import { test } from "node:test";
import assert from "node:assert/strict";
import { randomTimeInWindow, zonedToUtc } from "../src/time.ts";

test("zonedToUtc handles DST offsets", () => {
  assert.equal(zonedToUtc("America/Los_Angeles", 2026, 10, 21, 18, 0).toISOString(), "2026-10-22T01:00:00.000Z");
  assert.equal(zonedToUtc("America/Los_Angeles", 2026, 12, 1, 18, 0).toISOString(), "2026-12-02T02:00:00.000Z");
});

test("random time lands inside the window on an allowed day", () => {
  const from = new Date("2026-10-21T12:00:00Z"); // Wednesday
  for (let i = 0; i < 50; i++) {
    const t = randomTimeInWindow({ days: [6], start: "09:00", end: "10:00" }, "UTC", from)!;
    assert.equal(t.getUTCDay(), 6);
    assert.equal(t.getUTCHours(), 9);
  }
});

test("empty window returns null", () => {
  assert.equal(randomTimeInWindow({ days: [], start: "09:00", end: "10:00" }, "UTC", new Date()), null);
});
