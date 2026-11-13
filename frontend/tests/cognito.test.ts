import test from "node:test";
import assert from "node:assert/strict";
import { createCognitoClient } from "../src/auth/cognitoClient.ts";

const domain = "https://lt.auth.eu-central-1.amazoncognito.com";
const config = {
  authority: "", domain, clientId: "cid",
  redirectUri: "https://app.example/auth/callback", logoutUri: "https://app.example",
};
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (nonce: string) => `${b64({ alg: "RS256" })}.${b64({ nonce })}.sig`;
function harness(opts: { search?: string; respond?: (url: string, body: URLSearchParams) => Response | Promise<Response> } = {}) {
  const storage = memory();
  const nav: string[] = [];
  const requests: { url: string; body: URLSearchParams }[] = [];
  let time = 1_000_000;
  const client = createCognitoClient(config, {
    storage, navigate: (u) => void nav.push(u), now: () => time, search: () => opts.search ?? "",
    fetch: (async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      requests.push({ url, body });
      return opts.respond!(url, body);
    }) as typeof fetch,
  });
  return { client, storage, nav, requests, tick: (ms: number) => (time += ms) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("startLogin builds a PKCE authorize URL and stores state", async () => {
  const h = harness();
  await h.client.startLogin("signin");
  const url = new URL(h.nav[0]);
  assert.equal(url.origin + url.pathname, `${domain}/oauth2/authorize`);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("client_id"), "cid");
  const saved = JSON.parse(h.storage.getItem("lifetime:cognito-pkce")!);
  assert.equal(url.searchParams.get("state"), saved.state);
  assert.match(saved.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const { createHash } = await import("node:crypto");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(saved.verifier).digest("base64url"));
  await h.client.startLogin("signup");
  assert.equal(new URL(h.nav[1]).pathname, "/signup");
  await h.client.startLogin("signin", "Google");
  assert.equal(new URL(h.nav[2]).searchParams.get("identity_provider"), "Google");
  assert.equal(new URL(h.nav[2]).pathname, "/oauth2/authorize");
});
test("callback exchanges code with verifier, checks nonce, stores tokens, runs once", async () => {
  const h = harness({ search: "?code=abc&state=S", respond: () => json({ access_token: "AT", id_token: "x", expires_in: 3600 }) });
  h.storage.setItem("lifetime:cognito-pkce", JSON.stringify({ state: "S", verifier: "V", nonce: "N" }));
  // wrong nonce in id token -> rejected
  assert.equal(await h.client.completeCallback(), false);
  assert.match(h.client.getCallbackError(), /не пройшла перевірку|Не вдалося/);
  assert.equal(h.storage.getItem("lifetime:cognito-pkce"), null, "pkce state is single-use");
  assert.equal(await h.client.getAccessToken(), null);

  const ok = harness({ search: "?code=abc&state=S", respond: () => json({ access_token: "AT", id_token: idToken("N"), refresh_token: "RT", expires_in: 3600 }) });
  ok.storage.setItem("lifetime:cognito-pkce", JSON.stringify({ state: "S", verifier: "V", nonce: "N" }));
  const [a, b] = await Promise.all([ok.client.completeCallback(), ok.client.completeCallback()]);
  assert.deepEqual([a, b], [true, true]);
  assert.equal(ok.requests.length, 1, "StrictMode double-run must not reuse the code twice");
  assert.equal(ok.requests[0].url, `${domain}/oauth2/token`);
  assert.equal(ok.requests[0].body.get("code_verifier"), "V");
  assert.equal(ok.requests[0].body.get("grant_type"), "authorization_code");
  assert.equal(ok.requests[0].body.get("redirect_uri"), config.redirectUri);
  assert.equal(await ok.client.getAccessToken(), "AT");
});
test("callback rejects state mismatch, provider errors and missing pkce", async () => {
  for (const [search, saved] of [
    ["?code=a&state=WRONG", { state: "S", verifier: "V", nonce: "N" }],
    ["?error=access_denied&state=S", { state: "S", verifier: "V", nonce: "N" }],
    ["?code=a&state=S", null],
  ] as const) {
    const h = harness({ search, respond: () => { throw new Error("must not call token endpoint"); } });
    if (saved) h.storage.setItem("lifetime:cognito-pkce", JSON.stringify(saved));
    assert.equal(await h.client.completeCallback(), false);
    assert.ok(h.client.getCallbackError());
  }
});
test("expired access token is refreshed once for concurrent callers; refresh token is kept", async () => {
  let n = 0;
  const h = harness({ respond: () => (n++, json({ access_token: "AT2", id_token: idToken("N"), expires_in: 3600 })) });
  h.storage.setItem("lifetime:cognito-tokens", JSON.stringify({ accessToken: "AT1", idToken: "I", refreshToken: "RT", expiresAt: 1_000_000 + 30_000 }));
  const [x, y] = await Promise.all([h.client.getAccessToken(), h.client.getAccessToken()]);
  assert.deepEqual([x, y], ["AT2", "AT2"]);
  assert.equal(n, 1);
  assert.equal(h.requests[0].body.get("grant_type"), "refresh_token");
  assert.equal(JSON.parse(h.storage.getItem("lifetime:cognito-tokens")!).refreshToken, "RT");
});
test("rejected refresh ends the session; a network failure does not", async () => {
  const stale = JSON.stringify({ accessToken: "A", idToken: "I", refreshToken: "RT", expiresAt: 0 });
  const rejected = harness({ respond: () => json({ error: "invalid_grant" }, 400) });
  rejected.storage.setItem("lifetime:cognito-tokens", stale);
  assert.equal(await rejected.client.getAccessToken(), null);
  assert.equal(rejected.storage.getItem("lifetime:cognito-tokens"), null);
  const offline = harness({ respond: () => { throw new TypeError("offline"); } });
  offline.storage.setItem("lifetime:cognito-tokens", stale);
  assert.equal(await offline.client.getAccessToken(), null);
  assert.ok(offline.storage.getItem("lifetime:cognito-tokens"), "tokens kept so the user is not logged out by a blip");
});
test("logout clears tokens and goes to Cognito /logout; discovery is used without a domain", async () => {
  const h = harness({ respond: () => json({}) });
  h.storage.setItem("lifetime:cognito-tokens", JSON.stringify({ accessToken: "A", idToken: "I", expiresAt: 9e12 }));
  await h.client.logout();
  assert.equal(h.storage.getItem("lifetime:cognito-tokens"), null);
  const url = new URL(h.nav[0]);
  assert.equal(url.origin + url.pathname, `${domain}/logout`);
  assert.equal(url.searchParams.get("logout_uri"), config.logoutUri);

  const nav: string[] = [];
  const discovered = createCognitoClient({ ...config, domain: "", authority: "https://cognito-idp.eu-central-1.amazonaws.com/pool" }, {
    storage: memory(), navigate: (u) => void nav.push(u), search: () => "",
    fetch: (async (url: string) => {
      assert.equal(url, "https://cognito-idp.eu-central-1.amazonaws.com/pool/.well-known/openid-configuration");
      return json({ authorization_endpoint: `${domain}/oauth2/authorize`, token_endpoint: `${domain}/oauth2/token` });
    }) as typeof fetch,
  });
  await discovered.startLogin();
  assert.equal(new URL(nav[0]).origin, domain);
});
