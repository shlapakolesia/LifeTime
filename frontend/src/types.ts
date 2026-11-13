export type Page =
  | "overview"
  | "calendar"
  | "tasks"
  | "find"
  | "friends"
  | "groups"
  | "assistant"
  | "premium"
  | "admin"
  | "notifications"
  | "settings";
export type EventCategory = "Навчання" | "Робота" | "Особисте" | "Друзі" | "Спорт" | "Інше";
export type Privacy = "private" | "busy" | "shared";
export type CalendarView = "month" | "week" | "day";
export type PremiumStatus = "free" | "pending" | "premium" | "rejected";
export type AccountRole = "user" | "admin";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  activeStart: string;
  activeEnd: string;
  sharing: "none" | "busy" | "selected";
  patronymic?: string;
  premiumStatus: PremiumStatus;
  accountRole: AccountRole;
  bio?: string;
  timezone?: string;
  avatarUrl?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  start: string;
  end: string;
  category: EventCategory;
  location: string;
  participantIds: string[];
  ownerId: string;
  privacy: Privacy;
  endDate?: string;
  sourceTaskId?: string;
  startsAt?: string;
  endsAt?: string;
  recheckAvailability?: boolean;
  recurrence?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  deadline: string;
  estimatedMinutes?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  priority: "Високий" | "Середній" | "Низький";
  completed: boolean;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  ownerId: string;
  color: string;
}

export interface AppNotification {
  id: string;
  type: "event" | "reminder" | "friend" | "group" | "deadline" | "schedule";
  title: string;
  text: string;
  time: string;
  read: boolean;
  actionable?: boolean;
}

export interface Settings {
  activeStart: string;
  activeEnd: string;
  weekStartsMonday: boolean;
  defaultView: CalendarView;
  timeFormat: "24" | "12";
  sharing: "none" | "busy" | "selected";
  notifications: boolean;
}

export interface PremiumRequest {
  id: string;
  userId: string;
  premiumActive?: boolean;
  submittedFullName: string;
  accountEmail: string;
  screenshotDataUrl?: string;
  screenshotFileName?: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
}

export interface ApiErrorShape {
  status: number;
  code: "validation" | "unauthorized" | "forbidden" | "network" | "server";
  message: string;
}

export interface AvailabilityRequest {
  participantIds: string[];
  startDate: string;
  endDate: string;
  durationMinutes: number;
  earliestHour: string;
  latestHour: string;
  preferences?: string[];
}

export interface Slot {
  date: string;
  start: string;
  end: string;
  score: number;
  participantIds: string[];
  reason: string;
}
