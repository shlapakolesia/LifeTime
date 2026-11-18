import test from "node:test";
import assert from "node:assert/strict";
import request, { type Response } from "supertest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db } from "../src/services/database.js";
import { DateTime, Settings } from "luxon";
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

test(
  "AI reads the authenticated calendar and event overlap confirmation persists exactly once",
  { skip: process.env.RUN_DB_TESTS !== "true" },
  async (t) => {
    const previousNow = Settings.now;
    Settings.now = () => Date.parse("2026-11-17T11:00:00Z");
    t.after(() => { Settings.now = previousNow; });
    const zone = "Pacific/Kiritimati";
    const day = "2026-11-18";
    const makeUser = async (premiumStatus: string) => {
      const email = `calendar-${randomUUID()}@lifetime.local`;
      return db.user.create({
        data: {
          email,
          subject: `local:${email}`,
          premiumStatus,
          profile: { create: {
            firstName: "Тест", lastName: "Календар", timezone: zone,
            activeStart: "09:00", activeEnd: "20:00",
          } },
        },
      });
    };
    const a = await makeUser("premium");
    const b = await makeUser("free");
    const original = {
      title: "Подія через північ",
      startsAt: "2026-11-17T09:00:00Z",
      endsAt: "2026-11-17T20:00:00Z",
      timezone: zone,
    };
    const overlap = {
      ...original,
      title: "Зустріч",
      startsAt: "2026-11-17T19:30:00Z",
      endsAt: "2026-11-17T21:00:00Z",
      requestId: randomUUID(),
    };
    const editable = {
      ...original,
      title: "Редагована подія",
      startsAt: "2026-11-19T03:00:00Z",
      endsAt: "2026-11-19T04:00:00Z",
    };
    const aiApp = createApp(undefined, {
      name: "integration-contract",
      async interpret(context) {
        assert.equal(context.timezone, zone);
        assert.match(context.nowIso, /\+14:00$/);
        if (context.text === "Заплануй зустріч") {
          const { requestId: _, ...data } = overlap;
          return { type: "proposal", message: "Перевір подію.", proposal: { kind: "event", data } };
        }
        assert.match(context.text, /Коли я вільна 18 листопада/);
        return context.text.includes("2026")
          ? { type: "availability", startDate: day, endDate: "2026-11-19" }
          : { type: "availability", month: 11, day: 18 };
      },
    });
    const as = (user: typeof a) => `Bearer dev:${user.email}`;
    const create = (body: object, user = a) =>
      request(aiApp).post("/api/events").set("Authorization", as(user)).send(body);
    const list = () => request(aiApp).get("/api/events").set("Authorization", as(a)).expect(200);
    const ask = (text: string, user = a, extra = {}) =>
      request(aiApp).post("/api/ai/interpret").set("Authorization", as(user)).send({ text, ...extra });
    const confirm = (data: unknown) =>
      request(aiApp).post("/api/ai/proposals/confirm").set("Authorization", as(a)).send({ kind: "event", data });
    const query = "Коли я вільна 18 листопада?";
    await request(aiApp).post("/api/ai/interpret").send({ text: query }).expect(401);
    await ask(query, b).expect(403);
    await ask(query, a, { userId: b.id }).expect(400);

    const first = (await create(original).expect(201)).body;
    const edit = (await create(editable).expect(201)).body;
    await create({ ...overlap, requestId: randomUUID(), title: "Приватна подія іншого користувача",
      startsAt: "2026-11-17T21:00:00Z", endsAt: "2026-11-17T22:00:00Z" }, b).expect(201);
    await request(aiApp).post("/api/tasks").set("Authorization", as(a)).send({
      title: "Фокус-сесія",
      scheduledStart: "2026-11-18T00:00:00Z",
      scheduledEnd: "2026-11-18T02:00:00Z",
    }).expect(201);

    const warning = await create(overlap).expect(409);
    assert.equal(warning.body.code, "EVENT_OVERLAP");
    assert.match(warning.body.message, /попри накладку/);
    assert.equal((await list()).body.length, 2); // warning followed by cancel makes no write
    await create({ ...overlap, requestId: undefined, confirmOverlap: true }).expect(400);
    const retries = await Promise.all(
      Array.from({ length: 2 }, () => create({ ...overlap, confirmOverlap: true }).expect(201)),
    );
    for (const retry of retries) assert.equal(retry.body.id, overlap.requestId);
    assert.deepEqual(new Set((await list()).body.map((row: { id: string }) => row.id)),
      new Set([first.id, edit.id, overlap.requestId]));

    const update = (data: object, user = a) => request(aiApp)
      .put(`/api/events/${edit.id}`).set("Authorization", as(user)).send(data);
    const moved = { ...editable, startsAt: overlap.startsAt, endsAt: overlap.endsAt };
    await update(moved).expect(409, { code: "EVENT_OVERLAP", message: warning.body.message });
    assert.equal((await list()).body.find((row: { id: string }) => row.id === edit.id).startsAt,
      "2026-11-19T03:00:00.000Z");
    await update({ ...moved, confirmOverlap: true }, b).expect(403);
    await update({ ...moved, confirmOverlap: true }).expect(200);
    assert.equal((await list()).body.find((row: { id: string }) => row.id === first.id).title, original.title);

    const proposal = (await ask("Заплануй зустріч").expect(200)).body;
    assert.equal(proposal.overlap, true);
    assert.equal((await list()).body.length, 3);
    const pending = { ...proposal.proposal.data, requestId: randomUUID() };
    await confirm(pending).expect(409);
    await confirm({ ...pending, confirmOverlap: true }).expect(201);
    await confirm({ ...pending, confirmOverlap: true }).expect(201);
    assert.equal((await list()).body.length, 4);

    await create({ ...overlap, requestId: randomUUID(), participantIds: [b.id], confirmOverlap: true }).expect(403);
    await db.friendship.create({ data: { ownerId: b.id, friendId: a.id } });
    await create({ ...overlap, requestId: randomUUID(), participantIds: [b.id], confirmOverlap: true,
      startsAt: "2026-11-17T21:30:00Z", endsAt: "2026-11-17T22:30:00Z" })
      .expect(409).expect(({ body }) => assert.notEqual(body.code, "EVENT_OVERLAP"));

    const single = (await ask(query).expect(200)).body;
    assert.deepEqual(single.availability.days.map(({ date }: { date: string }) => date), [day]);
    const answer = (await ask("Коли я вільна 18 листопада 2026 і 19 листопада?").expect(200)).body;
    assert.deepEqual(answer.availability, {
      timezone: zone, activeStart: "09:00", activeEnd: "20:00",
      days: [
        { date: day, free: [{ start: "11:00", end: "14:00" }, { start: "16:00", end: "20:00" }] },
        { date: "2026-11-19", free: [{ start: "09:00", end: "20:00" }] },
      ],
    });
    assert.match(answer.message, /18 листопада 2026: 11:00–14:00, 16:00–20:00/);
    assert.doesNotMatch(JSON.stringify(answer), /Приватна подія|Фокус-сесія|Подія через північ/);
    const findMany = db.calendarEvent.findMany;
    t.after(() => { db.calendarEvent.findMany = findMany; });
    db.calendarEvent.findMany = () => { throw new Error("Calendar database unavailable"); };
    const failure = (await ask(query).expect(503)).body;
    assert.match(failure.message, /Не вдалося завантажити календар/);
    assert.equal(failure.availability, undefined);
  },
);

