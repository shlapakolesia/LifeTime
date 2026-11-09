import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  defaultSettings,
  loadStored,
  seedEvents,
  seedGroups,
  seedNotifications,
  seedTasks,
  users,
} from "./data";
import type {
  AppNotification,
  CalendarEvent,
  Group,
  PremiumRequest,
  Settings,
  Task,
  User,
} from "./types";
import { avatarUploadService } from "./services/avatarService";
import { apiMode } from "./config";
import { RemoteStoreProvider } from "./remoteStore";
import { premiumRequestService } from "./services/premiumRequestService";

export interface Store {
  users: User[];
  accounts: Record<string, User>;
  setAccounts: React.Dispatch<React.SetStateAction<Record<string, User>>>;
  currentUser: User;
  setCurrentUser: React.Dispatch<React.SetStateAction<User>>;
  events: CalendarEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  premiumRequests: PremiumRequest[];
  setPremiumRequests: React.Dispatch<React.SetStateAction<PremiumRequest[]>>;
}

export const StoreContext = createContext<Store | null>(null);

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User>(() => {
    const stored = loadStored("current-user", users[0]);
    return { ...stored, email: stored.email.replace(/\.(?:d)(?:e)(?:m)(?:o)$/, ".local") };
  });
  const [accounts, setAccounts] = useState<Record<string, User>>(() =>
    loadStored("accounts", { [users[0].email.toLowerCase()]: users[0] }),
  );
  const [events, setEvents] = useState(() => loadStored("events", seedEvents));
  const [tasks, setTasks] = useState(() => loadStored("tasks", seedTasks));
  const [groups, setGroups] = useState(() => loadStored("groups", seedGroups));
  const [notifications, setNotifications] = useState(() =>
    loadStored("notifications", seedNotifications),
  );
  const [settings, setSettings] = useState(() => loadStored("settings", defaultSettings));
  const [premiumRequests, setPremiumRequests] = useState<PremiumRequest[]>(() =>
    loadStored("premium-requests", []),
  );
  useEffect(
    () =>
      localStorage.setItem(
        "lifetime:current-user",
        JSON.stringify({ ...currentUser, avatarUrl: undefined }),
      ),
    [currentUser],
  );
  useEffect(
    () => setAccounts((old) => ({ ...old, [currentUser.email.toLowerCase()]: currentUser })),
    [currentUser],
  );
  useEffect(
    () =>
      localStorage.setItem(
        "lifetime:accounts",
        JSON.stringify(
          Object.fromEntries(
            Object.entries(accounts).map(([email, user]) => [
              email,
              { ...user, avatarUrl: undefined },
            ]),
          ),
        ),
      ),
    [accounts],
  );
  useEffect(() => localStorage.setItem("lifetime:events", JSON.stringify(events)), [events]);
  useEffect(() => localStorage.setItem("lifetime:tasks", JSON.stringify(tasks)), [tasks]);
  useEffect(() => localStorage.setItem("lifetime:groups", JSON.stringify(groups)), [groups]);
  useEffect(
    () => localStorage.setItem("lifetime:notifications", JSON.stringify(notifications)),
    [notifications],
  );
  useEffect(() => localStorage.setItem("lifetime:settings", JSON.stringify(settings)), [settings]);
  useEffect(
    () =>
      localStorage.setItem(
        "lifetime:premium-requests",
        JSON.stringify(
          premiumRequests.map((request) => ({ ...request, screenshotDataUrl: undefined })),
        ),
      ),
    [premiumRequests],
  );
  useEffect(() => {
    if (currentUser.avatarUrl) return;
    avatarUploadService
      .load(currentUser.id)
      .then((avatarUrl) => avatarUrl && setCurrentUser((user) => ({ ...user, avatarUrl })));
  }, [currentUser.id, currentUser.avatarUrl]);
  useEffect(() => {
    premiumRequests
      .filter((request) => !request.screenshotDataUrl)
      .forEach((request) => {
        premiumRequestService
          .getScreenshot(request.id)
          .then(
            (screenshotDataUrl) =>
              screenshotDataUrl &&
              setPremiumRequests((items) =>
                items.map((item) =>
                  item.id === request.id ? { ...item, screenshotDataUrl } : item,
                ),
              ),
          );
      });
  }, [premiumRequests]);
  const appUsers = useMemo(() => [{ ...currentUser, id: "me" }, ...users.slice(1)], [currentUser]);
  const value = useMemo(
    () => ({
      users: appUsers,
      accounts,
      setAccounts,
      currentUser,
      setCurrentUser,
      events,
      setEvents,
      tasks,
      setTasks,
      groups,
      setGroups,
      notifications,
      setNotifications,
      settings,
      setSettings,
      premiumRequests,
      setPremiumRequests,
    }),
    [
      appUsers,
      accounts,
      currentUser,
      events,
      tasks,
      groups,
      notifications,
      settings,
      premiumRequests,
    ],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("StoreProvider missing");
  return value;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  return apiMode ? (
    <RemoteStoreProvider>{children}</RemoteStoreProvider>
  ) : (
    <DemoStoreProvider>{children}</DemoStoreProvider>
  );
}
