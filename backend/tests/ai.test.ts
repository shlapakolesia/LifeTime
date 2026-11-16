import test from "node:test";
import assert from "node:assert/strict";
import {
  AiOutputError,
  buildSystemPrompt,
  createAiProvider,
  createMockProvider,
  extractJson,
  normalizeRaw,
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

test("normalizeRaw accepts only the two envelopes", () => {
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
  assert.equal(long.message.length, 500);
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
