import type { Persona } from "@hangup/client";

// Fallback when the speech service isn't reachable: the browser's own speech
// recognition and synthesis. Quality varies by browser; Chrome and Safari work.

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

export function browserSpeechSupported() {
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && "speechSynthesis" in window;
}

export class BrowserListener {
  private rec: Recognition | null = null;
  private active = false;
  private stopped = false;
  muted = false;

  constructor(
    private onFinal: (text: string) => void,
    private onInterim: (text: string) => void,
  ) {}

  start() {
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) throw new Error("Speech recognition is not supported in this browser");
    this.active = true;
    const rec: Recognition = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: any) => {
      if (this.muted) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.onFinal(text);
        else this.onInterim(text);
      }
    };
    rec.onend = () => {
      if (this.active && this.rec === rec) setTimeout(() => this.active && this.rec === rec && rec.start(), 150);
    };
    rec.onerror = () => {};
    rec.start();
    this.rec = rec;
  }

  stop() {
    this.stopped = true;
    this.active = false;
    this.rec?.abort();
    this.rec = null;
  }

  /** Stop listening while the caller talks. On phones a live recognizer can
   * cut synthesis off, and on speakers it hears the caller's voice. */
  pause() {
    if (!this.active) return;
    this.active = false;
    this.rec?.abort();
    this.rec = null;
  }

  resume() {
    if (this.stopped || this.active || this.rec) return;
    this.start();
  }
}

function pickVoice(hint: Persona["voiceHint"]) {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const female = /female|samantha|victoria|karen|moira|tessa|serena|zira|susan|allison|ava|google us english|fiona|kate/i;
  const male = /male|daniel|alex|fred|david|mark|george|arthur|aaron|rishi|oliver|tom|google uk english male/i;
  const re = hint.gender === "female" ? female : male;
  return voices.find((v) => re.test(v.name) && !(hint.gender === "female" && /\bmale\b/i.test(v.name) && !/female/i.test(v.name))) ?? voices[0];
}

export class BrowserSpeaker {
  private queue = 0;
  onIdle?: () => void;

  get speaking() {
    return this.queue > 0;
  }

  say(text: string, hint: Persona["voiceHint"]) {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(hint);
    if (v) u.voice = v;
    u.pitch = hint.pitch;
    u.rate = hint.rate;
    this.queue++;
    const done = () => {
      this.queue = Math.max(0, this.queue - 1);
      if (this.queue === 0) this.onIdle?.();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  stop() {
    this.queue = 0;
    speechSynthesis.cancel();
  }
}
