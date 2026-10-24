import { test } from "node:test";
import assert from "node:assert/strict";
import { redactTranscript } from "../src/redact.ts";

test("a street number is an address, not a code", () => {
  const { lines } = redactTranscript([{ role: "user", text: "I live at 1234 Elm Street", t: 0 }]);
  assert.equal(lines[0].text, "I live at [ADDRESS]");
});
