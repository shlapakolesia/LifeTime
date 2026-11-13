import { developmentAuthRouter } from "./services/developmentAuth.js";
import { cognitoAuthRouter } from "./services/cognitoAuth.js";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "./config/index.js";
import { db } from "./services/database.js";
import { authenticate, admin, type AccessTokenVerifier } from "./middleware/auth.js";
import { availabilityInput, eventInput, taskInput, profileInput, id } from "./validators/index.js";
import {
  HttpError,
  findAvailability,
  getBusy,
  requireAvailability,
} from "./services/availability.js";
import { storage, validateImage } from "./services/storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});
const page = (query: Record<string, unknown>) => ({
  skip: z.coerce.number().int().min(0).default(0).parse(query.offset),
  take: z.coerce.number().int().min(1).max(100).default(100).parse(query.limit),
});
export function createApp(verifier?: AccessTokenVerifier) {
  const app = express();
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
  async function saveEvent(userId: string, body: unknown, eventId?: string) {
    const input = eventInput.parse(body);
    if (eventId) {
      const old = await db.calendarEvent.findUnique({ where: { id: id.parse(eventId) } });
      if (!old) throw new HttpError(404, "Подію не знайдено.");
      if (old.ownerId !== userId) throw new HttpError(403, "Лише власник може змінити подію.");
    }
    const participants = [...new Set(input.participantIds)].filter((i) => i !== userId);
    await requireAvailability(userId, participants);
    const { participantIds: _, recheckAvailability, ...data } = input;
    // Serializable transaction and ordered per-user locks prevent concurrent confirmed slots from racing.
    return db.$transaction(
      async (tx) => {
        for (const participant of [userId, ...participants].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${participant}))`;
        if (recheckAvailability) {
          const busy = await getBusy(
            [userId, ...participants],
            new Date(data.startsAt),
            new Date(data.endsAt),
            tx as typeof db,
            { eventId },
          );
          if (busy.length) throw new HttpError(409, "Час уже зайнятий. Повторіть пошук.");
        }
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
              data: { ...data, ownerId: userId, participants: relations },
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
            tx as typeof db,
            { taskId },
          );
          if (busy.length) throw new HttpError(409, "Запланований час уже зайнятий.");
        }
        return taskId
          ? tx.task.update({ where: { id: taskId }, data })
          : tx.task.create({ data: { ...data, ownerId: userId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
        z.object({ kind: z.literal("event"), data: eventInput }),
        z.object({ kind: z.literal("task"), data: taskInput }),
      ])
      .parse(req.body);
    res
      .status(201)
      .json(
        proposal.kind === "event"
          ? await saveEvent(req.userId, { ...proposal.data, recheckAvailability: true })
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
