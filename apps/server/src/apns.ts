// VoIP pushes to the native iPhone app (PushKit). A VoIP push wakes the app
// even when it is closed, and the app must immediately report an incoming
// call to CallKit, so the phone rings with the system call screen.
//
// Token-based APNs auth: an ES256 JWT signed with a .p8 key from the Apple
// developer account. Configure APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID and
// APNS_BUNDLE_ID; without them VoIP push is off and the app falls back to
// checking for a ringing call when it opens.
import { connect, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { config } from "./config.ts";

export const apnsEnabled = () => Boolean(config.apns.key && config.apns.keyId && config.apns.teamId && config.apns.bundleId);

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** ES256 JWT for APNs. Exported for tests. */
export function apnsJwt(opts: { key: string; keyId: string; teamId: string; iat?: number }) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: opts.keyId }));
  const claims = b64url(JSON.stringify({ iss: opts.teamId, iat: opts.iat ?? Math.floor(Date.now() / 1000) }));
  const data = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(data), { key: createPrivateKey(opts.key), dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

let cached: { jwt: string; at: number } | null = null;
function jwt() {
  // Apple rejects tokens older than an hour and throttles refreshes faster than every 20 minutes.
  if (!cached || Date.now() - cached.at > 45 * 60_000) {
    cached = { jwt: apnsJwt({ key: config.apns.key, keyId: config.apns.keyId, teamId: config.apns.teamId }), at: Date.now() };
  }
  return cached.jwt;
}

const sessions = new Map<string, ClientHttp2Session>();
function session(sandbox: boolean) {
  const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  let s = sessions.get(host);
  if (!s || s.closed || s.destroyed) {
    s = connect(host);
    s.on("error", () => sessions.delete(host));
    s.on("close", () => sessions.delete(host));
    s.unref();
    sessions.set(host, s);
  }
  return s;
}

export type ApnsResult = { ok: true } | { ok: false; status: number; reason: string; gone: boolean };

export function sendVoipPush(token: string, sandbox: boolean, payload: Record<string, unknown>): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const req = session(sandbox).request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt()}`,
      "apns-topic": `${config.apns.bundleId}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      // A practice call that can't ring within a minute is stale.
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 60),
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (h) => (status = Number(h[":status"])));
    req.on("data", (c) => (body += c));
    req.on("error", (err) => resolve({ ok: false, status: 0, reason: String(err), gone: false }));
    req.on("end", () => {
      if (status === 200) return resolve({ ok: true });
      let reason = body;
      try {
        reason = JSON.parse(body).reason ?? body;
      } catch {}
      resolve({ ok: false, status, reason, gone: status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" });
    });
    req.end(JSON.stringify(payload));
  });
}
