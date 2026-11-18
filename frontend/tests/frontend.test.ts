import test from "node:test";
import assert from "node:assert/strict";
import { toInstant, eventDto } from "../src/services/dto.ts";
import { calendarEntries, onCalendarDate, placeCalendarEntries } from "../src/services/calendarView.ts";

test("wall time converts using IANA zone, including DST", () => {
  assert.equal(toInstant("2027-01-15", "14:00", "Europe/Kyiv"), "2027-01-15T12:00:00.000Z");
  assert.equal(toInstant("2027-07-15", "14:00", "Europe/Kyiv"), "2027-07-15T11:00:00.000Z");
  assert.equal(toInstant("2027-01-15", "00:30", "Pacific/Kiritimati"), "2027-01-14T10:30:00.000Z");
  assert.throws(() => toInstant("2027-03-28", "03:30", "Europe/Kyiv"));
});
test("DTO preserves multi-day endpoints and ownership; view segments do not alter saved event", () => {
  const event = eventDto(
    {
      id: "e",
      ownerId: "u",
      title: "Long",
      description: "",
      startsAt: "2027-01-15T20:00:00Z",
      endsAt: "2027-01-17T08:00:00Z",
      timezone: "Europe/Kyiv",
      category: "Особисте",
      location: "",
      privacy: "private",
      participants: [{ userId: "p" }],
    },
    "u",
    "Europe/Kyiv",
  );
  assert.equal(event.date, "2027-01-15");
  assert.equal(event.endDate, "2027-01-17");
  assert.equal(event.ownerId, "me");
  assert.equal(onCalendarDate(event, "2027-01-16")?.start, "00:00");
  assert.equal(onCalendarDate(event, "2027-01-16")?.end, "23:59");
  assert.equal(event.start, "22:00");
  assert.equal(onCalendarDate(event, "2027-01-18"), null);
});
test("task sessions are projected without creating duplicate calendar records", () => {
  const entries = calendarEntries(
    [],
    [
      {
        id: "t",
        title: "Work",
        description: "",
        deadline: "",
        priority: "Середній",
        completed: false,
        scheduledStart: "2027-01-15T12:00:00Z",
        scheduledEnd: "2027-01-15T13:00:00Z",
      },
    ],
    "u",
    "Europe/Kyiv",
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceTaskId, "t");
  assert.equal(entries[0].start, "14:00");
});

test("overlapping calendar blocks are both visible and unrelated blocks keep full width", () => {
  const event = eventDto({
    id: "original", ownerId: "me", title: "Лекція", description: "",
    startsAt: "2026-11-18T12:00:00Z", endsAt: "2026-11-18T14:00:00Z",
    timezone: "Europe/Kyiv", category: "Навчання", location: "", privacy: "private",
    participants: [],
  }, "me", "Europe/Kyiv");
  const blocks = placeCalendarEntries([
    { ...event, id: "overlap", start: "15:00", end: "18:00" },
    { ...event, id: "later", start: "18:00", end: "19:00" },
    event,
  ]);
  assert.deepEqual(blocks.map(({ event, column, columns }) => [event.id, column, columns]), [
    ["original", 0, 2],
    ["overlap", 1, 2],
    ["later", 0, 1],
  ]);
});
