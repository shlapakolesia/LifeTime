# Файли реалізації

Frontend залишився в корені. Форматування змінених TS/TSX файлів розгорнуто для читабельності; CSS і UI framework не замінювалися.

## Змінені наявні файли

- `.gitignore`
- `README.md`
- `package.json`
- `src/App.tsx`
- `src/auth/AuthProvider.tsx`
- `src/components/UI.tsx`
- `src/config.ts`
- `src/data.ts`
- `src/pages/CorePages.tsx`
- `src/pages/FeaturePages.tsx`
- `src/pages/MiscPages.tsx`
- `src/pages/PublicAndPremium.tsx`
- `src/services/apiClient.ts`
- `src/services/avatarService.ts`
- `src/services/premiumRequestService.ts`
- `src/store.tsx`
- `src/types.ts`

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
- `docs/api.md`
- `docs/database.md`
- `docs/implementation-files.md`
- `docs/integration-guide.md`
- `docs/local-development.md`
- `docs/verification.md`
- `src/remoteStore.tsx`
- `src/services/calendarView.ts`
- `src/services/dto.ts`
- `tests/frontend.test.ts`

Backend: app.ts визначає REST маршрути; middleware/auth.ts встановлює identity; validators перевіряють payload; services містять Prisma client, availability, storage та email contracts. SQL міграції містять FK, індекси й додаткові CHECK/partial unique constraints. remoteStore.tsx адаптує наявні React компоненти до API; dto.ts конвертує дані та часові пояси; calendarView.ts проєктує scheduled tasks без дублювання записів.

## Доповнення: виправлення authentication/onboarding

- `src/auth/session.ts` — серверна development-сесія й async restore.
- `backend/src/services/developmentAuth.ts` — restricted register/login/logout.
- `backend/prisma/migrations/202611090004_development_sessions/migration.sql` — additive session table.
- `backend/tests/developmentAuth.test.ts` — PostgreSQL provisioning/session regression.
- `tests/auth-flow.test.tsx`, `vitest.config.ts` — React registration/onboarding/Dashboard/refresh/error scenarios із реальною БД.
- Оновлено AuthProvider, API client, App onboarding, auth middleware, Prisma schema, npm scripts/dependencies/lock і відповідні docs.
