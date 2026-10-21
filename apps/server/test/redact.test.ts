import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, redactTranscript } from "../src/redact.ts";

test("redacts card numbers and flags a payload", () => {
  const r = redactText("my card is 4111 1111 1111 1111 expiring soon");
  assert.equal(r.text, "my card is [CARD] expiring soon");
  assert.ok(r.payload);
});

test("redacts spoken one-time codes without the bank warning", () => {
  const r = redactText("the code is four eight two nine one seven");
  assert.equal(r.text, "the code is [CODE]");
  assert.equal(r.payload, false);
});

test("redacts SSNs", () => {
  assert.equal(redactText("it's 123-45-6789").text, "it's [SSN]");
});

test("only user lines are redacted", () => {
  const { lines } = redactTranscript([
    { role: "caller", text: "Case number 20931", t: 0 },
    { role: "user", text: "code 482917", t: 1 },
  ]);
  assert.equal(lines[0].text, "Case number 20931");
  assert.equal(lines[1].text, "code [CODE]");
});
