import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  AiOutputError,
  buildConversation,
  buildSystemPrompt,
  createAiProvider,
  createMockProvider,
  extractJson,
  normalizeRaw,
  resolveAvailabilityDate,
  type AiContext,
} from "../src/services/ai.js";

const context = (text: string): AiContext => ({
  text,
  nowIso: "2026-11-15T14:00:00+02:00",
  timezone: "Europe/Kyiv",
  friends: [{ id: "11111111-1111-4111-8111-111111111111", name: "Софія Коваль" }],
});

test("extractJson tolerates fences and surrounding prose, rejects garbage", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Ось відповідь: {"a":{"b":2}} дякую'), { a: { b: 2 } });
  assert.throws(() => extractJson("no json here"), AiOutputError);
  assert.throws(() => extractJson("{broken"), AiOutputError);
});

test("normalizeRaw accepts the proposal and clarification envelopes", () => {
  assert.deepEqual(normalizeRaw({ type: "clarification", message: " На який день? " }), {
    type: "clarification",
    message: "На який день?",
  });
  const proposal = normalizeRaw({ type: "proposal", message: "ok", proposal: { kind: "task", data: {} } });
  assert.equal(proposal.type, "proposal");
  assert.equal(normalizeRaw({ type: "proposal", proposal: {} }).type, "proposal"); // default message
  for (const bad of [null, "x", [], { type: "proposal" }, { type: "proposal", proposal: "x" }, { type: "clarification" }, { type: "other", message: "x" }])
    assert.throws(() => normalizeRaw(bad), AiOutputError);
  const long = normalizeRaw({ type: "clarification", message: "я".repeat(900) });
  assert.equal(long.type === "clarification" && long.message.length, 500);
});

test("system prompt carries time, zone and friend ids but no emails", () => {
  const prompt = buildSystemPrompt(context("hi"));
  assert.match(prompt, /2026-11-15T14:00:00\+02:00/);
  assert.match(prompt, /Europe\/Kyiv/);
  assert.match(prompt, /11111111-1111-4111-8111-111111111111/);
  assert.match(prompt, /Софія Коваль/);
  assert.doesNotMatch(prompt, /@/);
  assert.match(buildSystemPrompt({ ...context("hi"), friends: [] }), /no friends/);
});

test("mock provider: event with a friend, task, clarification", async () => {
  const mock = createMockProvider();
  const event = await mock.interpret(context("Зустріч із Софією"));
  assert.equal(event.type, "proposal");
  const data = (event as { proposal: { kind: string; data: Record<string, unknown> } }).proposal;
  assert.equal(data.kind, "event");
  assert.equal(data.data.startsAt, "2026-11-16T10:00:00+02:00");
  assert.deepEqual(data.data.participantIds, ["11111111-1111-4111-8111-111111111111"]);
  const task = await mock.interpret(context("Підготувати презентацію"));
  assert.equal((task as { proposal: { kind: string } }).proposal.kind, "task");
  assert.equal((await mock.interpret(context("привіт"))).type, "clarification");
});

test("createAiProvider returns null for none and a provider otherwise", () => {
  assert.equal(createAiProvider({ provider: "none", bedrockModelId: "", region: "eu-north-1" }), null);
  assert.equal(createAiProvider({ provider: "mock", bedrockModelId: "", region: "eu-north-1" })?.name, "mock");
  assert.equal(createAiProvider({ provider: "bedrock", bedrockModelId: "m", region: "eu-north-1" })?.name, "bedrock");
});

test("conversation keeps earlier turns so a clarification answer has context", () => {
  const turns = buildConversation({
    text: "10:00",
    history: [
      { role: "user", text: "Хочу зустрітися з подругами в суботу" },
      { role: "assistant", text: "О котрій годині?" },
    ],
  });
  assert.deepEqual(
    turns.map((t) => t.role),
    ["user", "assistant", "user"],
  );
  assert.equal(turns[2].text, "10:00");
});

test("conversation always starts and ends with a user turn and merges equal roles", () => {
  const turns = buildConversation({
    text: "завтра",
    history: [
      { role: "assistant", text: "Привіт" },
      { role: "user", text: "a" },
      { role: "user", text: "b" },
      { role: "assistant", text: "?" },
      { role: "assistant", text: "??" },
    ],
  });
  assert.deepEqual(
    turns.map((t) => t.role),
    ["user", "assistant", "user"],
  );
  assert.equal(turns[0].text, "a\nb");
  assert.equal(buildConversation({ text: "x" }).length, 1);
});

