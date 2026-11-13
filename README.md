# LifeTime

Календар і соціальне планування: React 19 + TypeScript + Vite + Tailwind у frontend/, Express + Prisma + PostgreSQL у backend/. Дизайн існуючого frontend збережено.

Працюють REST API для профілю, подій, завдань, друзів, груп, спільної зайнятості, сповіщень, аватарів, Premium-заявок і ручного admin review. API-режим типовий; він не підміняє помилки localStorage-даними. `VITE_DATA_MODE=demo` явно вмикає старий прототип.

## Запуск

Потрібні Node.js 22.12+ (перевірено 24), npm, PostgreSQL 16/17.

```bash
npm install --prefix frontend
npm install --prefix backend
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Створіть окрему PostgreSQL базу й налаштуйте backend/.env: DATABASE_URL, NODE_ENV=development, DEV_IDENTITY_ENABLED=true (лише локально), FRONTEND_ORIGIN. Детальні кроки встановлення PostgreSQL та приклади: [local-development.md](docs/local-development.md).

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:backend
# в іншому терміналі
npm run dev   # запускає Vite з frontend/
```

Кореневий package.json містить лише скрипти-обгортки (dev, build, test тощо), які делегують у frontend/ і backend/. Backend типовий порт 3001, Vite — 5173. CORS origin має точно збігатися. Для локального входу використовуйте `olesia@lifetime.local`, `sofia@lifetime.local`, `solomia@lifetime.local`, `andrii@lifetime.local` або `admin@lifetime.local` після seed. Паролів немає. Нові локальні акаунти можна зареєструвати через onboarding; їм надаються лише user/free права. Seed недеструктивний. Після Prisma generate/migrate перезапустіть backend.

## Перевірки

```bash
npm run typecheck
npm run build
npm run build:backend
npm test
```

Persistence/API integration tests потребують окремої мігрованої тестової PostgreSQL:

```bash
cd backend
NODE_ENV=test DEV_IDENTITY_ENABLED=true RUN_DB_TESTS=true DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/lifetime_test npm test
```

Без RUN_DB_TESTS integration test явно пропускається. Не запускайте їх на production. У тестовій БД залишаються записи з унікальними тестовими email.

## Межі готовності

Локальна авторизація — development adapter, не production authentication. Production-вхід через Amazon Cognito (Hosted UI, Google, PKCE, верифікація JWT, створення акаунта при першому вході) реалізовано в коді — налаштування AWS описано в [docs/cognito-setup.md](docs/cognito-setup.md). Без `COGNITO_*` змінних production API відхиляє токени. S3 і SES підготовлені через контракти; файли зараз локальні, листи лише в БД outbox. Реальний AI не реалізовано; його UI збережено з явним повідомленням про відсутню інтеграцію.

Повторювані події ще не реалізовані. Форма підтримує дати початку й завершення; багатоденні події відображаються по днях. Task sessions впливають на пошук і відображаються в календарі як проєкція завдання, без дублювання в БД. Частина налаштувань вигляду календаря залишається станом сесії. Автоматичне очищення невикористаних файлів, production observability та email worker ще потрібні. Browser/UI end-to-end перевірка залежить від наявності браузера; результати перевірок дивіться у docs/verification.md.

## Документація

- [REST endpoints та приклади](docs/api.md)
- [Моделі, міграції та seed](docs/database.md)
- [Локальний запуск і типові помилки](docs/local-development.md)
- [Налаштування Cognito](docs/cognito-setup.md)
- [Інфраструктура (infra/)](infra/README.md)
- [Деплой на AWS і оновлення](docs/aws-deploy.md)
- [Контракти Cognito, S3, SES, AI](docs/integration-guide.md)
- [Фактичні перевірки та обмеження](docs/verification.md)

Секрети й local uploads ігноруються Git. Опис AWS-інфраструктури та скрипти деплою лежать у [infra/](infra/README.md); real LLM integration до цієї реалізації не входить.
