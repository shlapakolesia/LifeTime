import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { CognitoVerifier, type Jwk } from "../src/services/cognitoVerifier.js";

const region = "eu-central-1";
const userPoolId = "eu-central-1_TEST";
const clientId = "client-123";
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const NOW = 1_800_000_000_000;

const makeKey = (kid: string) => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid, use: "sig", alg: "RS256" } as Jwk;
  return { kid, privateKey, jwk };
};
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(
  key: { kid: string; privateKey: KeyObject },
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const head = b64({ alg: "RS256", kid: key.kid, ...header });
  const body = b64(claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key.privateKey).toString("base64url");
  return `${head}.${body}.${signature}`;
}
const accessClaims = (extra: Record<string, unknown> = {}) => ({
  iss: issuer, sub: "sub-1", token_use: "access", client_id: clientId,
  exp: NOW / 1000 + 3600, iat: NOW / 1000, ...extra,
});
const idClaims = (extra: Record<string, unknown> = {}) => ({
  iss: issuer, sub: "sub-1", token_use: "id", aud: clientId, email: "a@b.com",
  email_verified: true, given_name: "Ана", family_name: "Коваль",
  exp: NOW / 1000 + 3600, iat: NOW / 1000, ...extra,
});
function setup(keys = [makeKey("k1")], now = { value: NOW }) {
  const calls = { count: 0, keys: keys.map((k) => k.jwk), fail: false };
  const verifier = new CognitoVerifier({
    region, userPoolId, clientId, now: () => now.value,
    fetchJwks: async (url) => {
      assert.equal(url, `${issuer}/.well-known/jwks.json`);
      calls.count++;
      if (calls.fail) throw new Error("network");
      return { keys: calls.keys };
    },
  });
  return { verifier, calls, keys, now };
}

test("valid access and ID tokens are accepted; JWKS is cached", async () => {
  const { verifier, calls, keys } = setup();
  assert.deepEqual(await verifier.verify(jwt(keys[0], accessClaims())), { subject: "sub-1" });
  const profile = await verifier.verifyIdToken(jwt(keys[0], idClaims()));
  assert.deepEqual(profile, {
    subject: "sub-1", email: "a@b.com", emailVerified: true, givenName: "Ана", familyName: "Коваль",
  });
  assert.equal(calls.count, 1);
});
test("email_verified accepts the string form and rejects everything else", async () => {
  const { verifier, keys } = setup();
  assert.equal((await verifier.verifyIdToken(jwt(keys[0], idClaims({ email_verified: "true" })))).emailVerified, true);
  assert.equal((await verifier.verifyIdToken(jwt(keys[0], idClaims({ email_verified: false })))).emailVerified, false);
  assert.equal((await verifier.verifyIdToken(jwt(keys[0], idClaims({ email_verified: undefined })))).emailVerified, false);
});
test("Google logins are verified even when email_verified is not mapped, and expose the provider", async () => {
  const { verifier, keys } = setup();
  const google = { identities: [{ providerName: "Google" }], name: "Софія Садовенко", given_name: undefined, family_name: undefined };
  const profile = await verifier.verifyIdToken(jwt(keys[0], idClaims({ ...google, email_verified: undefined })));
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.provider, "Google");
  assert.equal(profile.givenName, "Софія");
  assert.equal(profile.familyName, "Садовенко");
});
test("wrong issuer, client, audience, token_use and expiry are rejected", async () => {
  const { verifier, keys } = setup();
  const k = keys[0];
  await assert.rejects(verifier.verify(jwt(k, accessClaims({ iss: "https://evil.example/pool" }))));
  await assert.rejects(verifier.verify(jwt(k, accessClaims({ client_id: "other" }))));
  await assert.rejects(verifier.verify(jwt(k, accessClaims({ exp: NOW / 1000 - 60 }))));
  await assert.rejects(verifier.verify(jwt(k, accessClaims({ nbf: NOW / 1000 + 600 }))));
  await assert.rejects(verifier.verify(jwt(k, accessClaims({ sub: undefined }))));
  await assert.rejects(verifier.verify(jwt(k, idClaims()))); // ID token is not an access token
  await assert.rejects(verifier.verifyIdToken(jwt(k, accessClaims()))); // and vice versa
  await assert.rejects(verifier.verifyIdToken(jwt(k, idClaims({ aud: "other" }))));
  await assert.rejects(verifier.verifyIdToken(jwt(k, idClaims({ email: undefined }))));
});
test("small clock skew is tolerated, large is not", async () => {
  const { verifier, keys } = setup();
  await verifier.verify(jwt(keys[0], accessClaims({ exp: NOW / 1000 - 10 })));
  await assert.rejects(verifier.verify(jwt(keys[0], accessClaims({ exp: NOW / 1000 - 31 }))));
});
test("forged, tampered, alg-none, HS256 and malformed tokens are rejected", async () => {
  const { verifier, keys } = setup();
  const attacker = makeKey("k1"); // same kid, different private key
  await assert.rejects(verifier.verify(jwt(attacker, accessClaims())));
  const good = jwt(keys[0], accessClaims());
  const [h, , s] = good.split(".");
  await assert.rejects(verifier.verify(`${h}.${b64(accessClaims({ sub: "admin" }))}.${s}`));
  await assert.rejects(verifier.verify(jwt(keys[0], accessClaims(), { alg: "none" })));
  await assert.rejects(verifier.verify(jwt(keys[0], accessClaims(), { alg: "HS256" })));
  for (const bad of ["", "a.b", "a.b.c.d", "..", "x".repeat(9000)]) await assert.rejects(verifier.verify(bad));
});
test("key rotation: unknown kid triggers one refresh, then is throttled", async () => {
  const { verifier, calls, keys, now } = setup();
  await verifier.verify(jwt(keys[0], accessClaims()));
  const rotated = makeKey("k2");
  calls.keys = [keys[0].jwk, rotated.jwk];
  now.value += 61_000; // past the refresh throttle
  await verifier.verify(jwt(rotated, accessClaims({ exp: now.value / 1000 + 3600 })));
  assert.equal(calls.count, 2);
  const unknown = makeKey("k3");
  await assert.rejects(verifier.verify(jwt(unknown, accessClaims({ exp: now.value / 1000 + 3600 }))));
  const before = calls.count;
  for (let i = 0; i < 5; i++)
    await assert.rejects(verifier.verify(jwt(unknown, accessClaims({ exp: now.value / 1000 + 3600 }))));
  assert.equal(calls.count, before, "unknown kids must not hammer the JWKS endpoint");
});
test("JWKS outage: fail closed with no cache, stale-if-error with cache", async () => {
  const cold = setup();
  cold.calls.fail = true;
  await assert.rejects(cold.verifier.verify(jwt(cold.keys[0], accessClaims())));
  const warm = setup();
  await warm.verifier.verify(jwt(warm.keys[0], accessClaims()));
  warm.calls.fail = true;
  warm.now.value += 7 * 3600 * 1000; // cache expired
  await warm.verifier.verify(jwt(warm.keys[0], accessClaims({ exp: warm.now.value / 1000 + 3600 })));
});
