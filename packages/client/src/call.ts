import type { ClientMessage, EndReason, ServerMessage, SpeechMode } from "./types.ts";

type Handler<T> = (msg: T) => void;
type Events = {
  [K in ServerMessage["type"]]: Extract<ServerMessage, { type: K }>;
} & { close: { code: number } };

/**
 * One live practice call over a WebSocket. Audio capture and playback are
 * left to the app (Web Audio in the browser, expo-av on native) so this class
 * runs anywhere a WebSocket exists.
 */
export class CallSession {
  private ws: WebSocket;
  private handlers = new Map<string, Set<Handler<any>>>();
  private opened: Promise<void>;

  constructor(url: string, speech: SpeechMode, WS: typeof WebSocket = WebSocket) {
    this.ws = new WS(url);
    this.ws.binaryType = "arraybuffer";
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        this.send({ type: "start", speech });
        resolve();
      };
      this.ws.onerror = () => reject(new Error("Could not connect the call"));
    });
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const msg = JSON.parse(ev.data) as ServerMessage;
      this.emit(msg.type, msg);
    };
    this.ws.onclose = (ev) => this.emit("close", { code: ev.code });
  }

  ready() {
    return this.opened;
  }

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  private emit(type: string, msg: unknown) {
    this.handlers.get(type)?.forEach((fn) => fn(msg));
  }

  send(msg: ClientMessage) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /** Server speech mode: stream PCM16 16 kHz mono audio for the current utterance. */
  sendAudio(pcm16: ArrayBuffer) {
    if (this.ws.readyState === 1) this.ws.send(pcm16);
  }

  sayText(text: string) {
    this.send({ type: "user_text", text });
  }
  bargeIn() {
    this.send({ type: "barge_in" });
  }
  playbackDone(turn: number) {
    this.send({ type: "playback_done", turn });
  }
  hangUp() {
    this.send({ type: "hangup" });
  }
  revealPractice() {
    this.send({ type: "practice_reveal" });
  }
  close() {
    this.ws.close();
  }
}

export type { EndReason };
