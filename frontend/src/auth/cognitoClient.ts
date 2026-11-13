/**
 * Amazon Cognito Authorization Code + PKCE client (no dependencies).
 * Pure factory: everything environment-specific is injectable, so it is unit-testable in Node.
 */
export interface CognitoConfig {
  /** https://cognito-idp.<region>.amazonaws.com/<poolId> — used for endpoint discovery. */
  authority: string;
  /** https://<prefix>.auth.<region>.amazoncognito.com — recommended; skips discovery. */
  domain?: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
}
export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
}
export interface CognitoEnv {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetch: typeof fetch;
  navigate: (url: string) => void;
  now: () => number;
  search: () => string;
}
interface Endpoints {
  authorize: string;
  token: string;
  logout: string;
}
class TokenRejected extends Error {}

const tokensKey = "lifetime:cognito-tokens";
const pkceKey = "lifetime:cognito-pkce";
const scope = "openid email profile";
const refreshSkewMs = 60_000;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (value: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const claimsOf = (jwt: string): Record<string, unknown> => {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
};

export function createCognitoClient(config: CognitoConfig, overrides: Partial<CognitoEnv> = {}) {
  const env: CognitoEnv = {
    storage: overrides.storage ?? sessionStorage,
    fetch: overrides.fetch ?? ((...args) => fetch(...args)),
    navigate: overrides.navigate ?? ((url) => location.assign(url)),
    now: overrides.now ?? Date.now,
    search: overrides.search ?? (() => location.search),
  };
  const domain = (config.domain || "").replace(/\/+$/, "");
  const authority = config.authority.replace(/\/+$/, "");

  let endpoints: Promise<Endpoints> | null = null;
  const resolveEndpoints = () => {
    endpoints ??= (async (): Promise<Endpoints> => {
      if (domain)
        return { authorize: `${domain}/oauth2/authorize`, token: `${domain}/oauth2/token`, logout: `${domain}/logout` };
      const response = await env.fetch(`${authority}/.well-known/openid-configuration`);
      if (!response.ok) throw new Error("Не вдалося отримати налаштування входу.");
      const doc = await response.json();
      return {
        authorize: doc.authorization_endpoint,
        token: doc.token_endpoint,
        logout: doc.end_session_endpoint || `${new URL(doc.authorization_endpoint).origin}/logout`,
      };
    })().catch((error) => {
      endpoints = null;
      throw error;
    });
    return endpoints;
  };

  const readJson = <T>(key: string): T | null => {
    try {
      return JSON.parse(env.storage.getItem(key) || "null") as T | null;
    } catch {
      return null;
    }
  };
  const clear = () => env.storage.removeItem(tokensKey);
  const save = (tokens: CognitoTokens) => env.storage.setItem(tokensKey, JSON.stringify(tokens));

  async function requestTokens(params: Record<string, string>): Promise<CognitoTokens> {
    const { token } = await resolveEndpoints();
    const response = await env.fetch(token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, ...params }),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw new TokenRejected("rejected");
      throw new Error("Сервер входу тимчасово недоступний.");
    }
    const body = await response.json();
    if (!body.access_token || !body.id_token) throw new TokenRejected("incomplete");
    return {
      accessToken: body.access_token,
      idToken: body.id_token,
      refreshToken: body.refresh_token,
      expiresAt: env.now() + Number(body.expires_in || 3600) * 1000,
    };
  }

  let refreshing: Promise<CognitoTokens | null> | null = null;
  async function getTokens(): Promise<CognitoTokens | null> {
    const current = readJson<CognitoTokens>(tokensKey);
    if (!current?.accessToken) return null;
    if (current.expiresAt - env.now() > refreshSkewMs) return current;
    if (!current.refreshToken) {
      clear();
      return null;
    }
    refreshing ??= requestTokens({ grant_type: "refresh_token", refresh_token: current.refreshToken })
      .then((next) => {
        const merged = { ...next, refreshToken: next.refreshToken ?? current.refreshToken };
        save(merged);
        return merged;
      })
      .catch((error) => {
        // Only an explicit rejection ends the session; a network blip keeps the tokens.
        if (error instanceof TokenRejected) clear();
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  let callbackRun: Promise<boolean> | null = null;
  let callbackError = "";
  async function runCallback(): Promise<boolean> {
    const params = new URLSearchParams(env.search());
    const saved = readJson<{ state: string; verifier: string; nonce: string }>(pkceKey);
    env.storage.removeItem(pkceKey); // one-time: an authorization code can be used once
    const fail = (message: string) => {
      callbackError = message;
      return false;
    };
    if (params.get("error")) return fail("Вхід скасовано або Cognito повернув помилку. Спробуйте ще раз.");
    const code = params.get("code");
    if (!code || !saved || params.get("state") !== saved.state)
      return fail("Сесія входу недійсна або застаріла. Спробуйте увійти ще раз.");
    try {
      const tokens = await requestTokens({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: saved.verifier,
      });
      if (claimsOf(tokens.idToken).nonce !== saved.nonce)
        return fail("Відповідь входу не пройшла перевірку. Спробуйте ще раз.");
      save(tokens);
      return true;
    } catch {
      return fail("Не вдалося завершити вхід. Спробуйте ще раз.");
    }
  }

  return {
    /** Redirects to Cognito. `provider` (e.g. "Google") skips the Cognito form. */
    async startLogin(kind: "signin" | "signup" = "signin", provider?: string) {
      const { authorize } = await resolveEndpoints();
      const state = random(32);
      const nonce = random(32);
      const verifier = random(48);
      env.storage.setItem(pkceKey, JSON.stringify({ state, nonce, verifier }));
      const url = new URL(authorize);
      if (kind === "signup" && !provider) url.pathname = "/signup";
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        scope,
        redirect_uri: config.redirectUri,
        state,
        nonce,
        code_challenge: await sha256(verifier),
        code_challenge_method: "S256",
        ...(provider ? { identity_provider: provider } : {}),
      }).toString();
      env.navigate(url.toString());
    },
    /** Idempotent: safe under React StrictMode double effects. Returns false on failure. */
    completeCallback: () => (callbackRun ??= runCallback()),
    getCallbackError: () => callbackError,
    getTokens,
    getAccessToken: async () => (await getTokens())?.accessToken ?? null,
    clear,
    async logout() {
      clear();
      try {
        const { logout } = await resolveEndpoints();
        env.navigate(
          `${logout}?${new URLSearchParams({ client_id: config.clientId, logout_uri: config.logoutUri })}`,
        );
      } catch {
        /* Local sign-out already happened. */
      }
    },
  };
}
