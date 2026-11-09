import test from "node:test";
import assert from "node:assert/strict";
import { freeIntervals, mergeIntervals } from "../src/services/availability.js";
import { availabilityInput, eventInput, taskInput } from "../src/validators/index.js";
import { validateImage } from "../src/services/storage.js";
import sharp from "sharp";

test("merge overlapping, nested and back-to-back meetings", () =>
  assert.deepEqual(
    mergeIntervals([
      { start: 10, end: 20 },
      { start: 15, end: 17 },
      { start: 20, end: 30 },
      { start: 0, end: 5 },
    ]),
    [
      { start: 0, end: 5 },
      { start: 10, end: 30 },
    ],
  ));
test("fully booked and cross-day intervals leave no invented slots", () =>
  assert.deepEqual(freeIntervals(10, 20, [{ start: 0, end: 30 }]), []));
test("clips boundaries and preserves actual gaps", () =>
  assert.deepEqual(
    freeIntervals(10, 50, [
      { start: 0, end: 20 },
      { start: 30, end: 40 },
      { start: 45, end: 100 },
    ]),
    [
      { start: 20, end: 30 },
      { start: 40, end: 45 },
    ],
  ));
test("empty calendar is free", () =>
  assert.deepEqual(freeIntervals(0, 1440, []), [{ start: 0, end: 1440 }]));
test("invalid intervals and client ownership rejected", () => {
  assert.equal(
    eventInput.safeParse({
      title: "x",
      startsAt: "2026-11-10T11:00:00Z",
      endsAt: "2026-11-10T10:00:00Z",
      timezone: "Europe/Kyiv",
    }).success,
    false,
  );
  assert.equal(taskInput.safeParse({ title: "x", ownerId: "spoof" }).success, false);
  assert.equal(
    taskInput.safeParse({ title: "x", scheduledStart: "2026-11-10T11:00:00Z" }).success,
    false,
  );
  assert.equal(
    availabilityInput.safeParse({
      participantIds: [],
      startDate: "2026-11-10",
      endDate: "2027-11-10",
      durationMinutes: 60,
      earliestHour: "09:00",
      latestHour: "20:00",
      timezone: "Invalid",
    }).success,
    false,
  );
});
test("image validates decoded content, rejects spoofed, SVG and oversized files", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
  assert.equal((await sharp(await validateImage(bytes)).metadata()).format, "webp");
  await assert.rejects(() => validateImage(Buffer.from("not a png")));
  await assert.rejects(() =>
    validateImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'),
    ),
  );
  await assert.rejects(() => validateImage(Buffer.alloc(5 * 1024 * 1024 + 1)));
});
