# База даних

PostgreSQL + Prisma. Схема: backend/prisma/schema.prisma, SQL-міграції зберігаються в backend/prisma/migrations.

- User: UUID, унікальні email/subject, серверні роль і Premium.
- DevelopmentSession: UUID, user FK, унікальний hash випадкового opaque token, expiresAt; тільки для локального development adapter.
- UserProfile: один профіль на акаунт, біографія, IANA timezone, активні години, sharing, посилання на аватар.
- CalendarEvent + EventParticipant: UTC timestamptz інтервали, власник і унікальні учасники.
- Task: власник, дедлайн, priority/completed, оцінка часу й nullable scheduled interval. Не дублюється в CalendarEvent.
- FriendRequest: вхідні/вихідні pending/accepted/rejected. Partial unique index за неупорядкованою парою для pending.
- Friendship: два спрямовані записи на дружбу. Кожен визначає дозвіл власника іншому користувачу.
- Group + GroupMember: власник і унікальні членства. Видалення групи видаляє членства.
- Notification: повідомлення лише для конкретного користувача.
- PremiumRequest: заявник, email на момент подання, приватний screenshot, pending/approved/rejected, reviewer і timestamp. Partial unique index не дозволяє дві pending заявки.
- UploadedFile: безпечний opaque key, власник, purpose, MIME та розмір. Шляхи не приймаються від браузера.
- OutgoingEmail: durable outbox локальних повідомлень; queued не означає delivered.

Для моделей є createdAt/updatedAt, FK та індекси за власниками/часом. Cascade застосовується до залежних записів; screenshot має Restrict, аватар SetNull. SQL CHECK захищає інтервали та допустимі статуси. Фізичні файли зберігаються окремо від PostgreSQL; резервування БД без файлового каталогу недостатнє.

Міграції: `npm run db:migrate`. Нова зміна схеми: у development `cd backend && npx prisma migrate dev --name descriptive_name`. Не використовуйте reset для існуючої бази. Після змін генеруйте клієнт.

Seed виконує upsert з порожнім update та createMany skipDuplicates. Повторне виконання не очищає й не перезаписує користувачів. Події створюються на наступний день від першого seed; пізніше seed не пересуває їх. Виберіть відповідну дату або створіть актуальні події самостійно.

Блокування за user UUID узгоджує зміни подій та task sessions, які створює API. Serializable конфлікти повертають 409 для повторного запиту. Це не гарантія від змін напряму SQL поза API. Видалення користувачів та автоматичний cleanup невикористаних файлів не мають публічних маршрутів; retention/cleanup — майбутня операційна задача.
