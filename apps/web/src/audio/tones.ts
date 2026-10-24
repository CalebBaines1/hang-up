import { audioContext } from "./context.ts";

// Ringtone, ambience and the hang-up click are synthesised with Web Audio so
// the app ships no audio files.

export function startRingtone(): () => void {
  const ctx = audioContext();
  const out = ctx.createGain();
  out.gain.value = 0.25;
  out.connect(ctx.destination);
  let stopped = false;
  const notes = [1318.5, 1046.5, 1318.5, 1046.5, 1318.5, 1046.5];
  const ringOnce = () => {
    if (stopped) return;
    const t0 = ctx.currentTime + 0.05;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = t0 + i * 0.11;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    });
    if ("vibrate" in navigator) navigator.vibrate?.([300, 120, 300]);
  };
  ringOnce();
  const timer = setInterval(() => {
    ringOnce();
    setTimeout(ringOnce, 900);
  }, 3000);
  setTimeout(ringOnce, 900);
  return () => {
    stopped = true;
    clearInterval(timer);
    navigator.vibrate?.(0);
    out.disconnect();
  };
}

/** Filtered noise under the caller's voice: a call centre, a street, an office. */
export function startAmbience(kind: "call-center" | "street" | "quiet" | "office"): () => void {
  const ctx = audioContext();
  const seconds = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // brown-ish noise
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === "street" ? "lowpass" : "bandpass";
  filter.frequency.value = kind === "street" ? 500 : kind === "call-center" ? 900 : 1200;
  filter.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.value = { "call-center": 0.16, street: 0.22, office: 0.07, quiet: 0.03 }[kind];
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
  return () => {
    try {
      src.stop();
    } catch {}
    gain.disconnect();
  };
}

export function playHangupTone() {
  const ctx = audioContext();
  const t = ctx.currentTime;
  [0, 0.18, 0.36].forEach((d) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 480;
    g.gain.setValueAtTime(0.15, t + d);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.14);
    o.connect(g).connect(ctx.destination);
    o.start(t + d);
    o.stop(t + d + 0.15);
  });
}
