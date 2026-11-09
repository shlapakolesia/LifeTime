# Інтеграції команди

## Cognito — AWS teammate

`backend/src/middleware/auth.ts`: реалізувати `AccessTokenVerifier.verify(token)` і передати в `createApp(verifier)` у server.ts. Перевіряти JWKS signature з кешуванням/rotation, точний issuer, expiry, token_use=access і app client ID. Не приймати ID token як access token. Повернути лише перевірений subject. User.subject має відповідати Cognito sub; provision/link акаунт тільки після перевірки claims (email_verified), не за довільним браузерним email.

Production backend без verifier відхиляє токени. `DEV_IDENTITY_ENABLED` типово false; поза явно заданим NODE_ENV=development/test запуск з true завершується помилкою. Development email-only login призначений лише для приватного локального середовища. Новий frontend використовує випадкові серверні сесії з терміном 7 днів; їх hash зберігається у DevelopmentSession. Register/login/logout додатково перевіряють loopback socket і дозволений Origin. Старий dev:email підтримується лише локально для існуючих інструментів/seed тестів. Production відхиляє обидва формати.

Frontend: AuthAdapter у src/auth/AuthProvider.tsx; замінити LocalAuthAdapter на Cognito adapter з Authorization Code + PKCE, state/nonce та callback/logout. Підключити той самий token provider до `api` та `privateImage` у apiClient.ts. Поточний frontend API provider читає серверний opaque development-session token; Cognito env самі по собі не активують вхід. Не зберігати client secrets/паролі; Google login проходить через Cognito. UI callback зараз є повідомленням-заглушкою, не завершеним OAuth flow.

## S3 — AWS teammate

`FileStorage` у backend/src/services/storage.ts: put(Buffer)→opaque key, read(key)→Buffer, remove(key). Local adapter працює без AWS. Замінити adapter на S3; bucket приватний, дозвіл видає API. Якщо потрібні presigned URLs, спочатку зберегти авторизацію GET uploads/:id і короткий TTL. Не публікувати donation evidence. Сервер декодує, обмежує 25 млн пікселів і re-encode WebP, видаляючи metadata; не довіряє MIME/filename. Ліміт вхідного файлу 5 МБ. Retention, orphan cleanup і backup каталогу/об'єктів налаштовуються окремо.

## SES — AWS teammate

`EmailService` у backend/src/services/email.ts описує контракт. Premium submission записує OutgoingEmail у тій самій транзакції, що заявку: AWS/network не викликаються у HTTP-транзакції. SES worker має читати queued записи, відправляти, записувати статус delivered/failed, повторювати з backoff та idempotency. До інтеграції це лише outbox, реального листа немає. Backend ADMIN_EMAIL конфігурує одержувача. Повідомлення містить ім'я, зареєстрований email, timestamp і відносний authenticated API review reference; worker може додати довірений frontend admin URL. Скріншот не прикріпляється і не має public URL. Помилка SES не повинна видаляти заявку.

Інфраструктура, production DB, deploy, Docker deployment, Terraform, CloudFront тут не реалізуються.

## AI teammate

Реальна модель/interpretation не підключені. У API-режимі локальний детермінований parser не використовується для відповідей. Всі `/api/ai/*` перевіряють Premium із БД.

1. GET /api/ai/context: до 100 власних events і tasks. Для великих календарів використовуйте paginated /api/events і /api/tasks з identity поточного користувача. Не додавайте довільний ownerId.
2. POST /api/ai/availability: той самий payload і permission checks, що /api/availability. Не обчислюйте shared availability з локального неповного календаря.
3. Модель повертає лише структурований proposal:

```json
{"kind":"event","data":{"title":"Зустріч","startsAt":"2027-01-15T12:00:00Z","endsAt":"2027-01-15T13:00:00Z","timezone":"Europe/Kyiv","participantIds":[],"privacy":"shared"}}
```

Або `{ "kind":"task", "data":{ "title":"Звіт", "priority":"Середній", "completed":false } }` з дозволеними task fields.
4. POST /api/ai/proposals/validate перевіряє структуру, **не зберігає**, не гарантує подальшої доступності.
5. Frontend показує proposal для редагування/підтвердження.
6. Лише після підтвердження POST /api/ai/proposals/confirm. Сервер повторно перевіряє Premium, ownership, учасників та зайнятість. Tasks із scheduled session також перевіряються на конфлікти. 409 → новий пошук і повторне підтвердження.

Не дозволяти моделі змінювати роль, Premium, userId чи викликати confirm до згоди користувача. Ці поля відхиляє Zod. Не передавати моделі screenshots чи зайві персональні дані.
