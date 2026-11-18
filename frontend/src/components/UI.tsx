import { apiMode } from "../config";
import { isEventOverlap } from "../services/apiClient";
import { calendarEntries } from "../services/calendarView";
import { toInstant, wallDateTime } from "../services/dto";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { addDays } from "../data";
import { useStore } from "../store";
import type { CalendarEvent, EventCategory, Task, User } from "../types";
import { Icon } from "./Icons";

export function Avatar({ user, size = "md" }: { user: User; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: user.color }}
      title={`${user.firstName} ${user.lastName}`}
    >
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.initials}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  icon,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: string;
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">LifeTime</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрити">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** Replaces window.confirm: a styled dialog that matches the rest of the app. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = "Підтвердити",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose}>
      <p className="dialog-text">{text}</p>
      <div className="modal-actions dialog-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Скасувати
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "Зачекайте…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <div className="toast">
      <span className="toast-check">
        <Icon name="check" size={14} />
      </span>
      {text}
    </div>
  );
}

const categories: EventCategory[] = ["Навчання", "Робота", "Особисте", "Друзі", "Спорт", "Інше"];
const emptyEvent: Omit<CalendarEvent, "id"> = {
  title: "",
  description: "",
  date: addDays(0),
  start: "10:00",
  end: "11:00",
  category: "Особисте",
  location: "",
  participantIds: [],
  ownerId: "me",
  privacy: "busy",
};

