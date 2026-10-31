import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@hangup/client";
import { config } from "./config.ts";
import { wavToMulaw8k } from "./mulaw.ts";
import { getPersona, getScenario } from "./scenarios.ts";
import { CallSessionHandler, type SessionSocket } from "./session.ts";
import { speechAvailable, synthesize } from "./speech.ts";
import { type CallRow, type DeviceRow, getCall, getDevice, updateCall } from "./store.ts";
import { phoneCallsEnabled, placeCall, validStreamToken } from "./twilio.ts";

// Real phone calls. Twilio rings the user's verified number and, once they answer, streams the
// line's audio (8 kHz μ-law) to /api/twilio/stream. This bridge feeds that audio to Deepgram,
// passes what the user said to the same CallSessionHandler the app uses (in "browser" mode, so it
// sends text), and speaks the caller's lines back down the line.

/** Should this call ring the user's real phone instead of the app? */
export function wantsPhone(device: DeviceRow) {
  return Boolean(device.settings.ringPhone && device.settings.phoneNumber && device.settings.phoneVerifiedAt && phoneCallsEnabled());
}

/** Dials the verified number. Returns false if Twilio refused, so the caller can fall back to the app. */
export async function ringByPhone(call: CallRow, device: DeviceRow): Promise<boolean> {
  if (!device.settings.phoneNumber) return false;
  try {
    updateCall(call.id, { via: "phone" });
    await placeCall(device.settings.phoneNumber, call.id);
    return true;
  } catch (err) {
    console.error("twilio dial failed", err);
    updateCall(call.id, { via: "app" });
    return false;
  }
}

// ---- caller voice on the phone line ----

