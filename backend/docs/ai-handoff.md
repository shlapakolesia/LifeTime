# Передача: підключення AI-помічника

Для того, хто підключає AI. Сайт уже працює на AWS; тут усе, що потрібно, щоб додати AI, перевірити його локально й опублікувати.

## Що вже є, а що треба зробити

**Є (backend):** захищені ендпоїнти `/api/ai/*`. Усі вони доступні лише користувачам зі статусом `premiumStatus = "premium"` (інакше 403 «Потрібен Premium.»):
- `GET /api/ai/context` — до 100 власних подій і завдань;
- `POST /api/ai/availability` — спільна зайнятість (ті самі правила доступу, що в `/api/availability`);
- `POST /api/ai/proposals/validate` — перевірка структури пропозиції, нічого не зберігає;
- `POST /api/ai/proposals/confirm` — збереження після згоди користувача (сервер повторно перевіряє Premium, власника, учасників і конфлікти).

Формат пропозиції та правила безпеки: [integration-guide.md](integration-guide.md), розділ «AI teammate».

**Додано:** `POST /api/ai/interpret` із провайдерами `mock` і `bedrock` (`backend/src/services/ai.ts`) і підключення сторінки асистента (`frontend/src/services/aiService.ts`, `MiscPages.tsx`). Деталі в [integration-guide.md](integration-guide.md).

**Де змінювати код:**
- `backend/src/app.ts`: новий маршрут (наприклад, `POST /api/ai/interpret`) додавайте **після** блоку `app.use("/api/ai", ...)`, що перевіряє Premium. Код роботи з моделлю краще винести в новий `backend/src/services/ai.ts`.
- `frontend/src/pages/MiscPages.tsx` і `frontend/src/services/smartSchedulingService.ts`: сторінка асистента й інтерфейс `SmartSchedulingService`. Зараз `interpret()` синхронний і локальний, для моделі він має стати асинхронним викликом backend. У API-режимі сторінка показує повідомлення «AI інтеграцію ще не підключено».

## Правила

1. **Ключ AI-провайдера лише на backend**, у `backend/.env` (локально й на сервері). Ніколи у `frontend/`, у змінних `VITE_*` (вони потрапляють у публічний код сайту) і не в git.
2. Нову змінну додайте також у `backend/src/config/index.ts` і в `backend/.env.example` (без значення).
3. Модель повертає лише структурований proposal. Роль, Premium, `userId` і виклик `confirm` без згоди користувача заборонені (їх відхиляє Zod). Не передавайте моделі зайвих персональних даних і скриншоти.
4. Обмежте частоту викликів AI на користувача й задайте таймаут запиту до провайдера: кожен виклик коштує грошей.

## Локальний запуск

1. Клонуйте репозиторій і запустіть за [README](../../README.md) (PostgreSQL, `npm install`, `db:migrate`, `db:seed`, `dev:backend`, `dev`).
2. Локально вхід за email із seed. Щоб API пускало вас до `/api/ai/*`, зробіть тестовому користувачу Premium (PowerShell, база з Docker):
   ```powershell
   @'
   UPDATE "User" SET "premiumStatus" = 'premium' WHERE email = 'olesia@lifetime.local';
   '@ | docker exec -i lifetime-local-postgres psql -U lifetime -d lifetime
   ```
   Очікується `UPDATE 1`.
3. Працюйте в окремій гілці (`feature/ai`) і відкривайте Pull Request у `main`. `.env` та ключі `.gitignore` вже виключає, але перед комітом перевіряйте `git status`.

## Публікація на AWS

Інфраструктуру описано в [infra/README.md](../../infra/README.md), кроки оновлення в [infra/docs/aws-deploy.md](../../infra/docs/aws-deploy.md).

1. **Backend:** додайте ключ у `~/LifeTime-main/backend/.env` на сервері, завантажте код і запустіть `infra/scripts/deploy-backend.sh`.
2. **Frontend:** `frontend/.env.production` (шаблон у `infra/frontend.env.production.example`), збірка, завантаження `dist` у S3 і скидання кешу CloudFront (`infra/scripts/deploy-frontend.ps1`).

**Таймаут CloudFront.** Відповіді моделей можуть тривати довше за 30 секунд (стандартний ліміт origin). У CloudFront відкрийте Origins → `lifetime-api` → Edit й збільште **Response timeout** до 60 секунд (максимум без запиту на підвищення квоти) або робіть відповіді коротшими.

## Доступи (чеклист для власника проєкту)

- [ ] GitHub: Settings → Collaborators → додати.
- [ ] AWS: запросити її власним email (Manage team), не давати свій логін.
- [ ] SSH: вона створює ключ (`ssh-keygen -t ed25519`) і надсилає вам лише `.pub`; ви додаєте його в `~/.ssh/authorized_keys` на сервері, її IP у Security Group (порт 22). Файл `.pem` не передавати.
- [ ] Значення для `frontend/.env.production`: домен CloudFront, ID користувацького пулу Cognito й клієнта (видно в консолі AWS).
- [ ] Ключ AI-провайдера: хто платить, той створює; передавати лише через менеджер паролів, не в чаті й не в git.
