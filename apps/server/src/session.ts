import type { ClientMessage, EndReason, ServerMessage, SpeechMode, TranscriptLine } from "@hangup/client";
import { config } from "./config.ts";
import { chatStream, type ChatMessage } from "./llm.ts";
import { redactTranscript } from "./redact.ts";
import { END_GAVE_UP, END_PAYLOAD, getPersona, getScenario, personaPrompt } from "./scenarios.ts";
import { scoreCall } from "./scoring.ts";
import { speechAvailable, synthesize, transcribe } from "./speech.ts";
import { type CallRow, type DeviceRow, now, updateCall } from "./store.ts";

/** Strip anything a TTS voice shouldn't read: stage directions, markdown, end markers. */
export function speakable(text: string) {
  return text
    .replace(/\[END:[A-Z_]*\]?/g, "")
    .replace(/[*(\[][^*)\]]*\b(sighs?|pauses?|laughs?|crying|cries|sniff\w*|coughs?|clears throat|whispers?)\b[^*)\]]*[*)\]]/gi, "")
    .replace(/[#*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits streamed text into speakable sentences as soon as each one is complete. */
export class SentenceSplitter {
  private buf = "";
  private first = true;
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      // The first chunk of a turn may break at a comma or dash so the voice starts sooner.
      const re = this.first ? /(?:[.!?…]+["')\]]*|,|—| - )\s+/g : /[.!?…]+["')\]]*\s+/g;
      let m: RegExpExecArray | null;
      let cut = -1;
      while ((m = re.exec(this.buf))) {
        const end = m.index + m[0].length;
        // Keep very short fragments ("Okay.") attached to what follows.
        if (this.buf.slice(0, end).trim().length >= (this.first ? 20 : 12)) {
          cut = end;
          break;
        }
      }
      if (cut < 0) return out;
      out.push(this.buf.slice(0, cut).trim());
      this.buf = this.buf.slice(cut);
      this.first = false;
    }
  }
  flush(): string {
    const rest = this.buf.trim();
    this.buf = "";
    return rest;
  }
}

export function mentionsSafeWord(text: string, safeWord: string) {
  const w = safeWord.trim().toLowerCase();
  if (!w) return false;
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(norm);
}

/** The app's WebSocket, or the phone bridge standing in for it. */
export interface SessionSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

export class CallSessionHandler {
  private mode: SpeechMode = "browser";
  private messages: ChatMessage[] = [];
  private transcript: TranscriptLine[] = [];
  private turn = 0;
  private abort: AbortController | null = null;
  private startedAt = 0;
  private ended = false;
  private capTimer: NodeJS.Timeout | null = null;
  private audio: Buffer[] = [];
  private scenario;
  private persona;

  constructor(
    private ws: SessionSocket,
    private call: CallRow,
    private device: DeviceRow,
  ) {
    this.scenario = getScenario(call.scenarioId)!;
    this.persona = getPersona(this.scenario.personaId);
    ws.on("message", (data, isBinary) => this.onMessage(Buffer.from(data), isBinary));
    ws.on("close", () => {
      // A socket that closes before "start" leaves the call ringing so the app can reconnect.
      if (!this.ended && this.startedAt) void this.end("disconnected");
    });
  }

  private send(msg: ServerMessage) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private elapsed() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  private async onMessage(data: Buffer, isBinary: boolean) {
    if (this.ended) return;
    if (isBinary) {
      if (this.audio.length < 2000) this.audio.push(Buffer.from(data));
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "start":
        return this.start(msg.speech);
      case "user_text":
        return this.onUserText(msg.text);
      case "utterance_start":
        this.audio = [];
        return;
      case "utterance_end": {
        const pcm = Buffer.concat(this.audio);
        this.audio = [];
        if (pcm.length < 16000 * 2 * 0.3) return; // under 0.3 s: a cough, not speech
        this.send({ type: "thinking" });
        try {
          const text = await transcribe(pcm);
          return this.onUserText(text);
        } catch (err) {
          console.error("stt failed", err);
          return;
        }
      }
      case "barge_in":
        this.abort?.abort();
        return;
      case "hangup":
        return this.end("hung_up");
      case "practice_reveal":
        return this.end("practice_reveal");
      case "playback_done":
        return;
    }
  }

  private async start(requested: SpeechMode) {
    if (this.startedAt) return;
    this.mode = requested === "server" && (await speechAvailable()) ? "server" : "browser";
    this.startedAt = Date.now();
    updateCall(this.call.id, { status: "active", startedAt: now() });
    this.send({
      type: "ready",
      speech: this.mode,
      callerId: this.scenario.callerId,
      safeWord: this.device.settings.safeWord,
      maxMs: config.maxCallMs,
    });
    this.capTimer = setTimeout(() => void this.end("time_cap"), config.maxCallMs);
    this.messages = [
      {
        role: "system",
        content: personaPrompt({
          scenario: this.scenario,
          difficulty: this.call.difficulty,
          userName: this.device.settings.displayName,
          safeWord: this.device.settings.safeWord,
        }),
      },
      { role: "user", content: "Hello?" },
    ];
    void this.callerTurn();
  }

  private onUserText(raw: string) {
    const text = raw.trim();
    if (!text || this.ended) return;
    if (mentionsSafeWord(text, this.device.settings.safeWord)) return this.end("safe_word");
    this.abort?.abort();
    this.transcript.push({ role: "user", text, t: this.elapsed() });
    this.send({ type: "user_text", text });
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") last.content += ` ${text}`;
    else this.messages.push({ role: "user", content: text });
    void this.callerTurn();
  }

  private async callerTurn() {
    const turn = ++this.turn;
    const abort = new AbortController();
    this.abort = abort;
    const t = this.elapsed();
    const splitter = new SentenceSplitter();
    let raw = "";
    let spoken = "";
    let seq = 0;
    let chain: Promise<void> = Promise.resolve();

    const speak = (sentence: string) => {
      const text = speakable(sentence);
      if (!text) return;
      spoken += (spoken ? " " : "") + text;
      const n = seq++;
      if (this.mode === "server") {
        const audio = synthesize(text, this.persona.voice, { phone: true }).catch((err) => {
          console.error("tts failed", err);
          return null;
        });
        chain = chain.then(async () => {
          const wav = await audio;
          if (turn !== this.turn || abort.signal.aborted || this.ended) return;
          if (wav) this.send({ type: "caller_audio", turn, seq: n, wav: wav.toString("base64") });
          else this.send({ type: "caller_say", turn, seq: n, text, voiceHint: this.persona.voiceHint });
        });
      } else {
        this.send({ type: "caller_say", turn, seq: n, text, voiceHint: this.persona.voiceHint });
      }
      this.send({ type: "caller_text", turn, text: spoken, final: false });
    };

    try {
      for await (const delta of chatStream({
        model: config.personaModel,
        messages: this.messages,
        maxTokens: 120,
        temperature: 0.85,
        thinking: false,
        signal: abort.signal,
      })) {
        raw += delta;
        for (const s of splitter.push(delta)) speak(s);
      }
      speak(splitter.flush());
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("persona failed", err);
        this.send({ type: "error", message: "The caller's line dropped. Try again in a moment." });
      }
    }

    const interrupted = abort.signal.aborted;
    if (spoken) {
      this.transcript.push({ role: "caller", text: spoken, t, ...(interrupted ? { interrupted: true } : {}) });
      this.messages.push({ role: "assistant", content: spoken + (interrupted ? " —" : "") });
    }
    if (interrupted || this.ended) return;
    this.send({ type: "caller_text", turn, text: spoken, final: true });
    await chain;
    if (turn !== this.turn) return;
    this.send({ type: "caller_turn_end", turn });
    if (raw.includes(END_PAYLOAD)) void this.end("payload_given", true);
    else if (raw.includes(END_GAVE_UP)) void this.end("caller_gave_up", true);
  }

  async end(reason: EndReason, afterPlayback = false) {
    if (this.ended) return;
    this.ended = true;
    if (!afterPlayback) this.abort?.abort();
    if (this.capTimer) clearTimeout(this.capTimer);
    const durationMs = this.elapsed();
    this.send({ type: "ended", reason, afterPlayback });
    setTimeout(() => this.ws.close(), afterPlayback ? 30_000 : 1500);

    const { lines, payload } = redactTranscript(this.transcript);
    updateCall(this.call.id, { status: "ended", endedAt: now(), endReason: reason, transcript: lines });

    // The safe word and "This is practice" end the call without a score, and so
    // does a dropped connection: it says nothing about what the user did.
    if (reason === "safe_word" || reason === "practice_reveal" || reason === "disconnected" || !this.startedAt) {
      updateCall(this.call.id, { status: "scored", score: null, result: null });
      return;
    }
    const result = await scoreCall({
      scenario: this.scenario,
      lines,
      endReason: reason,
      durationMs,
      userName: this.device.settings.displayName,
      payloadWarning: payload,
    });
    updateCall(this.call.id, { status: "scored", score: result.score, result });
  }
}
