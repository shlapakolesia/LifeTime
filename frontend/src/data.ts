import type { AppNotification, CalendarEvent, Group, Settings, Task, User } from './types'

export const iso = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
export const addDays = (amount: number) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + amount)
  return iso(d)
}
export const dateFromIso = (value: string) => new Date(`${value}T12:00:00`)
export const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  value ? new Intl.DateTimeFormat('uk-UA', options).format(dateFromIso(value)) : 'Без дедлайну'
export const weekday = (value: string) => new Intl.DateTimeFormat('uk-UA', { weekday: 'long' }).format(dateFromIso(value))
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
export const timeFromMinutes = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`

export const users: User[] = [
  { id: 'me', firstName: 'Олеся', lastName: 'Шлапак', email: 'olesia@lifetime.local', initials: 'ОШ', color: '#7057d8', role: 'UX-дизайнерка', activeStart: '08:00', activeEnd: '21:00', sharing: 'busy', premiumStatus: 'free', accountRole: 'user' },
  { id: 'sofia', firstName: 'Софія', lastName: 'Садовенко', email: 'sofia@example.com', initials: 'СС', color: '#d5677d', role: 'Frontend-розробниця', activeStart: '09:00', activeEnd: '20:00', sharing: 'busy', premiumStatus: 'free', accountRole: 'user' },
  { id: 'solomia', firstName: 'Соломія', lastName: 'Шимчук', email: 'solomia@example.com', initials: 'СШ', color: '#2f8f77', role: 'Студентка', activeStart: '08:00', activeEnd: '19:00', sharing: 'selected', premiumStatus: 'free', accountRole: 'user' },
  { id: 'maria', firstName: 'Марія', lastName: 'Коваль', email: 'maria@example.com', initials: 'МК', color: '#b36b31', role: 'Продуктова менеджерка', activeStart: '10:00', activeEnd: '21:00', sharing: 'busy', premiumStatus: 'free', accountRole: 'user' },
  { id: 'andrii', firstName: 'Андрій', lastName: 'Мельник', email: 'andrii@example.com', initials: 'АМ', color: '#3976b8', role: 'Розробник', activeStart: '09:00', activeEnd: '19:00', sharing: 'busy', premiumStatus: 'free', accountRole: 'user' },
]

const e = (id: string, title: string, day: number, start: string, end: string, category: CalendarEvent['category'], ownerId = 'me', participantIds: string[] = [], privacy: CalendarEvent['privacy'] = 'busy', location = ''): CalendarEvent => ({
  id, title, description: title === 'Лекція з програмування' ? 'Практична робота з алгоритмів і структур даних.' : '', date: addDays(day), start, end, category, ownerId, participantIds, privacy, location,
})

export const seedEvents: CalendarEvent[] = [
  e('e1', 'Лекція з програмування', 0, '09:00', '10:30', 'Навчання', 'me', [], 'busy', 'Аудиторія 312'),
  e('e2', 'Командний синк', 0, '12:00', '12:45', 'Робота', 'me', ['sofia', 'andrii'], 'shared', 'Google Meet'),
  e('e3', 'Тренування', 0, '18:30', '20:00', 'Спорт', 'me'),
  e('e4', 'Підготовка до контрольної', 1, '10:00', '12:00', 'Навчання'),
  e('e5', 'Зустріч із Софією', 1, '15:00', '16:00', 'Друзі', 'me', ['sofia'], 'shared', 'Кавʼярня «Сенс»'),
  e('e6', 'Робота над портфоліо', 2, '11:00', '13:00', 'Робота'),
  e('e7', 'Вечірня прогулянка', 3, '18:00', '19:00', 'Особисте'),
  e('e8', 'Командний проєкт', 4, '14:00', '16:00', 'Навчання', 'me', ['solomia', 'andrii'], 'shared'),
  e('s1', 'Приватна подія', 0, '10:00', '11:30', 'Особисте', 'sofia'),
  e('s2', 'Робочий фокус', 0, '13:00', '15:00', 'Робота', 'sofia'),
  e('s3', 'Зайнята', 1, '09:00', '11:00', 'Робота', 'sofia'),
  e('s4', 'Зайнята', 2, '14:00', '16:30', 'Робота', 'sofia'),
  e('m1', 'Зайнята', 0, '09:30', '12:30', 'Робота', 'maria'),
  e('m2', 'Зайнята', 1, '13:00', '15:00', 'Робота', 'maria'),
  e('m3', 'Зайнята', 2, '10:00', '12:00', 'Робота', 'maria'),
  e('a1', 'Зайнятий', 0, '11:00', '13:30', 'Робота', 'andrii'),
  e('a2', 'Зайнятий', 1, '16:00', '18:00', 'Навчання', 'andrii'),
  e('l1', 'Зайнята', 0, '14:30', '16:00', 'Навчання', 'solomia'),
  e('l2', 'Зайнята', 2, '09:00', '11:00', 'Навчання', 'solomia'),
]

export const seedTasks: Task[] = [
  { id: 't1', title: 'Здати лабораторну роботу', description: 'Перевірити тести й додати висновки.', deadline: addDays(0), priority: 'Високий', completed: false },
  { id: 't2', title: 'Підготувати презентацію проєкту', description: 'Оновити слайди з дослідженням.', deadline: addDays(2), priority: 'Середній', completed: false },
  { id: 't3', title: 'Замовити квитки до Львова', description: '', deadline: addDays(5), priority: 'Низький', completed: false },
  { id: 't4', title: 'Надіслати нотатки Софії', description: '', deadline: addDays(-1), priority: 'Середній', completed: true },
]

export const seedGroups: Group[] = [
  { id: 'g1', name: 'Команда LifeTime', description: 'Продуктова команда та щотижневі синки.', memberIds: ['me', 'sofia', 'andrii'], ownerId: 'me', color: '#7057d8' },
  { id: 'g2', name: 'Навчальна група', description: 'Готуємося разом і ділимося матеріалами.', memberIds: ['me', 'solomia', 'maria'], ownerId: 'solomia', color: '#2f8f77' },
  { id: 'g3', name: 'Друзі', description: 'Плани на вихідні без нескінченних переписок.', memberIds: ['me', 'sofia', 'solomia', 'maria'], ownerId: 'me', color: '#d5677d' },
]

export const seedNotifications: AppNotification[] = [
  { id: 'n1', type: 'event', title: 'Нове запрошення', text: 'Софія запрошує на «Кава після лекції»', time: '8 хв тому', read: false, actionable: true },
  { id: 'n2', type: 'deadline', title: 'Дедлайн сьогодні', text: 'Лабораторну роботу потрібно здати до 22:00', time: '32 хв тому', read: false },
  { id: 'n3', type: 'schedule', title: 'Знайдено спільний час', text: 'У групи «Друзі» є 3 вільні проміжки у суботу', time: '2 год тому', read: false },
  { id: 'n4', type: 'friend', title: 'Запит у друзі', text: 'Ірина Бондар хоче додати вас у друзі', time: 'Учора', read: true, actionable: true },
]

export const defaultSettings: Settings = {
  activeStart: '08:00', activeEnd: '21:00', weekStartsMonday: true, defaultView: 'week', timeFormat: '24', sharing: 'busy', notifications: true,
}

export function loadStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(`lifetime:${key}`)
    return stored ? JSON.parse(stored) : fallback
  } catch {
    return fallback
  }
}
