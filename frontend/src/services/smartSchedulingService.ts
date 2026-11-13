import { addDays, iso } from '../data'
import type { CalendarEvent, Slot, Task, User } from '../types'
import { calculateAvailabilitySlots } from './availabilityService'

export interface SmartEventDraft {
  kind: 'event'
  title: string
  participantIds: string[]
  date: string
  durationMinutes: number
  location: string
  slot: Slot
}

export interface SmartTaskDraft {
  kind: 'task'
  title: string
  deadline: string
  durationMinutes: number
  priority: Task['priority']
  slot: Slot
}

export type SmartDraft = SmartEventDraft | SmartTaskDraft
export type SmartParseResult = { draft: SmartDraft } | { clarification: string } | { unsupported: true }

export interface SmartSchedulingService {
  interpret(text: string, context: { events: CalendarEvent[]; users: User[]; activeStart: string; activeEnd: string }): SmartParseResult
}

const weekdayStems: [string, number][] = [['понеділ',1],['вівтор',2],['серед',3],['четвер',4],['пʼят',5],["п'ят",5],['субот',6],['неділ',0]]

function parseDate(text: string) {
  if (text.includes('завтра')) return addDays(1)
  const match = weekdayStems.find(([stem]) => text.includes(stem))
  if (!match) return null
  const today = new Date()
  let offset = (match[1] - today.getDay() + 7) % 7
  if (offset === 0 || text.includes('наступн')) offset += 7
  const result = new Date(today)
  result.setDate(today.getDate() + offset)
  return iso(result)
}

function parseDuration(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(годин(?:и|у)?|год|хвилин(?:и|у)?|хв)/)
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  return match[2].startsWith('хв') ? Math.round(value) : Math.round(value * 60)
}

function addMinutes(time: string, amount: number) {
  const total = Number(time.slice(0,2)) * 60 + Number(time.slice(3)) + amount
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}

class LocalSmartSchedulingService implements SmartSchedulingService {
  interpret(source: string, context: { events: CalendarEvent[]; users: User[]; activeStart: string; activeEnd: string }): SmartParseResult {
    const text = source.toLowerCase().replace(/’/g,'ʼ')
    const durationMinutes = parseDuration(text)
    const date = parseDate(text)
    if (text.includes('зустріч')) {
      const participantIds = context.users.slice(1).filter((user) => text.includes(user.firstName.toLowerCase().slice(0,-1))).map((user) => user.id)
      if (!participantIds.length) return { clarification: 'З ким запланувати зустріч? Напиши імена друзів так, як вони вказані у LifeTime.' }
      if (!date) return { clarification: 'На який день запланувати зустріч? Наприклад: «наступного четверга» або «завтра».' }
      if (!durationMinutes) return { clarification: 'Скільки має тривати зустріч? Вкажи години або хвилини.' }
      const after = text.match(/після\s+(\d{1,2})(?::(\d{2}))?/)
      const earliest = after ? `${String(Number(after[1])).padStart(2,'0')}:${after[2] || '00'}` : context.activeStart
      const locationMatch = text.match(/[ув]\s+(кав[ʼ']?ярн[^.]+|ресторані[^.]+|офісі[^.]+|центрі[^.]+)/)
      const location = locationMatch?.[1]?.trim() || ''
      const slots = calculateAvailabilitySlots(context.events, context.users, participantIds, date, date, earliest, context.activeEnd, durationMinutes)
      if (!slots.length) return { clarification: 'У цей день немає безперервного спільного вікна потрібної тривалості. Зміни день, час або тривалість.' }
      const names = participantIds.map((id) => context.users.find((user) => user.id === id)?.firstName).filter(Boolean)
      return { draft: { kind:'event', title:`Зустріч із ${names.join(' та ')}`, participantIds, date, durationMinutes, location, slot:slots[0] } }
    }
    if (text.includes('потрібно') || text.includes('підготувати') || text.includes('завдання')) {
      if (!date) return { clarification: 'До якого дня потрібно завершити завдання?' }
      if (!durationMinutes) return { clarification: 'Скільки часу потрібно на виконання завдання?' }
      const titleMatch = text.match(/(?:потрібно|треба)\s+(.+?)\s+до\s+/)
      const title = (titleMatch?.[1] || text.split(' до ')[0]).replace(/^мені\s+/, '').trim()
      if (!title) return { clarification: 'Коротко напиши, що саме потрібно зробити.' }
      if (!text.includes('пріоритет')) return { clarification: 'Який пріоритет має завдання: високий, середній чи низький?' }
      const priority: Task['priority'] = text.includes('висок') ? 'Високий' : text.includes('низьк') ? 'Низький' : 'Середній'
      const slots = calculateAvailabilitySlots(context.events, context.users, [], addDays(0), date, context.activeStart, context.activeEnd, durationMinutes)
      if (!slots.length) return { clarification: 'До дедлайну немає достатнього безперервного вікна. Зменш тривалість або зміни дедлайн.' }
      return { draft: { kind:'task', title:title.charAt(0).toUpperCase()+title.slice(1), deadline:date, durationMinutes, priority, slot:slots[0] } }
    }
    return { unsupported:true }
  }
}

export const smartSchedulingService: SmartSchedulingService = new LocalSmartSchedulingService()
export { addMinutes }
