import { calendarEntries, onCalendarDate } from "../services/calendarView";
import { useMemo, useState } from "react";
import { addDays, dateFromIso, formatDate, iso, minutes, timeFromMinutes, weekday } from "../data";
import { useStore } from "../store";
import type { CalendarEvent, CalendarView, Task } from "../types";
import { Icon } from "../components/Icons";
import { Avatar, Button } from "../components/UI";

const eventColor: Record<string, string> = {
  Навчання: "#7057d8",
  Робота: "#3976b8",
  Особисте: "#d5677d",
  Друзі: "#d88151",
  Спорт: "#2f8f77",
  Інше: "#718096",
};

export function Overview({
  navigate,
  openEvent,
  openTask,
}: {
  navigate: (page: any) => void;
  openEvent: () => void;
  openTask: () => void;
}) {
  const { events: storedEvents, tasks, users, notifications, currentUser } = useStore();
  const events = calendarEntries(
    storedEvents,
    tasks,
    currentUser.id,
    currentUser.timezone || "Europe/Kyiv",
  );
  const today = addDays(0);
  const todayEvents = events
    .map((e) => onCalendarDate(e, today))
    .filter((e): e is CalendarEvent => Boolean(e))
    .sort((a, b) => a.start.localeCompare(b.start));
  const openTasks = tasks
    .filter((t) => !t.completed)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const completed = tasks.filter((t) => t.completed).length;
  const dayLoad = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(i),
      intervals = events
        .map((e) => onCalendarDate(e, date))
        .filter((e): e is CalendarEvent => Boolean(e))
        .map((e) => [
          Math.max(minutes(currentUser.activeStart), minutes(e.start)),
          Math.min(minutes(currentUser.activeEnd), minutes(e.end)),
        ])
        .sort((a, b) => a[0] - b[0]);
    let end = 0,
      total = 0;
    for (const [start, finish] of intervals) {
      total += Math.max(0, finish - Math.max(start, end));
      end = Math.max(end, finish);
    }
    return total;
  });
  const activeMinutes = minutes(currentUser.activeEnd) - minutes(currentUser.activeStart);
  const freeHours = Math.max(
    0,
    (activeMinutes * 7 - dayLoad.reduce((a, b) => a + b, 0)) / 60,
  ).toFixed(1);

  const weekEvents = events.filter(
    (e) => e.ownerId === "me" && e.date >= today && e.date <= addDays(6),
  ).length;
  return (
    <div className="page overview-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">
            {weekday(today)}, {formatDate(today)}
          </p>
          <h1>Привіт, {currentUser.firstName}.</h1>
          <p>Твій день починається тут — спокійно й без зайвого шуму.</p>
        </div>
        <div className="quick-actions">
          <Button icon="plus" onClick={openEvent}>
            Додати подію
          </Button>
          <Button variant="secondary" icon="tasks" onClick={openTask}>
            Нове завдання
          </Button>
        </div>
      </section>
      <div className="overview-grid">
        <section className="card day-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">Сьогодні</span>
              <h2>Твій ритм дня</h2>
            </div>
            <button className="text-button" onClick={() => navigate("calendar")}>
              Весь календар <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="day-layout">
            <div className="time-rail">
              {["08", "10", "12", "14", "16", "18", "20"].map((h) => (
                <span key={h}>{h}:00</span>
              ))}
            </div>
            <div className="timeline">
              {["08", "10", "12", "14", "16", "18", "20"].map((h) => (
                <i key={h} />
              ))}
              {todayEvents.map((event) => {
                const top = ((minutes(event.start) - 480) / 780) * 100;
                const height = Math.max(
                  10,
                  ((minutes(event.end) - minutes(event.start)) / 780) * 100,
                );
                return (
                  <button
                    className="timeline-event"
                    key={event.id}
                    style={
                      {
                        top: `${top}%`,
                        height: `${height}%`,
                        "--event": eventColor[event.category],
                      } as React.CSSProperties
                    }
                    onClick={() => navigate("calendar")}
                  >
                    <b>{event.title}</b>
                    <span>
                      {event.start}–{event.end}
                    </span>
                  </button>
                );
              })}
              {!todayEvents.length && (
                <div className="timeline-empty">День вільний для нових планів</div>
              )}
            </div>
          </div>
        </section>
        <aside className="overview-side">
          <section className="card next-card">
            <div className="eyebrow">Далі за планом</div>
            {todayEvents[0] ? (
              <>
                <div className="next-time">{todayEvents[0].start}</div>
                <h3>{todayEvents[0].title}</h3>
                <p>{todayEvents[0].location || todayEvents[0].category}</p>
                <div className="next-line">
                  <span style={{ background: eventColor[todayEvents[0].category] }} />
                  <div />
                </div>
                <small>
                  Ще{" "}
                  {Math.max(
                    1,
                    minutes(todayEvents[0].start) -
                      (new Date().getHours() * 60 + new Date().getMinutes()),
                  )}{" "}
                  хв до початку
                </small>
              </>
            ) : (
              <p className="muted">На сьогодні більше нічого. Час видихнути.</p>
            )}
          </section>
          <section className="card week-glance">
            <div className="section-head">
              <div>
                <span className="eyebrow">Цей тиждень</span>
                <h3>Зайнятість за календарем</h3>
              </div>
              <span className="score">{weekEvents}</span>
            </div>
            <div className="week-bars">
              {dayLoad.map((load, i) => (
                <div key={i}>
                  <span
                    style={{ height: `${(load / Math.max(activeMinutes, 1)) * 100}%` }}
                    className={i === new Date().getDay() - 1 ? "active" : ""}
                  />
                  <small>{weekday(addDays(i)).slice(0, 2)}</small>
                </div>
              ))}
            </div>
            <div className="stat-row">
              <div>
                <b>{weekEvents}</b>
                <span>подій</span>
              </div>
              <div>
                <b>{completed}</b>
                <span>виконано</span>
              </div>
              <div>
                <b>{freeHours}</b>
                <span>вільних год</span>
              </div>
            </div>
          </section>
        </aside>
        <section className="card tasks-preview">
          <div className="section-head">
            <div>
              <span className="eyebrow">У фокусі</span>
              <h2>Найближчі завдання</h2>
            </div>
            <button className="text-button" onClick={() => navigate("tasks")}>
              Усі завдання <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="compact-tasks">
            {openTasks.slice(0, 3).map((task) => (
              <div key={task.id}>
                <span className={`priority-dot p-${task.priority}`} />
                <div>
                  <b>{task.title}</b>
                  <small>{task.deadline === today ? "Сьогодні" : formatDate(task.deadline)}</small>
                </div>
                <span className="priority-label">{task.priority}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="social-panel">
          <div className="social-copy">
            <span className="eyebrow light">Спільний час</span>
            <h2>
              Є час
              <br />
              для своїх?
            </h2>
            <p>Перевір спільну зайнятість і знайди час для зустрічі.</p>
            <Button className="light-button" onClick={() => navigate("find")}>
              Знайти найкращий час <Icon name="arrow" size={16} />
            </Button>
          </div>
          <div className="orbit">
            <div className="orbit-core">
              <Icon name="spark" />
            </div>
            {users.slice(1, 5).map((u, i) => (
              <span key={u.id} className={`orbit-avatar orbit-${i}`}>
                <Avatar user={u} />
              </span>
            ))}
          </div>
        </section>
        <section className="card notifications-preview">
          <div className="section-head">
            <div>
              <span className="eyebrow">Новини</span>
              <h2>Не пропусти</h2>
            </div>
            <span className="count-badge">{notifications.filter((n) => !n.read).length}</span>
          </div>
          {notifications
            .filter((n) => !n.read)
            .slice(0, 2)
            .map((n) => (
              <button key={n.id} onClick={() => navigate("notifications")}>
                <span className={`notification-icon type-${n.type}`}>
                  <Icon
                    name={
                      n.type === "friend" ? "friends" : n.type === "deadline" ? "tasks" : "bell"
                    }
                    size={17}
                  />
                </span>
                <span>
                  <b>{n.title}</b>
                  <small>{n.text}</small>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
        </section>
      </div>
    </div>
  );
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

export function CalendarPage({
  openEvent,
  editEvent,
  editTask,
}: {
  editTask: (task: Task) => void;
  openEvent: (prefill?: Partial<CalendarEvent>) => void;
  editEvent: (e: CalendarEvent) => void;
}) {
  const { events: storedEvents, tasks, currentUser } = useStore();
  const events = calendarEntries(
    storedEvents,
    tasks,
    currentUser.id,
    currentUser.timezone || "Europe/Kyiv",
  );
  const openEntry = (e: CalendarEvent) => {
    if (e.sourceTaskId) {
      const task = tasks.find((t) => t.id === e.sourceTaskId);
      if (task) editTask(task);
    } else editEvent(storedEvents.find((original) => original.id === e.id) || e);
  };
  const [view, setView] = useState<CalendarView>("week");
  const [cursor, setCursor] = useState(new Date());
  const [search, setSearch] = useState("");
  const own = events.filter(
    (e) =>
      (e.ownerId === "me" || e.participantIds.includes("me")) &&
      e.title.toLowerCase().includes(search.toLowerCase()),
  );
  const move = (dir: number) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + dir * (view === "month" ? 30 : view === "week" ? 7 : 1));
    setCursor(d);
  };
  const weekStart = startOfWeek(cursor);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const visibleDays = view === "month" ? monthDays : view === "week" ? weekDays : [cursor];
  return (
    <div className="page calendar-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Особистий простір</span>
          <h1>Календар</h1>
        </div>
        <Button icon="plus" onClick={() => openEvent()}>
          Додати подію
        </Button>
      </div>
      <div className="calendar-toolbar">
        <div className="period-nav">
          <button onClick={() => move(-1)}>
            <Icon name="chevron" className="flip" />
          </button>
          <button onClick={() => setCursor(new Date())}>Сьогодні</button>
          <button onClick={() => move(1)}>
            <Icon name="chevron" />
          </button>
        </div>
        <h2>
          {new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(cursor)}
        </h2>
        <div className="toolbar-end">
          <label className="search-field">
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук подій"
            />
          </label>
          <div className="segmented">
            {(["month", "week", "day"] as CalendarView[]).map((v) => (
              <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
                {v === "month" ? "Місяць" : v === "week" ? "Тиждень" : "День"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {view === "month" ? (
        <div className="month-calendar">
          <div className="weekday-row">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {visibleDays.map((date) => {
              const key = iso(date);
              const dayEvents = own
                .map((e) => onCalendarDate(e, key))
                .filter((e): e is CalendarEvent => Boolean(e));
              const current = key === addDays(0);
              return (
                <div
                  key={key}
                  className={`month-cell ${date.getMonth() !== cursor.getMonth() ? "outside" : ""}`}
                  onClick={() => openEvent({ date: key })}
                >
                  <button className={current ? "today-number" : ""}>{date.getDate()}</button>
                  {dayEvents.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      className="month-event"
                      style={{ "--event": eventColor[e.category] } as React.CSSProperties}
                      onClick={(x) => {
                        x.stopPropagation();
                        openEntry(e);
                      }}
                    >
                      <span>{e.start}</span>
                      {e.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <small>+ ще {dayEvents.length - 3}</small>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="week-calendar">
          <div className="week-head">
            <span />
            <>
              {visibleDays.map((d) => (
                <div key={iso(d)} className={iso(d) === addDays(0) ? "current" : ""}>
                  <small>{new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(d)}</small>
                  <b>{d.getDate()}</b>
                </div>
              ))}
            </>
          </div>
          <div className="week-body">
            <div className="hour-col">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i}>{String(i + 8).padStart(2, "0")}:00</span>
              ))}
            </div>
            {visibleDays.map((d) => (
              <div
                className={`day-col ${iso(d) === addDays(0) ? "current" : ""}`}
                key={iso(d)}
                onDoubleClick={() => openEvent({ date: iso(d) })}
              >
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} />
                ))}
                {own
                  .map((e) => onCalendarDate(e, iso(d)))
                  .filter((e): e is CalendarEvent => Boolean(e))
                  .map((e) => (
                    <button
                      key={e.id}
                      className="grid-event"
                      onClick={() => openEntry(e)}
                      style={
                        {
                          top: `${Math.max(0, ((minutes(e.start) - 480) / 840) * 100)}%`,
                          height: `${Math.max(5, ((minutes(e.end) - minutes(e.start)) / 840) * 100)}%`,
                          "--event": eventColor[e.category],
                        } as React.CSSProperties
                      }
                    >
                      <b>{e.title}</b>
                      <span>
                        {e.start}–{e.end}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TasksPage({
  openTask,
  editTask,
}: {
  openTask: () => void;
  editTask: (t: Task) => void;
}) {
  const { tasks, setTasks } = useStore();
  const [filter, setFilter] = useState("Усі");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const shown = useMemo(
    () =>
      tasks
        .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
        .filter((t) =>
          filter === "Усі" || filter === "Виконані"
            ? filter === "Усі" || t.completed
            : t.priority === filter,
        )
        .sort((a, b) =>
          sort === "priority"
            ? ["Високий", "Середній", "Низький"].indexOf(a.priority) -
              ["Високий", "Середній", "Низький"].indexOf(b.priority)
            : a.deadline.localeCompare(b.deadline),
        ),
    [tasks, filter, search, sort],
  );
  const done = tasks.filter((t) => t.completed).length;
  return (
    <div className="page tasks-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Роби важливе</span>
          <h1>Завдання</h1>
          <p>
            {done} із {tasks.length} виконано — хороший темп.
          </p>
        </div>
        <Button icon="plus" onClick={openTask}>
          Нове завдання
        </Button>
      </div>
      <div className="progress-card">
        <div>
          <b>{Math.round((done / Math.max(tasks.length, 1)) * 100)}%</b>
          <span>тижневого фокуса</span>
        </div>
        <div className="progress-track">
          <i style={{ width: `${(done / Math.max(tasks.length, 1)) * 100}%` }} />
        </div>
        <p>Ще {tasks.length - done} завдання до чистого списку</p>
      </div>
      <div className="task-tools">
        <div className="filter-tabs">
          {["Усі", "Високий", "Середній", "Низький", "Виконані"].map((f) => (
            <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>
              {f}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Знайти завдання"
          />
        </label>
        <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date">За дедлайном</option>
          <option value="priority">За пріоритетом</option>
        </select>
      </div>
      <div className="task-list">
        {shown.map((task) => (
          <article key={task.id} className={`task-row ${task.completed ? "completed" : ""}`}>
            <button
              className="task-check"
              onClick={async () => {
                try {
                  await setTasks(
                    tasks.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
                  );
                } catch {
                  /* Store displays the API error. */
                }
              }}
            >
              {task.completed && <Icon name="check" size={15} />}
            </button>
            <div className="task-main" onClick={() => editTask(task)}>
              <b>{task.title}</b>
              <p>{task.description || "Без додаткового опису"}</p>
            </div>
            <span className={`priority priority-${task.priority}`}>{task.priority}</span>
            <div
              className={`deadline ${task.deadline && task.deadline < addDays(0) && !task.completed ? "overdue" : ""}`}
            >
              <Icon name="calendar" size={15} />
              {task.deadline === addDays(0) ? "Сьогодні" : formatDate(task.deadline)}
            </div>
            <button className="icon-button" onClick={() => editTask(task)}>
              <Icon name="edit" size={17} />
            </button>
          </article>
        ))}
        {!shown.length && (
          <div className="empty-state">
            <span>
              <Icon name="check" />
            </span>
            <h3>Тут усе чисто</h3>
            <p>Спробуй інший фільтр або створи нове завдання.</p>
            <Button onClick={openTask}>Створити завдання</Button>
          </div>
        )}
      </div>
    </div>
  );
}
