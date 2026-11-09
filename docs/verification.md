# Перевірено 9 листопада 2026

Гілка feature/backend; до реалізації робоче дерево було чистим. Комітів, push, merge чи deployment не виконувалося.

Успішні перевірки:

- Початковий frontend production build та TypeScript перед змінами.
- Frontend `npm run typecheck`, `npm run build` після реалізації.
- Backend `npm run build:backend`.
- Prisma generate та validate.
- Три SQL-міграції реально застосовано на PostgreSQL 17.
- Seed виконано повторно без очищення чи перезаписування даних.
- 3 frontend unit tests: IANA timezone/DST, багатоденні DTO, проєкція task sessions.
- 10 backend tests, без пропусків: interval merging, fully booked/boundaries, validation, decoded images, unauthorized requests, fail-closed authentication, production development-adapter guard та реальні API workflows.
- API integration workflow перевірив події/edit/delete, tasks/persistence/complete/reopen, friend requests, права груп, зайнятість приватних подій і task sessions, 15/30/45/60/90/120/180/240/300/360/480/720/780 хв, full-window search, недоступні слоти, timezone Pacific/Kiritimati, DST, permission denial, confirmation conflict, Premium pending/approval/revocation, avatar replacement/removal, admin authorization, screenshot privacy та outbox.
- Persistence перевірено новим PrismaClient, незалежним від стану HTTP-застосунку.
- Живий `GET http://localhost:3001/api/health` повернув `{"status":"ok"}`.
- `git diff --check`.
- npm audit backend після оновлення sharp та транзитивних dependencies: 0 vulnerabilities.

Тестова БД запущена в окремому локальному контейнері `lifetime-codex-pg-20261109`, порт 127.0.0.1:55432. Це тимчасове середовище перевірки, не deployment configuration. Backend для перевірки запущено на 127.0.0.1:3001 з development adapter та цією базою. За потреби контейнер можна зупинити `docker stop lifetime-codex-pg-20261109`; дані не видаляються. У repository не створювався .env із credentials.

Не перевірено:

- Повний візуальний аудит усіх сторінок не виконано. Реєстрацію/onboarding/refresh/login тепер окремо перевірено у Safari (див. доповнення нижче).
- Cognito/Google/PKCE, реальні листи SES, S3 та AI: ці інтеграції не реалізовані відповідно до розподілу ролей.
- Production deployment, load testing, accessibility audit та cloud permissions.

Frontend підключений до API на рівні store/services; HTTP→PostgreSQL workflows перевірені. Для реєстрації/onboarding/login/refresh тепер виконано browser→frontend→API→DB перевірку; інші браузерні сценарії потребують окремого UI-тестування.

## Залишкові обмеження

- Recurrence потребує окремої реалізації (опції форми явно недоступні).
- Частина appearance settings календаря — стан поточної сесії.
- Group management використовує прості додаткові контролі; потрібен ручний UX-перегляд у браузері.
- Необхідні production provisioning Cognito identities, email outbox worker, file retention/cleanup, резервні копії й observability.
- Calendar timeline має попереднє вікно 08:00–22:00; month view і API містять події поза цими годинами. Для повного 24-годинного timeline потрібне окреме UI-доповнення.

## Виправлення реєстрації та onboarding

Корінь помилки: signup збирав дані лише в React, фінальний finish викликав signInLocal, а adapter зберігав email-only identity і читав GET /api/profile. Backend шукав local:email у БД без будь-якого provisioning. Для нового email акаунта не існувало, тому 401 Unknown account був закономірним. Поля часу мали defaultValue без state/onChange, їх значення не передавалися на сервер. Попередні тести реєстраційний UI з новим акаунтом не проходили.

Додано development-only register/login/logout, атомарне створення User+UserProfile+DevelopmentSession, випадковий token із hash у PostgreSQL та строком 7 днів. Frontend отримує серверний UUID, не вигадує local-ID, спільно використовує token для JSON і private images. Restore перевіряє профіль на сервері до відображення захищеної сторінки. Помилки показуються українською в поточній формі, без alert із сирим backend текстом. Duplicate registration не переписує профіль; відсутній login не створює нового користувача.

Безпека: тільки explicitly enabled development/test + loopback + дозволений Origin, rate limit, strict Zod, user/free за замовчуванням. Production verifier/Cognito contract збережено. Старі dev:email токени залишені тільки для локальних тестових інструментів, новий frontend їх не генерує.

Перевірено на справжній локальній PostgreSQL:

- Усі **18 тестів**: 3 frontend unit, 3 повні React/jsdom + Express + PostgreSQL regression, 12 backend тестів; без пропусків.
- Regression: новий email → registration → onboarding з 10:15–19:45 → Dashboard → повне перемонтування застосунку зі збереженим sessionStorage → Dashboard → logout → повторний login того самого UUID.
- Окремо: невідомий login українською; duplicate registration залишається на onboarding і не змінює існуючі ім'я/години; expired/revoked sessions; заборонені Origin та admin payload.
- Нативний Safari: новий тестовий акаунт → активні години 10:15–19:45 → Dashboard → реальний reload → налаштування з тими самими годинами → logout → повторний login → Dashboard.
- Прямий read-only запит у PostgreSQL підтвердив однаковий User.id/Profile.userId, години, timezone та user/free права Safari-акаунта.
- Prisma generate/validate; четверту additive migration застосовано без reset; frontend TypeScript і production build, backend production build, git diff --check успішні.

Під час першої нативної перевірки вже запущений watcher тримав старий Prisma client без DevelopmentSession. Перезапуск backend після generate/migrate це усунув, після чого сценарій повторено успішно. Цей крок додано в local-development.md.

Запуск regression: `NODE_ENV=test DEV_IDENTITY_ENABLED=true RUN_DB_TESTS=true DATABASE_URL=... npm test`. Без RUN_DB_TESTS DB-dependent сценарії явно пропускаються; їх результат не слід видавати за перевірений persistence.
