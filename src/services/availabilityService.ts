import { minutes, timeFromMinutes } from '../data'
import type { CalendarEvent, Slot, User } from '../types'

export function calculateAvailabilitySlots(events: CalendarEvent[], users: User[], participantIds: string[], from: string, to: string, start: string, end: string, duration: number): Slot[] {
  const dates: string[] = []
  for (const date = new Date(`${from}T12:00:00`); date <= new Date(`${to}T12:00:00`); date.setDate(date.getDate() + 1)) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }
  const allIds = ['me', ...participantIds]
  const output: Slot[] = []
  for (const date of dates) {
    const participants = users.filter((user) => allIds.includes(user.id))
    const allowedStart = Math.max(minutes(start), ...participants.map((user) => minutes(user.activeStart)))
    const allowedEnd = Math.min(minutes(end), ...participants.map((user) => minutes(user.activeEnd)))
    const busy = events
      .filter((event) => event.date === date && (allIds.includes(event.ownerId) || event.participantIds.some((id) => allIds.includes(id))))
      .map((event) => [minutes(event.start), minutes(event.end)] as [number, number])
    for (let cursor = allowedStart; cursor + duration <= allowedEnd; cursor += 15) {
      if (busy.some(([busyStart, busyEnd]) => cursor < busyEnd && cursor + duration > busyStart)) continue
      const hour = cursor / 60
      output.push({
        date,
        start: timeFromMinutes(cursor),
        end: timeFromMinutes(cursor + duration),
        score: 100 - Math.abs(hour - 14) * 3 - output.filter((slot) => slot.date === date).length,
        participantIds: allIds,
        reason: hour >= 11 && hour <= 16 ? 'Зручно між основними справами' : hour < 11 ? 'Спокійний початок дня' : 'Усі вже завершують важливі справи',
      })
    }
  }
  return output.sort((a, b) => b.score - a.score).slice(0, 12)
}
