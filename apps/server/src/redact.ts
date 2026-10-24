import type { TranscriptLine } from "@hangup/client";

// Runs in memory before anything is stored. People under pressure blurt out
// real numbers, so treat every user line as if it holds a secret.

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};

/** "four five six one" -> "4561" so spoken numbers get caught too. */
function normaliseSpokenDigits(text: string) {
  return text.replace(/\b((?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)){3,})\b/gi, (m) =>
    m
      .split(/[\s,-]+/)
      .map((w) => DIGIT_WORDS[w.toLowerCase()] ?? "")
      .join(""),
  );
}

const rules: { re: RegExp; token: string; payload: boolean }[] = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, token: "[EMAIL]", payload: false },
  { re: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, token: "[SSN]", payload: true },
  { re: /\b\d(?:[ -]?\d){12,18}\b/g, token: "[CARD]", payload: true },
  { re: /\b\d{7,12}\b/g, token: "[ACCOUNT]", payload: true },
  {
    re: /\b\d{1,5}\s+\w+(?:\s\w+)?\s(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way)\b/gi,
    token: "[ADDRESS]",
    payload: false,
  },
  // One-time codes are redacted but do not trigger the "call your bank" warning:
  // in practice there was no real text message to read from.
  { re: /\b\d{4,6}\b/g, token: "[CODE]", payload: false },
];

export function redactText(text: string): { text: string; payload: boolean } {
  let out = normaliseSpokenDigits(text);
  let payload = false;
  for (const r of rules) {
    out = out.replace(r.re, () => {
      if (r.payload) payload = true;
      return r.token;
    });
  }
  return { text: out, payload };
}

/** Redacts the user's lines only; the caller's invented case numbers are harmless. */
export function redactTranscript(lines: TranscriptLine[]) {
  let payload = false;
  const redacted = lines.map((l) => {
    if (l.role !== "user") return l;
    const r = redactText(l.text);
    payload ||= r.payload;
    return { ...l, text: r.text };
  });
  return { lines: redacted, payload };
}
