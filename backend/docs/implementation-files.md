# Файли реалізації

Frontend залишився в корені. Форматування змінених TS/TSX файлів розгорнуто для читабельності; CSS і UI framework не замінювалися.

## Змінені наявні файли

- `.gitignore`
- `README.md`
- `package.json`
- `frontend/src/App.tsx`
- `frontend/src/auth/AuthProvider.tsx`
- `frontend/src/components/UI.tsx`
- `frontend/src/config.ts`
- `frontend/src/data.ts`
- `frontend/src/pages/CorePages.tsx`
- `frontend/src/pages/FeaturePages.tsx`
- `frontend/src/pages/MiscPages.tsx`
- `frontend/src/pages/PublicAndPremium.tsx`
- `frontend/src/services/apiClient.ts`
- `frontend/src/services/avatarService.ts`
- `frontend/src/services/premiumRequestService.ts`
- `frontend/src/store.tsx`
- `frontend/src/types.ts`

## Нові файли

- `.env.example`
- `backend/.env.example`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/prisma/migrations/202611090001_initial/migration.sql`
- `backend/prisma/migrations/202611090002_invariants/migration.sql`
- `backend/prisma/migrations/202611090003_profile_bio/migration.sql`
- `backend/prisma/migrations/migration_lock.toml`
- `backend/prisma/schema.prisma`
- `backend/prisma/seed.ts`
- `backend/src/app.ts`
- `backend/src/config/index.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/server.ts`
- `backend/src/services/availability.ts`
- `backend/src/services/database.ts`
- `backend/src/services/email.ts`
- `backend/src/services/storage.ts`
- `backend/src/validators/index.ts`
- `backend/tests/api.test.ts`
- `backend/tests/auth.test.ts`
- `backend/tests/availability.test.ts`
- `backend/tsconfig.json`
- `backend/docs/api.md`
- `backend/docs/database.md`
- `backend/docs/implementation-files.md`
- `backend/docs/integration-guide.md`
- `backend/docs/local-development.md`
- `backend/docs/verification.md`
- `frontend/src/remoteStore.tsx`
- `frontend/src/services/calendarView.ts`
- `frontend/src/services/dto.ts`
- `frontend/tests/frontend.test.ts`

Backend: app.ts визначає REST маршрути; middleware/auth.ts встановлює identity; validators перевіряють payload; services містять Prisma client, availability, storage та email contracts. SQL міграції містять FK, індекси й додаткові CHECK/partial unique constraints. remoteStore.tsx адаптує наявні React компоненти до API; dto.ts конвертує дані та часові пояси; calendarView.ts проєктує scheduled tasks без дублювання записів.

## Доповнення: виправлення authentication/onboarding

- `frontend/src/auth/session.ts` — серверна development-сесія й async restore.
- `backend/src/services/developmentAuth.ts` — restricted register/login/logout.
- `backend/prisma/migrations/202611090004_development_sessions/migration.sql` — additive session table.
- `backend/tests/developmentAuth.test.ts` — PostgreSQL provisioning/session regression.
- `frontend/tests/auth-flow.test.tsx`, `frontend/vitest.config.ts` — React registration/onboarding/Dashboard/refresh/error scenarios із реальною БД.
- Оновлено AuthProvider, API client, App onboarding, auth middleware, Prisma schema, npm scripts/dependencies/lock і відповідні docs.
