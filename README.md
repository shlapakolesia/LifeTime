# LifeTime

**LifeTime** — веб-застосунок для календаря та соціального планування. Користувач веде власний приватний календар і завдання, додає друзів і груп, а застосунок знаходить час, коли вільні всі учасники зустрічі. Друзі бачать лише зайняті проміжки, а не деталі подій; запрошені учасники отримують сповіщення, а подія з'являється в їхньому календарі.

Можливості: календар (день/тиждень/місяць), завдання, друзі та групи, пошук спільного часу, сповіщення, аватари, Premium-заявки з розглядом адміністратором, вхід через Amazon Cognito (email і Google).

Технології: React 19 + TypeScript + Vite + Tailwind (`frontend/`), Express + Prisma + PostgreSQL (`backend/`), AWS: S3 + CloudFront, EC2, Cognito (`infra/`).

## Структура репозиторія

| Папка | Вміст |
|---|---|
| `backend/` | REST API, схема БД і міграції Prisma, тести; документація API та бази в `backend/docs/` |
| `frontend/` | Вебзастосунок (SPA) |
| `infra/` | AWS-інфраструктура: шаблон CloudFormation, конфіг сервера, скрипти деплою, інструкції в `infra/docs/` |

У корені також лежать `package.json` (скрипти-обгортки `npm run dev`, `build`, `test` тощо), `.gitignore` та службові файли `AGENTS.md`/`CLAUDE.md`.

## Запуск

Потрібні Node.js 22.12+ (перевірено 24), npm, PostgreSQL 16/17.

```bash
npm install --prefix frontend
npm install --prefix backend
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Створіть окрему PostgreSQL базу й налаштуйте backend/.env: DATABASE_URL, NODE_ENV=development, DEV_IDENTITY_ENABLED=true (лише локально), FRONTEND_ORIGIN. Детальні кроки встановлення PostgreSQL та приклади: [backend/docs/local-development.md](backend/docs/local-development.md).

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

## Деплой на AWS

Схема: сайт лежить у приватному S3-бакеті за CloudFront; запити `/api/*` CloudFront передає на EC2 (Node API + PostgreSQL); вхід забезпечує Cognito. Один HTTPS-домен для сайту й API.

1. Створіть ресурси: `infra/cloudformation/lifetime.yaml` (CloudFormation) або вручну за [infra/docs/aws-deploy.md](infra/docs/aws-deploy.md); налаштування Cognito: [infra/docs/cognito-setup.md](infra/docs/cognito-setup.md).
2. На сервері створіть базу (`infra/server/db-setup.sh`), `backend/.env` (шаблон `infra/server/backend.env.example`) і запустіть `infra/scripts/deploy-backend.sh`.
3. На своєму комп'ютері створіть `frontend/.env.production` (шаблон `infra/frontend.env.production.example`) і запустіть `infra/scripts/deploy-frontend.ps1`.

Повні кроки, обмеження та вартість: [infra/README.md](infra/README.md).

## Межі готовності

Локальна авторизація — development adapter, не production authentication. Production-вхід через Amazon Cognito (Hosted UI, Google, PKCE, верифікація JWT, створення акаунта при першому вході) реалізовано в коді — налаштування AWS описано в [infra/docs/cognito-setup.md](infra/docs/cognito-setup.md). Без `COGNITO_*` змінних production API відхиляє токени. S3 і SES підготовлені через контракти; файли зараз локальні, листи лише в БД outbox. Реальний AI не реалізовано; його UI збережено з явним повідомленням про відсутню інтеграцію.

Повторювані події ще не реалізовані. Форма підтримує дати початку й завершення; багатоденні події відображаються по днях. Task sessions впливають на пошук і відображаються в календарі як проєкція завдання, без дублювання в БД. Частина налаштувань вигляду календаря залишається станом сесії. Автоматичне очищення невикористаних файлів, production observability та email worker ще потрібні. Browser/UI end-to-end перевірка залежить від наявності браузера; результати перевірок дивіться у backend/docs/verification.md.

## Документація

- [REST endpoints та приклади](backend/docs/api.md)
- [Моделі, міграції та seed](backend/docs/database.md)
- [Локальний запуск і типові помилки](backend/docs/local-development.md)
- [Контракти Cognito, S3, SES, AI](backend/docs/integration-guide.md)
- [Фактичні перевірки та обмеження](backend/docs/verification.md)
- [Інфраструктура](infra/README.md), [деплой і оновлення](infra/docs/aws-deploy.md), [Cognito](infra/docs/cognito-setup.md)

Секрети й local uploads ігноруються Git. Real LLM integration до цієї реалізації не входить.
