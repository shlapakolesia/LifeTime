# Локальна розробка

Потрібні Node.js 22.12+ (перевірено Node 24), npm і PostgreSQL 16/17. AWS не потрібен.
Frontend залишається в корені; backend — окремий npm-проєкт.

1. `npm install`
2. `npm install --prefix backend`
3. `cp .env.example .env.local`
4. `cp backend/.env.example backend/.env`
5. Налаштуйте `DATABASE_URL` у backend/.env. Увімкніть `DEV_IDENTITY_ENABLED=true` **тільки локально**.
6. `npm run db:generate --prefix backend`
7. `npm run db:migrate --prefix backend`
8. `npm run db:seed --prefix backend`
9. В окремих терміналах: `npm run dev:backend` та `npm run dev`.

Backend завантажує `.env` від поточного каталогу: кореневий `dev:backend` переходить у backend автоматично. Для запуску напряму: `cd backend && npm run dev`. Prisma CLI сам читає backend/.env.

## PostgreSQL

Можна встановити PostgreSQL через офіційний інсталятор/Postgres.app або Homebrew: `brew install postgresql@17`, потім `brew services start postgresql@17`. Створіть окремого локального користувача й базу через psql:

```sql
CREATE USER lifetime WITH PASSWORD 'replace-with-local-password';
CREATE DATABASE lifetime OWNER lifetime;
```

Якщо Docker уже встановлений, альтернативний локальний запуск без deployment-файлів:

```bash
docker run --name lifetime-local-postgres -e POSTGRES_USER=lifetime -e POSTGRES_PASSWORD=local-only-password -e POSTGRES_DB=lifetime -p 127.0.0.1:5432:5432 -d postgres:17-alpine
```

Вкажіть цей пароль у backend/.env. Паролі прикладів призначені лише для ізольованої локальної бази. Не використовуйте production-базу для тестів.

Seed не очищає й не перезаписує записи. Тестові акаунти: `olesia@lifetime.local`, `sofia@lifetime.local`, `solomia@lifetime.local`, `andrii@lifetime.local`, `admin@lifetime.local`. У локальній формі входу введіть email одного з них. Паролів немає; локальна реєстрація створює новий user/free акаунт у PostgreSQL після onboarding. Google очікує Cognito. Адмін-роль береться з БД.

## Перевірки

```bash
npm run typecheck
npm run build
npm run build:backend
npm test
# Окрема тестова БД, міграції спочатку:
cd backend
NODE_ENV=test DEV_IDENTITY_ENABLED=true RUN_DB_TESTS=true DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/lifetime_test npm test
```

Без `RUN_DB_TESTS=true` тест persistence явно пропускається. Тести додають записи з унікальними email в тестовій БД; вони не очищають її автоматично.

## Типові помилки

- P1001: сервер PostgreSQL не працює, неправильний порт або DATABASE_URL.
- P2021: не застосовані міграції.
- 401: увімкніть development adapter локально, виконайте seed, увійдіть тестовим email. У production потрібен Cognito verifier.
- CORS: FRONTEND_ORIGIN має точно збігатися з адресою frontend, включно з портом. Після зміни env перезапустіть backend/Vite.
- Помилка зображення: потрібен справжній JPEG/PNG/WebP до 5 МБ і 25 млн пікселів.
- 403 пошуку часу: учасник не надав доступ або вимкнув sharing.
- Зайнятий порт: налаштуйте PORT та VITE_API_BASE_URL узгоджено.

`VITE_DATA_MODE=demo` явно вмикає старий локальний прототип. API-режим є типовим і не підмінює помилки локальними даними. Налаштування вигляду календаря залишаються станом поточної сесії; активні години та приватність зберігаються сервером.

## Оновлення після виправлення реєстрації

Виконайте `npm run db:generate`, `npm run db:migrate`, потім **перезапустіть backend**. Уже запущений tsx watcher може тримати старий Prisma client після генерації нової моделі. Базу не очищуйте й seed повторно не потрібний для реєстрації.

Локальна реєстрація: /register → ім'я/прізвище/email → onboarding → активні години → «Відкрити LifeTime». Дані створюються однією транзакцією. Вхід на /login знаходить уже наявний локальний акаунт. Duplicate email не змінює його профіль, а показує пропозицію увійти.

Сесія зберігається в sessionStorage поточної вкладки, має термін 7 днів та перевіряється через GET /api/profile після refresh. У БД зберігається лише SHA-256 hash випадкового session token. Logout відкликає сесію. Старі email-only browser sessions потребують повторного входу — дані акаунта не видаляються.

Для regression-тесту справжніх React форм із PostgreSQL:

```bash
NODE_ENV=test DEV_IDENTITY_ENABLED=true RUN_DB_TESTS=true DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/lifetime_test npm run test:auth-flow
```

Тест використовує jsdom, справжні React компоненти, Express і PostgreSQL; він додає нові унікальні тестові акаунти без очищення БД.
