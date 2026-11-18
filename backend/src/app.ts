import { developmentAuthRouter } from "./services/developmentAuth.js";
import { cognitoAuthRouter } from "./services/cognitoAuth.js";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { DateTime } from "luxon";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "./config/index.js";
import { db } from "./services/database.js";
import { authenticate, admin, type AccessTokenVerifier } from "./middleware/auth.js";
import { availabilityInput, eventInput, eventWriteInput, taskInput, profileInput, id } from "./validators/index.js";
import {
  HttpError,
  findAvailability,
  getBusy,
  personalAvailability,
  requireAvailability,
} from "./services/availability.js";
import { storage, validateImage } from "./services/storage.js";
import { availabilityDate, createAiProvider, resolveAvailabilityDate, type AiProvider } from "./services/ai.js";

import { availabilityClarification, personalAvailabilityIntent } from "./services/availabilityIntent.js";

const overlapWarning =
  "У цей час у твоєму календарі вже є запланована подія. Ти можеш створити нову подію попри накладку або вибрати інший час.";

class EventOverlap extends HttpError {
  constructor() {
    super(409, overlapWarning);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});
const page = (query: Record<string, unknown>) => ({
  skip: z.coerce.number().int().min(0).default(0).parse(query.offset),
  take: z.coerce.number().int().min(1).max(100).default(100).parse(query.limit),
});
export function createApp(verifier?: AccessTokenVerifier, aiProvider?: AiProvider | null) {
  const app = express();
  const ai = aiProvider === undefined ? createAiProvider(config.ai) : aiProvider;
  app.disable("x-powered-by");
  // Behind CloudFront: take the client IP from X-Forwarded-For so rate limits are per user.
  if (config.env === "production") app.set("trust proxy", 1);
  app.use(cors({ origin: config.origin }));
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });
  app.use("/api/dev-auth", developmentAuthRouter());
  app.use("/api/auth", cognitoAuthRouter(verifier));
  app.use("/api", rateLimit({ windowMs: 60000, limit: 180 }), authenticate(verifier));
  const me = (userId: string) =>
    db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  const groupAccess = async (groupId: string, userId: string, owner = false) => {
    const group = await db.group.findUnique({
      where: { id: id.parse(groupId) },
      include: { members: true },
    });
    if (!group) throw new HttpError(404, "Групу не знайдено.");
    if (owner ? group.ownerId !== userId : !group.members.some((m) => m.userId === userId))
      throw new HttpError(403, "Немає доступу до групи.");
    return group;
  };
  app.get("/api/profile", async (req, res) => res.json(await me(req.userId)));
  app.patch("/api/profile", async (req, res) => {
    const data = profileInput.parse(req.body);
    await db.userProfile.update({ where: { userId: req.userId }, data });
    res.json(await me(req.userId));
  });
  app.get("/api/users", async (req, res) => {
    const email = z.email().parse(req.query.email).toLowerCase();
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, profile: { select: { firstName: true, lastName: true } } },
    });
    res.json(user ? [user] : []);
  });
  app.get("/api/events", async (req, res) => {
    const from = req.query.from
      ? new Date(z.iso.datetime({ offset: true }).parse(req.query.from))
      : undefined;
    const to = req.query.to
      ? new Date(z.iso.datetime({ offset: true }).parse(req.query.to))
      : undefined;
    const events = await db.calendarEvent.findMany({
      where: {
        OR: [
          { ownerId: req.userId },
          // Invited participants always see the event, whatever its privacy label.
          { participants: { some: { userId: req.userId } } },
        ],
        ...(from ? { endsAt: { gt: from } } : {}),
        ...(to ? { startsAt: { lt: to } } : {}),
      },
      include: { participants: true },
      orderBy: { startsAt: "asc" },
      ...page(req.query),
    });
    res.json(events);
  });
  async function checkEventTime(
    userId: string,
    participants: string[],
    input: z.infer<typeof eventInput>,
    client: Prisma.TransactionClient,
    eventId?: string,
  ) {
    await requireAvailability(userId, participants, client);
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (participants.length && (await getBusy(participants, start, end, client, { eventId })).length)
      throw new HttpError(409, "Хтось із запрошених зайнятий у цей час. Обери інший час.");
    return (await getBusy([userId], start, end, client, { eventId })).length > 0;
  }
  async function saveEvent(userId: string, body: unknown, eventId?: string) {
    const input = eventWriteInput.parse(body);
    if (eventId) id.parse(eventId);
    const participants = [...new Set(input.participantIds)].filter((i) => i !== userId);
    const { participantIds: _, recheckAvailability: _legacyCheck, confirmOverlap, requestId, ...data } = input;
    if (confirmOverlap && !eventId && !requestId)
      throw new HttpError(400, "Для підтвердження накладки потрібен ідентифікатор запиту.");
    // The lock statement can start before the previous writer commits. ReadCommitted gives
    // the subsequent availability and idempotency checks a fresh snapshot after the wait.
    return db.$transaction(
      async (tx) => {
        for (const participant of [userId, ...participants].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${participant}))`;
        if (eventId || requestId) {
          const existing = await tx.calendarEvent.findUnique({
            where: { id: eventId ?? requestId },
            include: { participants: true },
          });
          if (eventId && !existing) throw new HttpError(404, "Подію не знайдено.");
          if (existing && existing.ownerId !== userId)
            throw new HttpError(403, "Лише власник може змінити подію.");
          if (!eventId && existing) return existing;
        }
        if ((await checkEventTime(userId, participants, input, tx, eventId)) && !confirmOverlap)
          throw new EventOverlap();
        const relations = { create: participants.map((userId) => ({ userId })) };
        const before = eventId
          ? (await tx.eventParticipant.findMany({ where: { eventId } })).map((p) => p.userId)
          : [];
        const saved = eventId
          ? await tx.calendarEvent.update({
              where: { id: eventId },
              data: { ...data, participants: { deleteMany: {}, ...relations } },
              include: { participants: true },
            })
          : await tx.calendarEvent.create({
              data: { ...data, id: requestId, ownerId: userId, participants: relations },
              include: { participants: true },
            });
        const invited = participants.filter((uid) => !before.includes(uid));
        if (invited.length) {
          const owner = await tx.userProfile.findUnique({ where: { userId } });
          const when = new Intl.DateTimeFormat("uk-UA", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: data.timezone,
          }).format(new Date(data.startsAt));
          await tx.notification.createMany({
            data: invited.map((uid) => ({
              userId: uid,
              type: "event",
              title: "Вас запрошено на подію",
              text: `${owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Друг"} запрошує на «${data.title}» — ${when}.`,
            })),
          });
        }
        return saved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  app.post("/api/events", async (req, res) =>
    res.status(201).json(await saveEvent(req.userId, req.body)),
  );
  app.put("/api/events/:id", async (req, res) =>
    res.json(await saveEvent(req.userId, req.body, req.params.id as string)),
  );
  app.delete("/api/events/:id", async (req, res) => {
    const eventId = id.parse(req.params.id);
    await db.$transaction(async (tx) => {
      const event = await tx.calendarEvent.findFirst({
        where: { id: eventId, ownerId: req.userId },
        include: { participants: true },
      });
      if (!event) throw new HttpError(404, "Подію не знайдено.");
      await tx.calendarEvent.delete({ where: { id: eventId } });
      if (event.participants.length)
        await tx.notification.createMany({
          data: event.participants.map((p) => ({
            userId: p.userId,
            type: "event",
            title: "Подію скасовано",
            text: `Організатор скасував подію «${event.title}».`,
          })),
        });
    });
    res.status(204).end();
  });
  app.get("/api/tasks", async (req, res) => {
    const sort = z
      .enum(["deadline", "createdAt", "priority"])
      .default("deadline")
      .parse(req.query.sort);
    const completed =
      req.query.completed === undefined
        ? undefined
        : z.enum(["true", "false"]).parse(req.query.completed) === "true";
    const pagination = page(req.query);
    if (sort === "priority") {
      // Parameterized SQL keeps semantic priority order before applying pagination.
      const rows =
        await db.$queryRaw`SELECT * FROM "Task" WHERE "ownerId" = ${req.userId}::uuid AND (${completed === undefined} OR completed = ${completed ?? false}) ORDER BY CASE priority WHEN 'Високий' THEN 0 WHEN 'Середній' THEN 1 ELSE 2 END, "createdAt", id LIMIT ${pagination.take} OFFSET ${pagination.skip}`;
      res.json(rows);
      return;
    }
    res.json(
      await db.task.findMany({
        where: { ownerId: req.userId, ...(completed === undefined ? {} : { completed }) },
        orderBy: [{ [sort]: "asc" }, { id: "asc" }],
        ...pagination,
      }),
    );
  });
  async function saveTask(userId: string, body: unknown, taskId?: string) {
    const data = taskInput.parse(body);
    // Share the event writer's per-user lock and read committed state after any wait.
    return db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        if (taskId) {
          const old = await tx.task.findUnique({ where: { id: id.parse(taskId) } });
          if (!old || old.ownerId !== userId) throw new HttpError(404, "Завдання не знайдено.");
        }
        if (!data.completed && data.scheduledStart && data.scheduledEnd) {
          const busy = await getBusy(
            [userId],
            new Date(data.scheduledStart),
            new Date(data.scheduledEnd),
            tx,
            { taskId },
          );
          if (busy.length) throw new HttpError(409, "Запланований час уже зайнятий.");
        }
        return taskId
          ? tx.task.update({ where: { id: taskId }, data })
          : tx.task.create({ data: { ...data, ownerId: userId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  app.post("/api/tasks", async (req, res) =>
    res.status(201).json(await saveTask(req.userId, req.body)),
  );
  app.put("/api/tasks/:id", async (req, res) =>
    res.json(await saveTask(req.userId, req.body, req.params.id as string)),
  );
  app.delete("/api/tasks/:id", async (req, res) => {
    const result = await db.task.deleteMany({
      where: { id: id.parse(req.params.id), ownerId: req.userId },
    });
    if (!result.count) throw new HttpError(404, "Завдання не знайдено.");
    res.status(204).end();
  });
  app.get("/api/friends", async (req, res) =>
    res.json(
      await db.friendship.findMany({
        where: { ownerId: req.userId },
        include: { friend: { select: { id: true, profile: true } } },
        ...page(req.query),
      }),
    ),
  );
  app.patch("/api/friends/:id", async (req, res) => {
    const data = z.object({ shareAvailability: z.boolean() }).strict().parse(req.body);
    res.json(
      await db.friendship.update({
        where: { ownerId_friendId: { ownerId: req.userId, friendId: id.parse(req.params.id) } },
        data,
      }),
    );
  });
  app.delete("/api/friends/:id", async (req, res) => {
    const target = id.parse(req.params.id);
    await db.friendship.deleteMany({
      where: {
        OR: [
          { ownerId: req.userId, friendId: target },
          { ownerId: target, friendId: req.userId },
        ],
      },
    });
    res.status(204).end();
  });
  app.get("/api/friend-requests", async (req, res) =>
    res.json(
      await db.friendRequest.findMany({
        where: { OR: [{ recipientId: req.userId }, { senderId: req.userId }], status: "pending" },
        include: {
          sender: { select: { id: true, profile: true } },
          recipient: { select: { id: true, profile: true } },
        },
        ...page(req.query),
      }),
    ),
  );
  app.post("/api/friend-requests", async (req, res) => {
    const target = z.object({ recipientId: id }).strict().parse(req.body).recipientId;
    if (target === req.userId) throw new HttpError(400, "Не можна запросити себе.");
    const result = await db.$transaction(async (tx) => {
      for (const uid of [target, req.userId].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uid}))`;
      if (
        await tx.friendship.findUnique({
          where: { ownerId_friendId: { ownerId: req.userId, friendId: target } },
        })
      )
        throw new HttpError(409, "Ви вже друзі.");
      if (
        await tx.friendRequest.findFirst({
          where: {
            status: "pending",
            OR: [
              { senderId: req.userId, recipientId: target },
              { senderId: target, recipientId: req.userId },
            ],
          },
        })
      )
        throw new HttpError(409, "Запит уже існує.");
      const request = await tx.friendRequest.create({
        data: { senderId: req.userId, recipientId: target },
      });
      await tx.notification.create({
        data: {
          userId: target,
          type: "friend",
          title: "Новий запит у друзі",
          text: "Перегляньте запити на сторінці Друзі.",
        },
      });
      return request;
    });
    res.status(201).json(result);
  });
  app.patch("/api/friend-requests/:id", async (req, res) => {
    const { status } = z
      .object({ status: z.enum(["accepted", "rejected"]) })
      .strict()
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const request = await tx.friendRequest.findUnique({ where: { id: id.parse(req.params.id) } });
      if (!request || request.recipientId !== req.userId)
        throw new HttpError(403, "Немає доступу до запиту.");
      const changed = await tx.friendRequest.updateMany({
        where: { id: request.id, status: "pending" },
        data: { status },
      });
      if (!changed.count) throw new HttpError(409, "Запит уже розглянуто.");
      if (status === "accepted")
        await tx.friendship.createMany({
          data: [
            { ownerId: request.senderId, friendId: request.recipientId },
            { ownerId: request.recipientId, friendId: request.senderId },
          ],
          skipDuplicates: true,
        });
      return { id: request.id, status };
    });
    res.json(result);
  });
  const groupInput = z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(2000).default(""),
    })
    .strict();
  app.get("/api/groups", async (req, res) =>
    res.json(
      await db.group.findMany({
        where: { members: { some: { userId: req.userId } } },
        include: { members: { include: { user: { select: { id: true, profile: true } } } } },
        ...page(req.query),
      }),
    ),
  );
  app.post("/api/groups", async (req, res) =>
    res.status(201).json(
      await db.group.create({
        data: {
          ...groupInput.parse(req.body),
          ownerId: req.userId,
          members: { create: { userId: req.userId } },
        },
        include: { members: true },
      }),
    ),
  );
  app.patch("/api/groups/:id", async (req, res) => {
    await groupAccess(req.params.id as string, req.userId, true);
    res.json(
      await db.group.update({
        where: { id: req.params.id as string },
        data: groupInput.parse(req.body),
      }),
    );
  });
  app.delete("/api/groups/:id", async (req, res) => {
    await groupAccess(req.params.id as string, req.userId, true);
    await db.group.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  });
  app.post("/api/groups/:id/members", async (req, res) => {
    await groupAccess(req.params.id as string, req.userId, true);
    const { userId } = z.object({ userId: id }).strict().parse(req.body);
    await requireAvailability(req.userId, [userId]);
    res
      .status(201)
      .json(await db.groupMember.create({ data: { groupId: req.params.id as string, userId } }));
  });
  app.delete("/api/groups/:id/members/:userId", async (req, res) => {
    const target = id.parse(req.params.userId);
    const group = await groupAccess(req.params.id as string, req.userId);
    if (target === group.ownerId) throw new HttpError(400, "Власник має видалити групу.");
    if (target !== req.userId && group.ownerId !== req.userId)
      throw new HttpError(403, "Лише власник може видаляти учасників.");
    await db.groupMember.deleteMany({ where: { groupId: group.id, userId: target } });
    res.status(204).end();
  });
  app.post("/api/availability", async (req, res) =>
    res.json(await findAvailability(req.userId, availabilityInput.parse(req.body))),
  );
  app.get("/api/notifications", async (req, res) =>
    res.json(
      await db.notification.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    ),
  );
  app.patch("/api/notifications/:id", async (req, res) => {
    const data = z.object({ read: z.boolean() }).strict().parse(req.body);
    const result = await db.notification.updateMany({
      where: { id: id.parse(req.params.id), userId: req.userId },
      data,
    });
    if (!result.count) throw new HttpError(404, "Сповіщення не знайдено.");
    res.json({ updated: result.count });
  });
  app.delete("/api/notifications/:id", async (req, res) => {
    await db.notification.deleteMany({
      where: { id: id.parse(req.params.id), userId: req.userId },
    });
    res.status(204).end();
  });
  async function cleanupFile(key: string | null | undefined) {
    if (key)
      await storage
        .remove(key)
        .catch((error) => console.error("File cleanup failed; retry orphan cleanup", error));
  }
  app.post("/api/uploads/avatar", upload.single("file"), async (req, res) => {
    if (!req.file) throw new HttpError(400, "Додайте файл.");
    const bytes = await validateImage(req.file.buffer),
      key = await storage.put(bytes);
    try {
      const result = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.userId}))`;
        const old = await tx.userProfile.findUniqueOrThrow({
          where: { userId: req.userId },
          include: { avatar: true },
        });
        const file = await tx.uploadedFile.create({
          data: {
            ownerId: req.userId,
            key,
            mimeType: "image/webp",
            size: bytes.length,
            purpose: "avatar",
          },
        });
        await tx.userProfile.update({ where: { userId: req.userId }, data: { avatarId: file.id } });
        if (old.avatarId) await tx.uploadedFile.delete({ where: { id: old.avatarId } });
        return { file, oldKey: old.avatar?.key };
      });
      await cleanupFile(result.oldKey);
      res.status(201).json({ id: result.file.id });
    } catch (error) {
      await cleanupFile(key);
      throw error;
    }
  });
  app.delete("/api/uploads/avatar", async (req, res) => {
    const oldKey = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.userId}))`;
      const old = await tx.userProfile.findUniqueOrThrow({
        where: { userId: req.userId },
        include: { avatar: true },
      });
      await tx.userProfile.update({ where: { userId: req.userId }, data: { avatarId: null } });
      if (old.avatarId) await tx.uploadedFile.delete({ where: { id: old.avatarId } });
      return old.avatar?.key;
    });
    await cleanupFile(oldKey);
    res.status(204).end();
  });
  app.get("/api/uploads/:id", async (req, res) => {
    const file = await db.uploadedFile.findUnique({ where: { id: id.parse(req.params.id) } });
    if (!file) throw new HttpError(404, "Файл не знайдено.");
    const user = await me(req.userId);
    if (file.purpose !== "avatar" && file.ownerId !== req.userId && user.accountRole !== "admin")
      throw new HttpError(403, "Приватний файл.");
    res.type(file.mimeType).send(await storage.read(file.key));
  });
  app.get("/api/premium/requests", async (req, res) =>
    res.json(
      await db.premiumRequest.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    ),
  );
  app.post(
    "/api/premium/requests",
    rateLimit({ windowMs: 3600000, limit: 10 }),
    upload.single("file"),
    async (req, res) => {
      const names = z
        .object({
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100),
        })
        .strict()
        .parse(req.body);
      if (!req.file) throw new HttpError(400, "Додайте підтвердження.");
      const bytes = await validateImage(req.file.buffer),
        key = await storage.put(bytes);
      try {
        const request = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.userId}))`;
          const user = await tx.user.findUniqueOrThrow({ where: { id: req.userId } });
          if (
            user.premiumStatus === "premium" ||
            (await tx.premiumRequest.findFirst({
              where: { userId: req.userId, status: "pending" },
            }))
          )
            throw new HttpError(409, "Premium активний або заявка вже очікує розгляду.");
          const file = await tx.uploadedFile.create({
            data: {
              ownerId: req.userId,
              key,
              mimeType: "image/webp",
              size: bytes.length,
              purpose: "premium",
            },
          });
          const request = await tx.premiumRequest.create({
            data: { ...names, userId: req.userId, accountEmail: user.email, screenshotId: file.id },
          });
          await tx.user.update({ where: { id: req.userId }, data: { premiumStatus: "pending" } });
          // Same transaction persists the application and outbox: no SES/network call here.
          await tx.outgoingEmail.create({
            data: {
              recipient: config.adminEmail,
              subject: "LifeTime: Premium application",
              text: `${names.firstName} ${names.lastName}\n${user.email}\n${request.createdAt.toISOString()}\nAuthenticated review: /api/admin/premium-requests/${request.id}`,
            },
          });
          return request;
        });
        res.status(201).json(request);
      } catch (error) {
        await storage.remove(key);
        throw error;
      }
    },
  );
  app.get("/api/admin/premium-requests", admin, async (req, res) =>
    res.json(
      await db.premiumRequest.findMany({
        include: { user: { select: { premiumStatus: true } } },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    ),
  );
  app.get("/api/admin/premium-requests/:id", admin, async (req, res) => {
    const request = await db.premiumRequest.findUnique({ where: { id: id.parse(req.params.id) } });
    if (!request) throw new HttpError(404, "Заявку не знайдено.");
    res.json(request);
  });
  app.patch("/api/admin/premium-requests/:id", admin, async (req, res) => {
    const { status, reviewNotes } = z
      .object({
        status: z.enum(["approved", "rejected"]),
        reviewNotes: z.string().max(2000).default(""),
      })
      .strict()
      .parse(req.body);
    const request = await db.$transaction(async (tx) => {
      const old = await tx.premiumRequest.findUnique({ where: { id: id.parse(req.params.id) } });
      if (!old) throw new HttpError(404, "Заявку не знайдено.");
      const changed = await tx.premiumRequest.updateMany({
        where: { id: old.id, status: "pending" },
        data: { status, reviewNotes, reviewedBy: req.userId, reviewedAt: new Date() },
      });
      if (!changed.count) throw new HttpError(409, "Заявку вже розглянуто.");
      await tx.user.update({
        where: { id: old.userId },
        data: { premiumStatus: status === "approved" ? "premium" : "rejected" },
      });
      await tx.notification.create({
        data: {
          userId: old.userId,
          type: "event",
          title: "Результат Premium-заявки",
          text: status === "approved" ? "Premium активовано." : `Заявку відхилено. ${reviewNotes}`,
        },
      });
      return tx.premiumRequest.findUnique({ where: { id: old.id } });
    });
    res.json(request);
  });
  // Removes a processed application together with its screenshot. Pending applications must be
  // reviewed first; an active Premium must be revoked first so access is never lost by accident.
  app.delete("/api/admin/premium-requests/:id", admin, async (req, res) => {
    const requestId = id.parse(req.params.id);
    const fileKey = await db.$transaction(async (tx) => {
      const request = await tx.premiumRequest.findUnique({
        where: { id: requestId },
        include: {
          user: { select: { premiumStatus: true } },
          screenshot: { select: { key: true } },
        },
      });
      if (!request) throw new HttpError(404, "Заявку не знайдено.");
      if (request.status === "pending")
        throw new HttpError(409, "Спершу розгляньте заявку: схваліть або відхиліть її.");
      if (request.status === "approved" && request.user.premiumStatus === "premium") {
        const newer = await tx.premiumRequest.findFirst({
          where: { userId: request.userId, status: "approved", createdAt: { gt: request.createdAt } },
          select: { id: true },
        });
        if (!newer)
          throw new HttpError(409, "У користувача активний Premium. Спершу відкличте доступ.");
      }
      await tx.premiumRequest.delete({ where: { id: request.id } });
      await tx.uploadedFile.delete({ where: { id: request.screenshotId } });
      return request.screenshot.key;
    });
    // The database is already consistent; a missing file on disk must not fail the request.
    await storage.remove(fileKey).catch(() => undefined);
    res.status(204).end();
  });
  app.delete("/api/admin/users/:id/premium", admin, async (req, res) => {
    const userId = id.parse(req.params.id);
    await db.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: userId, premiumStatus: "premium" },
        data: { premiumStatus: "free" },
      });
      if (!changed.count) throw new HttpError(409, "Користувач не має активного Premium.");
      await tx.notification.create({
        data: {
          userId,
          type: "event",
          title: "Premium відкликано",
          text: "Адміністратор відкликав Premium-доступ.",
        },
      });
    });
    res.status(204).end();
  });
  app.use("/api/ai", async (req, _res, next) => {
    const user = await me(req.userId);
    if (user.premiumStatus !== "premium") throw new HttpError(403, "Потрібен Premium.");
    next();
  });
  const aiRateMessage = { message: "Забагато запитів до AI. Спробуйте трохи пізніше." };
  const aiPerMinute = rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: (req) => req.userId, message: aiRateMessage });
  const aiPerDay = rateLimit({ windowMs: 86_400_000, limit: 100, keyGenerator: (req) => req.userId, message: aiRateMessage });
  const aiProposal = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("event"), data: eventInput }),
    z.object({ kind: z.literal("task"), data: taskInput }),
  ]);
  // Answers calendar queries or interprets free text. Writes require /proposals/confirm.
  app.post("/api/ai/interpret", aiPerMinute, aiPerDay, async (req, res) => {
    const { text, history } = z
      .object({
        text: z.string().trim().min(1).max(1000),
        history: z
          .array(
            z
              .object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000) })
              .strict(),
          )
          .max(12)
          .default([]),
      })
      .strict()
      .parse(req.body);
    const user = await me(req.userId);
    const zone = user.profile?.timezone || "UTC";
    const now = DateTime.now().setZone(zone);
    async function sendAvailability(date: z.infer<typeof availabilityDate>, durationMinutes?: number) {
      if (!user.profile || !now.isValid)
        throw new HttpError(503, "Не вдалося отримати налаштування календаря.");
      const range = resolveAvailabilityDate(date, now);
      const availability = await personalAvailability(req.userId, range, user.profile, durationMinutes).catch(() => {
        throw new HttpError(503, "Не вдалося завантажити календар. Спробуй ще раз трохи пізніше.");
      });
      const lines = availability.days.map(({ date, free }) => {
        const label = DateTime.fromISO(date, { zone }).setLocale("uk").toFormat("d MMMM yyyy");
        const times = free.map(({ start, end }) => `${start}–${end}`).join(", ");
        const noTime = durationMinutes
          ? `немає вільного проміжку тривалістю щонайменше ${durationMinutes} хв.`
          : "вільного часу немає.";
        return `${label}: ${times ? `${times}.` : noTime}`;
      });
      res.json({
        type: "availability",
        availability,
        message: `Вільний час у межах активних годин (${availability.timezone}):
${lines.join("\n")}`,
      });
    }
    const clarification = availabilityClarification(text, true);
    if (clarification) {
      res.json({ type: "clarification", message: clarification });
      return;
    }
    const request = personalAvailabilityIntent(text, history);
    if (request) {
      if (request.date) await sendAvailability(request.date, request.durationMinutes);
      else res.json({ type: "clarification", message: "На яку дату перевірити вільний час?" });
      return;
    }
    if (!ai) throw new HttpError(503, "AI-помічник не налаштований на сервері.");
    const friendships = await db.friendship.findMany({
      where: { ownerId: req.userId },
      include: { friend: { select: { id: true, profile: true } } },
      take: 100,
    });
    const friends = friendships
      .map((f) => ({
        id: f.friend.id,
        name: `${f.friend.profile?.firstName ?? ""} ${f.friend.profile?.lastName ?? ""}`.trim(),
      }))
      .filter((f) => f.name);
    const nowIso = now.toISO({ suppressMilliseconds: true }) ?? new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let raw;
    try {
      raw = await ai.interpret({ text, history, nowIso, timezone: zone, friends }, controller.signal);
    } catch (error) {
      console.error("AI provider error:", error instanceof Error ? error.message : error);
      throw new HttpError(502, "AI-помічник тимчасово недоступний. Спробуйте ще раз.");
    } finally {
      clearTimeout(timer);
    }
    if (raw.type === "clarification") {
      const deniesCalendarAccess = /(?:не маю|немає|не можу отримати)\s+(?:прямого\s+)?доступ\p{L}*[^.!?]*календар/iu.test(raw.message);
      res.json({
        type: "clarification",
        message: deniesCalendarAccess
          ? "Уточни, будь ласка, чий вільний час і за який період потрібно перевірити."
          : raw.message,
      });
      return;
    }
    if (raw.type === "availability") {
      const clarification = availabilityClarification(text);
      if (clarification) {
        res.json({ type: "clarification", message: clarification });
        return;
      }
      const { type, ...dates } = raw;
      await sendAvailability(availabilityDate.parse(dates));
      return;
    }
    const parsed = aiProposal.safeParse(raw.proposal);
    if (!parsed.success) {
      res.json({
        type: "clarification",
        message: "Не вдалося точно зрозуміти запит. Уточніть день, час і тривалість.",
      });
      return;
    }
    const proposal = parsed.data;
    let overlap = false;
    if (proposal.kind === "event") {
      const allowed = new Set(friends.map((f) => f.id));
      proposal.data.participantIds = proposal.data.participantIds.filter((pid) => allowed.has(pid));
      proposal.data.timezone = zone;
      const participants = [...new Set(proposal.data.participantIds)].filter((pid) => pid !== req.userId);
      overlap = await checkEventTime(req.userId, participants, proposal.data, db);
    }
    res.json({
      type: "proposal",
      message: overlap ? overlapWarning : raw.message,
      proposal,
      overlap,
    });
  });
  app.get("/api/ai/context", async (req, res) =>
    res.json({
      events: await db.calendarEvent.findMany({ where: { ownerId: req.userId }, take: 100 }),
      tasks: await db.task.findMany({ where: { ownerId: req.userId }, take: 100 }),
    }),
  );
  app.post("/api/ai/availability", async (req, res) =>
    res.json(await findAvailability(req.userId, availabilityInput.parse(req.body))),
  );
  app.post("/api/ai/proposals/validate", async (req, res) => {
    const proposal = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("event"), data: eventInput }),
        z.object({ kind: z.literal("task"), data: taskInput }),
      ])
      .parse(req.body);
    res.json(proposal);
  });
  app.post("/api/ai/proposals/confirm", async (req, res) => {
    const proposal = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("event"), data: eventWriteInput }),
        z.object({ kind: z.literal("task"), data: taskInput }),
      ])
      .parse(req.body);
    res
      .status(201)
      .json(
        proposal.kind === "event"
          ? await saveEvent(req.userId, proposal.data)
          : await saveTask(req.userId, proposal.data),
      );
  });
  app.use((_req, res) => res.status(404).json({ message: "Endpoint not found" }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ message: "Invalid JSON" });
        return;
      }
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Некоректні дані.", issues: error.issues });
        return;
      }
      if (error instanceof EventOverlap) {
        res.status(409).json({ code: "EVENT_OVERLAP", message: error.message });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      if (error instanceof multer.MulterError) {
        res.status(400).json({ message: "Некоректне завантаження (максимум 5 МБ)." });
        return;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const status =
          error.code === "P2025"
            ? 404
            : error.code === "P2002" || error.code === "P2034"
              ? 409
              : error.code === "P2003"
                ? 400
                : 500;
        res.status(status).json({
          message:
            status === 409
              ? "Конфлікт даних. Повторіть запит."
              : status === 404
                ? "Запис не знайдено."
                : "Помилка даних.",
        });
        return;
      }
      console.error(error);
      res.status(500).json({ message: "Внутрішня помилка сервера." });
    },
  );
  return app;
}
