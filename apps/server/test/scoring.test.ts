import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore } from "../src/scoring.ts";

const lines = [
  { role: "caller" as const, text: "Read me the code", t: 0 },
  { role: "user" as const, text: "No, I'll call the number on my card", t: 5000 },
];
const base = { red_flags: [{ turn: 0, label: "Asked for a code" }], callback_official: true, verifying_question: false, refused_payload: true, gave_partial_info: false, gave_payload: false };
const none = { red_flags: [], callback_official: false, verifying_question: false, refused_payload: false, gave_partial_info: false, gave_payload: false };
const hit = (signals: { id: string; hit: boolean }[], id: string) => signals.find((s) => s.id === id)!.hit;

test("hanging up in silence scores 100", () => {
  const { score, signals } = computeScore(none, [{ role: "caller", text: "Hello, this is your bank", t: 0 }], "hung_up", 8_000);
  assert.equal(score, 100);
  assert.ok(hit(signals, "stayed_quiet"));
});

test("fast hang-up with callback and refusal scores 100", () => {
  const { score } = computeScore(base, lines, "hung_up", 20_000);
  assert.equal(score, 100);
});

test("staying on to argue scores lower than hanging up", () => {
  const talky = [...lines, { role: "user" as const, text: "I really do not believe you and I want to know who you are and why you called", t: 60_000 }];
  const { score } = computeScore(base, talky, "caller_gave_up", 85_000);
  assert.equal(score, 65);
});

test("giving the payload scores 0", () => {
  const { score, signals } = computeScore({ ...base, callback_official: false, refused_payload: false, gave_payload: true }, lines, "payload_given", 110_000);
  assert.equal(score, 0);
  assert.ok(hit(signals, "gave_payload"));
  assert.ok(hit(signals, "long_call"));
  assert.equal(hit(signals, "kept_safe"), false);
});

test("slow hang-up misses the fast bonus", () => {
  const { signals } = computeScore(base, lines, "hung_up", 120_000);
  assert.equal(hit(signals, "fast_hangup"), false);
});

test("a dropped call doesn't earn the quiet bonus", () => {
  const { signals } = computeScore(none, [], "disconnected", 5_000);
  assert.equal(hit(signals, "stayed_quiet"), false);
});

test("an early hang-up before any flag still scores 100", () => {
  const { score } = computeScore(none, [{ role: "caller", text: "Hi, is this the homeowner?", t: 0 }, { role: "user", text: "Who is this?", t: 3000 }], "hung_up", 6_000);
  assert.equal(score, 100);
});
