import type { User, CalendarEvent, Task, PremiumRequest, Group } from "../types";
export interface ProfileDto {
  bio?: string;
  firstName: string;
  lastName: string;
  timezone: string;
  activeStart: string;
  activeEnd: string;
  sharing: User["sharing"];
  avatarId?: string | null;
}
export interface UserDto {
  id: string;
  email?: string;
  accountRole?: User["accountRole"];
  premiumStatus?: User["premiumStatus"];
  profile: ProfileDto;
}
export interface EventDto {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  category: CalendarEvent["category"];
  location: string;
  privacy: CalendarEvent["privacy"];
  participants: { userId: string }[];
}
export interface TaskDto extends Omit<Task, "deadline"> {
  deadline: string | null;
}
export interface GroupDto {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  members: { userId: string; user?: UserDto }[];
}
export interface PremiumDto {
  user?: { premiumStatus: string };
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  accountEmail: string;
  screenshotId: string;
  status: PremiumRequest["status"];
  createdAt: string;
  reviewedAt?: string;
  reviewNotes?: string;
}
export function userDto(u: UserDto, self?: string): User {
  return {
    id: u.id === self ? "me" : u.id,
    bio: u.profile.bio,
    firstName: u.profile.firstName,
    lastName: u.profile.lastName,
    email: u.email || "",
    initials: `${u.profile.firstName[0] ?? ""}${u.profile.lastName[0] ?? ""}`.toUpperCase(),
    color: "#7057d8",
    role: "",
    activeStart: u.profile.activeStart,
    activeEnd: u.profile.activeEnd,
    sharing: u.profile.sharing,
    timezone: u.profile.timezone,
    accountRole: u.accountRole || "user",
    premiumStatus: u.premiumStatus || "free",
  };
}
const parts = (iso: string, zone: string) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (k: string) => p.find((v) => v.type === k)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};
export function eventDto(e: EventDto, self: string, zone: string): CalendarEvent {
  const s = parts(e.startsAt, zone),
    end = parts(e.endsAt, zone);
  return {
    ...e,
    date: s.date,
    endDate: end.date,
    start: s.time,
    end: end.time,
    ownerId: e.ownerId === self ? "me" : e.ownerId,
    participantIds: e.participants.map((p) => (p.userId === self ? "me" : p.userId)),
  };
}
export function groupDto(g: GroupDto, self: string): Group {
  return {
    ...g,
    color: "#7057d8",
    ownerId: g.ownerId === self ? "me" : g.ownerId,
    memberIds: g.members.map((m) => (m.userId === self ? "me" : m.userId)),
  };
}
export function premiumDto(p: PremiumDto): PremiumRequest {
  return {
    ...p,
    submittedFullName: `${p.firstName} ${p.lastName}`,
    premiumActive: p.user?.premiumStatus === "premium",
    submittedAt: p.createdAt,
    screenshotFileName: "Підтвердження",
  };
}
/** Convert a wall-clock form value in its IANA zone; reject nonexistent DST times. */
export function toInstant(date: string, time: string, zone: string): string {
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess).toISOString(), zone);
    const shown = Date.parse(`${p.date}T${p.time}:00Z`);
    const delta = target - shown;
    if (!delta) return new Date(guess).toISOString();
    guess += delta;
  }
  throw new Error("Такий час не існує через перехід на літній час.");
}

export function wallDateTime(instant: string, zone: string): string {
  const p = parts(instant, zone);
  return `${p.date}T${p.time}`;
}
