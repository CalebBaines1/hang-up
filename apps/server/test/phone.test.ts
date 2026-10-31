import { test } from "node:test";
import assert from "node:assert/strict";
import { linearToMulaw, mulawToLinear, parseWav, toMulaw8k, wavToMulaw8k } from "../src/mulaw.ts";
import { normalizePhone, signatureFor, streamTwiml, validStreamToken, streamToken } from "../src/twilio.ts";

function wav(samples: number[], rate: number, channels = 1) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2 * channels, 28);
  h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("μ-law round-trips within the codec's quantisation error", () => {
  assert.equal(linearToMulaw(0), 0xff);
  for (const s of [-32000, -8000, -1000, -100, 0, 100, 1000, 8000, 32000]) {
    const back = mulawToLinear(linearToMulaw(s));
    assert.ok(Math.abs(back - s) <= Math.max(8, Math.abs(s) * 0.07), `${s} -> ${back}`);
  }
});

test("WAV at 24 kHz becomes 8 kHz μ-law, a third as many samples", () => {
  const tone = Array.from({ length: 2400 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));
  const out = wavToMulaw8k(wav(tone, 24000));
  assert.equal(out.length, 800);
  assert.ok(out.some((b) => b !== 0xff), "not silent");
});

test("stereo WAV is mixed down to mono", () => {
  const { samples, rate } = parseWav(wav([1000, 3000, -2000, 0], 16000, 2));
  assert.equal(rate, 16000);
  assert.deepEqual([...samples], [2000, -1000]);
  assert.equal(toMulaw8k(samples, 16000).length, 1);
});

test("phone numbers normalise to E.164", () => {
  assert.equal(normalizePhone("+1 (555) 123-4567"), "+15551234567");
  assert.equal(normalizePhone("0044 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("555-1234"), null);
  assert.equal(normalizePhone("+0123456789"), null);
  assert.equal(normalizePhone("+1555abc4567"), null);
});

test("Twilio signatures sort params and sign url + key + value", () => {
  const url = "https://example.com/api/twilio/voice?callId=abc";
  const a = signatureFor(url, { To: "+15551234567", CallSid: "CA1" }, "secret");
  const b = signatureFor(url, { CallSid: "CA1", To: "+15551234567" }, "secret");
  assert.equal(a, b);
  assert.notEqual(a, signatureFor(url, { CallSid: "CA2", To: "+15551234567" }, "secret"));
  assert.notEqual(a, signatureFor(url, { CallSid: "CA1", To: "+15551234567" }, "other"));
});

test("the media stream carries the call id and a token only this call accepts", () => {
  const twiml = streamTwiml("call-1");
  assert.match(twiml, /<Connect><Stream url="[^"]*\/api\/twilio\/stream">/);
  assert.match(twiml, /name="callId" value="call-1"/);
  assert.ok(validStreamToken("call-1", streamToken("call-1")));
  assert.ok(!validStreamToken("call-2", streamToken("call-1")));
  assert.ok(!validStreamToken("call-1", undefined));
});