export function EventModal({
  event,
  prefill,
  onClose,
  onSaved,
}: {
  event?: CalendarEvent;
  prefill?: Partial<CalendarEvent>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { events, setEvents, tasks, users, currentUser } = useStore();
  const canEdit =
    !event || (!event.sourceTaskId && (event.ownerId === "me" || event.ownerId === currentUser.id));
  const [form, setForm] = useState<Omit<CalendarEvent, "id">>({
    ...emptyEvent,
    ...event,
    ...prefill,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [overlap, setOverlap] = useState("");
  const savingRef = useRef(false);
  const requestId = useRef<string | undefined>(undefined);
  const set = (key: keyof typeof form, value: unknown) => {
    if (savingRef.current) return;
    requestId.current = undefined;
    setForm((old) => ({ ...old, [key]: value }));
  };
  const save = async (confirmOverlap = false) => {
    if (savingRef.current || !canEdit) return;
    if (!form.title.trim()) return setError("Додайте назву події.");
    const start = `${form.date}T${form.start}`;
    const end = `${form.endDate || form.date}T${form.end}`;
    if (end <= start) return setError("Час завершення має бути пізніше за початок.");
    setError("");
    if (!apiMode && !confirmOverlap) {
      const zone = currentUser.timezone || "Europe/Kyiv";
      const conflict = calendarEntries(events, tasks, currentUser.id, zone).some(
        (item) =>
          item.id !== event?.id &&
          (item.ownerId === "me" || item.ownerId === currentUser.id ||
            item.participantIds.includes("me") || item.participantIds.includes(currentUser.id)) &&
          `${item.date}T${item.start}` < end &&
          `${item.endDate || item.date}T${item.end}` > start,
      );
      if (conflict) {
        setOverlap("У цей час у твоєму календарі вже є запланована подія. Ти можеш створити нову подію попри накладку або вибрати інший час.");
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (apiMode && !event) requestId.current ??= crypto.randomUUID();
      const saved = {
        ...form,
        id: event?.id ?? requestId.current ?? `e-${Date.now()}`,
        ...(apiMode ? { requestId: requestId.current, confirmOverlap } : {}),
      };
      if (event)
        await setEvents((items) => items.map((item) => (item.id === event.id ? saved : item)));
      else await setEvents((items) => items.some((item) => item.id === saved.id) ? items : [...items, saved]);
      onSaved(event ? "Подію оновлено" : "Подію додано до календаря");
      onClose();
    } catch (e) {
      if (isEventOverlap(e)) setOverlap(e.message);
      else setError(e instanceof Error ? e.message : "Помилка збереження.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!event || !window.confirm("Видалити цю подію? Цю дію не можна скасувати.")) return;
    try {
      await setEvents(events.filter((item) => item.id !== event.id));
      onSaved("Подію видалено");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка видалення.");
    }
  };
  if (overlap)
    return (
      <Modal title="Накладка в календарі" onClose={saving ? () => undefined : onClose} wide>
        <p role="alert">{overlap}</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Скасувати</Button>
          <Button variant="secondary" onClick={() => {
            setOverlap("");
            setError("");
          }} disabled={saving}>
            Обрати інший час
          </Button>
          <Button onClick={() => void save(true)} disabled={saving}>
            {saving ? "Зберігаємо…" : event ? "Зберегти попри накладку" : "Створити попри накладку"}
          </Button>
        </div>
      </Modal>
    );
  return (
    <Modal title={event ? "Редагувати подію" : "Нова подія"} onClose={saving ? () => undefined : onClose} wide>
      <div className="form-grid">
        <label className="field span-2">
          <span>Назва</span>
          <input
            autoFocus
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Наприклад, кава із Софією"
          />
        </label>
        <label className="field span-2">
          <span>Опис</span>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Додайте корисні деталі"
          />
        </label>
        <label className="field">
          <span>Дата</span>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Початок</span>
            <input type="time" value={form.start} onChange={(e) => set("start", e.target.value)} />
          </label>
          <label className="field">
            <span>Кінець</span>
            <input type="time" value={form.end} onChange={(e) => set("end", e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Дата завершення</span>
          <input
            type="date"
            min={form.date}
            value={form.endDate || form.date}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Категорія</span>
          <select value={form.category} onChange={(e) => set("category", e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Місце</span>
          <input
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder="Онлайн або адреса"
          />
        </label>
        <label className="field">
          <span>Приватність</span>
          <select value={form.privacy} onChange={(e) => set("privacy", e.target.value)}>
            <option value="private">Приватна</option>
            <option value="busy">Видно лише «зайнято»</option>
            <option value="shared">Для обраних людей</option>
          </select>
        </label>
        <label className="field">
          <span>Повторення</span>
          <select value={form.recurrence || ""} onChange={(e) => set("recurrence", e.target.value)}>
            <option value="">Не повторювати</option>
            <option disabled>Щотижня (у розробці)</option>
            <option disabled>Щомісяця (у розробці)</option>
          </select>
        </label>
        <div className="field span-2">
          <span>Учасники</span>
          <div className="people-select">
            {users
              .filter((u) => u.id !== "me")
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={
                    form.participantIds.includes(u.id) ? "person-pill selected" : "person-pill"
                  }
                  onClick={() =>
                    set(
                      "participantIds",
                      form.participantIds.includes(u.id)
                        ? form.participantIds.filter((id) => id !== u.id)
                        : [...form.participantIds, u.id],
                    )
                  }
                >
                  <Avatar user={u} size="sm" />
                  {u.firstName}
                </button>
              ))}
          </div>
        </div>
      </div>
      {!canEdit && <p>Цю подію може змінити лише її власник.</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        {event && canEdit && (
          <Button variant="danger" icon="trash" onClick={remove} disabled={saving}>
            Видалити
          </Button>
        )}
        <span />
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Скасувати
        </Button>
        <Button disabled={!canEdit || saving} onClick={() => void save()}>
          {event ? "Зберегти" : "Створити подію"}
        </Button>
      </div>
    </Modal>
  );
}

export function TaskModal({
  task,
  onClose,
  onSaved,
}: {
  task?: Task;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { tasks, setTasks, currentUser } = useStore();
  const zone = currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const scheduledInstant = (value: string) =>
    value ? toInstant(value.slice(0, 10), value.slice(11, 16), zone) : null;
  const [form, setForm] = useState<Omit<Task, "id">>(
    task || {
      title: "",
      description: "",
      deadline: addDays(0),
      priority: "Середній",
      completed: false,
    },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    if (!form.title.trim()) return setError("Напишіть, що потрібно зробити.");
    setSaving(true);
    try {
      await setTasks(
        task
          ? tasks.map((t) => (t.id === task.id ? { ...form, id: task.id } : t))
          : [...tasks, { ...form, id: `t-${Date.now()}` }],
      );
      onSaved(task ? "Завдання оновлено" : "Завдання створено");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка збереження.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!task || !window.confirm("Видалити це завдання?")) return;
    try {
      await setTasks(tasks.filter((item) => item.id !== task.id));
      onSaved("Завдання видалено");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка видалення.");
    }
  };
  return (
    <Modal title={task ? "Редагувати завдання" : "Нове завдання"} onClose={onClose}>
      <div className="form-stack">
        <label className="field">
          <span>Завдання</span>
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Що потрібно зробити?"
          />
        </label>
        <label className="field">
          <span>Опис</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Деталі, посилання або нотатки"
          />
        </label>
        <label className="field">
          <span>Оцінка тривалості (хв)</span>
          <input
            type="number"
            min="1"
            max="1440"
            value={form.estimatedMinutes || ""}
            onChange={(e) =>
              setForm({ ...form, estimatedMinutes: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Початок роботи</span>
            <input
              type="datetime-local"
              value={form.scheduledStart ? wallDateTime(form.scheduledStart, zone) : ""}
              onChange={(e) => {
                try {
                  setForm({ ...form, scheduledStart: scheduledInstant(e.target.value) });
                  setError("");
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Некоректний час");
                }
              }}
            />
          </label>
          <label className="field">
            <span>Кінець роботи</span>
            <input
              type="datetime-local"
              value={form.scheduledEnd ? wallDateTime(form.scheduledEnd, zone) : ""}
              onChange={(e) => {
                try {
                  setForm({ ...form, scheduledEnd: scheduledInstant(e.target.value) });
                  setError("");
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Некоректний час");
                }
              }}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Дедлайн</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Пріоритет</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Task["priority"] })}
            >
              <option>Високий</option>
              <option>Середній</option>
              <option>Низький</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        {task && (
          <Button variant="danger" icon="trash" onClick={remove}>
            Видалити
          </Button>
        )}
        <span />
        <Button variant="ghost" onClick={onClose}>
          Скасувати
        </Button>
        <Button disabled={saving} onClick={save}>
          Зберегти
        </Button>
      </div>
    </Modal>
  );
}
