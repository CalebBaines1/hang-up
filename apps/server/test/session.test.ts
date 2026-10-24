import { test } from "node:test";
import assert from "node:assert/strict";
import { SentenceSplitter, mentionsSafeWord, speakable } from "../src/session.ts";

test("splits streamed text into sentences, first chunk early", () => {
  const s = new SentenceSplitter();
  const out: string[] = [];
  for (const tok of "Hi there, this is Daniel from Your Bank. Okay. I need the code now! Can you".split(/(?<= )/)) out.push(...s.push(tok));
  assert.deepEqual(out, ["Hi there, this is Daniel from Your Bank.", "Okay. I need the code now!"]);
  assert.equal(s.flush(), "Can you");
});

test("first chunk breaks at a comma once long enough", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Look, I understand you're worried, but the transfer goes through soon. "), [
    "Look, I understand you're worried,",
    "but the transfer goes through soon.",
  ]);
});

test("speakable strips stage directions and markers but keeps emphasis words", () => {
  assert.equal(speakable("I'm your *grandson*, remember? *sighs* Okay (pauses) look. [END:GAVE_UP]"), "I'm your grandson, remember? Okay look.");
});

test("safe word matching is whole-word and case-insensitive", () => {
  assert.ok(mentionsSafeWord("Okay, PINEAPPLE!", "pineapple"));
  assert.ok(!mentionsSafeWord("pineapples are nice", "pineapple"));
});
