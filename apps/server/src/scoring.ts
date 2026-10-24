import type { CallResult, Debrief, EndReason, RedFlag, Scenario, ScoreSignal, TranscriptLine } from "@hangup/client";
import { config } from "./config.ts";
import { chat, extractJson } from "./llm.ts";

// Nemotron tags the behaviours; deterministic rules on top (time on the line,
// how fast the user hung up after the first red flag) keep scores consistent.

interface JudgeTags {
  red_flags: { turn: number; label: string }[];
  callback_official: boolean;
  verifying_question: boolean;
  refused_payload: boolean;
  gave_partial_info: boolean;
  gave_payload: boolean;
  earliest_hangup_turn: number | null;
  debrief: {
    scam: string;
    biggest_tell: string;
    did_well: string;
    do_differently: string;
    earliest_moment: string;
    spoken: string;
  };
}

// The safest habits score highest: give nothing away, say little, hang up fast.
export const SIGNALS: Record<ScoreSignal["id"], { label: string; points: number }> = {
  kept_safe: { label: "Gave away nothing: no code, money or personal details", points: 50 },
  fast_hangup: { label: "Ended the call within 60 seconds of the first red flag", points: 40 },
  stayed_quiet: { label: "Didn't engage: said 10 words or fewer", points: 10 },
  callback_official: { label: "Said they'd call back on the official number", points: 10 },
  verifying_question: { label: "Asked a verifying question the caller couldn't answer", points: 5 },
  refused_payload: { label: "Refused to give the code, card or payment", points: 5 },
  long_call: { label: "Stayed on the line past 3 minutes", points: -10 },
  partial_info: { label: "Gave partial personal info", points: -20 },
  gave_payload: { label: "Gave the scammer what they asked for", points: -50 },
};

const QUIET_WORDS = 10;

function formatTranscript(lines: TranscriptLine[]) {
  return lines
    .map((l, i) => `[${i}] (${(l.t / 1000).toFixed(0)}s) ${l.role === "caller" ? "CALLER" : "USER"}: ${l.text}${l.interrupted ? " (interrupted)" : ""}`)
    .join("\n");
}

function judgePrompt(scenario: Scenario, lines: TranscriptLine[], endReason: EndReason, userName: string) {
  return `You are the coach in Hang Up, a scam-call training app. The user just finished a consented practice call with an AI playing a scammer. Grade the USER's behaviour and write a short, warm, plain-language debrief.

Scenario: ${scenario.title}. ${scenario.summary}
What the scammer wanted: ${scenario.ask}
The key tell for this scam: ${scenario.keyTell}
How the call ended: ${endReason.replace(/_/g, " ")}
User's first name: ${userName || "unknown"}
The behaviour we want to build: give nothing away, say as little as possible, and hang up fast. Hanging up early, even before hearing the pitch, or staying silent is the ideal response; praise it and never suggest they should have engaged more.
Note: values like [CODE], [CARD] or [SSN] in user lines mean the user said a real-looking number that was redacted for privacy; treat it as handing that thing over.

Transcript (turn index, seconds since answer):
${formatTranscript(lines)}

Return ONLY a JSON object with exactly these keys:
{
  "red_flags": [{"turn": <caller turn index>, "label": "<3 to 6 word name of the tactic, e.g. 'Asked for a one-time code'>"}],
  "callback_official": <true if the user said they would hang up and call the official number / the number on their card / the real person directly>,
  "verifying_question": <true if the user asked a question to test the caller that the caller dodged or could not answer>,
  "refused_payload": <true if the user explicitly refused the payload at least once and never gave it>,
  "gave_partial_info": <true if the user volunteered personal details such as full name, bank name, address, date of birth, a relative's name>,
  "gave_payload": <true if the user handed over the payload or agreed to pay/install/buy>,
  "earliest_hangup_turn": <index of the earliest caller turn after which hanging up was clearly justified, or null>,
  "debrief": {
    "scam": "<one sentence naming the scam>",
    "biggest_tell": "<one sentence: the single biggest tell in THIS call>",
    "did_well": "<one sentence: something specific the user did well; if nothing, praise answering calmly>",
    "do_differently": "<one sentence: the one thing to do differently next time>",
    "earliest_moment": "<one sentence quoting or paraphrasing the earliest moment they could have hung up>",
    "spoken": "<the coach's spoken debrief, 45 to 75 words, second person, friendly, no lists. Always say this was a practice call, name the earliest moment they could have hung up, and end with one memorable rule.>"
  }
}`;
}

