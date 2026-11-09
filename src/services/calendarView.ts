import type { CalendarEvent, Task } from "../types";
import { eventDto } from "./dto";

/** Task sessions are projected for display only; no duplicate event is saved. */
export function calendarEntries(
  events: CalendarEvent[],
  tasks: Task[],
  self: string,
  zone: string,
): CalendarEvent[] {
  return [
    ...events,
    ...tasks
      .filter((t) => !t.completed && t.scheduledStart && t.scheduledEnd)
      .map((t) => ({
        ...eventDto(
          {
            id: `task:${t.id}`,
            ownerId: self,
            title: `Робота: ${t.title}`,
            description: t.description,
            startsAt: t.scheduledStart!,
            endsAt: t.scheduledEnd!,
            timezone: zone,
            category: "Навчання",
            location: "",
            privacy: "private",
            participants: [],
          },
          self,
          zone,
        ),
        sourceTaskId: t.id,
      })),
  ];
}
export function onCalendarDate(event: CalendarEvent, date: string): CalendarEvent | null {
  const endDate = event.endDate || event.date;
  if (
    date < event.date ||
    date > endDate ||
    (date === endDate && event.end === "00:00" && date !== event.date)
  )
    return null;
  return {
    ...event,
    start: date === event.date ? event.start : "00:00",
    end: date === endDate ? event.end : "23:59",
  };
}
