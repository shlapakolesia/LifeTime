import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { config } from "../src/config/index.js";
import { db } from "../src/services/database.js";
const app = createApp();
test("development provisioning is disabled unless explicitly enabled", async () => {
  const enabled = config.devIdentity;
  try {
    config.devIdentity = false;
    await request(app).post("/api/dev-auth/register").send({}).expect(403);
    await request(app).post("/api/dev-auth/login").send({}).expect(403);
  } finally {
    config.devIdentity = enabled;
  }
});
test(
  "new development user, onboarding persistence, stable identity, login and session lifecycle",
  { skip: process.env.RUN_DB_TESTS !== "true" },
  async () => {
    const email = `registration-${randomUUID()}@lifetime.local`;
    const input = {
      email,
      firstName: "Марія",
      lastName: "Тестова",
      activeStart: "10:15",
      activeEnd: "19:45",
      timezone: "Europe/Kyiv",
    };
    await request(app)
      .post("/api/dev-auth/register")
      .set("Origin", "https://untrusted.example")
      .send(input)
      .expect(403);
    await request(app)
      .post("/api/dev-auth/register")
      .send({ ...input, accountRole: "admin" })
      .expect(400);
    await request(app)
      .post("/api/dev-auth/register")
      .send({ ...input, activeEnd: "07:00" })
      .expect(400);
    const registered = await request(app).post("/api/dev-auth/register").send(input).expect(201);
    const { token, user } = registered.body;
    assert.equal(user.accountRole, "user");
    assert.equal(user.premiumStatus, "free");
    assert.equal(user.profile.userId, user.id);
    assert.equal(user.profile.activeStart, input.activeStart);
    await request(app).post("/api/dev-auth/register").send(input).expect(409);
    // Fresh app instance represents server/session restoration without browser email impersonation.
    const refreshed = await request(createApp())
      .get("/api/profile")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.equal(refreshed.body.id, user.id);
    assert.equal(refreshed.body.profile.activeEnd, input.activeEnd);
    const login = await request(app)
      .post("/api/dev-auth/login")
      .send({ email: email.toUpperCase() })
      .expect(200);
    assert.equal(login.body.user.id, user.id);
    await request(app)
      .post("/api/dev-auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`).expect(401);
    await request(app)
      .get("/api/profile")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(200);
    await db.developmentSession.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(0) },
    });
    await request(app)
      .get("/api/profile")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(401);
    await request(app)
      .post("/api/dev-auth/login")
      .send({ email: `missing-${email}` })
      .expect(401);
    assert.equal(
      (await db.userProfile.findUniqueOrThrow({ where: { userId: user.id } })).activeStart,
      input.activeStart,
    );
  },
);
test.after(() => db.$disconnect());
