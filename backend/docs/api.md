# REST API LifeTime

Base URL задається `VITE_API_BASE_URL`, наприклад `http://localhost:3001`. Всі маршрути, крім health, потребують `Authorization: Bearer <access-token>`.
Локально, лише з увімкненим development adapter: `Authorization: Bearer dev:olesia@lifetime.local`.
Це **не production authentication**. Дані користувача, роль і Premium сервер бере з БД; браузер не може призначати їх.

JSON-помилка: `{ "message": "Некоректні дані.", "issues": [] }` (issues лише для Zod).
Коди: 200/201/204 — успіх; 400 — валідація; 401 — немає identity; 403 — немає дозволу; 404 — запис відсутній/недоступний; 409 — конфлікт; 429 — rate limit; 500 — внутрішня помилка.
Списки підтримують `?limit=100&offset=0`, максимум 100 на сторінку. Винятки: точний пошук користувача й розрахований список слотів (до 24).

| Метод | Шлях | Дія |
|---|---|---|
| GET | /api/health | Перевірка з'єднання з БД |
| GET, PATCH | /api/profile | Власний профіль |
| GET | /api/users?email=exact@example.com | Точний email-пошук, повертає лише id та ім'я |
| GET, POST | /api/events | Список / створення події |
| PUT, DELETE | /api/events/:id | Повна заміна / видалення власної події |
| GET, POST | /api/tasks | Власні завдання / створення |
| PUT, DELETE | /api/tasks/:id | Повна заміна / видалення |
| GET | /api/friends | Друзі й власний дозвіл shareAvailability |
| PATCH, DELETE | /api/friends/:id | Дозвіл / двостороннє видалення дружби |
| GET, POST | /api/friend-requests | Pending вхідні/вихідні запити / запросити |
| PATCH | /api/friend-requests/:id | Прийняти або відхилити (лише адресат) |
| GET, POST | /api/groups | Мої групи / створити |
| PATCH, DELETE | /api/groups/:id | Змінити / видалити (лише власник) |
| POST | /api/groups/:id/members | Додати учасника (власник) |
| DELETE | /api/groups/:id/members/:userId | Видалити учасника або вийти |
| POST | /api/availability | Спільний вільний час |
| GET | /api/notifications | Власні сповіщення |
| PATCH, DELETE | /api/notifications/:id | Прочитати / видалити |
| POST, DELETE | /api/uploads/avatar | multipart file / прибрати аватар |
| GET | /api/uploads/:id | Автентифікована видача зображення |
| GET, POST | /api/premium/requests | Власні заявки / multipart заявка |
| GET | /api/admin/premium-requests | Список заявок (admin) |
| GET, PATCH | /api/admin/premium-requests/:id | Деталі / ручне рішення (admin) |
| DELETE | /api/admin/premium-requests/:id | Видалити опрацьовану заявку разом зі скриншотом (admin). 409, якщо заявка ще pending або в користувача активний Premium |
| DELETE | /api/admin/users/:id/premium | Відкликати чинний Premium (admin) |
| GET | /api/ai/context | Власні події й завдання (Premium) |
| POST | /api/ai/availability | Авторизований пошук (Premium) |
| POST | /api/ai/proposals/validate | Перевірка структури пропозиції (Premium) |
| POST | /api/ai/proposals/confirm | Збереження підтвердженої пропозиції (Premium) |

## Події

POST /api/events (PUT використовує той самий повний payload):

```json
{
  "title": "Зустріч команди",
  "description": "Обговорити проєкт",
  "startsAt": "2027-01-15T12:00:00Z",
  "endsAt": "2027-01-15T13:00:00Z",
  "timezone": "Europe/Kyiv",
  "category": "Навчання",
  "location": "Онлайн",
  "privacy": "shared",
  "participantIds": [],
  "recheckAvailability": true
}
```

Відповідь 201 містить id, ownerId, часові поля, createdAt/updatedAt та `participants: [{eventId,userId,...}]`. GET приймає ISO `from` і `to`, використовує перетин інтервалів. Private/busy деталі доступні лише власнику; shared — також учасникам. Пошук враховує всі події й участь у них, незалежно від visibility, але не повертає деталі.

`recheckAvailability=true` обов'язково надсилається frontend після вибору слоту. Сервер перевіряє час повторно з транзакційними блокуваннями учасників. 409 означає, що потрібно повторити пошук. Для звичайних власних подій можна дозволяти перетини. Recurrence наразі не підтримується.

## Завдання

```json
{
  "title": "Підготувати звіт",
  "description": "Практична робота",
  "deadline": "2027-01-17T21:59:00Z",
  "priority": "Високий",
  "completed": false,
  "estimatedMinutes": 60,
  "scheduledStart": "2027-01-16T13:00:00Z",
  "scheduledEnd": "2027-01-16T14:00:00Z"
}
```

GET: `completed=true|false`, `sort=deadline|createdAt|priority`. PUT повністю замінює поля; complete/reopen — той самий PUT зі зміною completed. Обидва scheduled endpoint мають бути задані разом або null. Вони є єдиним джерелом фокус-сесії: окрема CalendarEvent не створюється. Незавершені сесії блокують зайнятість; конфлікт запланованої сесії повертає 409.

## Друзі та групи

