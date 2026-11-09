import { useEffect, useMemo, useState } from "react";
import { addDays, formatDate, minutes, weekday } from "../data";
import { useStore } from "../store";
import type { CalendarEvent, Slot } from "../types";
import { Avatar, Button } from "../components/UI";
import { Icon } from "../components/Icons";
import { apiMode } from "../config";
import { api } from "../services/apiClient";
import { userDto, type UserDto } from "../services/dto";
import { calculateAvailabilitySlots } from "../services/availabilityService";

export function FindTimePage({
  schedule,
  initialSelected = [],
}: {
  initialSelected?: string[];
  schedule: (prefill: Partial<CalendarEvent>) => void;
}) {
  const { users, events, groups, currentUser } = useStore();
  const [selected, setSelected] = useState<string[]>(
    apiMode ? initialSelected : ["sofia", "solomia"],
  );
  const [title, setTitle] = useState("Кава з друзями");
  const [duration, setDuration] = useState(60);
  const [durationMode, setDurationMode] = useState("60");
  const [customDuration, setCustomDuration] = useState("150");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours">("minutes");
  const [from, setFrom] = useState(addDays(0));
  const [to, setTo] = useState(addDays(6));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("20:00");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [durationError, setDurationError] = useState("");
  const [searching, setSearching] = useState(false);
  const toggle = (id: string) =>
    setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const resolveDuration = () => {
    const activeWindow = minutes(end) - minutes(start);
    const value =
      durationMode === "full"
        ? activeWindow
        : durationMode === "custom"
          ? Number(customDuration) * (customUnit === "hours" ? 60 : 1)
          : Number(durationMode);
    if (!Number.isFinite(value) || value < 15) {
      setDurationError("Мінімальна тривалість — 15 хвилин.");
      return null;
    }
    if (value > 1440) {
      setDurationError(
        "У цій версії підтримуються безперервні зустрічі тривалістю не більше 24 годин.",
      );
      return null;
    }
    if (value > activeWindow) {
      setDurationError(
        `Обрана тривалість не вміщується у дозволене вікно ${start}–${end}. Розшир активні години.`,
      );
      return null;
    }
    setDurationError("");
    setDuration(value);
    return value;
  };
  const calculate = async () => {
    const value = resolveDuration();
    if (!value) return;
    setSearching(true);
    if (apiMode) {
      try {
        const result = await api.request<Slot[]>("/api/availability", {
          method: "POST",
          body: JSON.stringify({
            participantIds: selected,
            startDate: from,
            endDate: to,
            durationMinutes: value,
            earliestHour: start,
            latestHour: end,
            timezone: currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        setSlots(
          result.map((slot) => ({
            ...slot,
            participantIds: slot.participantIds.map((id) => (id === currentUser.id ? "me" : id)),
          })),
        );
      } catch (e) {
        setDurationError(e instanceof Error ? e.message : "Помилка пошуку");
        setSlots(null);
      } finally {
        setSearching(false);
      }
      return;
    }
    window.setTimeout(() => {
      setSlots(
        calculateAvailabilitySlots(events, users, selected, from, to, start, end, value).slice(
          0,
          6,
        ),
      );
      setSearching(false);
    }, 450);
  };
  useEffect(() => {
    if (apiMode) {
      setSlots(null);
      return;
    }
    if (slots === null) return;
    const value = resolveDuration();
    if (value)
      setSlots(
        calculateAvailabilitySlots(events, users, selected, from, to, start, end, value).slice(
          0,
          6,
        ),
      );
    // Recalculate visible results whenever duration settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMode, customDuration, customUnit, selected.join(","), from, to, start, end]);
  const durationOptions = [
    ["15", "15 хв"],
    ["30", "30 хв"],
    ["45", "45 хв"],
    ["60", "1 год"],
    ["90", "1,5 год"],
    ["120", "2 год"],
    ["180", "3 год"],
    ["240", "4 год"],
    ["300", "5 год"],
    ["360", "6 год"],
    ["480", "8 год"],
    ["720", "12 год"],
    ["full", "Повний день"],
    ["custom", "Власна"],
  ];
  return (
    <div className="page find-page">
      <div className="find-hero">
        <div>
          <span className="eyebrow light">Серце LifeTime</span>
          <h1>
            Час, який
            <br />
            підходить усім.
          </h1>
          <p>
            Порівнюємо лише зайняті проміжки. Назви й деталі приватних подій завжди залишаються
            приватними.
          </p>
        </div>
        <div className="privacy-seal">
          <Icon name="check" />
          <span>
            <b>
              Приватність
              <br />
              за замовчуванням
            </b>
            <small>Без розкриття деталей</small>
          </span>
        </div>
      </div>
      <div className="find-layout">
        <section className="finder-panel">
          <div className="step-block">
            <span className="step-number">01</span>
            <div className="step-content">
              <h2>Хто зустрічається?</h2>
              <p>Твій календар враховується автоматично. Додай друзів або цілу групу.</p>
              <div className="current-participant">
                <Avatar user={users[0]} />
                <span>
                  <b>
                    {users[0].firstName} {users[0].lastName}
                  </b>
                  <small>Організатор · календар уже враховано</small>
                </span>
                <Icon name="check" size={16} />
              </div>
              <div className="selected-people">
                {selected.map((id) => (
                  <button className="person-pill selected" key={id} onClick={() => toggle(id)}>
                    <Avatar user={users.find((u) => u.id === id) || users[0]} size="sm" />
                    {users.find((u) => u.id === id)!.firstName}
                    <Icon name="close" size={13} />
                  </button>
                ))}
              </div>
              <div className="friend-picker">
                {users.slice(1).map((u) => (
                  <button
                    key={u.id}
                    className={selected.includes(u.id) ? "picked" : ""}
                    onClick={() => toggle(u.id)}
                  >
                    <Avatar user={u} />
                    <span>
                      <b>
                        {u.firstName} {u.lastName}
                      </b>
                      <small>Ділиться статусом зайнятості</small>
                    </span>
                    <i>
                      {selected.includes(u.id) ? (
                        <Icon name="check" size={14} />
                      ) : (
                        <Icon name="plus" size={14} />
                      )}
                    </i>
                  </button>
                ))}
              </div>
              <div className="group-chips">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelected(g.memberIds.filter((id) => id !== "me"))}
                  >
                    <span style={{ background: g.color }} />
                    <Icon name="groups" size={15} />
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="step-block">
            <span className="step-number">02</span>
            <div className="step-content">
              <h2>Який час шукаємо?</h2>
              <div className="finder-form">
                <label className="field span-2">
                  <span>Назва зустрічі</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <div className="field span-2">
                  <span>Тривалість зустрічі</span>
                  <div className="duration-options extended">
                    {durationOptions.map(([value, label]) => (
                      <button
                        className={durationMode === value ? "active" : ""}
                        key={value}
                        onClick={() => setDurationMode(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {durationMode === "full" && (
                    <small className="field-help">
                      Повний день означає весь вибраний активний проміжок {start}–{end} без поділу
                      на частини.
                    </small>
                  )}
                  {durationMode === "custom" && (
                    <div className="custom-duration">
                      <input
                        type="number"
                        min="0.25"
                        step="0.25"
                        value={customDuration}
                        onChange={(e) => setCustomDuration(e.target.value)}
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value as "minutes" | "hours")}
                      >
                        <option value="minutes">хвилин</option>
                        <option value="hours">годин</option>
                      </select>
                    </div>
                  )}
                  {durationError && <small className="duration-error">{durationError}</small>}
                </div>
                <label className="field">
                  <span>Від</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span>До</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Не раніше</span>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="field">
                  <span>Не пізніше</span>
                  <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </div>
              <Button
                className="calculate-button"
                icon="spark"
                onClick={calculate}
                disabled={!title.trim() || searching}
              >
                {searching ? "Перевіряємо календарі…" : "Знайти спільний час"}
              </Button>
            </div>
          </div>
        </section>
        <section className="results-panel">
          {!slots && (
            <div className="result-intro">
              <div className="overlap-graphic">
                <span />
                <span />
                <span />
                <i>
                  <Icon name="spark" />
                </i>
              </div>
              <h2>Тут з’являться найкращі варіанти</h2>
              <p>
                LifeTime перевірить реальні зайняті проміжки кожного й покаже лише ті, що справді
                працюють.
              </p>
              <div className="trust-note">
                <Icon name="check" size={16} />
                Результати не генеруються випадково
              </div>
            </div>
          )}
          {slots && slots.length > 0 && (
            <div className="slot-results">
              <div className="results-heading">
                <span className="eyebrow">Знайдено {slots.length} варіантів</span>
                <h2>Найкращі збіги</h2>
                <p>Розраховано на основі поточних календарів.</p>
              </div>
              {slots.slice(0, 4).map((slot, i) => (
                <article
                  className={`slot-card ${i === 0 ? "best" : ""}`}
                  key={`${slot.date}-${slot.start}`}
                >
                  {i === 0 && (
                    <span className="best-label">
                      <Icon name="spark" size={13} />
                      Найкращий варіант
                    </span>
                  )}
                  <div className="slot-date">
                    <b>
                      {new Intl.DateTimeFormat("uk-UA", { day: "numeric" }).format(
                        new Date(slot.date + "T12:00:00"),
                      )}
                    </b>
                    <span>
                      {weekday(slot.date).slice(0, 2)}
                      <br />
                      {new Intl.DateTimeFormat("uk-UA", { month: "short" }).format(
                        new Date(slot.date + "T12:00:00"),
                      )}
                    </span>
                  </div>
                  <div className="slot-main">
                    <h3>
                      {slot.start}–{slot.end}
                    </h3>
                    <p>{slot.reason}</p>
                    <div className="mini-avatars">
                      {slot.participantIds.map((id) => (
                        <Avatar
                          key={id}
                          user={users.find((u) => u.id === id) || users[0]}
                          size="sm"
                        />
                      ))}
                      <span>Усі вільні</span>
                    </div>
                  </div>
                  <Button
                    variant={i === 0 ? "primary" : "secondary"}
                    onClick={() =>
                      schedule({
                        title,
                        date: slot.date,
                        start: slot.start,
                        end: slot.end,
                        participantIds: selected,
                        category: "Друзі",
                        privacy: "shared",
                        recheckAvailability: true,
                      })
                    }
                  >
                    Запланувати
                  </Button>
                </article>
              ))}
              {!apiMode && (
                <div className="availability-map">
                  <div className="map-head">
                    <b>Чому цей час працює</b>
                    <span>Вільно</span>
                  </div>
                  {["me", ...selected].map((id) => (
                    <div className="map-row" key={id}>
                      <Avatar user={users.find((u) => u.id === id) || users[0]} size="sm" />
                      <div>
                        <i style={{ left: "22%", width: "48%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {slots && !slots.length && (
            <div className="empty-state large">
              <span>
                <Icon name="clock" />
              </span>
              <h2>Спільного вікна поки немає</h2>
              <p>
                {duration >= 480
                  ? "Тривала зустріч не вміщується у спільні активні години. Спробуй розширити часовий проміжок, додати дні або скоротити тривалість."
                  : "Спробуй розширити діапазон дат, скоротити тривалість або дозволити трохи пізніший час."}
              </p>
              <Button
                onClick={() => {
                  setTo(addDays(14));
                  setDurationMode("30");
                  setSlots(null);
                }}
              >
                Розширити пошук
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function FriendsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  return apiMode ? <ApiFriendsPage goFind={goFind} /> : <DemoFriendsPage goFind={goFind} />;
}
function DemoFriendsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  const { users } = useStore();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(true);
  const [removed, setRemoved] = useState<string[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Твоє коло</span>
          <h1>Друзі</h1>
          <p>Бачте, коли ви вільні, а не чому ви зайняті.</p>
        </div>
        <Button icon="friends" onClick={() => setInviteOpen(!inviteOpen)}>
          Запросити друга
        </Button>
      </div>
      {inviteOpen && (
        <div className="inline-invite">
          <div>
            <b>Код запрошення</b>
            <p>Надішли цей код другові, щоб додати зв’язок у поточній версії.</p>
          </div>
          <code>LIFETIME-OLESIA-24</code>
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard?.writeText("LIFETIME-OLESIA-24")}
          >
            Копіювати код
          </Button>
        </div>
      )}
      {pending && (
        <div className="invite-banner">
          <Avatar
            user={{
              ...users[2],
              firstName: "Ірина",
              lastName: "Бондар",
              initials: "ІБ",
              color: "#bd654f",
            }}
          />
          <div>
            <b>Ірина Бондар хоче додати тебе в друзі</b>
            <span>2 спільних друзів</span>
          </div>
          <Button variant="secondary" onClick={() => setPending(false)}>
            Відхилити
          </Button>
          <Button onClick={() => setPending(false)}>Прийняти</Button>
        </div>
      )}
      <label className="search-field page-search">
        <Icon name="search" size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Знайти друга"
        />
      </label>
      <div className="friend-grid">
        {users
          .slice(1)
          .filter(
            (u) =>
              !removed.includes(u.id) &&
              `${u.firstName} ${u.lastName}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((u) => (
            <article className="friend-card" key={u.id}>
              <div className="friend-top">
                <Avatar user={u} size="lg" />
                <span className="online-dot" />
                <button
                  className="icon-button"
                  title="Видалити друга"
                  onClick={() => {
                    if (confirm(`Видалити ${u.firstName} з друзів?`))
                      setRemoved([...removed, u.id]);
                  }}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
              <h3>
                {u.firstName} {u.lastName}
              </h3>
              <p>{u.role}</p>
              <div className="sharing-status">
                <Icon name="check" size={14} />
                Ділиться лише статусом зайнятості
              </div>
              <div className="friend-actions">
                <Button variant="secondary" onClick={() => goFind([u.id])}>
                  <Icon name="find" size={16} />
                  Знайти час
                </Button>
              </div>
            </article>
          ))}
      </div>
    </div>
  );
}

export function GroupsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  const { groups, setGroups, users } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    try {
      await setGroups([
        ...groups,
        {
          id: `g-${Date.now()}`,
          name,
          description,
          memberIds: ["me"],
          ownerId: "me",
          color: "#7057d8",
        },
      ]);
      setName("");
      setDescription("");
      setCreating(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Помилка створення");
    }
  };
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Разом простіше</span>
          <h1>Групи</h1>
          <p>Команди, навчання й друзі — кожен спільний план в одному місці.</p>
        </div>
        <Button icon="plus" onClick={() => setCreating(true)}>
          Створити групу
        </Button>
      </div>
      {creating && (
        <div className="inline-create">
          <label className="field">
            <span>Назва групи</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Наприклад, Книжковий клуб"
            />
          </label>
          <label className="field">
            <span>Опис</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Що вас об’єднує?"
            />
          </label>
          <Button onClick={create}>Створити</Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Скасувати
          </Button>
        </div>
      )}
      <div className="group-grid">
        {groups.map((g, i) => (
          <article className={`group-card group-${i % 3}`} key={g.id}>
            <div className="group-symbol" style={{ background: g.color }}>
              <Icon name="groups" />
            </div>
            <span className="group-count">{g.memberIds.length} учасники</span>
            <h2>{g.name}</h2>
            <p>{g.description}</p>
            <div className="member-stack">
              {g.memberIds.map((id) => (
                <Avatar key={id} user={users.find((u) => u.id === id) || users[0]} />
              ))}
            </div>
            <div className="group-next">
              <span>Наступна зустріч</span>
              <b>{"Перегляньте календар"}</b>
            </div>
            <div className="group-actions">
              {apiMode && <GroupControls groupId={g.id} owner={g.ownerId === "me"} />}
              <Button
                variant="secondary"
                onClick={() => goFind(g.memberIds.filter((id) => id !== "me"))}
              >
                Знайти спільний час
              </Button>
              {g.ownerId === "me" && (
                <button
                  className="icon-button"
                  onClick={() => {
                    if (confirm("Видалити групу?")) setGroups(groups.filter((x) => x.id !== g.id));
                  }}
                >
                  <Icon name="trash" size={17} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ApiFriendsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  const [friends, setFriends] = useState<{ friend: UserDto; shareAvailability: boolean }[]>([]);
  const [requests, setRequests] = useState<
    { id: string; senderId: string; recipientId: string; sender: UserDto }[]
  >([]);
  const [self, setSelf] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const [me, fs, rs] = await Promise.all([
      api.request<UserDto>("/api/profile"),
      api.request<typeof friends>("/api/friends"),
      api.request<typeof requests>("/api/friend-requests"),
    ]);
    setSelf(me.id);
    setFriends(fs);
    setRequests(rs);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(work: () => Promise<unknown>) {
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка API");
    }
  }
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Твоє коло</span>
          <h1>Друзі</h1>
          <p>Пошук за точною email-адресою.</p>
        </div>
      </div>
      <div className="inline-invite">
        <label className="field">
          <span>Email друга</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <Button
          onClick={() =>
            action(async () => {
              const matches = await api.request<UserDto[]>(
                `/api/users?email=${encodeURIComponent(email)}`,
              );
              if (!matches[0]) throw new Error("Користувача не знайдено.");
              await api.request("/api/friend-requests", {
                method: "POST",
                body: JSON.stringify({ recipientId: matches[0].id }),
              });
              setMessage("Запит надіслано.");
            })
          }
        >
          Запросити друга
        </Button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {message && <p>{message}</p>}
      {requests
        .filter((r) => r.recipientId === self)
        .map((r) => (
          <div className="invite-banner" key={r.id}>
            <Avatar user={userDto(r.sender)} />
            <b>
              {r.sender.profile.firstName} {r.sender.profile.lastName}
            </b>
            {(["rejected", "accepted"] as const).map((status) => (
              <Button
                key={status}
                onClick={() =>
                  action(() =>
                    api.request(`/api/friend-requests/${r.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ status }),
                    }),
                  )
                }
              >
                {status === "accepted" ? "Прийняти" : "Відхилити"}
              </Button>
            ))}
          </div>
        ))}
      <div className="friend-grid">
        {friends.map((f) => {
          const u = userDto(f.friend);
          return (
            <article className="friend-card" key={u.id}>
              <Avatar user={u} size="lg" />
              <h3>
                {u.firstName} {u.lastName}
              </h3>
              <label className="field">
                <span>Ділитися моєю зайнятістю</span>
                <input
                  type="checkbox"
                  checked={f.shareAvailability}
                  onChange={(e) =>
                    action(() =>
                      api.request(`/api/friends/${u.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ shareAvailability: e.target.checked }),
                      }),
                    )
                  }
                />
              </label>
              <div className="friend-actions">
                <Button variant="secondary" onClick={() => goFind([u.id])}>
                  Знайти час
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm("Видалити друга?"))
                      void action(() => api.request(`/api/friends/${u.id}`, { method: "DELETE" }));
                  }}
                >
                  Видалити
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function GroupControls({ groupId, owner }: { groupId: string; owner: boolean }) {
  const { users, currentUser } = useStore();
  async function act(work: () => Promise<unknown>) {
    try {
      await work();
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Помилка групи");
    }
  }
  return (
    <>
      {owner && (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              const name = prompt("Нова назва групи");
              if (name) {
                const description = prompt("Опис групи") || "";
                void act(() =>
                  api.request(`/api/groups/${groupId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, description }),
                  }),
                );
              }
            }}
          >
            Редагувати
          </Button>
          <select
            aria-label="Додати учасника"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                void act(() =>
                  api.request(`/api/groups/${groupId}/members`, {
                    method: "POST",
                    body: JSON.stringify({ userId: e.target.value }),
                  }),
                );
            }}
          >
            <option value="">Додати учасника</option>
            {users.slice(1).map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            onClick={() => {
              const userId = prompt(
                "ID учасника для видалення (видно в списку нижче):\n" +
                  users
                    .slice(1)
                    .map((u) => `${u.firstName}: ${u.id}`)
                    .join("\n"),
              );
              if (userId)
                void act(() =>
                  api.request(`/api/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
                );
            }}
          >
            Видалити учасника
          </Button>
        </>
      )}
      {!owner && (
        <Button
          variant="ghost"
          onClick={() =>
            act(() =>
              api.request(`/api/groups/${groupId}/members/${currentUser.id}`, { method: "DELETE" }),
            )
          }
        >
          Вийти з групи
        </Button>
      )}
    </>
  );
}
