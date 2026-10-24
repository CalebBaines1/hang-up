import { audioContext } from "./context.ts";

/** Plays the caller's sentences back to back, and can be cut off for barge-in. */
export class VoicePlayer {
  private queue: Promise<void> = Promise.resolve();
  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private generation = 0;
  private pending = 0;
  onIdle?: () => void;

  get playing() {
    return this.pending > 0 || this.sources.size > 0;
  }

  enqueueWav(base64: string) {
    const gen = this.generation;
    this.pending++;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const decoded = audioContext().decodeAudioData(bytes.buffer);
    this.queue = this.queue.then(async () => {
      try {
        const buffer = await decoded;
        if (gen !== this.generation) return;
        const ctx = audioContext();
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        const at = Math.max(ctx.currentTime + 0.02, this.nextStart);
        src.start(at);
        this.nextStart = at + buffer.duration;
        this.sources.add(src);
        src.onended = () => {
          this.sources.delete(src);
          if (!this.playing) this.onIdle?.();
        };
      } catch {
        // undecodable chunk: skip it
      } finally {
        this.pending--;
      }
    });
  }

  stop() {
    this.generation++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.nextStart = 0;
  }
}
