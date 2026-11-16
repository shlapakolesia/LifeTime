import { apiMode } from "../config";
import { useEffect, useRef, useState } from "react";
import { addDays, formatDate } from "../data";
import { useStore } from "../store";
import { Avatar, Button } from "../components/UI";
import { Icon } from "../components/Icons";
import { avatarUploadService, validateImage } from "../services/avatarService";
import { smartSchedulingService, type SmartDraft } from "../services/smartSchedulingService";
import { aiService, type AiHistoryTurn, type AiProposal } from "../services/aiService";
import { calculateAvailabilitySlots } from "../services/availabilityService";
import { minutes } from "../data";

export function AssistantPage({
  goCalendar,
  goFind,
}: {
  goCalendar: () => void;
  goFind: () => void;
}) {
  const { events, setEvents, tasks, setTasks, users, settings, reload } = useStore();
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string; action?: "calendar" }[]
  >([
    {
      role: "ai",
      text: apiMode
        ? "Опиши подію або завдання своїми словами. Я підготую пропозицію, а зберігається вона лише після твого підтвердження."
        : "Я аналізую локальні події та завдання за визначеними правилами. Опиши зустріч або завдання для підтвердження.",
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState<SmartDraft | null>(null);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const messagesBox = useRef<HTMLDivElement>(null);
  // Keep the newest message in view; only the message list scrolls, never the whole page.
  useEffect(() => {
    const box = messagesBox.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [messages, typing, proposal, draft]);
  const askAi = async (text: string) => {
    // The first message is the static greeting; buttons and confirmations are not part of the dialogue.
    const history: AiHistoryTurn[] = messages
      .slice(1)
      .filter((m) => !m.action)
      .slice(-8)
      .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", text: m.text.slice(0, 1000) }));
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setProposal(null);
    setTyping(true);
    try {
      const result = await aiService.interpret(text, history);
      setMessages((m) => [...m, { role: "ai", text: result.message }]);
      if (result.type === "proposal") setProposal(result.proposal);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: error instanceof Error ? error.message : "Не вдалося отримати відповідь помічника.",
        },
      ]);
    } finally {
      setTyping(false);
    }
  };
  const confirmProposal = async () => {
    if (!proposal || confirming) return;
    setConfirming(true);
    try {
      await aiService.confirm(proposal);
      await reload?.();
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text:
            proposal.kind === "event"
              ? `Готово: подію «${proposal.data.title}» створено.`
              : `Готово: завдання «${proposal.data.title}» додано.`,
          action: "calendar",
        },
      ]);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text:
            (error instanceof Error ? error.message : "Не вдалося зберегти.") +
            " Нічого не створено. Опиши інший час.",
        },
      ]);
    } finally {
      setProposal(null);
      setConfirming(false);
    }
  };
  const answer = (text: string) => {
    if (apiMode) {
      void askAi(text);
      return;
    }
    const q = text.toLowerCase();
    let response =
      "Я можу допомогти з вільним часом, найближчими дедлайнами або плануванням зустрічі.";
    const parsed = smartSchedulingService.interpret(text, {
      events,
      users,
      activeStart: settings.activeStart,
      activeEnd: settings.activeEnd,
    });
    if ("draft" in parsed) {
      setDraft(parsed.draft);
      response =
        parsed.draft.kind === "event"
          ? "Я розпізнала зустріч і перевірила календарі. Переглянь деталі перед створенням."
          : "Я розпізнала завдання й знайшла безперервне вікно до дедлайну. Перевір план перед створенням.";
    } else if ("clarification" in parsed) response = parsed.clarification;
    else if (q.includes("вільн") || q.includes("завтра")) {
      const tomorrow = events.filter((e) => e.ownerId === "me" && e.date === addDays(1));
      response = tomorrow.length
        ? `Завтра маєш ${tomorrow.length} події. Найдовше вільне вікно — після ${tomorrow.sort((a, b) => b.end.localeCompare(a.end))[0].end}. Перевір календар, щоб побачити весь день.`
        : "Завтра календар вільний з 08:00 до 21:00. Гарна нагода залишити час для себе.";
    } else if (q.includes("дедлайн")) {
      const open = tasks
        .filter((t) => !t.completed)
        .sort((a, b) => a.deadline.localeCompare(b.deadline));
      response = open.length
        ? `Найближче: «${open[0].title}» — ${open[0].deadline === addDays(0) ? "сьогодні" : formatDate(open[0].deadline)}. Після нього ще ${Math.max(0, open.length - 1)} активні завдання.`
        : "Активних дедлайнів немає. Чудова робота.";
    } else if (q.includes("соф") || q.includes("зустріч") || q.includes("друз"))
      response =
        "Перейди до «Знайти час»: я підготувала порівняння зайнятих проміжків без розкриття приватних деталей.";
    else if (q.includes("іспит") || q.includes("підгот"))
      response =
        "Раджу три фокус-сесії по 50 хвилин із перервами. Почни з найближчого вільного ранкового вікна й створи окремі завдання для кожної теми.";
    else
      response =
        "Я підтримую планування зустрічей із друзями та завдань із дедлайном. Вкажи день, тривалість і, для зустрічі, імена учасників.";
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMessages((m) => [...m, { role: "ai", text: response }]);
      setTyping(false);
    }, 650);
  };
  const confirmDraft = () => {
    if (!draft) return;
    if (draft.kind === "task" && draft.slot.date > draft.deadline) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: "Запропонована фокус-сесія пізніше за дедлайн. Зміни дедлайн або опиши інший бажаний час — нічого не створено.",
        },
      ]);
      return;
    }
    const duration = draft.durationMinutes;
    const participants = draft.kind === "event" ? draft.participantIds : [];
    const available = calculateAvailabilitySlots(
      events,
      users,
      participants,
      draft.slot.date,
      draft.slot.date,
      draft.slot.start,
      draft.slot.end,
      duration,
    ).some((slot) => slot.start === draft.slot.start);
    if (!available) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: "Цей час уже зайнятий або не вміщується в активні години. Опиши інший бажаний час — нічого не створено.",
        },
      ]);
      setDraft(null);
      return;
    }
    if (draft.kind === "event") {
      const created = {
        id: `smart-event-${Date.now()}`,
        title: draft.title,
        description: "Створено після підтвердження у Розумному плануванні.",
        date: draft.slot.date,
        start: draft.slot.start,
        end: draft.slot.end,
        category: "Друзі" as const,
        location: draft.location,
        participantIds: draft.participantIds,
        ownerId: "me",
        privacy: "shared" as const,
      };
      setEvents([...events, created]);
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: `Готово: подію «${draft.title}» створено на ${formatDate(draft.slot.date)}, ${draft.slot.start}–${draft.slot.end}.`,
          action: "calendar",
        },
      ]);
    } else {
      const task = {
        id: `smart-task-${Date.now()}`,
        title: draft.title,
        description: `Заплановано ${draft.durationMinutes} хвилин фокусної роботи.`,
        deadline: draft.deadline,
        priority: draft.priority,
        completed: false,
      };
      const workEvent = {
        id: `smart-work-${Date.now()}`,
        title: `Робота над завданням: ${draft.title}`,
        description: "Фокус-сесія для виконання завдання.",
        date: draft.slot.date,
        start: draft.slot.start,
        end: draft.slot.end,
        category: "Навчання" as const,
        location: "",
        participantIds: [],
        ownerId: "me",
        privacy: "busy" as const,
      };
      setTasks([...tasks, task]);
      setEvents([...events, workEvent]);
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: `Завдання додано, а час ${formatDate(draft.slot.date)}, ${draft.slot.start}–${draft.slot.end} заброньовано в календарі.`,
          action: "calendar",
        },
      ]);
    }
    setDraft(null);
  };
  const prompts = [
    "Заплануй зустріч із Софією наступного четверга на 2 години після 15:00",
    "Підготувати презентацію до пʼятниці, треба 3 години, пріоритет високий",
    "Коли я вільна завтра?",
  ];
  return (
    <div className="page assistant-page">
      <div className="assistant-shell">
        <aside className="assistant-aside">
          <div>
            <span className="assistant-mark">
              <Icon name="spark" />
            </span>
            <span className="rules-label">Розумне планування</span>
            <h1>
              Плани стають
              <br />
              простішими.
            </h1>
            <p>
              Опиши подію або завдання природною мовою. Жодна зміна не зберігається без твого
              підтвердження.
            </p>
          </div>
          <div className="context-box">
            <span className="eyebrow">Поточний контекст</span>
            <div>
              <Icon name="calendar" size={16} />
              {events.filter((e) => e.ownerId === "me").length} подій
            </div>
            <div>
              <Icon name="tasks" size={16} />
              {tasks.filter((t) => !t.completed).length} активні завдання
            </div>
            <small>
              {apiMode
                ? "Запити обробляє AI-модель. Помічник лише пропонує, а зміни зберігаються після твого підтвердження."
                : "Запити обробляються локально за визначеними правилами. Для складніших формулювань помічник попросить уточнення."}
            </small>
          </div>
        </aside>
        <section className="chat-panel">
          <div className="chat-head">
            <div>
              <span className="ai-avatar">
                <Icon name="spark" />
              </span>
              <div>
                <b>LifeTime Assistant</b>
                <small>
                  <i /> {apiMode ? "AI-модель" : "Локальна обробка"}
                </small>
              </div>
            </div>
            <span className="premium-mini">
              <Icon name="crown" size={13} />
              Premium
            </span>
          </div>
          <div className="messages" ref={messagesBox}>
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="message-bubble">
                  {m.text}
                  {m.role === "ai" && m.text.includes("Знайти час") && (
                    <Button variant="secondary" onClick={goFind}>
                      Відкрити пошук часу
                    </Button>
                  )}
                  {m.action === "calendar" && (
                    <Button variant="secondary" onClick={goCalendar}>
                      Відкрити створене в календарі
                    </Button>
                  )}
                </div>
                <small>{m.role === "ai" ? "Помічник" : "Ти"} · щойно</small>
              </div>
            ))}
            {typing && (
              <div className="typing">
                <i />
                <i />
                <i />
              </div>
            )}
            {proposal && (
              <AiProposalCard
                proposal={proposal}
                users={users}
                busy={confirming}
                onCancel={() => setProposal(null)}
                onConfirm={() => void confirmProposal()}
              />
            )}
            {draft && (
              <SmartDraftCard
                draft={draft}
                users={users}
                onChange={setDraft}
                onCancel={() => setDraft(null)}
                onConfirm={confirmDraft}
              />
            )}
          </div>
          <div className="prompt-row">
            {prompts.map((p) => (
              <button key={p} onClick={() => answer(p)}>
                {p}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) answer(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Запитай про свій розклад…"
            />
            <button aria-label="Надіслати">
              <Icon name="arrow" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function AiProposalCard({
  proposal,
  users,
  busy,
  onCancel,
  onConfirm,
}: {
  proposal: AiProposal;
  users: ReturnType<typeof useStore>["users"];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const format = (iso: string, zone: string) =>
    new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(
      new Date(iso),
    );
  const zone = proposal.kind === "event" ? proposal.data.timezone : "UTC";
  const names =
    proposal.kind === "event"
      ? proposal.data.participantIds
          .map((id) => users.find((user) => user.id === id)?.firstName)
          .filter(Boolean)
          .join(", ")
      : "";
  return (
    <section className="smart-draft">
      <div className="smart-draft-head">
        <span>
          <Icon name={proposal.kind === "event" ? "calendar" : "tasks"} size={17} />
        </span>
        <div>
          <small>Перевір перед створенням</small>
          <h3>{proposal.kind === "event" ? "Нова подія" : "Нове завдання"}</h3>
        </div>
      </div>
      <div className="smart-fields">
        <div className="field span-2">
          <span>Назва</span>
          <b>{proposal.data.title}</b>
        </div>
        {proposal.kind === "event" ? (
          <>
            <div className="field span-2">
              <span>Час</span>
              <b>
                {format(proposal.data.startsAt, zone)} — {format(proposal.data.endsAt, zone)}
              </b>
            </div>
            {names && (
              <div className="field span-2">
                <span>Учасники</span>
                <b>{names}</b>
              </div>
            )}
            {proposal.data.location && (
              <div className="field span-2">
                <span>Місце</span>
                <b>{proposal.data.location}</b>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field">
              <span>Пріоритет</span>
              <b>{proposal.data.priority}</b>
            </div>
            {proposal.data.deadline && (
              <div className="field">
                <span>Дедлайн</span>
                <b>{format(proposal.data.deadline, "UTC")}</b>
              </div>
            )}
          </>
        )}
      </div>
      <div className="smart-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Скасувати
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? "Зберігаємо…" : "Підтвердити й створити"}
        </Button>
      </div>
    </section>
  );
}

function SmartDraftCard({
  draft,
  users,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: SmartDraft;
  users: ReturnType<typeof useStore>["users"];
  onChange: (draft: SmartDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const changeTime = (key: "start" | "end", value: string) => {
    const slot = { ...draft.slot, [key]: value };
    const calculated = minutes(slot.end) - minutes(slot.start);
    onChange({
      ...draft,
      slot,
      durationMinutes: calculated > 0 ? calculated : draft.durationMinutes,
    });
  };
  return (
    <section className="smart-draft">
      <div className="smart-draft-head">
        <span>
          <Icon name={draft.kind === "event" ? "calendar" : "tasks"} size={17} />
        </span>
        <div>
          <small>Перевір перед створенням</small>
          <h3>{draft.kind === "event" ? "Нова подія" : "Нове завдання і фокус-сесія"}</h3>
        </div>
      </div>
      <div className="smart-fields">
        <label className="field span-2">
          <span>Назва</span>
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
          />
        </label>
        {draft.kind === "event" && (
          <div className="field span-2">
            <span>Учасники</span>
            <div className="smart-people">
              {draft.participantIds.map((id) => (
                <span key={id}>
                  <Avatar user={users.find((user) => user.id === id)!} size="sm" />
                  {users.find((user) => user.id === id)?.firstName}
                </span>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span>{draft.kind === "task" ? "Дедлайн" : "Дата"}</span>
          <input
            type="date"
            value={draft.kind === "task" ? draft.deadline : draft.slot.date}
            onChange={(e) =>
              onChange(
                draft.kind === "task"
                  ? { ...draft, deadline: e.target.value }
                  : {
                      ...draft,
                      date: e.target.value,
                      slot: { ...draft.slot, date: e.target.value },
                    },
              )
            }
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Початок</span>
            <input
              type="time"
              value={draft.slot.start}
              onChange={(e) => changeTime("start", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Кінець</span>
            <input
              type="time"
              value={draft.slot.end}
              onChange={(e) => changeTime("end", e.target.value)}
            />
          </label>
        </div>
        {draft.kind === "event" ? (
          <label className="field span-2">
            <span>Місце</span>
            <input
              value={draft.location}
              onChange={(e) => onChange({ ...draft, location: e.target.value })}
              placeholder="Не вказано"
            />
          </label>
        ) : (
          <label className="field span-2">
            <span>Пріоритет</span>
            <select
              value={draft.priority}
              onChange={(e) =>
                onChange({ ...draft, priority: e.target.value as typeof draft.priority })
              }
            >
              <option>Високий</option>
              <option>Середній</option>
              <option>Низький</option>
            </select>
          </label>
        )}
      </div>
      <div className="smart-summary">
        <Icon name="clock" size={15} />
        {draft.durationMinutes < 60
          ? `${draft.durationMinutes} хв`
          : `${draft.durationMinutes / 60} год`}{" "}
        · час перевірено за поточним календарем
      </div>
      <div className="smart-actions">
        <Button variant="ghost" onClick={onCancel}>
          Скасувати
        </Button>
        <Button onClick={onConfirm}>Підтвердити й створити</Button>
      </div>
    </section>
  );
}

export function NotificationsPage() {
  const { notifications, setNotifications } = useStore();
  return (
    <div className="page narrow-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Будь у курсі</span>
          <h1>Сповіщення</h1>
          <p>{notifications.filter((n) => !n.read).length} непрочитаних</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setNotifications(notifications.map((n) => ({ ...n, read: true })))}
        >
          Позначити все прочитаним
        </Button>
      </div>
      <div className="notification-list">
        {notifications.map((n) => (
          <article
            key={n.id}
            className={!n.read ? "unread" : ""}
            onClick={() =>
              setNotifications(notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
            }
          >
            <span className={`notification-icon type-${n.type}`}>
              <Icon
                name={n.type === "friend" ? "friends" : n.type === "deadline" ? "tasks" : "bell"}
              />
            </span>
            <div>
              <h3>{n.title}</h3>
              <p>{n.text}</p>
              <small>{n.time}</small>
            </div>
            {n.actionable && (
              <div className="notification-actions">
                <Button
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNotifications(notifications.filter((x) => x.id !== n.id));
                  }}
                >
                  Відхилити
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNotifications(notifications.filter((x) => x.id !== n.id));
                  }}
                >
                  Прийняти
                </Button>
              </div>
            )}
            {!n.read && <i className="unread-dot" />}
          </article>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage({ logout }: { logout: () => void }) {
  const { settings, setSettings, currentUser, setCurrentUser } = useStore();
  const me = currentUser;
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState({
    firstName: me.firstName,
    lastName: me.lastName,
    email: me.email,
    bio: me.bio || "",
    timezone: me.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl);
  const [avatarError, setAvatarError] = useState("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const update = async (key: keyof typeof settings, value: unknown) => {
    try {
      await setSettings({ ...settings, [key]: value });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Помилка збереження");
    }
  };
  const sections = [
    ["profile", "Мій профіль"],
    ["calendar-settings", "Календар"],
    ["active-hours", "Активні години"],
    ["privacy-settings", "Приватність"],
    ["notification-settings", "Сповіщення"],
  ];
  return (
    <div className="page settings-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Твій LifeTime</span>
          <h1>Налаштування</h1>
          <p>Зроби простір зручним саме для себе.</p>
        </div>
        {saved && (
          <span className="saved-indicator">
            <Icon name="check" size={15} />
            Збережено
          </span>
        )}
      </div>
      <div className="settings-layout">
        <aside className="settings-nav">
          {sections.map(([id, label], i) => (
            <button
              className={i === 0 ? "active" : ""}
              key={id}
              onClick={() =>
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {label}
            </button>
          ))}
        </aside>
        <div className="settings-content">
          <section className="settings-section" id="profile">
            <div>
              <h2>Мій профіль</h2>
              <p>Інформація, яку бачать твої друзі.</p>
            </div>
            <div className="profile-editor avatar-editor">
              <Avatar user={{ ...me, avatarUrl }} size="lg" />
              <div>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const validation = validateImage(file);
                    if (validation) {
                      setAvatarError(validation);
                      return;
                    }
                    setAvatarLoading(true);
                    setAvatarError("");
                    try {
                      setAvatarUrl(await avatarUploadService.save(me.id, file));
                    } catch {
                      setAvatarError("Не вдалося завантажити фото.");
                    } finally {
                      setAvatarLoading(false);
                      e.target.value = "";
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                >
                  {avatarLoading ? "Обробляємо…" : avatarUrl ? "Замінити фото" : "Завантажити фото"}
                </Button>
                {avatarUrl && (
                  <button className="remove-avatar" onClick={() => setAvatarUrl(undefined)}>
                    Видалити фото
                  </button>
                )}
                <small>JPEG, PNG або WebP · до 5 МБ</small>
              </div>
              <span className={`account-badge ${me.premiumStatus}`}>
                <Icon name={me.premiumStatus === "premium" ? "crown" : "lock"} size={14} />
                {me.premiumStatus === "premium" ? "Premium" : "Безкоштовний план"}
              </span>
            </div>
            {avatarError && <p className="form-error">{avatarError}</p>}
            <div className="form-grid">
              <label className="field">
                <span>Ім’я</span>
                <input
                  value={profile.firstName}
                  onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Прізвище</span>
                <input
                  value={profile.lastName}
                  onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                />
              </label>
              <label className="field span-2">
                <span>Email</span>
                <input value={profile.email} readOnly />
              </label>
              <label className="field span-2">
                <span>Часовий пояс (IANA)</span>
                <input
                  value={profile.timezone}
                  onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                  placeholder="Europe/Kyiv"
                />
              </label>
              <label className="field span-2">
                <span>Про себе</span>
                <textarea
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                />
              </label>
            </div>
            <Button
              onClick={async () => {
                try {
                  if (!avatarUrl && me.avatarUrl) await avatarUploadService.remove(me.id);
                  await setCurrentUser({
                    ...me,
                    firstName: profile.firstName,
                    lastName: profile.lastName,
                    bio: profile.bio,
                    timezone: profile.timezone,
                    avatarUrl,
                    email: profile.email,
                    initials:
                      `${profile.firstName[0] || ""}${profile.lastName[0] || ""}`.toUpperCase(),
                  });
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1800);
                } catch (e) {
                  setAvatarError(e instanceof Error ? e.message : "Помилка збереження");
                }
              }}
            >
              Зберегти профіль
            </Button>
            <p className="storage-note">
              Фото зберігається через адаптер завантажень. Формати: JPEG, PNG, WebP.
            </p>
          </section>
          <section className="settings-section" id="calendar-settings">
            <div>
              <h2>Календар</h2>
              <p>Основні правила відображення твого розкладу.</p>
            </div>
            <Toggle
              label="Тиждень починається з понеділка"
              value={settings.weekStartsMonday}
              onChange={(v) => update("weekStartsMonday", v)}
            />
          </section>
          <section className="settings-section" id="active-hours">
            <div>
              <h2>Активні години</h2>
              <p>Використовуємо ці години під час пошуку вільного часу.</p>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Активний день від</span>
                <input
                  type="time"
                  value={settings.activeStart}
                  onChange={(e) => update("activeStart", e.target.value)}
                />
              </label>
              <label className="field">
                <span>До</span>
                <input
                  type="time"
                  value={settings.activeEnd}
                  onChange={(e) => update("activeEnd", e.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="settings-section" id="privacy-settings">
            <div>
              <h2>Приватність</h2>
              <p>Назви приватних подій ніколи не показуються іншим.</p>
            </div>
            <label className="field">
              <span>Доступ до зайнятості</span>
              <select value={settings.sharing} onChange={(e) => update("sharing", e.target.value)}>
                <option value="none">Не ділитися</option>
                <option value="busy">Лише вільно / зайнято</option>
                <option value="selected">Деталі обраних календарів</option>
              </select>
            </label>
            <div className="privacy-note">
              <Icon name="check" />
              <span>
                <b>Приватні події захищені</b>
                <p>
                  Під час порівняння друзі бачать лише зайнятий проміжок — без назви, місця й опису.
                </p>
              </span>
            </div>
          </section>
          <section className="settings-section" id="notification-settings">
            <div>
              <h2>Сповіщення</h2>
              <p>Нагадування про події, дедлайни та запрошення.</p>
            </div>
            <Toggle
              label="Дозволити сповіщення у LifeTime"
              value={settings.notifications}
              onChange={(v) => update("notifications", v)}
            />
          </section>
          <section className="settings-section danger-zone">
            <div>
              <h2>Мій акаунт</h2>
              <p>Керування поточною локальною сесією LifeTime.</p>
            </div>
            <Button variant="danger" icon="logout" onClick={logout}>
              Вийти
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button className={value ? "toggle on" : "toggle"} onClick={() => onChange(!value)}>
        <i />
      </button>
    </label>
  );
}