for (const { name, first, second, repeated = false } of [
  { name: "event then event", first: "events", second: "events" },
  { name: "event then scheduled task", first: "events", second: "tasks" },
  { name: "scheduled task then event", first: "tasks", second: "events" },
  { name: "scheduled task then scheduled task", first: "tasks", second: "tasks" },
  { name: "repeated event confirmation", first: "events", second: "events", repeated: true },
]) {
  test(`calendar writes queued on the same advisory lock: ${name}`, {
    skip: process.env.RUN_DB_TESTS !== "true",
  }, async () => {
    const email = `concurrency-${randomUUID()}@lifetime.local`;
    const user = await db.user.create({
      data: { email, subject: `local:${email}`, premiumStatus: "premium" },
    });
    const startsAt = "2026-11-18T12:00:00Z";
    const endsAt = "2026-11-18T13:00:00Z";
    const event = { title: "Подія", timezone: "Europe/Kyiv", startsAt, endsAt };
    const task = { title: "Сесія", scheduledStart: startsAt, scheduledEnd: endsAt };
    const requestId = randomUUID();
    const post = (path: string, data: object) =>
      request(app).post(path).set("Authorization", `Bearer dev:${email}`).send(data);
    if (repeated) await post("/api/events", event).expect(201);
    const write = (resource: string) => repeated
      ? post("/api/ai/proposals/confirm", {
          kind: "event",
          data: { ...event, requestId, confirmOverlap: true },
        })
      : post(`/api/${resource}`, resource === "events" ? event : task);

    const responses: Promise<Response>[] = [];
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
        for (const resource of [first, second]) {
          responses.push(write(resource).then((response) => response));
          const deadline = Date.now() + 2500;
          let waiting = 0;
          // Observe each request waiting in PostgreSQL before releasing the lock.
          while (Date.now() < deadline && waiting < responses.length) {
            const [locks] = await tx.$queryRaw<{ waiting: number }[]>`
              SELECT count(*)::int AS waiting FROM pg_locks
              WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
                AND objid::bigint = (hashtext(${user.id})::bigint & 4294967295)
            `;
            waiting = locks.waiting;
            if (waiting < responses.length) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(waiting, responses.length, "each write must wait for the owner's lock");
        }
      }, { timeout: 8000 });
    } catch (error) {
      await Promise.allSettled(responses);
      throw error;
    }

    const [winner, follower] = await Promise.all(responses);
    assert.equal(winner.status, 201);
    if (repeated) {
      assert.equal(follower.status, 201);
      assert.equal(winner.body.id, requestId);
      assert.equal(follower.body.id, requestId);
    } else {
      assert.equal(follower.status, 409);
      if (second === "events") assert.equal(follower.body.code, "EVENT_OVERLAP");
      else assert.equal(follower.body.message, "Запланований час уже зайнятий.");
    }
    const [events, tasks] = await Promise.all([
      db.calendarEvent.count({ where: { ownerId: user.id } }),
      db.task.count({ where: { ownerId: user.id } }),
    ]);
    assert.equal(events, repeated ? 2 : Number(first === "events"));
    assert.equal(tasks, Number(first === "tasks"));
  });
}

