// End-to-end check of a practice call without a browser.
// Usage: tsx scripts/simulate-call.ts [server|browser] [scenarioId] [difficulty]
// In server mode the "user" lines are spoken by Kokoro and sent as audio, so
// the whole Parakeet -> Nemotron -> Kokoro loop is exercised.
import { CallSession, HangUpApi, type Difficulty, type SpeechMode } from "@hangup/client";

const base = process.env.API_URL ?? "http://localhost:8787";
const speechUrl = process.env.SPEECH_URL ?? "http://localhost:8001";
const mode = (process.argv[2] ?? "browser") as SpeechMode;
const scenarioId = process.argv[3] ?? "bank-code";
const difficulty = (process.argv[4] ?? "competent") as Difficulty;
const lines = (process.env.USER_LINES ?? "Who is this?|No, I'm not reading you any code.|How do I know you're really from my bank?|No. I'm going to hang up and call the number on the back of my card.")
  .split("|");

let token: string | null = null;
const api = new HangUpApi({ baseUrl: base, getToken: () => token });

async function speechPcm(text: string): Promise<ArrayBuffer> {
  const res = await fetch(`${speechUrl}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice: "bf_emma" }),
  });
  const wav = Buffer.from(await res.arrayBuffer());
  const sr = wav.readUInt32LE(24);
  const src = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
  const n = Math.floor((src.length * 16000) / sr);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = src[Math.floor((i * sr) / 16000)];
  return out.buffer;
}

const reg = await api.register("Caleb");
token = reg.token;
await api.updateSettings({ displayName: "Caleb", consentedAt: new Date().toISOString(), timezone: "America/Los_Angeles" });
const call = await api.practice({ scenarioId, difficulty });
console.log(`📞 ${call.callerId} (${call.scenarioTitle}, ${call.difficulty})`);

const session = new CallSession(await api.sessionUrl(call.id), mode);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let next = 0;
let turnStart = 0;
let firstAudio = true;

session.on("ready", (m) => {
  turnStart = Date.now();
  console.log(`[${stamp()}] ready, speech=${m.speech}`);
});
session.on("caller_audio", (m) => {
  if (firstAudio) console.log(`[${stamp()}]   first audio for turn ${m.turn} after ${Date.now() - turnStart} ms`);
  firstAudio = false;
});
session.on("caller_say", (m) => {
  if (firstAudio) console.log(`[${stamp()}]   first sentence for turn ${m.turn} after ${Date.now() - turnStart} ms`);
  firstAudio = false;
});
session.on("caller_text", (m) => m.final && console.log(`[${stamp()}] CALLER: ${m.text}`));
session.on("user_text", (m) => console.log(`[${stamp()}] USER (heard): ${m.text}`));
session.on("caller_turn_end", async () => {
  if (next >= lines.length) {
    console.log(`[${stamp()}] *hangs up*`);
    session.hangUp();
    return;
  }
  const text = lines[next++];
  turnStart = Date.now();
  firstAudio = true;
  if (mode === "server") {
    session.send({ type: "utterance_start" });
    const pcm = await speechPcm(text);
    for (let i = 0; i < pcm.byteLength; i += 6400) session.sendAudio(pcm.slice(i, i + 6400));
    turnStart = Date.now();
    session.send({ type: "utterance_end" });
  } else {
    session.sayText(text);
  }
});
session.on("ended", async (m) => {
  console.log(`[${stamp()}] ended: ${m.reason}`);
  for (let i = 0; i < 60; i++) {
    const d = await api.call(call.id);
    if (d.status === "scored") {
      console.log(`\nSCORE ${d.score}`);
      for (const s of d.result?.signals ?? []) console.log(`  ${s.hit ? "✔" : "·"} ${s.points > 0 ? "+" : ""}${s.points} ${s.label}`);
      console.log("Red flags:", d.result?.redFlags.map((f) => `[${f.turn}] ${f.label}`).join("; "));
      console.log("\nDEBRIEF:", d.result?.debrief.spoken);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("timed out waiting for score");
  process.exit(1);
});
session.on("error", (m) => console.log("error", m.message));
