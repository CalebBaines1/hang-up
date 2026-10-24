import { test } from "node:test";
import assert from "node:assert/strict";
import { redactTranscript } from "../src/redact.ts";

test("a street number is an address, not a code", () => {
  const { lines } = redactTranscript([{ role: "user", text: "I live at 1234 Elm Street", t: 0 }]);
  assert.equal(lines[0].text, "I live at [ADDRESS]");
});

test("spaced-out digits are caught as a code", () => {
  const { lines } = redactTranscript([{ role: "user", text: "Sure, the code is 4 8 2 9 1 7", t: 0 }]);
  assert.equal(lines[0].text, "Sure, the code is [CODE]");
});

test("a card number read in groups is still a card", () => {
  const { lines, payload } = redactTranscript([{ role: "user", text: "It's 4111 1111 1111 1111", t: 0 }]);
  assert.equal(lines[0].text, "It's [CARD]");
  assert.ok(payload);
});
