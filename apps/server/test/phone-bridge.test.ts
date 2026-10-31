import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { config } from "../src/config.ts";
import { PhoneBridge } from "../src/phone.ts";
import * as store from "../src/store.ts";
import { streamToken } from "../src/twilio.ts";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(data: string | Buffer) {
    this.sent.push(typeof data === "string" ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await tick(10);
  }
}

test("a phone call speaks the caller's lines, stops talking on barge-in, and scores a hang-up", async () => {
  config.nebiusApiKey = "test";
  config.elevenlabs.apiKey = "test";
  const prompts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("elevenlabs")) return new Response(new Uint8Array(4000).fill(0x7f));
    const body = JSON.parse(String(init?.body ?? "{}"));
    prompts.push(body.messages?.at(-1)?.content ?? "");
    if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi, this is the fraud team at your bank calling about a transfer. " } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;

  try {
    const { deviceId } = store.createDevice("Sam");
    const device = store.getDevice(deviceId)!;
    store.saveSettings(deviceId, { ...device.settings, consentedAt: store.now(), phoneNumber: "+15551234567", phoneVerifiedAt: store.now(), ringPhone: true });
    const call = store.createCall({ deviceId, scenarioId: "bank-code", difficulty: "clumsy", status: "ringing", source: "practice", ringAt: store.now(), via: "phone" });

    const line = new FakeSocket();
    const listener = new FakeSocket();
    new PhoneBridge(line as any, { connectListener: () => listener as any });
    line.emit("message", JSON.stringify({ event: "start", start: { streamSid: "MZ1", customParameters: { callId: call.id, token: streamToken(call.id) } } }));

    // The caller's first line goes down the phone line as μ-law media followed by a mark.
    await until(() => line.sent.some((m) => m.event === "mark"));
    assert.equal(store.getCall(call.id)!.status, "active");
    const media = line.sent.filter((m) => m.event === "media");
    assert.ok(media.length >= 1 && media.every((m) => m.streamSid === "MZ1"));

    // The user's audio is forwarded to the listener.
    line.emit("message", JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from([1, 2, 3]).toString("base64") } }));
    assert.ok(listener.sent.some((b) => Buffer.isBuffer(b)));

    // The user talks over the caller: playback is cleared and their words reach the AI.
    const result = (text: string, final: boolean) =>
      listener.emit("message", JSON.stringify({ type: "Results", is_final: final, speech_final: final, channel: { alternatives: [{ transcript: text }] } }));
    result("no thank you", false);
    assert.ok(line.sent.some((m) => m.event === "clear"));
    result("no thank you I'll call my bank", true);
    await until(() => prompts.some((p) => p.includes("call my bank")));

    // Hanging up the phone is the win condition.
    line.emit("message", JSON.stringify({ event: "stop" }));
    await until(() => store.getCall(call.id)!.endReason != null);
    assert.equal(store.getCall(call.id)!.endReason, "hung_up");
    assert.equal(listener.readyState === 1 ? listener.sent.at(-1)?.type : "CloseStream", "CloseStream");
  } finally {
    globalThis.fetch = realFetch;
    config.elevenlabs.apiKey = "";
  }
});

test("a stream without the call's token is rejected", async () => {
  const { deviceId } = store.createDevice("Kim");
  const call = store.createCall({ deviceId, scenarioId: "bank-code", difficulty: "clumsy", status: "ringing", source: "practice", ringAt: store.now(), via: "phone" });
  const line = new FakeSocket();
  new PhoneBridge(line as any, { connectListener: () => new FakeSocket() as any });
  line.emit("message", JSON.stringify({ event: "start", start: { streamSid: "MZ2", customParameters: { callId: call.id, token: "wrong" } } }));
  assert.equal(line.readyState, 3);
  assert.equal(store.getCall(call.id)!.status, "ringing");
});
