import { DateTime } from "luxon";
import { db } from "./database.js";
import type { z } from "zod";
import { availabilityInput } from "../validators/index.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Interval = { start: number; end: number };
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}
export function freeIntervals(start: number, end: number, busy: Interval[]): Interval[] {
  let cursor = start;
  const result: Interval[] = [];
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor || b.start >= end) continue;
    if (b.start > cursor) result.push({ start: cursor, end: Math.min(b.start, end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}
export async function requireAvailability(viewer: string, ids: string[], client = db) {
  for (const userId of [...new Set(ids)].filter((id) => id !== viewer)) {
    const target = await client.userProfile.findUnique({ where: { userId } });
    const permission = await client.friendship.findUnique({
      where: { ownerId_friendId: { ownerId: userId, friendId: viewer } },
    });
    const groupGrant =
      !permission &&
      (await client.groupMember.findFirst({
        where: { userId, group: { members: { some: { userId: viewer } } } },
      }));
    if (!target || target.sharing === "none" || !(permission?.shareAvailability || groupGrant))
      throw new HttpError(403, "Учасник не надав доступ до зайнятості.");
  }
}
export async function getBusy(
  ids: string[],
  start: Date,
  end: Date,
  client = db,
  exclude?: { eventId?: string; taskId?: string },
): Promise<Interval[]> {
  const [events, tasks] = await Promise.all([
    client.calendarEvent.findMany({
      where: {
        OR: [{ ownerId: { in: ids } }, { participants: { some: { userId: { in: ids } } } }],
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
    }),
    client.task.findMany({
      where: {
        ownerId: { in: ids },
        completed: false,
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
      },
    }),
  ]);
  return [
    ...events
      .filter((e) => e.id !== exclude?.eventId)
      .map((e) => ({ start: +e.startsAt, end: +e.endsAt })),
    ...tasks
      .filter((t) => t.id !== exclude?.taskId)
      .map((t) => ({ start: +t.scheduledStart!, end: +t.scheduledEnd! })),
  ];
}
export async function findAvailability(viewer: string, input: z.infer<typeof availabilityInput>) {
  const ids = [...new Set([viewer, ...input.participantIds])];
  await requireAvailability(viewer, ids);
  const profiles = await db.userProfile.findMany({ where: { userId: { in: ids } } });
  const from = DateTime.fromISO(input.startDate, { zone: input.timezone }).startOf("day");
  const until = DateTime.fromISO(input.endDate, { zone: input.timezone })
    .plus({ days: 1 })
    .startOf("day");
  const busy = await getBusy(ids, from.toJSDate(), until.toJSDate());
  const output = [];
  for (let day = from; day < until; day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    let start = DateTime.fromISO(`${date}T${input.earliestHour}`, { zone: input.timezone });
    let end = DateTime.fromISO(`${date}T${input.latestHour}`, { zone: input.timezone });
    const unavailable = [...busy];
    // A participant's active day may fall on a different local date. Build all
    // neighboring active windows, then block their complement in the search day.
    for (const p of profiles) {
      const allowed: Interval[] = [];
      const first = start.setZone(p.timezone).startOf("day").minus({ days: 1 });
      const last = end.setZone(p.timezone).startOf("day").plus({ days: 1 });
      for (let local = first; local <= last; local = local.plus({ days: 1 })) {
        const date = local.toISODate();
        const ps = DateTime.fromISO(`${date}T${p.activeStart}`, { zone: p.timezone });
        const pe = DateTime.fromISO(`${date}T${p.activeEnd}`, { zone: p.timezone });
        if (+pe > +start && +ps < +end)
          allowed.push({ start: Math.max(+start, +ps), end: Math.min(+end, +pe) });
      }
      unavailable.push(...freeIntervals(+start, +end, allowed));
    }
    for (const free of freeIntervals(+start, +end, unavailable)) {
      for (
        let cursor = free.start;
        cursor + input.durationMinutes * 60000 <= free.end;
        cursor += 15 * 60000
      ) {
        const s = DateTime.fromMillis(cursor, { zone: input.timezone }),
          e = s.plus({ minutes: input.durationMinutes });
        const preference = s.hour < 12 ? "morning" : s.hour < 17 ? "afternoon" : "evening";
        output.push({
          date,
          start: s.toFormat("HH:mm"),
          end: e.toFormat("HH:mm"),
          startsAt: s.toUTC().toISO(),
          endsAt: e.toUTC().toISO(),
          participantIds: ids,
          score:
            100 - Math.abs(s.hour - 14) * 3 + (input.preferences.includes(preference) ? 20 : 0),
          reason: "Спільний вільний час",
        });
      }
    }
  }
  return output
    .sort((a, b) => b.score - a.score || a.startsAt!.localeCompare(b.startsAt!))
    .slice(0, 24);
}
