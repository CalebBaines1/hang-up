// G.711 μ-law at 8 kHz is what phone networks (and Twilio Media Streams) carry.

const BIAS = 0x84;
const CLIP = 32635;

export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -s : s;
}

/** Reads a PCM16 WAV (any sample rate, mono or stereo) into mono samples. */
export function parseWav(wav: Buffer): { samples: Int16Array; rate: number } {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let rate = 16000;
  let channels = 1;
  let bits = 16;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = wav.readUInt16LE(body + 2);
      rate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`unsupported WAV bit depth ${bits}`);
      const end = Math.min(wav.length, body + size);
      const frames = Math.floor((end - body) / (2 * channels));
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += wav.readInt16LE(body + (i * channels + c) * 2);
        samples[i] = Math.round(acc / channels);
      }
      return { samples, rate };
    }
    off = body + size + (size & 1);
  }
  throw new Error("WAV has no data chunk");
}

/** Resamples to 8 kHz (averaging when downsampling) and encodes μ-law. */
export function toMulaw8k(samples: Int16Array, rate: number): Buffer {
  const ratio = rate / 8000;
  const n = Math.floor(samples.length / ratio);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const start = i * ratio;
    const a = Math.floor(start);
    const b = Math.max(a + 1, Math.floor(start + ratio));
    let acc = 0;
    let count = 0;
    for (let j = a; j < b && j < samples.length; j++) {
      acc += samples[j];
      count++;
    }
    out[i] = linearToMulaw(count ? acc / count : 0);
  }
  return out;
}

export function wavToMulaw8k(wav: Buffer): Buffer {
  const { samples, rate } = parseWav(wav);
  return toMulaw8k(samples, rate);
}
