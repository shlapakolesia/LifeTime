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

## 4. Google (вхід через Google)
Код уже готовий (кнопка «Продовжити з Google» передає `identity_provider=Google`). Якщо вона веде на помилку, у Cognito не налаштований провайдер. Робиться один раз:

**Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
1. APIs & Services → **OAuth consent screen**: тип External, назва застосунку, ваш email. Поки застосунок у режимі *Testing*, увійти можуть лише email зі списку **Test users** — додайте туди акаунти для захисту (або натисніть *Publish app*).
2. APIs & Services → **Credentials → Create credentials → OAuth client ID**, тип **Web application**.
   - *Authorized JavaScript origins*: `https://<prefix>.auth.<region>.amazoncognito.com`
   - *Authorized redirect URIs*: `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
3. Скопіюйте **Client ID** і **Client secret**.

**AWS Cognito** → ваш User Pool:
1. **Social and external providers → Add identity provider → Google**. Ім'я провайдера — рівно **Google**. Вставте Client ID і secret, scopes: `profile email openid`.
2. Attribute mapping (Google → Cognito): `email → email`, `email_verified → email_verified`, `given_name → given_name`, `family_name → family_name` (за бажанням `picture → picture`).
3. **App clients → ваш client → Login pages (Managed login) → Edit → Identity providers**: увімкніть **Google** (поряд із Cognito user pool). Без цього кроку вхід завершується помилкою `invalid_request`/`redirect_mismatch`.
4. Там же перевірте, що Callback URL = `https://<CLOUDFRONT-ДОМЕН>/auth/callback`, а OAuth scopes містять `openid email profile`.

Типові помилки:
- `redirect_uri_mismatch` від Google — у Google Cloud не збігається redirect URI із доменом Cognito (кінець має бути `/oauth2/idpresponse`).
- `Error 403: access_denied` від Google — застосунок у режимі Testing, а ваш email не в Test users.
- Cognito «invalid_request» або сторінка помилки — Google не увімкнений в App client (крок 3).
- `Підтвердіть email` від API — не змаплений `email_verified` (API все одно довіряє токенам Google, але змапте атрибут).

Один email — один акаунт: якщо людина вже зареєстрована через email+пароль, вхід через Google з тим самим email **прив'язується до існуючого акаунта** (таблиця `UserIdentity`, міграція `202611160001_user_identities`); календар, друзі й Premium зберігаються.

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
- Різні способи входу з одним підтвердженим email (email+пароль і Google) обʼєднуються в один акаунт через `UserIdentity`. Усе, що Cognito не вважає підтвердженим email, відхиляється (403).
- Токени зберігаються в `sessionStorage` (як і раніше сесія). Це простіше, але вразливе до XSS; тримайте строгий CSP на CloudFront.
- За проксі (App Runner/ALB) додайте в `app.ts` `app.set("trust proxy", 1)`, інакше rate limit рахуватиметься по IP проксі, а не користувача.
