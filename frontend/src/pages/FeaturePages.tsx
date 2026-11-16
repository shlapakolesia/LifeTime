import { useEffect, useMemo, useState } from "react";
import { addDays, formatDate, minutes, weekday } from "../data";
import { useStore } from "../store";
import type { CalendarEvent, Group, Slot, User } from "../types";
import { Avatar, Button, ConfirmDialog, Modal } from "../components/UI";
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

const membersWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "учасник";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "учасники";
  return "учасників";
};

export function GroupsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  const { groups, setGroups, users } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [toDelete, setToDelete] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setCreateError("");
    try {
      await setGroups([
        ...groups,
        {
          id: `g-${Date.now()}`,
          name: name.trim(),
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
      setCreateError(e instanceof Error ? e.message : "Не вдалося створити групу.");
    }
  };
  const removeGroup = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await setGroups(groups.filter((x) => x.id !== toDelete.id));
      setToDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Не вдалося видалити групу.");
    } finally {
      setDeleting(false);
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
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setCreateError("");
            }}
          >
            Скасувати
          </Button>
          {createError && <p className="form-error inline-create-error">{createError}</p>}
        </div>
      )}
      <div className="group-grid">
        {groups.map((g, i) => {
          const owner = g.ownerId === "me";
          return (
            <article className={`group-card group-${i % 3}`} key={g.id}>
              <div className="group-symbol" style={{ background: g.color }}>
                <Icon name="groups" />
              </div>
              <span className="group-count">
                {g.memberIds.length} {membersWord(g.memberIds.length)}
              </span>
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
                <Button
                  variant="secondary"
                  className="group-find"
                  onClick={() => goFind(g.memberIds.filter((id) => id !== "me"))}
                >
                  <Icon name="find" size={16} />
                  Знайти спільний час
                </Button>
              </div>
              <div className="group-manage">
                {apiMode && <GroupControls group={g} owner={owner} />}
                {owner && (
                  <button
                    type="button"
                    className="manage-btn danger icon-only"
                    title="Видалити групу"
                    aria-label="Видалити групу"
                    onClick={() => {
                      setDeleteError("");
                      setToDelete(g);
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {toDelete && (
        <ConfirmDialog
          title="Видалити групу?"
          danger
          busy={deleting}
          confirmLabel="Видалити групу"
          text={
            <>
              Групу <b>«{toDelete.name}»</b> буде видалено для всіх учасників. Цю дію не можна
              скасувати.
              {deleteError && <span className="dialog-error">{deleteError}</span>}
            </>
          }
          onConfirm={() => void removeGroup()}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

function ApiFriendsPage({ goFind }: { goFind: (ids?: string[]) => void }) {
  const { users } = useStore();
  const [friends, setFriends] = useState<{ friend: UserDto; shareAvailability: boolean }[]>([]);
  const [requests, setRequests] = useState<
    { id: string; senderId: string; recipientId: string; sender: UserDto }[]
  >([]);
  const [self, setSelf] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [inviting, setInviting] = useState(false),
    [loaded, setLoaded] = useState(false),
    [toRemove, setToRemove] = useState<User | null>(null),
    [removing, setRemoving] = useState(false);
  // The store already holds every known person with a loaded photo; prefer it over the bare DTO.
  const person = (dto: UserDto): User => users.find((x) => x.id === dto.id) ?? userDto(dto);
  async function load() {
    const [me, fs, rs] = await Promise.all([
      api.request<UserDto>("/api/profile"),
      api.request<typeof friends>("/api/friends"),
      api.request<typeof requests>("/api/friend-requests"),
    ]);
    setSelf(me.id);
    setFriends(fs);
    setRequests(rs);
    setLoaded(true);
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
  const invite = async () => {
    const address = email.trim();
    if (!address || inviting) return;
    setMessage("");
    setInviting(true);
    await action(async () => {
      const matches = await api.request<UserDto[]>(`/api/users?email=${encodeURIComponent(address)}`);
      if (!matches[0]) throw new Error("Користувача з такою email-адресою не знайдено.");
      await api.request("/api/friend-requests", {
        method: "POST",
        body: JSON.stringify({ recipientId: matches[0].id }),
      });
      setMessage("Запит надіслано.");
      setEmail("");
    });
    setInviting(false);
  };
  const incoming = requests.filter((r) => r.recipientId === self);
  const visible = friends.filter((f) =>
    `${f.friend.profile.firstName} ${f.friend.profile.lastName}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Твоє коло</span>
          <h1>Друзі</h1>
          <p>Додавай людей за точною email-адресою й ділись лише зайнятістю, без подробиць.</p>
        </div>
      </div>
      <form
        className="friend-invite"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <div>
          <b>Запросити друга</b>
          <p>Введи email, з яким людина зареєстрована в LifeTime.</p>
        </div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          aria-label="Email друга"
        />
        <Button type="submit" icon="friends" disabled={!email.trim() || inviting}>
          {inviting ? "Надсилаємо…" : "Запросити"}
        </Button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="success-note">{message}</p>}
      {incoming.map((r) => {
        const sender = person(r.sender);
        return (
          <div className="invite-banner" key={r.id}>
            <Avatar user={sender} />
            <div>
              <b>
                {sender.firstName} {sender.lastName}
              </b>
              <span>хоче додати тебе в друзі</span>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                action(() =>
                  api.request(`/api/friend-requests/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "rejected" }),
                  }),
                )
              }
            >
              Відхилити
            </Button>
            <Button
              onClick={() =>
                action(() =>
                  api.request(`/api/friend-requests/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "accepted" }),
                  }),
                )
              }
            >
              Прийняти
            </Button>
          </div>
        );
      })}
      {friends.length > 3 && (
        <label className="search-field page-search">
          <Icon name="search" size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Знайти друга"
          />
        </label>
      )}
      {loaded && !friends.length && (
        <div className="empty-state">
          <span>
            <Icon name="friends" />
          </span>
          <h3>Друзів поки немає</h3>
          <p>Запроси першого друга за email — і ви зможете знаходити спільний час.</p>
        </div>
      )}
      <div className="friend-grid">
        {visible.map((f) => {
          const u = person(f.friend);
          return (
            <article className="friend-card friend-card-v2" key={u.id}>
              <div className="friend-card-head">
                <Avatar user={u} size="lg" />
                <div>
                  <h3>
                    {u.firstName} {u.lastName}
                  </h3>
                  <p>{u.bio || "У твоєму колі"}</p>
                </div>
              </div>
              <label className="share-toggle">
                <span>
                  <b>Ділитися моєю зайнятістю</b>
                  <small>
                    {f.shareAvailability
                      ? "Друг бачить лише зайняті проміжки, без подробиць"
                      : "Друг не бачить, коли ти зайнята"}
                  </small>
                </span>
                <input
                  className="switch"
                  type="checkbox"
                  role="switch"
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
              <div className="friend-card-actions">
                <Button variant="secondary" onClick={() => goFind([u.id])}>
                  <Icon name="find" size={16} />
                  Знайти час
                </Button>
                <button
                  type="button"
                  className="icon-button danger-icon"
                  title="Видалити з друзів"
                  aria-label={`Видалити ${u.firstName} з друзів`}
                  onClick={() => setToRemove(u)}
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {toRemove && (
        <ConfirmDialog
          title="Видалити з друзів?"
          danger
          busy={removing}
          confirmLabel="Видалити"
          text={
            <>
              <b>
                {toRemove.firstName} {toRemove.lastName}
              </b>{" "}
              зникне зі списку друзів, а спільний пошук часу з цією людиною стане недоступним.
            </>
          }
          onConfirm={() => {
            setRemoving(true);
            void action(() => api.request(`/api/friends/${toRemove.id}`, { method: "DELETE" })).finally(
              () => {
                setRemoving(false);
                setToRemove(null);
              },
            );
          }}
          onClose={() => setToRemove(null)}
        />
      )}
    </div>
  );
}

function GroupControls({ group, owner }: { group: Group; owner: boolean }) {
  const { users, currentUser, reload } = useStore();
  const [dialog, setDialog] = useState<"edit" | "add" | "remove" | "leave" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [friends, setFriends] = useState<User[] | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const open = (next: typeof dialog) => {
    setError("");
    setPendingRemove(null);
    setName(group.name);
    setDescription(group.description);
    setDialog(next);
  };
  const close = () => {
    if (!busy) setDialog(null);
  };
  /** Runs an API call, refreshes the store (no page reload) and closes the dialog unless asked not to. */
  async function act(work: () => Promise<unknown>, keepOpen = false) {
    setBusy(true);
    setError("");
    try {
      await work();
      await reload?.();
      if (!keepOpen) setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося виконати дію.");
    } finally {
      setBusy(false);
    }
  }
  // Only friends can be added, so load them when the dialog opens instead of listing every known user.
  useEffect(() => {
    if (dialog !== "add") return;
    let live = true;
    setFriends(null);
    api
      .request<{ friend: UserDto }[]>("/api/friends?limit=100")
      .then((rows) => {
        if (live)
          setFriends(rows.map((r) => users.find((x) => x.id === r.friend.id) ?? userDto(r.friend)));
      })
      .catch((e) => {
        if (live) {
          setFriends([]);
          setError(e instanceof Error ? e.message : "Не вдалося завантажити друзів.");
        }
      });
    return () => {
      live = false;
    };
  }, [dialog]);
  const members = group.memberIds
    .filter((id) => id !== "me" && id !== group.ownerId)
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => Boolean(u));
  const candidates = (friends ?? []).filter((f) => !group.memberIds.includes(f.id));
  const fullName = (u: User) => `${u.firstName} ${u.lastName}`.trim();
  return (
    <>
      {owner ? (
        <>
          <button type="button" className="manage-btn" onClick={() => open("edit")}>
            <Icon name="edit" size={15} />
            Редагувати
          </button>
          <button type="button" className="manage-btn" onClick={() => open("add")}>
            <Icon name="plus" size={15} />
            Додати учасника
          </button>
          <button
            type="button"
            className="manage-btn"
            disabled={!members.length}
            onClick={() => open("remove")}
          >
            <Icon name="close" size={15} />
            Видалити учасника
          </button>
        </>
      ) : (
        <button type="button" className="manage-btn danger" onClick={() => open("leave")}>
          Вийти з групи
        </button>
      )}
      {dialog === "edit" && (
        <Modal title="Редагувати групу" onClose={close}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void act(() =>
                api.request(`/api/groups/${group.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ name: name.trim(), description }),
                }),
              );
            }}
          >
            <label className="field">
              <span>Назва групи</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
            <label className="field">
              <span>Опис</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions dialog-actions">
              <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                Скасувати
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Зберігаємо…" : "Зберегти"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "add" && (
        <Modal title="Додати учасника" onClose={close}>
          {error && <p className="form-error">{error}</p>}
          {friends === null ? (
            <p className="dialog-text">Завантажуємо друзів…</p>
          ) : candidates.length ? (
            <ul className="person-list">
              {candidates.map((u) => (
                <li key={u.id}>
                  <Avatar user={u} />
                  <span>
                    <b>{fullName(u)}</b>
                  </span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          api.request(`/api/groups/${group.id}/members`, {
                            method: "POST",
                            body: JSON.stringify({ userId: u.id }),
                          }),
                        true,
                      )
                    }
                  >
                    Додати
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dialog-text">
              Усі твої друзі вже в цій групі. Нових людей спершу додай на сторінці «Друзі».
            </p>
          )}
          <div className="modal-actions dialog-actions">
            <Button variant="secondary" onClick={close}>
              Готово
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal title="Видалити учасника" onClose={close}>
          {error && <p className="form-error">{error}</p>}
          {members.length ? (
            <ul className="person-list">
              {members.map((u) => (
                <li key={u.id}>
                  <Avatar user={u} />
                  <span>
                    <b>{fullName(u)}</b>
                  </span>
                  {pendingRemove === u.id ? (
                    <span className="person-confirm">
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              api.request(`/api/groups/${group.id}/members/${u.id}`, {
                                method: "DELETE",
                              }),
                            true,
                          ).then(() => setPendingRemove(null))
                        }
                      >
                        Видалити
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setPendingRemove(null)}>
                        Ні
                      </Button>
                    </span>
                  ) : (
                    <Button variant="danger" disabled={busy} onClick={() => setPendingRemove(u.id)}>
                      Видалити
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dialog-text">У групі немає інших учасників.</p>
          )}
          <div className="modal-actions dialog-actions">
            <Button variant="secondary" onClick={close}>
              Закрити
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "leave" && (
        <ConfirmDialog
          title="Вийти з групи?"
          danger
          busy={busy}
          confirmLabel="Вийти"
          text={
            <>
              Ти залишиш групу <b>«{group.name}»</b>. Повернутися зможеш лише за запрошенням
              власника.
              {error && <span className="dialog-error">{error}</span>}
            </>
          }
          onConfirm={() =>
            void act(() =>
              api.request(`/api/groups/${group.id}/members/${currentUser.id}`, { method: "DELETE" }),
            )
          }
          onClose={close}
        />
      )}
    </>
  );
}
