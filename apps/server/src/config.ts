import { resolve } from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? "0.0.0.0",
  nebiusApiKey: env.NEBIUS_API_KEY ?? "",
  nebiusBaseUrl: (env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, ""),
  // NVIDIA Nemotron 3 Super plays the scammer (thinking off for ~0.6s first token)
  personaModel: env.PERSONA_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
  // Nemotron with reasoning on scores the call and writes the debrief
  judgeModel: env.JUDGE_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
  speechUrl: (env.SPEECH_URL ?? "").replace(/\/$/, ""),
  dbPath: env.DB_PATH ?? "./data/hangup.db",
  corsOrigins: (env.CORS_ORIGIN ?? "*").split(",").map((s) => s.trim()),
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY ?? "",
    privateKey: env.VAPID_PRIVATE_KEY ?? "",
    subject: env.VAPID_SUBJECT ?? "mailto:hello@example.com",
  },
  // Native iPhone app: APNs VoIP push (token auth). APNS_KEY is the .p8 file's contents.
  apns: {
    key: (env.APNS_KEY ?? "").replace(/\\n/g, "\n"),
    keyId: env.APNS_KEY_ID ?? "",
    teamId: env.APNS_TEAM_ID ?? "",
    bundleId: env.APNS_BUNDLE_ID ?? "",
  },
  // Public https URL of this server, used for Twilio webhooks and the media stream.
  publicUrl: (env.PUBLIC_URL ?? "").replace(/\/$/, ""),
  // Real phone calls: Twilio places the call and streams its audio to us.
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID ?? "",
    authToken: env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: env.TWILIO_FROM_NUMBER ?? "",
    verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID ?? "",
  },
  // Phone speech: Deepgram listens on the line, ElevenLabs speaks (falls back to SPEECH_URL).
  deepgramApiKey: env.DEEPGRAM_API_KEY ?? "",
  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY ?? "",
    model: env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
    femaleVoice: env.ELEVENLABS_VOICE_FEMALE ?? "21m00Tcm4TlvDq8ikWAM",
    maleVoice: env.ELEVENLABS_VOICE_MALE ?? "pNInz6obpgDQGcFmaJgB",
  },
  maxCallMs: Number(env.MAX_CALL_MS ?? 2 * 60 * 1000),
  webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : "",
};
