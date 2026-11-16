import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./database.js";
import { HttpError } from "./availability.js";
import { timezone } from "../validators/index.js";
import type { AccessTokenVerifier } from "../middleware/auth.js";

const provisionInput = z
  .object({ idToken: z.string().min(20).max(8192), timezone: z.string().max(64).optional() })
  .strict();
const emailInput = z.string().trim().toLowerCase().pipe(z.email());
const clean = (value: string | undefined, fallback: string) =>
  (value ?? "").trim().slice(0, 100) || fallback;

/**
 * POST /api/auth/provision — idempotent "first login" endpoint.
 * Needs a valid Cognito ACCESS token in Authorization and the matching ID token in the body.
 * Account data (email, names) comes only from the verified ID token, never from the browser.
 * A second login with the same verified email (e.g. Google after email+password) is linked to the
 * existing account through UserIdentity instead of creating a duplicate or failing.
 */
export function cognitoAuthRouter(verifier?: AccessTokenVerifier) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60000, limit: 30 }));
  router.post("/provision", async (req, res) => {
    if (!verifier?.verifyIdToken)
      throw new HttpError(401, "Вхід через Cognito ще не підключено.");
    const access = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!access) throw new HttpError(401, "Потрібна авторизація.");
    const input = provisionInput.parse(req.body);
    let subject: string;
    let claims: Awaited<ReturnType<NonNullable<AccessTokenVerifier["verifyIdToken"]>>>;
    try {
      subject = (await verifier.verify(access)).subject;
      claims = await verifier.verifyIdToken(input.idToken);
    } catch {
      throw new HttpError(401, "Недійсна сесія. Увійдіть повторно.");
    }
    if (claims.subject !== subject) throw new HttpError(401, "Недійсна сесія. Увійдіть повторно.");
    if (!claims.emailVerified) throw new HttpError(403, "Підтвердіть email, щоб продовжити.");
    const include = { profile: true } as const;
    const existing =
      (await db.user.findUnique({ where: { subject }, include })) ??
      (await db.userIdentity.findUnique({ where: { subject }, include: { user: { include } } }))?.user;
    if (existing) {
      res.json(existing);
      return;
    }
    const email = emailInput.parse(claims.email);
    // The same person signing in another way (e.g. Google after email+password). Both logins carry a
    // verified email (checked above), so the new login is linked to the existing account.
    const sameEmail = await db.user.findUnique({ where: { email }, include });
    if (sameEmail) {
      try {
        await db.userIdentity.create({
          data: { subject, userId: sameEmail.id, provider: claims.provider ?? "cognito" },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"))
          throw error;
      }
      res.json(sameEmail);
      return;
    }
    const zone = timezone.safeParse(input.timezone).success ? input.timezone : undefined;
    try {
      const user = await db.user.create({
        data: {
          subject,
          email,
          accountRole: "user",
          premiumStatus: "free",
          profile: {
            create: {
              firstName: clean(claims.givenName, clean(email.split("@")[0], "Користувач")),
              lastName: clean(claims.familyName, ""),
              ...(zone ? { timezone: zone } : {}),
            },
          },
        },
        include,
      });
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await db.user.findUnique({ where: { subject }, include });
        if (raced) {
          res.json(raced);
          return;
        }
        throw new HttpError(409, "Акаунт із цією email-адресою вже існує. Зверніться до адміністратора.");
      }
      throw error;
    }
  });
  return router;
}
