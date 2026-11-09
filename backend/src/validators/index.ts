import { z } from "zod";
import { DateTime } from "luxon";
export const id = z.uuid();
export const timezone = z
  .string()
  .refine((v) => DateTime.now().setZone(v).isValid, "Invalid IANA timezone");
export const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const instant = z.iso.datetime({ offset: true });
export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    startsAt: instant,
    endsAt: instant,
    timezone,
    category: z
      .enum(["Навчання", "Робота", "Особисте", "Друзі", "Спорт", "Інше"])
      .default("Особисте"),
    location: z.string().max(500).default(""),
    privacy: z.enum(["private", "busy", "shared"]).default("private"),
    participantIds: z.array(id).max(50).default([]),
    recheckAvailability: z.boolean().default(false),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), "Invalid event interval");
export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    deadline: instant.nullable().optional(),
    priority: z.enum(["Високий", "Середній", "Низький"]).default("Середній"),
    completed: z.boolean().default(false),
    estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    scheduledStart: instant.nullable().optional(),
    scheduledEnd: instant.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.scheduledStart && !v.scheduledEnd) ||
      Boolean(
        v.scheduledStart &&
        v.scheduledEnd &&
        Date.parse(v.scheduledEnd) > Date.parse(v.scheduledStart),
      ),
    "Both scheduled endpoints required, end after start",
  );
export const profileInput = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    bio: z.string().max(2000).default(""),
    timezone,
    activeStart: clock,
    activeEnd: clock,
    sharing: z.enum(["none", "busy", "selected"]),
  })
  .strict()
  .refine((v) => v.activeEnd > v.activeStart, "Invalid active hours");
export const availabilityInput = z
  .object({
    participantIds: z.array(id).max(50),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    durationMinutes: z.number().int().min(15).max(1440),
    earliestHour: clock,
    latestHour: clock,
    timezone,
    preferences: z
      .array(z.enum(["morning", "afternoon", "evening"]))
      .max(3)
      .default([]),
  })
  .strict()
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      Date.parse(v.endDate) - Date.parse(v.startDate) <= 31 * 86400000 &&
      v.latestHour > v.earliestHour,
    "Range must be 0–31 days, valid daily hours",
  );
