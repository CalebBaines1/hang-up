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
  maxCallMs: Number(env.MAX_CALL_MS ?? 4 * 60 * 1000),
  webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : "",
};