test("clear personal availability bypasses the provider and preserves the date for duration follow-ups", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async (t) => {
  const previousNow = Settings.now;
  Settings.now = () => Date.parse("2026-11-21T11:00:00Z");
  t.after(() => { Settings.now = previousNow; });
  const zone = "Pacific/Kiritimati";
  const email = `availability-${randomUUID()}@lifetime.local`;
  const user = await db.user.create({
    data: {
      email, subject: `local:${email}`, premiumStatus: "premium",
      profile: { create: {
        firstName: "Тест", lastName: "Календар", timezone: zone,
        activeStart: "09:00", activeEnd: "10:00",
      } },
    },
  });
  await db.calendarEvent.createMany({
    data: [
      ["19:10", "19:30"],
      ["19:20", "19:45"],
    ].map(([start, end]) => ({
      ownerId: user.id, title: "Приватна подія", timezone: zone,
      startsAt: new Date(`2026-11-21T${start}:00Z`),
      endsAt: new Date(`2026-11-21T${end}:00Z`),
    })),
  });
  const providerCalls: string[] = [];
  const app = createApp(undefined, {
    name: "integration-contract",
    async interpret({ text }) {
      providerCalls.push(text);
      return {
        type: "clarification",
        message: text.startsWith("Додай")
          ? "На коли запланувати подію?"
          : "Я не маю доступу до твого календаря.",
      };
    },
  });
  const ask = (text: string, history: { role: string; text: string }[] = [], server = app) =>
    request(server).post("/api/ai/interpret").set("Authorization", `Bearer dev:${email}`)
      .send({ text, history }).expect(200);
  const question = "Коли я вільна 22 листопада?";
  const answer = (await ask(question)).body;
  assert.equal(answer.type, "availability");
  assert.deepEqual(answer.availability.days, [{
    date: "2026-11-22",
    free: [{ start: "09:00", end: "09:10" }, { start: "09:45", end: "10:00" }],
  }]);
  assert.equal(answer.availability.timezone, zone);
  assert.doesNotMatch(answer.message, /Приватна подія|не маю доступу/);
  const history = [
    { role: "user", text: question },
    { role: "assistant", text: answer.message },
  ];
  for (const result of [
    await ask("Коли є вільний час, треба 15 хвилин", history),
    await ask("Знайди 15 хвилин вільного часу 22 листопада."),
  ]) assert.deepEqual(result.body.availability.days, [{
    date: "2026-11-22", free: [{ start: "09:45", end: "10:00" }],
  }]);
  const noFit = (await ask("Знайди 16 хвилин вільного часу 22 листопада.")).body;
  assert.deepEqual(noFit.availability.days[0].free, []);
  assert.match(noFit.message, /немає вільного проміжку/);
  assert.deepEqual((await ask("Які в мене вільні години сьогодні?", [], createApp(undefined, null))).body.availability.days,
    answer.availability.days);
  assert.deepEqual((await ask("Коли я вільна завтра?")).body.availability.days, [{
    date: "2026-11-23", free: [{ start: "09:00", end: "10:00" }],
  }]);
  assert.deepEqual(providerCalls, []);
  await ask("Додай подію на 22 листопада");
  const ambiguous = await ask("Чи вільна Софія 22 листопада?");
  assert.equal(ambiguous.body.type, "clarification");
  assert.doesNotMatch(ambiguous.body.message, /не маю доступу/);
  assert.deepEqual(providerCalls, ["Додай подію на 22 листопада", "Чи вільна Софія 22 листопада?"]);
  assert.equal(await db.calendarEvent.count({ where: { ownerId: user.id } }), 2);
});

