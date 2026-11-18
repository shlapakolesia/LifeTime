import type { CalendarEvent, Task } from "../types";
import { minutes } from "../data";
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

// Partition by the rendered vertical bounds, including the minimum block height.
export function placeCalendarEntries(events: CalendarEvent[]) {
  const blocks = events.map((event) => ({
    event,
    top: Math.max(0, ((minutes(event.start) - 480) / 840) * 100),
    height: Math.max(5, ((minutes(event.end) - minutes(event.start)) / 840) * 100),
    column: 0,
    columns: 1,
  })).sort((a, b) => a.top - b.top);

  let groupStart = 0;
  let columnEnds: number[] = [];
  const setWidths = (end: number) => {
    for (let index = groupStart; index < end; index++)
      blocks[index].columns = columnEnds.length;
  };
  for (const [index, block] of blocks.entries()) {
    if (columnEnds.every((end) => end <= block.top)) {
      setWidths(index);
      groupStart = index;
      columnEnds = [];
    }
    const freeColumn = columnEnds.findIndex((end) => end <= block.top);
    block.column = freeColumn === -1 ? columnEnds.length : freeColumn;
    columnEnds[block.column] = block.top + block.height;
  }
  setWidths(blocks.length);
  return blocks;
}
