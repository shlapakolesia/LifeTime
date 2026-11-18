import { DateTime } from "luxon";
import { availabilityDate, type AiTurn } from "./ai.js";

const months = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];
const writtenDate = new RegExp(`(?<![\\p{L}\\d])([0-9]{1,2})\\s+(${months.join("|")})(?:\\s+([0-9]{4}))?(?![\\p{L}\\d])`, "gu");
const relativeDate = /(?<!\p{L})(сьогодні|завтра|наступного понеділка|цього тижня)(?!\p{L})/gu;
const periods = {
  сьогодні: "today",
  завтра: "tomorrow",
  "наступного понеділка": "nextMonday",
  "цього тижня": "thisWeek",
} as const;
const readOnly = /^(?:коли (?:я вільн(?:а|ий)|є вільний час|я можу зайнятися)|покажи (?:мій|мені) вільний час|які в мене вільні години|знайди (?:мені )?\d+\s+хвилин[аи]? вільного часу)(?!\p{L})/u;
const scheduling = /(?<!\p{L})(?:заплануй|запланувати|створи|створити|додай|додати|забронюй|забронювати|признач|постав|запиши|організуй|запроси|перенеси|скасуй|видали|збережи)(?!\p{L})/u;
const otherPeople = /(?<!\p{L})(?:(?:ми|нам|нас|разом|спільн\p{L}*|друз\p{L}*|груп\p{L}*)(?!\p{L})|(?:з|із|зі|для)\s+\p{L})/u;
const clockConstraint = /\d{1,2}:\d{2}|(?<!\p{L})(?:(?:після|перед|до|раніше|пізніше)\s+[\p{L}\d]+|(?:о|об|з|від|між)\s+\d|вранці|уранці|зранку|вдень|увечері|ввечері|опівдні|опівночі|у другій половині дня|у першій половині дня)(?!\p{L})/u;

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function availabilityClarification(text: string, personalOnly = false): string | undefined {
  const normalized = normalize(text);
  if (personalOnly && (!readOnly.test(normalized) || scheduling.test(normalized))) return;
  const withoutDate = normalized.replace(writtenDate, "");
  if (otherPeople.test(withoutDate))
    return "Шукаєш вільний час лише для себе чи разом з іншими? Для спільного часу скористайся «Знайти час».";
  if (clockConstraint.test(withoutDate))
    return "У чаті можу показати вільний час за весь день. Показати його чи перевірити потрібні години через «Знайти час»?";
}

function inspect(text: string) {
  const normalized = normalize(text);
  if (!readOnly.test(normalized) || scheduling.test(normalized) || availabilityClarification(normalized)) return null;
  const durations = [...normalized.matchAll(/(?<![\p{L}\d])([0-9]+)\s*(хв(?:илин[аиу]?)?|год(?:ин[аиу]?)?)(?!\p{L})/gu)];
  const duration = durations[0];
  const durationMinutes = duration ? Number(duration[1]) * (duration[2].startsWith("год") ? 60 : 1) : undefined;
  if (/\d[.,]\d+\s*(?:хв|год)/u.test(normalized) || durations.length > 1 || (durationMinutes !== undefined && (durationMinutes < 1 || durationMinutes > 1440))) return null;

  const written = [...normalized.matchAll(writtenDate)];
  const relative = [...normalized.matchAll(relativeDate)];
  if (written.length + relative.length > 1 || /(?:^| )(?:або|між|до|від) (?=\d)/u.test(normalized) || /(?<!\d)\d{1,2}[./-]\d{1,2}(?!\d)|(?<!\p{L})(?:післязавтра|вчора|наступного тижня)(?!\p{L})/u.test(normalized)) return null;
  const date = written[0];
  if (date) {
    const [, day, month, year] = date;
    const monthNumber = months.indexOf(month) + 1;
    const iso = year ? DateTime.utc(Number(year), monthNumber, Number(day)).toISODate() : null;
    if (year && !iso) return null;
    const parsed = availabilityDate.safeParse(iso
      ? { startDate: iso, endDate: iso }
      : { day: Number(day), month: monthNumber });
    return parsed.success ? { date: parsed.data, durationMinutes } : null;
  }
  return {
    date: relative[0] ? { period: periods[relative[0][1] as keyof typeof periods] } : undefined,
    durationMinutes,
  };
}

const undatedFollowUp = /^(?:коли є вільний час|коли я вільн(?:а|ий))[?,]?\s*(?:(?:мені )?треба \d+\s+хвилин[аи]?)?[?.!]?$/iu;

export function personalAvailabilityIntent(text: string, history: AiTurn[]) {
  const request = inspect(text);
  if (!request || (!request.date && !undatedFollowUp.test(text.trim()))) return null;
  if (request.date && !("month" in request.date)) return request;

  // Stop at any unrelated user turn instead of borrowing an older calendar date.
  for (const turn of [...history].reverse()) {
    if (turn.role !== "user") continue;
    const previous = inspect(turn.text);
    if (!previous?.date) {
      if (previous && undatedFollowUp.test(turn.text.trim())) continue;
      break;
    }
    if (!request.date) return { ...request, date: previous.date };
    if ("startDate" in previous.date && previous.date.startDate === previous.date.endDate) {
      const date = DateTime.fromISO(previous.date.startDate);
      if (date.month === request.date.month && date.day === request.date.day)
        return { ...request, date: previous.date };
    }
    break;
  }
  return request;
}
