# Налаштування Amazon Cognito

Код інтеграції вже в репозиторії: backend перевіряє JWT (`backend/src/services/cognitoVerifier.ts`), акаунт створюється при першому вході (`POST /api/auth/provision`), frontend входить через Hosted UI з Authorization Code + PKCE (`frontend/src/auth/cognitoClient.ts`). Нижче — що створити в AWS.

## 1. User Pool
- Sign-in: **email**. Self-registration: увімкнено.
- Verify: **email** (потрібно, бо backend відхиляє акаунти з `email_verified=false`).
- Атрибути: стандартні `email`, `given_name`, `family_name` (за бажанням — обов'язкові при реєстрації).
- Тип пулу не змінюється після створення — перевірте регіон (той самий, що в `COGNITO_REGION`).

## 2. App client (public)
- Тип: **Single-page application / public client — БЕЗ client secret**.
- Allowed callback URLs: `https://<CLOUDFRONT-ДОМЕН>/auth/callback` (+ `http://localhost:5173/auth/callback` для локальних перевірок).
- Allowed sign-out URLs: `https://<CLOUDFRONT-ДОМЕН>` (+ `http://localhost:5173`).
- OAuth grant: **Authorization code grant**. Implicit — вимкнути.
- Scopes: `openid`, `email`, `profile`.
- Токени: access ≤ 1 год, refresh 30 днів (за замовчуванням ок).

## 3. Domain
User Pool → App integration → **Domain** (Cognito domain або власний). Отримаєте `https://<prefix>.auth.<region>.amazoncognito.com`.

## 4. Google (опційно)
Створіть OAuth client у Google Cloud Console (redirect URI: `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`), додайте Google як identity provider у пулі, змапте `email`, `given_name`, `family_name`, увімкніть його в App client. Назва провайдера має бути **Google** (так її передає кнопка).

## 5. Змінні
**Backend** (App Runner / ECS):
```
COGNITO_REGION=eu-central-1
COGNITO_USER_POOL_ID=eu-central-1_XXXXXXXXX
COGNITO_CLIENT_ID=<app client id>
DEV_IDENTITY_ENABLED=false
```
Усі три `COGNITO_*` задаються разом, інакше сервер не стартує.

**Frontend** (на етапі збірки):
```
VITE_DATA_MODE=api
VITE_API_BASE_URL=https://<backend>
VITE_COGNITO_DOMAIN=https://<prefix>.auth.<region>.amazoncognito.com
VITE_COGNITO_CLIENT_ID=<app client id>
VITE_COGNITO_REDIRECT_URI=https://<домен>/auth/callback
VITE_COGNITO_LOGOUT_URI=https://<домен>
```
`VITE_COGNITO_DOMAIN` рекомендовано: тоді frontend не залежить від discovery-запиту. Без нього потрібен `VITE_COGNITO_AUTHORITY=https://cognito-idp.<region>.amazonaws.com/<poolId>`.
Якщо Cognito-змінні задані — frontend використовує Cognito замість локального dev-входу.

## 6. Перший адміністратор
Адмін-роль береться з БД і автоматично не видається. Після першого входу:
```sql
UPDATE "User" SET "accountRole" = 'admin' WHERE email = 'you@example.com';
```

## Поведінка та обмеження
- Перший вхід створює `User` + `UserProfile` (імʼя з `given_name`/`family_name`, інакше з email; часовий пояс браузера; активні години за замовчуванням 08:00–21:00 — змінюються в налаштуваннях).
- Акаунти **не зливаються за email**: якщо email уже є в БД з іншим `subject` (наприклад, спершу email+пароль, потім Google), API повертає 409. Обʼєднання — вручну або через Pre sign-up Lambda trigger.
- Токени зберігаються в `sessionStorage` (як і раніше сесія). Це простіше, але вразливе до XSS; тримайте строгий CSP на CloudFront.
- За проксі (App Runner/ALB) додайте в `app.ts` `app.set("trust proxy", 1)`, інакше rate limit рахуватиметься по IP проксі, а не користувача.
