import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import type { AccessTokenVerifier, VerifiedIdentity, VerifiedProfile } from "../middleware/auth.js";

/**
 * Dependency-free Cognito JWT verifier (RS256 only).
 * Checks signature (JWKS, cached), exact issuer, expiry, token_use and app client ID.
 * Access tokens and ID tokens are NOT interchangeable.
 */
export interface CognitoVerifierOptions {
  region: string;
  userPoolId: string;
  clientId: string;
  /** Injectable for tests. Defaults to a fetch with a 5 s timeout. */
  fetchJwks?: (url: string) => Promise<{ keys: Jwk[] }>;
  /** Injectable clock (ms). */
  now?: () => number;
  clockToleranceSeconds?: number;
}
export interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}
type Claims = Record<string, unknown>;

const KEY_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000; // do not hammer JWKS because of unknown `kid`s
const MAX_TOKEN_LENGTH = 8192;

async function defaultFetchJwks(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`JWKS request failed: ${response.status}`);
  return (await response.json()) as { keys: Jwk[] };
}

export class CognitoVerifier implements AccessTokenVerifier {
  readonly issuer: string;
  private readonly jwksUrl: string;
  private readonly keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly tolerance: number;
  private readonly fetchJwks: (url: string) => Promise<{ keys: Jwk[] }>;

  constructor(private readonly options: CognitoVerifierOptions) {
    this.issuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;
    this.jwksUrl = `${this.issuer}/.well-known/jwks.json`;
    this.now = options.now ?? Date.now;
    this.tolerance = options.clockToleranceSeconds ?? 30;
    this.fetchJwks = options.fetchJwks ?? defaultFetchJwks;
  }

  private refresh(): Promise<void> {
    this.inflight ??= (async () => {
      this.lastAttempt = this.now();
      try {
        const { keys } = await this.fetchJwks(this.jwksUrl);
        const next = new Map<string, KeyObject>();
        for (const jwk of keys ?? []) {
          if (jwk.kty !== "RSA" || !jwk.kid || (jwk.use && jwk.use !== "sig")) continue;
          next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]));
        }
        if (!next.size) throw new Error("JWKS contains no usable RSA keys");
        this.keys.clear();
        for (const [kid, key] of next) this.keys.set(kid, key);
        this.fetchedAt = this.now();
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    const stale = this.now() - this.fetchedAt >= KEY_TTL_MS;
    const known = this.keys.get(kid);
    if (known && !stale) return known;
    const mayRefresh = stale || this.now() - this.lastAttempt >= MIN_REFRESH_MS;
    if (mayRefresh) {
      try {
        await this.refresh();
      } catch (error) {
        // Stale-if-error: a JWKS outage must not log everyone out, but unknown keys still fail.
        if (!known) throw error;
        return known;
      }
    }
    const key = this.keys.get(kid);
    if (!key) throw new Error("Unknown signing key");
    return key;
  }

  private async decode(token: string, tokenUse: "access" | "id"): Promise<Claims> {
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw new Error("Bad token");
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Malformed token");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Claims;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Claims;
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Bad header");
    const key = await this.keyFor(header.kid);
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url"),
    );
    if (!valid) throw new Error("Bad signature");
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.iss !== this.issuer) throw new Error("Bad issuer");
    if (typeof claims.exp !== "number" || claims.exp + this.tolerance <= nowSeconds)
      throw new Error("Token expired");
    if (typeof claims.nbf === "number" && claims.nbf - this.tolerance > nowSeconds)
      throw new Error("Token not yet valid");
    if (claims.token_use !== tokenUse) throw new Error("Wrong token_use");
    if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Missing subject");
    if (tokenUse === "access" ? claims.client_id !== this.options.clientId : claims.aud !== this.options.clientId)
      throw new Error("Wrong app client");
    return claims;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const claims = await this.decode(token, "access");
    return { subject: claims.sub as string };
  }

  async verifyIdToken(token: string): Promise<VerifiedProfile> {
    const claims = await this.decode(token, "id");
    if (typeof claims.email !== "string" || !claims.email) throw new Error("ID token has no email");
    const str = (value: unknown) => (typeof value === "string" ? value : undefined);
    return {
      subject: claims.sub as string,
      email: claims.email,
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      givenName: str(claims.given_name),
      familyName: str(claims.family_name),
    };
  }
}

export const createCognitoVerifier = (options: CognitoVerifierOptions) => new CognitoVerifier(options);