test("availability action only accepts a bounded inclusive date range and no identity", () => {
  const action = { type: "availability", startDate: "2026-11-18", endDate: "2026-11-18" };
  assert.deepEqual(normalizeRaw(action), action);
  assert.throws(() => normalizeRaw({ ...action, userId: context("").friends[0].id }), AiOutputError);
  assert.throws(() => normalizeRaw({ ...action, endDate: "2027-11-18" }), AiOutputError);
  assert.throws(() => normalizeRaw({ ...action, endDate: "2026-11-17" }), AiOutputError);
  assert.throws(() => normalizeRaw({ ...action, startDate: "2026-02-29" }), AiOutputError);
  const prompt = buildSystemPrompt(context("Коли я вільна 18 листопада?"));
  for (const rule of ["сьогодні", "завтра", "наступного понеділка", "цього тижня", "next occurrence including today"])
    assert.ok(prompt.includes(rule));
});

test("availability action resolves calendar periods and omitted years from the local date", () => {
  const now = DateTime.fromISO("2026-11-17T11:00:00Z").setZone("Pacific/Kiritimati");
  const range = (startDate: string, endDate = startDate) => ({ startDate, endDate });
  assert.deepEqual(resolveAvailabilityDate({ period: "today" }, now), range("2026-11-18"));
  assert.deepEqual(resolveAvailabilityDate({ period: "tomorrow" }, now), range("2026-11-19"));
  assert.deepEqual(resolveAvailabilityDate({ period: "nextMonday" }, now), range("2026-11-23"));
  assert.deepEqual(resolveAvailabilityDate({ period: "nextMonday" }, now.plus({ days: 5 })), range("2026-11-30"));
  assert.deepEqual(resolveAvailabilityDate({ period: "thisWeek" }, now), range("2026-11-16", "2026-11-22"));
  assert.deepEqual(resolveAvailabilityDate({ month: 11, day: 18 }, now), range("2026-11-18"));
  assert.deepEqual(resolveAvailabilityDate({ month: 11, day: 18 }, now.plus({ days: 1 })), range("2027-11-18"));
  assert.deepEqual(resolveAvailabilityDate({ month: 2, day: 29 }, now), range("2028-02-29"));
  assert.deepEqual(resolveAvailabilityDate(range("2025-11-18"), now), range("2025-11-18"));
  assert.throws(() => normalizeRaw({ type: "availability", month: 2, day: 30 }), AiOutputError);
});

test("deterministic routing recognizes only clear personal availability requests", async () => {
  const { personalAvailabilityIntent } = await import("../src/services/availabilityIntent.js");
  for (const text of [
    "Коли я вільна 22 листопада?",
    "Покажи мій вільний час на 22 листопада.",
    "Коли я вільна завтра?",
    "Які в мене вільні години сьогодні?",
    "Знайди 15 хвилин вільного часу 22 листопада.",
    "Коли я можу зайнятися лабораторною 22 листопада?",
  ]) assert.ok(personalAvailabilityIntent(text, [])?.date, text);
  for (const text of [
    "Заплануй зустріч 22 листопада, коли я вільна",
    "Коли я вільна завтра? Заплануй зустріч",
    "Коли є вільний час з Олесею завтра?",
    "Коли я вільна 22 листопада або 23?",
    "Коли я вільна 31 листопада?",
    "Коли я вільна післязавтра?",
  ]) assert.equal(personalAvailabilityIntent(text, []), null, text);
  assert.equal(personalAvailabilityIntent("Коли є вільний час, треба 15 хвилин", [
    { role: "user", text: "Коли я вільна 22 листопада?" },
    { role: "user", text: "Створи завдання" },
  ])?.date, undefined);
});

test("personal availability rejects participant references and clock constraints", async () => {
  const { availabilityClarification, personalAvailabilityIntent } =
    await import("../src/services/availabilityIntent.js");
  for (const text of [
    "Коли я вільна завтра з олесею?",
    "Коли я вільна завтра з другом?",
    "Коли я вільна завтра зі своєю подругою?",
    "Коли я вільна 22 листопада після 18:00?",
    "Коли я вільна завтра до 12:00?",
    "Коли я вільна завтра після шостої?",
    "Які в мене вільні години сьогодні ввечері?",
  ]) {
    assert.equal(personalAvailabilityIntent(text, []), null, text);
    assert.ok(availabilityClarification(text, true), text);
  }
  assert.equal(availabilityClarification("Заплануй зустріч завтра з Олесею о 18:00", true), undefined);
  assert.deepEqual(personalAvailabilityIntent("Коли є вільний час, треба 15 хвилин", [
    { role: "user", text: "Коли я вільна завтра до 12:00?" },
  ]), { date: undefined, durationMinutes: 15 });
});
