import { config } from "./config.ts";

// Client for services/speech: NVIDIA Parakeet (speech-to-text) and Kokoro
// (text-to-speech) served by sherpa-onnx on a Nebius AI Cloud GPU (or any box).

let healthy = false;
let lastCheck = 0;

export async function speechAvailable(): Promise<boolean> {
  if (!config.speechUrl) return false;
  if (Date.now() - lastCheck < 15_000) return healthy;
  lastCheck = Date.now();
  try {
    const res = await fetch(`${config.speechUrl}/health`, { signal: AbortSignal.timeout(3000) });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  return healthy;
}

/** PCM16 little-endian, 16 kHz mono in; text out. */
export async function transcribe(pcm16: Buffer): Promise<string> {
  const res = await fetch(`${config.speechUrl}/stt`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(pcm16),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`stt ${res.status}`);
  return ((await res.json()) as { text: string }).text.trim();
}

/** Returns WAV bytes. `phone` band-limits the voice so it sounds like a phone line. */
export async function synthesize(text: string, voice: string, opts: { phone?: boolean; speed?: number } = {}): Promise<Buffer> {
  const res = await fetch(`${config.speechUrl}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice, phone: opts.phone ?? false, speed: opts.speed ?? 1.0 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