POST friend-requests: `{ "recipientId": "<uuid>" }` → 201 із записом запиту.
PATCH friend-requests/:id: `{ "status": "accepted" }` або rejected.
PATCH friends/:id: `{ "shareAvailability": false }` — **мій** дозвіл цьому другу.
POST/PATCH groups: `{ "name": "Команда", "description": "Університетський проєкт" }`.
POST groups/:id/members: `{ "userId": "<uuid>" }`.
Власник не може просто вийти: він видаляє групу. Учасник може вийти сам, але не видаляти інших.

## Пошук часу

```json
{
  "participantIds": ["<uuid друга або учасника групи>"],
  "startDate": "2027-01-15",
  "endDate": "2027-01-17",
  "durationMinutes": 90,
  "earliestHour": "08:00",
  "latestHour": "21:00",
  "timezone": "Europe/Kyiv",
  "preferences": ["afternoon"]
}
```

Автор автоматично включений. До 50 учасників, діапазон до 31 дня, duration — будь-яке ціле число 15–1440. Повний день у UI — весь вибраний активний проміжок. Preferences: morning/afternoon/evening впливають лише на рейтинг. Враховуються активні години кожного у його timezone, усі перетини подій і незавершені task sessions. Слоти мають крок 15 хв від початку реального вільного інтервалу.

```json
[{"date":"2027-01-15","start":"14:00","end":"15:30","startsAt":"2027-01-15T12:00:00.000Z","endsAt":"2027-01-15T13:30:00.000Z","participantIds":["<uuid>"],"score":120,"reason":"Спільний вільний час"}]
```

`[]` означає відсутність слотів; 403 — відсутність дозволу, це не вільний календар. Потрібна дружба з дозволом від цільового користувача або спільна група; sharing=none забороняє обидва шляхи. Явна заборона для друга діє і в групі. Вступ до групи надає її учасникам доступ до busy/free, якщо немає явної заборони.

## Профіль, файли, Premium

PATCH profile: `{ "firstName":"Олеся", "lastName":"Шлапак", "timezone":"Europe/Kyiv", "activeStart":"08:00", "activeEnd":"21:00", "sharing":"busy", "bio":"Студентка" }`.
GET profile → User із вкладеним profile, серверними accountRole/premiumStatus.
Аватар: multipart/form-data з `file`, відповідь `{ "id":"<file uuid>" }`.
Premium: multipart лише `firstName`, `lastName`, `file`. Email автоматично береться з акаунта.
Відповідь містить id, screenshotId, accountEmail, status=pending, createdAt. Скриншот не активує Premium.
PATCH admin/premium-requests/:id: `{ "status":"approved", "reviewNotes":"Звірено" }` або rejected. Лише pending можна розглянути.
DELETE admin/premium-requests/:id: 204. Pending не видаляється (спершу рішення), схвалену заявку з активним Premium — лише після `DELETE /api/admin/users/:id/premium`.
POST ai/interpret: `{ "text":"10:00", "history":[{"role":"user","text":"…"},{"role":"assistant","text":"…"}] }` — `history` необовʼязковий (до 12 повідомлень), дає моделі контекст розмови.
GET uploads/:id повертає binary WebP, не URL. Для скриншотів дозволено лише власника й admin. Аватари доступні автентифікованим користувачам. Файли не роздаються static middleware.
PATCH notification: `{ "read":true }` → `{ "updated":1 }`.

## Development registration/session (лише явно enabled local development)

POST `/api/dev-auth/register`: `{ "email":"new@lifetime.local", "firstName":"Марія", "lastName":"Тестова", "activeStart":"10:15", "activeEnd":"19:45", "timezone":"Europe/Kyiv" }`.

201: `{ "user":{ "id":"<server UUID>", "accountRole":"user", "premiumStatus":"free", "profile":{...} }, "token":"dev-session:<random token>", "expiresAt":"<ISO timestamp>" }`. Користувач, профіль і сесія створюються атомарно. Email нормалізується; існуючий email → 409, без перезапису. Поля userId/isAdmin/accountRole/isPremium не приймаються.

POST `/api/dev-auth/login`: `{ "email":"new@lifetime.local" }` → той самий формат сесії, завжди той самий UUID акаунта. Не створює акаунт і не зв'язує Cognito user з неперевіреним email.

GET `/api/profile` з Bearer session token відновлює сесію. POST `/api/dev-auth/logout` відкликає поточний token → 204. Невідомі/прострочені/відкликані сесії → 401 українською.

Усі dev-auth маршрути закриті поза explicitly enabled development/test, обмежені loopback-з'єднанням, дозволеним Origin і rate limit. Backend із development identity слухає лише 127.0.0.1. Це не production password/identity provider; Cognito контракт не змінено.

## POST `/api/auth/provision` (Cognito)
Заголовок `Authorization: Bearer <access token>`, тіло `{ "idToken": "...", "timezone": "Europe/Warsaw" }`. Перевіряє обидва токени (підпис, issuer, token_use, client), збіг `sub` і `email_verified`. Ідемпотентно: повертає існуючий акаунт (200) або створює новий (201) у форматі `/api/profile`. 401 — недійсні токени; 403 — email не підтверджено; 409 — email уже привʼязаний до іншого акаунта. Email та імена беруться лише з ID token.
