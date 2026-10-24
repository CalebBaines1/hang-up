// Shared types for the Hang Up API. The server, the web app and any future
// native app all import these, so the wire format lives in one place.

export type Difficulty = "clumsy" | "competent" | "expert";

export type Lever = "authority" | "helper" | "family" | "opportunity" | "work";

export interface Persona {
  id: string;
  name: string;
  lever: Lever;
  temperament: string;
  /** Voice id used by the speech service (Kokoro speaker name). */
  voice: string;
  /** Hint for the browser speech fallback. */
  voiceHint: { gender: "female" | "male"; pitch: number; rate: number };
}

export interface Scenario {
  id: string;
  title: string;
  /** Generic caller ID shown on the ringing screen. Never a real brand. */
  callerId: string;
  personaId: string;
  ask: string;
  keyTell: string;
  summary: string;
  /** Background ambience the ringing/call screen plays under the voice. */
  ambience: "call-center" | "street" | "quiet" | "office";
}

export interface ScheduleWindow {
  /** 0 = Sunday ... 6 = Saturday */
  days: number[];
  /** "HH:MM" 24h local time */
  start: string;
  end: string;
}

export interface Settings {
  displayName: string;
  safeWord: string;
  timezone: string;
  scheduleEnabled: boolean;
  window: ScheduleWindow;
  /** Practice calls per week, 1 to 3. */
  callsPerWeek: number;
  /** Parent opt-in: linked family members may queue practice calls. */
  familyCallsEnabled: boolean;
  consentedAt: string | null;
}

export type CallStatus =
  | "scheduled"
  | "ringing"
  | "active"
  | "ended"
  | "scored"
  | "missed"
  | "declined"
  | "cancelled";

export type CallSource = "practice" | "schedule" | "family";

export type EndReason =
  | "hung_up"
  | "safe_word"
  | "practice_reveal"
  | "payload_given"
  | "caller_gave_up"
  | "time_cap"
  | "disconnected";

export interface TranscriptLine {
  role: "caller" | "user";
  text: string;
  /** Milliseconds since the call was answered. */
  t: number;
  /** The caller was interrupted mid-sentence. */
  interrupted?: boolean;
}

export interface RedFlag {
  turn: number;
  label: string;
}

export interface ScoreSignal {
  id:
    | "kept_safe"
    | "fast_hangup"
    | "stayed_quiet"
    | "callback_official"
    | "verifying_question"
    | "refused_payload"
    | "long_call"
    | "partial_info"
    | "gave_payload";
  label: string;
  points: number;
  hit: boolean;
}

export interface Debrief {
  scam: string;
  biggestTell: string;
  didWell: string;
  doDifferently: string;
  earliestMoment: string;
  /** Set when the user hung up before the pitch: what the caller was about to ask and the tell to listen for. */
  beforePitch?: string;
  /** Under 30 seconds when read aloud by the coach voice. */
  spoken: string;
}

export interface CallResult {
  score: number;
  signals: ScoreSignal[];
  redFlags: RedFlag[];
  earliestHangupTurn: number | null;
  debrief: Debrief;
  /** A real-looking card number or code was caught by redaction. */
  payloadWarning: boolean;
  judgeModel: string;
}

export interface CallSummary {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  callerId: string;
  difficulty: Difficulty;
  status: CallStatus;
  source: CallSource;
  senderName: string | null;
  ringAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endReason: EndReason | null;
  score: number | null;
  durationMs: number | null;
}

export interface CallDetail extends CallSummary {
  transcript: TranscriptLine[];
  result: CallResult | null;
}

export interface FamilyMember {
  deviceId: string;
  name: string;
  linkedAt: string;
  paused: boolean;
}

export interface FamilyParent {
  deviceId: string;
  name: string;
  acceptsCalls: boolean;
  recentScores: { scenarioTitle: string; score: number; at: string }[];
  pendingCall: { ringWindow: string } | null;
  canSendNow: boolean;
  reason: string | null;
}

export interface Me {
  deviceId: string;
  settings: Settings;
  familyCode: string | null;
  stats: { calls: number; averageScore: number | null; streakDays: number };
  nextCall: { ringAt: string; source: CallSource } | null;
  speech: { server: boolean };
}

// ---- WebSocket call session protocol ----

export type SpeechMode = "server" | "browser";

export type ClientMessage =
  | { type: "start"; speech: SpeechMode }
  /** Browser speech mode: the recognised text of one user utterance. */
  | { type: "user_text"; text: string }
  /** Server speech mode: marks the start/end of an utterance whose PCM16 16 kHz mono audio follows as binary frames. */
  | { type: "utterance_start" }
  | { type: "utterance_end" }
  /** The user started talking over the caller. */
  | { type: "barge_in" }
  /** Caller audio for a turn finished playing on the device. */
  | { type: "playback_done"; turn: number }
  | { type: "hangup" }
  | { type: "practice_reveal" };

export type ServerMessage =
  | { type: "ready"; speech: SpeechMode; callerId: string; safeWord: string; maxMs: number }
  | { type: "caller_text"; turn: number; text: string; final: boolean }
  /** Base64 WAV for one sentence of caller speech (server speech mode). */
  | { type: "caller_audio"; turn: number; seq: number; wav: string }
  /** Browser speech mode: one sentence for the device to speak. */
  | { type: "caller_say"; turn: number; seq: number; text: string; voiceHint: Persona["voiceHint"] }
  | { type: "caller_turn_end"; turn: number }
  | { type: "user_text"; text: string }
  | { type: "thinking" }
  | { type: "ended"; reason: EndReason; afterPlayback: boolean }
  | { type: "error"; message: string };