test("participant and time constraints never become unrestricted personal availability", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async () => {
  const email = `availability-constraints-${randomUUID()}@lifetime.local`;
  await db.user.create({
    data: {
      email, subject: `local:${email}`, premiumStatus: "premium",
      profile: { create: { firstName: "Тест", lastName: "Календар" } },
    },
  });
  const providerCalls: string[] = [];
  const server = createApp(undefined, {
    name: "integration-contract",
    async interpret({ text }) {
      providerCalls.push(text);
      // Simulate the model dropping the participant or clock range.
      return { type: "availability", period: "tomorrow" };
    },
  });
  const direct = [
    "Коли я вільна завтра з олесею?",
    "Коли я вільна завтра з другом?",
    "Коли я вільна 22 листопада після 18:00?",
    "Коли я вільна завтра до 12:00?",
  ];
  const fallback = ["Чи вільна я завтра з олесею?", "Чи я вільна завтра о 18:00?"];
  for (const text of [...direct, ...fallback]) {
    const { body } = await request(server).post("/api/ai/interpret")
      .set("Authorization", `Bearer dev:${email}`).send({ text }).expect(200);
    assert.equal(body.type, "clarification", text);
    assert.match(body.message, text.includes(":") ? /потрібні години/ : /спільного часу/);
    assert.equal(body.availability, undefined);
    assert.equal(body.proposal, undefined);
  }
  assert.deepEqual(providerCalls, fallback);
});
