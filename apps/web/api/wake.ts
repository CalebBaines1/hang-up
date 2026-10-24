// Vercel function: starts the Nebius VM that runs the Hang Up API when it has
// powered itself off after being idle (deploy/nebius/idle-shutdown.sh).
//
// Env (Vercel project settings), from a Nebius service account with permission
// to start the instance and an authorized key for it:
//   NEBIUS_SA_ID, NEBIUS_KEY_ID, NEBIUS_PRIVATE_KEY (PEM), NEBIUS_INSTANCE_ID
import { createSign } from "node:crypto";

const API = "https://api.nebius.cloud";
const AUTH = "https://auth.eu.nebius.com:443/oauth2/token/exchange";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

let cached: { token: string; until: number } | null = null;

async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const { NEBIUS_SA_ID: sa, NEBIUS_KEY_ID: kid, NEBIUS_PRIVATE_KEY: pem } = process.env;
  if (!sa || !kid || !pem) throw new Error("Nebius service account env vars are not set");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))}.${b64url(JSON.stringify({ iss: sa, sub: sa, iat: now, exp: now + 300 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(pem.replace(/\\n/g, "\n"), "base64url");
  const res = await fetch(AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: `${unsigned}.${signature}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, until: Date.now() + (json.expires_in - 300) * 1000 };
  return json.access_token;
}

async function nebius(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`Nebius ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** GET: the VM's state. POST: start it if it's stopped. */
async function handle(start: boolean) {
  const id = process.env.NEBIUS_INSTANCE_ID;
  if (!id) return json({ error: "NEBIUS_INSTANCE_ID is not set" }, 500);
  try {
    const vm = await nebius(`/compute/v1/instances/${encodeURIComponent(id)}`);
    const state: string = vm.status?.state ?? "UNSPECIFIED";
    if (start && state === "STOPPED") {
      await nebius("/compute/v1/instances/start", { method: "POST", body: JSON.stringify({ id }) });
      return json({ state: "STARTING" });
    }
    return json({ state });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't reach the Nebius API" }, 502);
  }
}

export function GET() {
  return handle(false);
}

export function POST() {
  return handle(true);
}
