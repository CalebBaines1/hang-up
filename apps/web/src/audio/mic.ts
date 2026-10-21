import { audioContext } from "./context.ts";

// Microphone capture with a small energy-based voice activity detector.
// Emits 16 kHz PCM16 chunks for each utterance so the server's Parakeet model
// gets clean, endpointed audio.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("tap", Tap);
`;

export interface MicEvents {
  onSpeechStart: () => void;
  onAudio: (pcm16: ArrayBuffer) => void;
  onSpeechEnd: () => void;
  onLevel?: (level: number) => void;
}

export class Mic {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private speaking = false;
  private loudFrames = 0;
  private silentMs = 0;
  private utteranceMs = 0;
  private noise = 0.004;
  private preroll: Int16Array[] = [];
  private resampleCarry = 0;
  muted = false;
  /** Raise the threshold while the caller is talking so echo doesn't count as speech. */
  callerTalking = false;

  constructor(private ev: MicEvents) {}

  static async requestPermission() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  }

  async start() {
    const ctx = audioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, "tap");
    this.node.port.onmessage = (e) => this.process(e.data as Float32Array, ctx.sampleRate);
    this.source.connect(this.node);
  }

  private downsample(input: Float32Array, rate: number): Int16Array {
    const ratio = rate / 16000;
    const out: number[] = [];
    let pos = this.resampleCarry;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const s = Math.max(-1, Math.min(1, input[i]));
      out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      pos += ratio;
    }
    this.resampleCarry = pos - input.length;
    return Int16Array.from(out);
  }

  private process(frame: Float32Array, rate: number) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const frameMs = (frame.length / rate) * 1000;
    this.ev.onLevel?.(this.muted ? 0 : Math.min(1, rms * 12));
    const pcm = this.downsample(frame, rate);
    if (this.muted) return;

    if (!this.speaking) this.noise = this.noise * 0.995 + Math.min(rms, 0.05) * 0.005;
    const threshold = Math.max(0.012, this.noise * 3) * (this.callerTalking ? 2.2 : 1);
    const loud = rms > threshold;

    if (!this.speaking) {
      this.preroll.push(pcm);
      if (this.preroll.length * frameMs > 350) this.preroll.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames * frameMs >= 120) {
        this.speaking = true;
        this.silentMs = 0;
        this.utteranceMs = 0;
        this.ev.onSpeechStart();
        for (const p of this.preroll) this.ev.onAudio(p.buffer as ArrayBuffer);
        this.preroll = [];
      }
      return;
    }

    this.ev.onAudio(pcm.buffer as ArrayBuffer);
    this.utteranceMs += frameMs;
    this.silentMs = loud ? 0 : this.silentMs + frameMs;
    if (this.silentMs >= 750 || this.utteranceMs > 15000) {
      this.speaking = false;
      this.loudFrames = 0;
      this.ev.onSpeechEnd();
    }
  }

  stop() {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
  }
}
