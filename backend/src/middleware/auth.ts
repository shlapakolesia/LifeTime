import { developmentOnly, hashToken } from "../services/developmentAuth.js";
import type { RequestHandler } from "express";
import { config } from "../config/index.js";
import { db } from "../services/database.js";
export interface VerifiedIdentity {
  subject: string;
}
/** Claims from a verified Cognito ID token; used only to provision an account on first login. */
export interface VerifiedProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
}
/** Cognito adapter must validate signature, issuer, token_use=access, expiry and client ID. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
  /** Validates an ID token (token_use=id, aud=client ID). Required for POST /api/auth/provision. */
  verifyIdToken?(token: string): Promise<VerifiedProfile>;
}
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}
export const authenticate =
  (verifier?: AccessTokenVerifier): RequestHandler =>
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) {
        res.status(401).json({ message: "Потрібна авторизація." });
        return;
      }
      if (token.startsWith("dev-session:")) {
        let allowed = false;
        developmentOnly(req, res, () => {
          allowed = true;
        });
        if (!allowed) return;
        const session = await db.developmentSession.findUnique({
          where: { tokenHash: hashToken(token) },
        });
        if (!session || session.expiresAt <= new Date()) {
          res.status(401).json({ message: "Сесія завершилася. Увійдіть повторно." });
          return;
        }
        req.userId = session.userId;
        next();
        return;
      }
      let subject: string;
      if (config.devIdentity && token.startsWith("dev:")) {
        let allowed = false;
        developmentOnly(req, res, () => {
          allowed = true;
        });
        if (!allowed) return;
        subject = `local:${token.slice(4).toLowerCase()}`;
      } else {
        if (!verifier) {
          res.status(401).json({ message: "Вхід через Cognito ще не підключено." });
          return;
        }
        try {
          subject = (await verifier.verify(token)).subject;
        } catch {
          res.status(401).json({ message: "Недійсна сесія. Увійдіть повторно." });
          return;
        }
      }
      const user = await db.user.findUnique({ where: { subject } });
      if (!user) {
        res
          .status(401)
          .json({
            message: "Акаунт не знайдено. Зареєструйтеся або зверніться до адміністратора.",
          });
        return;
      }
      req.userId = user.id;
      next();
    } catch (error) {
      next(error);
    }
  };
export const admin: RequestHandler = async (req, res, next) => {
  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (user.accountRole !== "admin") {
      res.status(403).json({ message: "Лише для адміністратора." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
