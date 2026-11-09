import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db } from "../src/services/database.js";
import { DateTime } from "luxon";
const app = createApp();
test("API rejects unauthenticated sensitive requests", async () => {
  for (const route of [
    "/api/profile",
    "/api/events",
    "/api/tasks",
    "/api/friends",
    "/api/groups",
    "/api/notifications",
    "/api/admin/premium-requests",
    "/api/uploads/00000000-0000-4000-8000-000000000001",
  ])
    await request(app).get(route).expect(401);
});
// Runs only against an explicitly supplied dedicated DB. No deletion or reset required.
test(
  "PostgreSQL persistence, authorization, privacy and workflows",
  { skip: process.env.RUN_DB_TESTS !== "true" },
  async (t) => {
    const key = randomUUID();
    const emails = [
      `test-a-${key}@lifetime.local`,
      `test-b-${key}@lifetime.local`,
      `test-admin-${key}@lifetime.local`,
    ];
    const created = [];
    for (const [i, email] of emails.entries())
      created.push(
        await db.user.create({
          data: {
            email,
            subject: `local:${email}`,
            accountRole: i === 2 ? "admin" : "user",
            profile: { create: { firstName: "Тест", lastName: String(i) } },
          },
        }),
      );
    const [a, b] = created;
    const client = (index = 0) => ({
      get: (p: string) => request(app).get(p).set("Authorization", `Bearer dev:${emails[index]}`),
      post: (p: string) => request(app).post(p).set("Authorization", `Bearer dev:${emails[index]}`),
      put: (p: string) => request(app).put(p).set("Authorization", `Bearer dev:${emails[index]}`),
      patch: (p: string) =>
        request(app).patch(p).set("Authorization", `Bearer dev:${emails[index]}`),
      delete: (p: string) =>
        request(app).delete(p).set("Authorization", `Bearer dev:${emails[index]}`),
    });
    const ca = client(),
      cb = client(1),
      admin = client(2);
    await ca.get("/api/health").expect(200);
    await ca.post("/api/friend-requests").send({ recipientId: a.id }).expect(400);
    const fr = await ca.post("/api/friend-requests").send({ recipientId: b.id }).expect(201);
    await ca.post("/api/friend-requests").send({ recipientId: b.id }).expect(409);
    await ca.patch(`/api/friend-requests/${fr.body.id}`).send({ status: "accepted" }).expect(403);
    await cb.patch(`/api/friend-requests/${fr.body.id}`).send({ status: "accepted" }).expect(200);
    await ca
      .get("/api/friends")
      .expect(200)
      .expect((r) => assert.equal(r.body.length, 1));
    const day = "2027-01-15";
    const event = {
      title: "Приватна назва",
      description: "Секрет",
      startsAt: `${day}T10:00:00Z`,
      endsAt: `${day}T11:00:00Z`,
      timezone: "Europe/Kyiv",
      privacy: "private",
    };
    const e = await ca.post("/api/events").send(event).expect(201);
    await cb
      .get("/api/events")
      .expect(200)
      .expect((r) => assert.equal(r.body.length, 0));
    await cb.put(`/api/events/${e.body.id}`).send(event).expect(403);
    await ca
      .put(`/api/events/${e.body.id}`)
      .send({ ...event, title: "Оновлено" })
      .expect(200);
    await ca
      .get("/api/events")
      .expect(200)
      .expect((r) => assert.equal(r.body[0].title, "Оновлено"));
    const task = await ca
      .post("/api/tasks")
      .send({
        title: "Сесія",
        scheduledStart: `${day}T13:00:00Z`,
        scheduledEnd: `${day}T14:00:00Z`,
        estimatedMinutes: 60,
      })
      .expect(201);
    await ca
      .get("/api/tasks")
      .expect(200)
      .expect((r) => assert.equal(r.body[0].id, task.body.id));
    await ca
      .put(`/api/tasks/${task.body.id}`)
      .send({ title: "Сесія", completed: true })
      .expect(200);
    await ca
      .put(`/api/tasks/${task.body.id}`)
      .send({
        title: "Сесія",
        completed: false,
        scheduledStart: `${day}T13:00:00Z`,
        scheduledEnd: `${day}T14:00:00Z`,
      })
      .expect(200);
    await cb.put(`/api/tasks/${task.body.id}`).send({ title: "hack" }).expect(404);
    const search = {
      participantIds: [a.id],
      startDate: day,
      endDate: day,
      durationMinutes: 60,
      earliestHour: "08:00",
      latestHour: "21:00",
      timezone: "Europe/Kyiv",
    };
    const slots = await cb.post("/api/availability").send(search).expect(200);
    assert.ok(slots.body.length);
    assert.ok(!JSON.stringify(slots.body).includes("Секрет"));
    for (const s of slots.body) {
      assert.ok(
        Date.parse(s.endsAt) <= Date.parse(event.startsAt) ||
          Date.parse(s.startsAt) >= Date.parse(event.endsAt),
      );
      assert.ok(
        Date.parse(s.endsAt) <= Date.parse(`${day}T13:00:00Z`) ||
          Date.parse(s.startsAt) >= Date.parse(`${day}T14:00:00Z`),
      );
    }
    await ca.patch(`/api/friends/${b.id}`).send({ shareAvailability: false }).expect(200);
    await cb.post("/api/availability").send(search).expect(403);
    await ca.patch(`/api/friends/${b.id}`).send({ shareAvailability: true }).expect(200);
    const booked = slots.body[0];
    const meeting = {
      ...event,
      title: "Спільна",
      privacy: "shared",
      startsAt: booked.startsAt,
      endsAt: booked.endsAt,
      participantIds: [a.id],
      recheckAvailability: true,
    };
    await cb.post("/api/events").send(meeting).expect(201);
    await cb.post("/api/events").send(meeting).expect(409);
    const g = await ca.post("/api/groups").send({ name: "Команда" }).expect(201);
    await cb.patch(`/api/groups/${g.body.id}`).send({ name: "hack" }).expect(403);
    await ca.post(`/api/groups/${g.body.id}/members`).send({ userId: b.id }).expect(201);
    await cb.delete(`/api/groups/${g.body.id}`).expect(403);
    await cb.delete(`/api/groups/${g.body.id}/members/${b.id}`).expect(204);
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    await ca
      .post("/api/uploads/avatar")
      .attach("file", Buffer.from("fake"), { filename: "fake.png", contentType: "image/png" })
      .expect(400);
    const avatar = await ca
      .post("/api/uploads/avatar")
      .attach("file", image, "avatar.png")
      .expect(201);
    await cb.get(`/api/uploads/${avatar.body.id}`).expect(200);
    const replacement = await ca
      .post("/api/uploads/avatar")
      .attach("file", image, "new.png")
      .expect(201);
    await cb.get(`/api/uploads/${avatar.body.id}`).expect(404);
    await ca.delete("/api/uploads/avatar").expect(204);
    await cb.get(`/api/uploads/${replacement.body.id}`).expect(404);
    const premium = await ca
      .post("/api/premium/requests")
      .field("firstName", "Тест")
      .field("lastName", "Студент")
      .attach("file", image, "evidence.png")
      .expect(201);
    await ca
      .post("/api/premium/requests")
      .field("firstName", "Тест")
      .field("lastName", "Студент")
      .attach("file", image, "evidence.png")
      .expect(409);
    await cb.get(`/api/uploads/${premium.body.screenshotId}`).expect(403);
    await ca.get("/api/admin/premium-requests").expect(403);
    await ca
      .patch(`/api/admin/premium-requests/${premium.body.id}`)
      .send({ status: "approved" })
      .expect(403);
    await admin.get(`/api/uploads/${premium.body.screenshotId}`).expect(200);
    await ca.get("/api/ai/context").expect(403);
    await admin
      .patch(`/api/admin/premium-requests/${premium.body.id}`)
      .send({ status: "approved" })
      .expect(200);
    await ca
      .get("/api/profile")
      .expect(200)
      .expect((r) => assert.equal(r.body.premiumStatus, "premium"));
    await ca.get("/api/ai/context").expect(200);
    assert.ok(await db.outgoingEmail.findFirst({ where: { text: { contains: emails[0] } } }));
    await ca
      .patch("/api/profile")
      .send({
        firstName: "Тест",
        lastName: "Студент",
        timezone: "Pacific/Kiritimati",
        activeStart: "08:00",
        activeEnd: "21:00",
        sharing: "busy",
        bio: "Збережена біографія",
      })
      .expect(200);
    await ca
      .get("/api/profile")
      .expect(200)
      .expect((r) => assert.equal(r.body.profile.bio, "Збережена біографія"));
    const remoteZone = await ca
      .post("/api/availability")
      .send({
        ...search,
        participantIds: [],
        startDate: "2027-01-18",
        endDate: "2027-01-18",
        timezone: "Pacific/Kiritimati",
      })
      .expect(200);
    assert.ok(remoteZone.body.length);
    for (const slot of remoteZone.body) {
      const local = DateTime.fromISO(slot.startsAt).setZone("Pacific/Kiritimati");
      assert.equal(local.toISODate(), "2027-01-18");
      assert.ok(local.hour >= 8 && local.hour < 21);
    }
    for (const durationMinutes of [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 720, 780]) {
      const found = await ca
        .post("/api/availability")
        .send({
          ...search,
          participantIds: [],
          startDate: "2027-01-18",
          endDate: "2027-01-18",
          earliestHour: "08:00",
          latestHour: "21:00",
          timezone: "Pacific/Kiritimati",
          durationMinutes,
        })
        .expect(200);
      assert.ok(found.body.length, `Missing duration ${durationMinutes}`);
      assert.equal(
        Date.parse(found.body[0].endsAt) - Date.parse(found.body[0].startsAt),
        durationMinutes * 60000,
      );
    }
    await ca
      .post("/api/availability")
      .send({
        ...search,
        participantIds: [],
        startDate: "2027-01-18",
        endDate: "2027-01-18",
        durationMinutes: 1440,
      })
      .expect(200)
      .expect((r) => assert.deepEqual(r.body, []));
    await ca.get("/api/tasks?sort=priority").expect(200);
    await ca.delete(`/api/admin/users/${a.id}/premium`).expect(403);
    await admin.delete(`/api/admin/users/${a.id}/premium`).expect(204);
    await ca.get("/api/ai/context").expect(403);
    // Fresh DB client verifies persisted records independently of HTTP/application state.
    const fresh = new (db.constructor as typeof import("@prisma/client").PrismaClient)();
    try {
      assert.equal(
        (await fresh.task.findUniqueOrThrow({ where: { id: task.body.id } })).title,
        "Сесія",
      );
    } finally {
      await fresh.$disconnect();
    }
    const dst = await ca
      .post("/api/availability")
      .send({
        ...search,
        participantIds: [],
        startDate: "2027-03-28",
        endDate: "2027-03-28",
        timezone: "Europe/Kyiv",
      })
      .expect(200);
    assert.ok(dst.body.every((s: { startsAt: string }) => DateTime.fromISO(s.startsAt).isValid));
    await ca.delete(`/api/events/${e.body.id}`).expect(204);
    await ca.delete(`/api/tasks/${task.body.id}`).expect(204);
    await ca.delete(`/api/groups/${g.body.id}`).expect(204);
    await ca.delete(`/api/friends/${b.id}`).expect(204);
  },
);
test.after(async () => {
  await db.$disconnect();
});
