# infra — AWS-інфраструктура LifeTime

```
Браузер ──HTTPS──> CloudFront ──(за замовч.)──> S3 (приватний бакет, збірка frontend)
                       │  └─ CloudFront Function: URL без розширення -> /index.html (SPA)
                       └──(/api/*)──HTTP:3001──> EC2 t3.micro: Node API (systemd) + PostgreSQL + файли користувачів
Вхід: Amazon Cognito (Hosted UI, Authorization Code + PKCE). API перевіряє JWT за JWKS Cognito.
```

Один домен для сайту й API (`https://<id>.cloudfront.net`), тому CORS і змішаний HTTP/HTTPS не потрібні.
Порт 3001 відкритий лише для списку адрес CloudFront, SSH (22) лише для вашої IP.

## Вміст
| Шлях | Призначення |
|---|---|
| `cloudformation/lifetime.yaml` | Весь стек: S3, CloudFront (+функція, +`/api/*`), Cognito, EC2, Elastic IP, Security Group |
| `server/lifetime.service` | systemd-служба API |
| `server/backend.env.example` | Шаблон `backend/.env` на сервері |
| `server/db-setup.sh` | Створення ролі й бази PostgreSQL |
| `scripts/deploy-backend.sh` | Оновлення API на сервері (залежності, міграції, збірка, перезапуск) |
| `scripts/deploy-frontend.ps1` | Збірка сайту, завантаження в S3, скидання кешу CloudFront |
| `frontend.env.production.example` | Шаблон `frontend/.env.production` |

Секрети (`.env`, `.pem`, паролі) у репозиторії не зберігаються.

## Розгортання з нуля (CloudFormation)
1. EC2 → Key pairs → створіть ключ (або візьміть наявний). Дізнайтеся ID списку адрес CloudFront у своєму регіоні:
   `aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing`
2. CloudFormation → Create stack → завантажте `cloudformation/lifetime.yaml`. Параметри: `KeyName`, `AdminCidr` (ваша IP з `/32`), `CloudFrontPrefixListId`, `CognitoDomainPrefix`.
3. Дочекайтеся `CREATE_COMPLETE` (CloudFront ~5–10 хв). Значення з вкладки **Outputs** потрібні далі.
4. На сервері (`ssh -i key ubuntu@<ServerIp>`): завантажте код у `~/LifeTime-main`, виконайте `infra/server/db-setup.sh '<пароль>'`, створіть `backend/.env` за `server/backend.env.example`, потім `infra/scripts/deploy-backend.sh`. Служба: `sudo cp infra/server/lifetime.service /etc/systemd/system/ && sudo systemctl enable --now lifetime`.
5. На комп'ютері: створіть `frontend/.env.production` за шаблоном і запустіть `infra/scripts/deploy-frontend.ps1 -Bucket <SiteBucketName> -DistributionId <DistributionId>`.
6. Зареєструйтесь на сайті, потім зробіть себе адміном: `sudo -u postgres psql lifetime -c "UPDATE \"User\" SET \"accountRole\"='admin' WHERE email='...';"`

Поточний продакшн було створено вручну в консолі AWS (кроки в [docs/aws-deploy.md](docs/aws-deploy.md)). Шаблон його не імпортує: розгортання створить окремий, паралельний стек.

## Обмеження й застереження
- Шаблон перевірено лише на синтаксис YAML. У CloudFormation його не розгортали, тож перший запуск краще робити в тестовому акаунті.
- Домен origin для API збирається з Elastic IP за форматом `ec2-A-B-C-D.<регіон>.compute.amazonaws.com`; у `us-east-1` формат інший (`compute-1`).
- За замовчуванням береться Ubuntu 24.04 (PostgreSQL 16, Node.js 22 з NodeSource). Живий сервер працює на Ubuntu 26.04 (PostgreSQL 18).
- Google-вхід не входить у шаблон: його додають у Cognito вручну (див. [docs/cognito-setup.md](docs/cognito-setup.md)).
- Файли користувачів (аватарки) лежать на диску EC2 (`UPLOAD_DIR`), окремого бекапу немає.
- Free Plan AWS діє 6 місяців або до вичерпання кредитів. Cognito безкоштовний до 10 000 активних користувачів на місяць.
