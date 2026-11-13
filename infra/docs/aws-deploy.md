# Деплой на AWS (як налаштовано зараз)

Інфраструктура як код і скрипти: [infra/README.md](../README.md).

Схема: **S3 + CloudFront** (сайт і єдиний HTTPS-домен), **EC2 t3.micro** (backend + PostgreSQL), **Cognito** (вхід).
`/api/*` у CloudFront іде на EC2 (HTTP, порт 3001), решта — на S3. Файли користувачів лежать на диску EC2 (`UPLOAD_DIR`).

Секрети (`.env`, `.pem`, паролі БД) у git не зберігаються. Адреси та ID ресурсів беріть у власника AWS-акаунта.

## Оновити backend (на сервері, по SSH)
```bash
cd ~ && unzip -qo LifeTime-main-cognito.zip      # або: cd LifeTime-main && git pull
cd ~/LifeTime-main/backend
npm ci && npx prisma migrate deploy && npm run build
sudo systemctl restart lifetime
curl -s localhost:3001/api/health
```
`.env` на сервері не перезаписується. Логи: `sudo journalctl -u lifetime -n 50 --no-pager`.

## Оновити frontend (на своєму комп'ютері)
```bash
cd frontend && npm ci && npm run build        # потрібен frontend/.env.production
```
Далі: S3 → бакет сайту → Upload → вміст `dist/` (index.html та папка assets) → CloudFront → Invalidations → `/*`.

`frontend/.env.production` (не в git):
```
VITE_DATA_MODE=api
VITE_API_BASE_URL=https://<cloudfront-домен>
VITE_COGNITO_DOMAIN=https://<prefix>.auth.<region>.amazoncognito.com
VITE_COGNITO_CLIENT_ID=<client id>
VITE_COGNITO_REDIRECT_URI=https://<cloudfront-домен>/auth/callback
VITE_COGNITO_LOGOUT_URI=https://<cloudfront-домен>
```

## Доступ до сервера
Кожен учасник створює власний ключ (`ssh-keygen -t ed25519`) і надсилає **публічну** частину (`.pub`) власнику. Її додають у `~/.ssh/authorized_keys` на сервері, а IP учасника — у Security Group (порт 22). Приватні ключі (`.pem`) не передавайте.

## Адмін
Адмін-роль видається в БД: `UPDATE "User" SET "accountRole"='admin' WHERE email='...';`

## Витрати
Free Plan AWS діє 6 місяців або до вичерпання кредитів. Cognito безкоштовний до 10 000 активних користувачів на місяць.