async function phoneVoice(text: string, persona: ReturnType<typeof getPersona>): Promise<Buffer | null> {
  const el = config.elevenlabs;
  if (el.apiKey) {
    const voice = persona.voiceHint.gender === "female" ? el.femaleVoice : el.maleVoice;
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=ulaw_8000`, {
        method: "POST",
        headers: { "xi-api-key": el.apiKey, "content-type": "application/json", accept: "audio/basic" },
        body: JSON.stringify({ text, model_id: el.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: persona.voiceHint.rate } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.error("phone tts failed", err);
    }
  }
  if (config.speechUrl && (await speechAvailable())) {
    try {
      return wavToMulaw8k(await synthesize(text, persona.voice, { phone: true }));
    } catch (err) {
      console.error("speech service tts failed", err);
    }
  }
  return null;
}

// ---- the session handler talks to this instead of an app WebSocket ----

class SessionPipe extends EventEmitter implements SessionSocket {
  readyState = 1;
  constructor(
    private onServer: (msg: ServerMessage) => void,
    private onClose: () => void,
  ) {
    super();
  }
  send(data: string) {
    this.onServer(JSON.parse(data) as ServerMessage);
  }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.onClose();
    this.emit("close");
  }
  deliver(msg: ClientMessage) {
    if (this.readyState === 1) this.emit("message", Buffer.from(JSON.stringify(msg)), false);
  }
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export class PhoneBridge {
  private streamSid = "";
  private pipe: SessionPipe | null = null;
  private deepgram: WebSocket | null = null;
  private earlyAudio: Buffer[] = [];
  private persona: ReturnType<typeof getPersona> | null = null;
  private marks = new Set<string>();
  private drained: (() => void)[] = [];
  private chain: Promise<void> = Promise.resolve();
  /** Bumped on barge-in so queued sentences from the interrupted turn are dropped. */
  private generation = 0;
  private finals: string[] = [];
  private sessionEnded = false;
  private closed = false;

  constructor(
    private twilio: WebSocket,
    private hooks: { onStart?: () => void; onEnd?: () => void; connectListener?: () => WebSocket } = {},
  ) {
    twilio.on("message", (data) => this.onTwilio(data.toString()));
    twilio.on("close", () => this.onLineClosed());
    twilio.on("error", (err) => console.error("twilio stream error", err));
  }

  private onTwilio(raw: string) {
    let evt: any;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    switch (evt.event) {
      case "start":
        return this.start(evt.start);
      case "media":
        if (evt.media?.track && evt.media.track !== "inbound") return;
        return this.listen(Buffer.from(evt.media.payload, "base64"));
      case "mark":
        this.marks.delete(evt.mark?.name);
        if (!this.marks.size) this.drained.splice(0).forEach((f) => f());
        return;
      case "stop":
        return this.onLineClosed();
    }
  }

  private start(start: { streamSid: string; customParameters?: Record<string, string> }) {
    this.streamSid = start.streamSid;
    const callId = start.customParameters?.callId ?? "";
    const call = getCall(callId);
    const device = call ? getDevice(call.deviceId) : null;
    if (!call || !device || call.via !== "phone" || call.status !== "ringing" || !validStreamToken(callId, start.customParameters?.token)) {
      console.warn("rejected phone stream", { callId });
      this.closeLine();
      return;
    }
    this.persona = getPersona(getScenario(call.scenarioId)!.personaId);
    this.hooks.onStart?.();
    this.openDeepgram();
    this.pipe = new SessionPipe(
      (msg) => this.onSession(msg),
      () => this.closeLine(),
    );
    new CallSessionHandler(this.pipe, call, device);
    this.pipe.deliver({ type: "start", speech: "browser" });
  }

  // ---- user's voice → Deepgram → text ----

  private openDeepgram() {
    const q = new URLSearchParams({
      model: "nova-3",
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
    });
    const dg =
      this.hooks.connectListener?.() ??
      new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, { headers: { authorization: `Token ${config.deepgramApiKey}` } });
    this.deepgram = dg;
    dg.on("open", () => {
      for (const b of this.earlyAudio.splice(0)) dg.send(b);
    });
    dg.on("message", (data) => this.onTranscript(data.toString()));
    dg.on("error", (err) => console.error("deepgram error", err));
  }

  private listen(audio: Buffer) {
    if (!this.pipe || this.sessionEnded) return;
    const dg = this.deepgram;
    if (dg?.readyState === WebSocket.OPEN) dg.send(audio);
    else if (this.earlyAudio.length < 250) this.earlyAudio.push(audio); // ~5 s while connecting
  }

  private onTranscript(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "UtteranceEnd") return this.commit();
    if (msg.type !== "Results") return;
    const text = String(msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
    // Two words over the caller is a real interruption, not a cough or an "mm".
    if (text && this.playing() && (msg.is_final || words(text) >= 2)) this.bargeIn();
    if (msg.is_final && text) this.finals.push(text);
    if (msg.speech_final) this.commit();
  }

  private commit() {
    const text = this.finals.join(" ").trim();
    this.finals = [];
    if (!text) return;
    if (this.playing()) this.bargeIn();
    this.pipe?.deliver({ type: "user_text", text });
  }

  private playing() {
    return this.marks.size > 0;
  }

  private bargeIn() {
    if (!this.playing()) return;
    this.generation++;
    this.sendTwilio({ event: "clear", streamSid: this.streamSid });
    this.marks.clear();
    this.drained.splice(0).forEach((f) => f());
    this.pipe?.deliver({ type: "barge_in" });
  }

  // ---- caller's lines → speech → the phone line ----

  private onSession(msg: ServerMessage) {
    if (msg.type === "caller_say") {
      const gen = this.generation;
      const audio = this.persona ? phoneVoice(msg.text, this.persona) : Promise.resolve(null);
      this.chain = this.chain.then(async () => {
        const ulaw = await audio;
        if (!ulaw || gen !== this.generation || this.closed) return;
        this.play(ulaw, `${msg.turn}-${msg.seq}`);
      });
    } else if (msg.type === "ended") {
      this.sessionEnded = true;
      this.closeDeepgram();
      // Let the caller finish their closing line, then hang up.
      const finish = msg.afterPlayback ? this.chain.then(() => this.untilDrained(20_000)) : new Promise<void>((r) => setTimeout(r, 600));
      void finish.then(() => this.closeLine());
    }
  }

  private play(ulaw: Buffer, mark: string) {
    // 400 ms frames; Twilio queues them and plays in order.
    for (let i = 0; i < ulaw.length; i += 3200) {
      this.sendTwilio({ event: "media", streamSid: this.streamSid, media: { payload: ulaw.subarray(i, i + 3200).toString("base64") } });
    }
    this.marks.add(mark);
    this.sendTwilio({ event: "mark", streamSid: this.streamSid, mark: { name: mark } });
  }

  private untilDrained(timeoutMs: number) {
    if (!this.marks.size) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.drained.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  private sendTwilio(msg: unknown) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify(msg));
  }

  // ---- teardown ----

  /** The line went away: Twilio stopped the stream, usually because the user hung up. */
  private onLineClosed() {
    if (this.closed) return;
    this.closed = true;
    // Hanging up is the point of the exercise. The handler ignores this if the call already ended.
    if (this.pipe && !this.sessionEnded) this.pipe.deliver({ type: "hangup" });
    this.teardown();
  }

  /** We end the call: closing the stream ends <Connect>, and with no TwiML left Twilio hangs up. */
  private closeLine() {
    if (!this.closed) {
      this.closed = true;
      this.teardown();
    }
    if (this.twilio.readyState === WebSocket.OPEN || this.twilio.readyState === WebSocket.CONNECTING) this.twilio.close();
  }

  private teardown() {
    this.closeDeepgram();
    this.pipe?.close();
    if (this.persona) this.hooks.onEnd?.();
    this.hooks.onEnd = undefined;
  }

  private closeDeepgram() {
    const dg = this.deepgram;
    this.deepgram = null;
    if (!dg) return;
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => dg.close(), 500);
    } else if (dg.readyState === WebSocket.CONNECTING) dg.terminate();
  }
}

/** Twilio reported the call's outcome. Unanswered calls become missed or declined. */
export function onDialStatus(callId: string, status: string) {
  const call = getCall(callId);
  if (!call || call.via !== "phone" || call.status !== "ringing") return;
  if (status === "busy") updateCall(callId, { status: "declined" });
  else if (["no-answer", "failed", "canceled", "completed"].includes(status)) updateCall(callId, { status: "missed" });
}
