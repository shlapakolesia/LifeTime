import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { createApp } from "../src/app.js";

test("missing Cognito verifier and invalid access tokens fail closed", async () => {
  await request(createApp())
    .get("/api/profile")
    .set("Authorization", "Bearer unverified-jwt")
    .expect(401);
  await request(
    createApp({
      async verify() {
        throw new Error("bad signature");
      },
    }),
  )
    .get("/api/profile")
    .set("Authorization", "Bearer invalid")
    .expect(401);
});
test("development identity cannot be enabled in production or an unspecified environment", () => {
  for (const mode of ["production", undefined]) {
    const env: NodeJS.ProcessEnv = { ...process.env, DEV_IDENTITY_ENABLED: "true" };
    if (mode) env.NODE_ENV = mode;
    else env.NODE_ENV = "";
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", "import('./src/config/index.ts')"],
      { env, encoding: "utf8" },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Development identity is forbidden/);
  }
});