export function computeScore(
  tags: Pick<JudgeTags, "red_flags" | "callback_official" | "verifying_question" | "refused_payload" | "gave_partial_info" | "gave_payload">,
  lines: TranscriptLine[],
  endReason: EndReason,
  durationMs: number,
): { score: number; signals: ScoreSignal[] } {
  const firstFlag = [...tags.red_flags].sort((a, b) => a.turn - b.turn)[0];
  const firstFlagT = firstFlag ? (lines[firstFlag.turn]?.t ?? 0) : null;
  // Ending the call within a minute counts even if the caller never got to a red flag;
  // refusing until the caller gives up counts the same as hanging up.
  const fastHangup =
    (endReason === "hung_up" || endReason === "caller_gave_up") && !tags.gave_payload && (firstFlagT === null ? durationMs <= 60_000 : durationMs - firstFlagT <= 60_000);

  const gavePayload = tags.gave_payload || endReason === "payload_given";
  const userWords = lines.filter((l) => l.role === "user").reduce((n, l) => n + (l.text.match(/[\p{L}\p{N}']+/gu)?.length ?? 0), 0);

  const hits: Record<ScoreSignal["id"], boolean> = {
    kept_safe: !gavePayload && !tags.gave_partial_info,
    fast_hangup: fastHangup,
    stayed_quiet: endReason !== "disconnected" && !gavePayload && userWords <= QUIET_WORDS,
    callback_official: tags.callback_official,
    verifying_question: tags.verifying_question,
    refused_payload: tags.refused_payload && !gavePayload,
    long_call: durationMs > 180_000,
    partial_info: tags.gave_partial_info,
    gave_payload: gavePayload,
  };
  const signals = (Object.keys(SIGNALS) as ScoreSignal["id"][]).map((id) => ({
    id,
    label: SIGNALS[id].label,
    points: SIGNALS[id].points,
    hit: hits[id],
  }));
  const raw = signals.reduce((s, x) => s + (x.hit ? x.points : 0), 0);
  return { score: Math.max(0, Math.min(100, raw)), signals };
}

function fallbackDebrief(scenario: Scenario): Debrief {
  return {
    scam: `This was a practice ${scenario.title.toLowerCase()} scam.`,
    biggestTell: scenario.keyTell,
    didWell: "You took the call calmly, which makes it easier to think clearly.",
    doDifferently: "Hang up as soon as a caller asks for money, a code or secrecy, and call back on a number you trust.",
    earliestMoment: "The moment the caller created urgency was your cue to hang up.",
    spoken: `That was a practice call. ${scenario.keyTell} Next time, hang up as soon as someone asks for a code, money or secrecy, and call back on a number you already trust.`,
  };
}

export async function scoreCall(opts: {
  scenario: Scenario;
  lines: TranscriptLine[];
  endReason: EndReason;
  durationMs: number;
  userName: string;
  payloadWarning: boolean;
}): Promise<CallResult> {
  const { scenario, lines, endReason, durationMs } = opts;
  let tags: JudgeTags | null = null;
  try {
    const reply = await chat({
      model: config.judgeModel,
      messages: [{ role: "user", content: judgePrompt(scenario, lines, endReason, opts.userName) }],
      maxTokens: 4000,
      temperature: 0.3,
    });
    tags = extractJson<JudgeTags>(reply);
  } catch (err) {
    console.error("judge failed", err);
  }
  const safeTags = tags ?? {
    red_flags: [],
    callback_official: false,
    verifying_question: false,
    refused_payload: false,
    gave_partial_info: false,
    gave_payload: endReason === "payload_given",
    earliest_hangup_turn: null,
    debrief: null as unknown as JudgeTags["debrief"],
  };
  const redFlags: RedFlag[] = (safeTags.red_flags ?? [])
    .filter((f) => Number.isInteger(f.turn) && lines[f.turn]?.role === "caller")
    .map((f) => ({ turn: f.turn, label: String(f.label).slice(0, 80) }));
  const { score, signals } = computeScore({ ...safeTags, red_flags: redFlags }, lines, endReason, durationMs);
  const d = safeTags.debrief;
  let debrief = d
    ? {
        scam: d.scam,
        biggestTell: d.biggest_tell,
        didWell: d.did_well,
        doDifferently: d.do_differently,
        earliestMoment: d.earliest_moment,
        spoken: d.spoken,
      }
    : fallbackDebrief(scenario);
  if (opts.payloadWarning) {
    debrief = {
      ...debrief,
      spoken: `${debrief.spoken} One more thing: it sounded like you read out a real number. If that was a real card or code, call your bank on the number on your card.`,
    };
  }
  return {
    score,
    signals,
    redFlags,
    earliestHangupTurn: safeTags.earliest_hangup_turn ?? null,
    debrief,
    payloadWarning: opts.payloadWarning,
    judgeModel: config.judgeModel,
  };
}
