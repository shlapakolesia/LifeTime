import { createHash, randomBytes } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config/index.js";
import { db } from "./database.js";
import { HttpError } from "./availability.js";
import { clock, timezone } from "../validators/index.js";

export const developmentOnly: RequestHandler = (req, res, next) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "");
  if (!config.devIdentity || !["development", "test"].includes(config.env) || !local) {
    res
      .status(403)
      .json({
        message: "Локальний вхід доступний лише в явно увімкненому локальному середовищі розробки.",
      });
    return;
  }
  if (req.headers.origin && req.headers.origin !== config.origin) {
    res.status(403).json({ message: "Цей сайт не має дозволу на локальний вхід." });
    return;
  }
  next();
};
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const emailInput = z.string().trim().toLowerCase().pipe(z.email());
const registration = z
  .object({
    email: emailInput,
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    activeStart: clock,
    activeEnd: clock,
    timezone,
  })
  .strict()
  .refine(
    (v) => v.activeEnd > v.activeStart,
    "Активний час завершення має бути пізніше за початок.",
  );
export function developmentAuthRouter() {
  const router = Router();
  router.use(developmentOnly, rateLimit({ windowMs: 60000, limit: 30 }));
  router.post("/register", async (req, res) => {
    const { email, ...profile } = registration.parse(req.body);
    const token = `dev-session:${randomBytes(32).toString("hex")}`;
    const result = await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email } }))
        throw new HttpError(409, "Акаунт із цією email-адресою вже існує. Скористайтеся входом.");
      const user = await tx.user.create({
        data: {
          email,
          subject: `local:${email}`,
          accountRole: "user",
          premiumStatus: "free",
          profile: { create: profile },
        },
        include: { profile: true },
      });
      const session = await tx.developmentSession.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      return { user, expiresAt: session.expiresAt };
    });
    res.status(201).json({ ...result, token });
  });
  router.post("/login", async (req, res) => {
    const { email } = z.object({ email: emailInput }).strict().parse(req.body);
    const user = await db.user.findUnique({ where: { email }, include: { profile: true } });
    if (!user || user.subject !== `local:${email}`)
      throw new HttpError(401, "Локальний акаунт не знайдено. Перевірте email або зареєструйтеся.");
    const token = `dev-session:${randomBytes(32).toString("hex")}`;
    const session = await db.developmentSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    res.json({ user, token, expiresAt: session.expiresAt });
  });
  router.post("/logout", async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (token) await db.developmentSession.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.status(204).end();
  });
  return router;
}
