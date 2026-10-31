import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

// Twilio over plain REST: Verify for the phone number, Programmable Voice to ring it.

export function twilioEnabled() {
  const t = config.twilio;
  return Boolean(t.accountSid && t.authToken && t.fromNumber && config.publicUrl);
}

export function verifyEnabled() {
  return Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.verifyServiceSid);
}

/** Real phone calls need Twilio, a listener (Deepgram) and a voice (ElevenLabs or the speech service). */
export function phoneCallsEnabled() {
  return twilioEnabled() && verifyEnabled() && Boolean(config.deepgramApiKey) && Boolean(config.elevenlabs.apiKey || config.speechUrl);
}

/** E.164: a plus sign and 8 to 15 digits. Spaces, dashes, dots and brackets are dropped. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  const withPlus = s.startsWith("00") ? `+${s.slice(2)}` : s;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

async function twilioPost(url: string, params: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
  const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw Object.assign(new Error(`twilio ${res.status}: ${json.message ?? "request failed"}`), { status: res.status, code: json.code });
  return json;
}

export async function startVerification(to: string) {
  await twilioPost(`https://verify.twilio.com/v2/Services/${config.twilio.verifyServiceSid}/Verifications`, { To: to, Channel: "sms" });
}

export async function checkVerification(to: string, code: string): Promise<boolean> {
  try {
    const r = await twilioPost(`https://verify.twilio.com/v2/Services/${config.twilio.verifyServiceSid}/VerificationCheck`, { To: to, Code: code });
    return r.status === "approved";
  } catch (err) {
    // 404 means the verification expired or was already used.
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}

/** Rings `to`. When answered, Twilio fetches the voice webhook, which connects the media stream. */
export async function placeCall(to: string, callId: string): Promise<string> {
  const base = config.publicUrl;
  const r = await twilioPost(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`, {
    To: to,
    From: config.twilio.fromNumber,
    Url: `${base}/api/twilio/voice?callId=${callId}`,
    StatusCallback: `${base}/api/twilio/status?callId=${callId}`,
    StatusCallbackEvent: ["completed"],
    Timeout: "30",
    // A backstop in case our own 2-minute cap never fires.
    TimeLimit: String(Math.ceil(config.maxCallMs / 1000) + 60),
    // Hang up on voicemail instead of pitching a scam to it.
    MachineDetection: "Enable",
    MachineDetectionTimeout: "5",
  });
  return r.sid as string;
}

/** https://www.twilio.com/docs/usage/webhooks/webhooks-security */
export function signatureFor(url: string, params: Record<string, string>, authToken = config.twilio.authToken) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validSignature(url: string, params: Record<string, string>, signature: string | undefined) {
  if (!signature || !config.twilio.authToken) return false;
  const a = Buffer.from(signatureFor(url, params));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A per-call secret passed to the media stream, so only Twilio's stream for this call can drive it. */
export function streamToken(callId: string) {
  return createHmac("sha256", config.twilio.authToken || "dev").update(`stream:${callId}`).digest("hex").slice(0, 32);
}

export function validStreamToken(callId: string, token: string | undefined) {
  if (!token) return false;
  const a = Buffer.from(streamToken(callId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function streamTwiml(callId: string) {
  const ws = `${config.publicUrl.replace(/^http/, "ws")}/api/twilio/stream`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(ws)}"><Parameter name="callId" value="${xml(callId)}"/><Parameter name="token" value="${streamToken(callId)}"/></Stream></Connect></Response>`;
}

export const hangupTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
