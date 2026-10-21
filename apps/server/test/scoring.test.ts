import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore } from "../src/scoring.ts";

const lines = [
  { role: "caller" as const, text: "Read me the code", t: 0 },
  { role: "user" as const, text: "No, I'll call the number on my card", t: 5000 },
];
const base = { red_flags: [{ turn: 0, label: "Asked for a code" }], callback_official: true, verifying_question: false, refused_payload: true, gave_partial_info: false, gave_payload: false };

test("fast hang-up with callback and refusal scores 85", () => {
  const { score } = computeScore(base, lines, "hung_up", 20_000);
  assert.equal(score, 85);
});

test("giving the payload floors the score", () => {
  const { score, signals } = computeScore({ ...base, callback_official: false, refused_payload: false, gave_payload: true }, lines, "payload_given", 200_000);
  assert.equal(score, 0);
  assert.ok(signals.find((s) => s.id === "gave_payload")!.hit);
  assert.ok(signals.find((s) => s.id === "long_call")!.hit);
});

test("slow hang-up gets no speed bonus", () => {
  const { signals } = computeScore(base, lines, "hung_up", 120_000);
  assert.equal(signals.find((s) => s.id === "fast_hangup")!.hit, false);
});
