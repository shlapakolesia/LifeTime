import { useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { StoreContext, type Store } from "./store";
import { useAuth } from "./auth/AuthProvider";
import { api, privateImage } from "./services/apiClient";
import {
  userDto,
  eventDto,
  groupDto,
  premiumDto,
  toInstant,
  wallDateTime,
  type UserDto,
  type EventDto,
  type TaskDto,
  type GroupDto,
  type PremiumDto,
} from "./services/dto";
import { defaultSettings, users as demoUsers } from "./data";
import type { User, CalendarEvent, Task, Group, AppNotification, PremiumRequest } from "./types";

export function RemoteStoreProvider({ children }: { children: ReactNode }) {
  const { user: identity, isAuthenticated, signOut } = useAuth();
  const identityRef = useRef(identity?.email);
  identityRef.current = identity?.email;
  const [currentUser, setUser] = useState<User>(demoUsers[0]);
  const [users, setUsers] = useState<User[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [groups, setGroups] = useState<Group[]>([]),
    [notifications, setNotifications] = useState<AppNotification[]>([]),
    [premiumRequests, setPremiumRequests] = useState<PremiumRequest[]>([]);
  const [settings, setSettings] = useState(defaultSettings),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  async function all<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await api.request<T[]>(`${path}?limit=100&offset=${offset}`);
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  }
  async function refresh() {
    const identityAtStart = identity?.email;
    const me = await api.request<UserDto>("/api/profile");
    const zone = me.profile.timezone;
    const [es, ts, gs, ns, fs, ps] = await Promise.all([
      all<EventDto>("/api/events"),
      all<TaskDto>("/api/tasks"),
      all<GroupDto>("/api/groups"),
      all<AppNotification & { createdAt: string }>("/api/notifications"),
      all<{ friend: UserDto }>("/api/friends"),
      all<PremiumDto>(
        me.accountRole === "admin" ? "/api/admin/premium-requests" : "/api/premium/requests",
      ),
    ]);
    const mappedMe = userDto(me);
    if (me.profile.avatarId) mappedMe.avatarUrl = await privateImage(me.profile.avatarId);
    const known = new Map<string, UserDto>();
    for (const f of fs) known.set(f.friend.id, f.friend);
    for (const g of gs) for (const m of g.members) if (m.user) known.set(m.userId, m.user);
    const others = await Promise.all(
      [...known.values()]
        .filter((u) => u.id !== me.id)
        .map(async (u) => {
          const mapped = userDto(u);
          if (u.profile.avatarId) mapped.avatarUrl = await privateImage(u.profile.avatarId);
          return mapped;
        }),
    );
    const requests = ps.map(premiumDto);
    for (let i = 0; i < requests.length; i++)
      requests[i].screenshotDataUrl = await privateImage(ps[i].screenshotId);
    if (identityAtStart !== identityRef.current) return;
    setUser(mappedMe);
    setUsers([{ ...mappedMe, id: "me" }, ...others]);
    setEvents(es.map((e) => eventDto(e, me.id, zone)));
    setTasks(
      ts.map((t) => ({
        ...t,
        deadline: t.deadline ? wallDateTime(t.deadline, zone).slice(0, 10) : "",
      })),
    );
    setGroups(gs.map((g) => groupDto(g, me.id)));
    setNotifications(
      ns.map((n) => ({ ...n, time: new Date(n.createdAt).toLocaleString("uk-UA") })),
    );
    setPremiumRequests(requests);
    setSettings((s) => ({
      ...s,
      activeStart: me.profile.activeStart,
      activeEnd: me.profile.activeEnd,
      sharing: me.profile.sharing,
    }));
    setReady(true);
  }
  useEffect(() => {
    if (!isAuthenticated) {
      setReady(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    refresh()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [isAuthenticated, identity?.email]);
  // Pull invitations and calendar changes made by other users without a manual reload.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      if (!document.hidden) refreshRef.current().catch(() => undefined);
    };
    const timer = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [isAuthenticated, identity?.email]);
  async function mutate(work: () => Promise<unknown>) {
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка API");
      throw e;
    }
  }
  const apply = <T,>(change: SetStateAction<T>, old: T): T =>
    typeof change === "function" ? (change as (old: T) => T)(old) : change;
  // Existing components use array setters. Persist only changed records and update UI after API success.
  function sync<T extends { id: string }>(
    old: T[],
    change: SetStateAction<T[]>,
    path: string,
    encode: (v: T) => unknown,
  ) {
    const next = apply(change, old);
    return mutate(async () => {
      for (const item of old)
        if (!next.some((n) => n.id === item.id))
          await api.request(`${path}/${item.id}`, { method: "DELETE" });
      for (const item of next) {
        const previous = old.find((o) => o.id === item.id);
        if (JSON.stringify(previous) === JSON.stringify(item)) continue;
        await api.request(previous ? `${path}/${item.id}` : path, {
          method: previous ? "PUT" : "POST",
          body: JSON.stringify(encode(item)),
        });
      }
    });
  }
  useEffect(
    () => () => {
      for (const url of [
        currentUser.avatarUrl,
        ...users.map((u) => u.avatarUrl),
        ...premiumRequests.map((p) => p.screenshotDataUrl),
      ])
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [currentUser.avatarUrl, users, premiumRequests],
  );
  const zone = currentUser.timezone || "Europe/Kyiv";
  const value: Store = {
    users,
    accounts: {},
    setAccounts: () => {},
    currentUser,
    setCurrentUser: (change) =>
      mutate(async () => {
        const u = apply(change, currentUser);
        await api.request("/api/profile", {
          method: "PATCH",
          body: JSON.stringify({
            bio: u.bio || "",
            firstName: u.firstName,
            lastName: u.lastName,
            timezone: u.timezone || zone,
            activeStart: u.activeStart,
            activeEnd: u.activeEnd,
            sharing: u.sharing,
          }),
        });
      }),
    events,
    setEvents: (change) =>
      sync(events, change, "/api/events", (e) => ({
        title: e.title,
        description: e.description,
        startsAt: toInstant(e.date, e.start, zone),
        endsAt: toInstant(e.endDate || e.date, e.end, zone),
        timezone: zone,
        category: e.category,
        location: e.location,
        privacy: e.privacy,
        participantIds: e.participantIds.filter((i) => i !== "me"),
        recheckAvailability: e.recheckAvailability || false,
      })),
    tasks,
    setTasks: (change) =>
      sync(tasks, change, "/api/tasks", (t) => ({
        title: t.title,
        description: t.description,
        deadline: t.deadline ? toInstant(t.deadline, "23:59", zone) : null,
        priority: t.priority,
        completed: t.completed,
        estimatedMinutes: t.estimatedMinutes,
        scheduledStart: t.scheduledStart,
        scheduledEnd: t.scheduledEnd,
      })),
    groups,
    setGroups: (change) => {
      const next = apply(change, groups);
      return mutate(async () => {
        for (const g of groups)
          if (!next.some((n) => n.id === g.id))
            await api.request(`/api/groups/${g.id}`, { method: "DELETE" });
        for (const g of next)
          if (!groups.some((o) => o.id === g.id))
            await api.request("/api/groups", {
              method: "POST",
              body: JSON.stringify({ name: g.name, description: g.description }),
            });
      });
    },
    notifications,
    setNotifications: (change) => {
      const next = apply(change, notifications);
      return mutate(async () => {
        for (const n of notifications) {
          const v = next.find((v) => v.id === n.id);
          if (!v) await api.request(`/api/notifications/${n.id}`, { method: "DELETE" });
          else if (v.read !== n.read)
            await api.request(`/api/notifications/${n.id}`, {
              method: "PATCH",
              body: JSON.stringify({ read: v.read }),
            });
        }
      });
    },
    settings,
    setSettings: (change) => {
      const s = apply(change, settings);
      return mutate(async () => {
        await api.request("/api/profile", {
          method: "PATCH",
          body: JSON.stringify({
            bio: currentUser.bio || "",
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            timezone: zone,
            activeStart: s.activeStart,
            activeEnd: s.activeEnd,
            sharing: s.sharing,
          }),
        });
        setSettings(s);
      });
    },
    premiumRequests,
    setPremiumRequests: () => mutate(refresh),
  };
  // Public pages can render before sign-in. Protected pages never receive fixture data.
  if (isAuthenticated && (loading || !ready))
    return (
      <div className="page">
        <p>{error || "Завантажуємо LifeTime…"}</p>
        {error && (
          <button
            className="button"
            onClick={() => {
              setLoading(true);
              refresh()
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            Повторити
          </button>
        )}
        {error && (
          <button className="button" onClick={() => void signOut()}>
            Вийти
          </button>
        )}
      </div>
    );
  return (
    <StoreContext.Provider value={value}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </StoreContext.Provider>
  );
}
