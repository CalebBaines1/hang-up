import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Difficulty, FamilyParent, Me, Settings } from "@hangup/client";
import { config } from "./config.ts";
import { vapidPublicKey } from "./push.ts";
import { getScenario, personas, scenarios } from "./scenarios.ts";
import { hadCallToday, inFailureCooldown, nextDifficulty, randomScenarioId, startScheduler } from "./scheduler.ts";
import { CallSessionHandler } from "./session.ts";
import { speechAvailable, synthesize } from "./speech.ts";
import * as store from "./store.ts";
import { describeWindow, randomTimeInWindow, safeTz } from "./time.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 256 * 1024 });

await app.register(cors, {
  origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  methods: ["GET", "POST", "PATCH", "DELETE"],
});
await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

// ---- auth: each install registers a device and gets a bearer token ----

function tokenOf(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return (req.query as Record<string, string> | undefined)?.token;
}

function auth(req: FastifyRequest, reply: FastifyReply) {
  const device = store.deviceByToken(tokenOf(req));
  if (!device) {
    reply.code(401).send({ error: "Unknown device. Register first." });
    return null;
  }
  return device;
}

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

app.get("/api/health", async () => ({ ok: true, speech: await speechAvailable(), personaModel: config.personaModel, judgeModel: config.judgeModel }));

app.post("/api/devices", async (req) => {
  const { displayName } = (req.body ?? {}) as { displayName?: string };
  return store.createDevice(displayName);
});

async function meFor(device: store.DeviceRow): Promise<Me> {
  const calls = store.callsForDevice(device.id, 100);
  const scored = calls.filter((c) => c.score != null);
  const days = new Set(scored.map((c) => (c.startedAt ?? c.createdAt).slice(0, 10)));
  // Consecutive days with a scored call, counting back from today (or yesterday).
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  let streak = 0;
  let cursor = days.has(dayKey(Date.now())) ? Date.now() : Date.now() - 86400000;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= 86400000;
  }
  const pending = store.pendingCallFor(device.id);
  return {
    deviceId: device.id,
    settings: device.settings,
    familyCode: device.settings.familyCallsEnabled ? device.familyCode : null,
    stats: {
      calls: scored.length,
      averageScore: scored.length ? Math.round(scored.reduce((a, c) => a + c.score!, 0) / scored.length) : null,
      streakDays: streak,
    },
    nextCall: pending && pending.ringAt ? { ringAt: pending.ringAt, source: pending.source } : null,
    speech: { server: await speechAvailable() },
  };
}

app.get("/api/me", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  return meFor(device);
});

app.post("/api/me/opened", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  store.markOpened(device.id);
  return reply.code(204).send();
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

app.patch("/api/me/settings", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const patch = (req.body ?? {}) as Partial<Settings> & { consent?: boolean };
  const s: Settings = { ...device.settings };
  if (typeof patch.displayName === "string") s.displayName = patch.displayName.trim().slice(0, 40);
  if (typeof patch.safeWord === "string") {
    const w = patch.safeWord.trim().toLowerCase();
    if (!/^[\p{L}\p{N}]{3,24}$/u.test(w)) return fail(reply, 400, "The safe word should be one word, 3 to 24 letters.");
    s.safeWord = w;
  }
  if (typeof patch.timezone === "string") s.timezone = safeTz(patch.timezone);
  if (typeof patch.scheduleEnabled === "boolean") s.scheduleEnabled = patch.scheduleEnabled;
  if (patch.window) {
    const w = patch.window;
    if (!Array.isArray(w.days) || !w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !HHMM.test(w.start) || !HHMM.test(w.end))
      return fail(reply, 400, "Invalid call window.");
    s.window = { days: [...new Set(w.days)].sort(), start: w.start, end: w.end };
  }
  if (typeof patch.callsPerWeek === "number") s.callsPerWeek = Math.min(3, Math.max(1, Math.round(patch.callsPerWeek)));
  if (typeof patch.familyCallsEnabled === "boolean") {
    s.familyCallsEnabled = patch.familyCallsEnabled;
    if (patch.familyCallsEnabled && !device.familyCode) store.setFamilyCode(device.id, familyCode());
  }
  if (patch.consentedAt !== undefined && patch.consentedAt !== null && !s.consentedAt) s.consentedAt = store.now();
  store.saveSettings(device.id, s);
  // Schedule changes invalidate a planned (not yet ringing) scheduled call.
  if (patch.window || patch.scheduleEnabled !== undefined || patch.callsPerWeek || patch.timezone) {
    const pending = store.pendingCallFor(device.id);
    if (pending && pending.status === "scheduled" && pending.source === "schedule") store.updateCall(pending.id, { status: "cancelled" });
  }
  return meFor(store.getDevice(device.id)!);
});

app.delete("/api/me", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  store.deleteDevice(device.id);
  return reply.code(204).send();
});

function familyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
}

// ---- scenarios ----

app.get("/api/scenarios", async () => ({ scenarios, personas }));

// ---- calls ----

const DIFFICULTIES: Difficulty[] = ["clumsy", "competent", "expert"];

app.post("/api/calls", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  if (!device.settings.consentedAt) return fail(reply, 403, "Finish setup and consent before practice calls.");
  const body = (req.body ?? {}) as { scenarioId?: string; difficulty?: Difficulty };
  const scenarioId = body.scenarioId && getScenario(body.scenarioId) ? body.scenarioId : randomScenarioId(device.id);
  const difficulty = body.difficulty && DIFFICULTIES.includes(body.difficulty) ? body.difficulty : nextDifficulty(device.id);
  // Practice-now replaces any call that is already ringing.
  const ringing = store.ringingCallFor(device.id);
  if (ringing) store.updateCall(ringing.id, { status: "cancelled" });
  const call = store.createCall({ deviceId: device.id, scenarioId, difficulty, status: "ringing", source: "practice", ringAt: store.now() });
  return store.summarize(call);
});

app.get("/api/calls", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const calls = store.callsForDevice(device.id).filter((c) => !["scheduled", "cancelled"].includes(c.status));
  return { calls: calls.map(store.summarize) };
});

app.get("/api/calls/ringing", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const c = store.ringingCallFor(device.id);
  return { call: c ? store.summarize(c) : null };
});

function ownCall(req: FastifyRequest, reply: FastifyReply) {
  const device = auth(req, reply);
  if (!device) return null;
  const call = store.getCall((req.params as { id: string }).id);
  if (!call || call.deviceId !== device.id) {
    fail(reply, 404, "Call not found");
    return null;
  }
  return { device, call };
}

app.get("/api/calls/:id", async (req, reply) => {
  const r = ownCall(req, reply);
  if (!r) return;
  return store.detail(r.call);
});

app.post("/api/calls/:id/decline", async (req, reply) => {
  const r = ownCall(req, reply);
  if (!r) return;
  if (r.call.status === "ringing" || r.call.status === "scheduled") store.updateCall(r.call.id, { status: "declined" });
  return reply.code(204).send();
});

app.get("/api/calls/:id/debrief.wav", async (req, reply) => {
  const r = ownCall(req, reply);
  if (!r) return;
  const spoken = r.call.result?.debrief.spoken;
  if (!spoken) return fail(reply, 404, "No debrief yet");
  if (!(await speechAvailable())) return fail(reply, 503, "Speech service unavailable");
  const wav = await synthesize(spoken, "af_bella", { speed: 1.0 });
  return reply.header("content-type", "audio/wav").header("cache-control", "private, max-age=3600").send(wav);
});

app.register(async (scope) => {
  scope.get("/api/calls/:id/session", { websocket: true }, (socket, req) => {
    const device = store.deviceByToken(tokenOf(req));
    const call = store.getCall((req.params as { id: string }).id);
    if (!device || !call || call.deviceId !== device.id) {
      socket.close(4401, "unauthorized");
      return;
    }
    if (call.status !== "ringing") {
      socket.close(4409, "call is not ringing");
      return;
    }
    new CallSessionHandler(socket, call, device);
  });
});

// ---- push ----

app.get("/api/push/key", async () => ({ publicKey: vapidPublicKey }));

app.post("/api/push/subscribe", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const { subscription } = (req.body ?? {}) as { subscription?: { endpoint?: string } };
  if (!subscription?.endpoint || !/^https:\/\//.test(subscription.endpoint)) return fail(reply, 400, "Invalid subscription");
  store.savePushSub(device.id, subscription as { endpoint: string });
  return reply.code(204).send();
});

// ---- family: parent opts in on their own device, shares a code ----

app.get("/api/family/members", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  return { members: store.familyMembers(device.id) };
});

app.patch("/api/family/members/:memberId", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const { paused } = (req.body ?? {}) as { paused?: boolean };
  store.setLinkPaused(device.id, (req.params as { memberId: string }).memberId, !!paused);
  return reply.code(204).send();
});

app.delete("/api/family/members/:memberId", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  store.unlinkFamily(device.id, (req.params as { memberId: string }).memberId);
  return reply.code(204).send();
});

function parentView(parent: store.DeviceRow, memberId: string): FamilyParent {
  const link = store.familyLink(parent.id, memberId);
  const calls = store.callsForDevice(parent.id, 20);
  const pending = store.pendingCallFor(parent.id);
  const sentRecently = calls.some((c) => c.source === "family" && Date.now() - Date.parse(c.createdAt) < 86400000);
  let reason: string | null = null;
  if (!parent.settings.familyCallsEnabled) reason = `${parent.settings.displayName || "They"} turned family calls off.`;
  else if (link?.paused) reason = "Paused by them for now.";
  else if (pending) reason = "A practice call is already queued.";
  else if (sentRecently) reason = "One family call a day. Try again tomorrow.";
  else if (inFailureCooldown(parent)) reason = "Waiting for them to open the app after their last call.";
  return {
    deviceId: parent.id,
    name: parent.settings.displayName || "Family member",
    acceptsCalls: parent.settings.familyCallsEnabled && !link?.paused,
    // Family sees scores, never transcripts.
    recentScores: calls
      .filter((c) => c.score != null)
      .slice(0, 5)
      .map((c) => ({ scenarioTitle: getScenario(c.scenarioId)?.title ?? c.scenarioId, score: c.score!, at: c.startedAt ?? c.createdAt })),
    pendingCall: pending?.source === "family" ? { ringWindow: describeWindow(parent.settings.window) } : null,
    canSendNow: reason === null,
    reason,
  };
}

app.post("/api/family/link", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const { code, yourName } = (req.body ?? {}) as { code?: string; yourName?: string };
  const parent = code ? store.deviceByFamilyCode(code.trim()) : null;
  if (!parent || !parent.settings.familyCallsEnabled) return fail(reply, 404, "That family code didn't work. Ask them to check it in their Hang Up settings.");
  if (parent.id === device.id) return fail(reply, 400, "That's your own code.");
  const name = (yourName ?? device.settings.displayName).trim();
  if (!name) return fail(reply, 400, "Add your name so they know who sent the call.");
  store.linkFamily(parent.id, device.id, name);
  return { parent: parentView(parent, device.id) };
});

app.get("/api/family/parents", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const parents = store
    .familyParents(device.id)
    .map((l) => store.getDevice(l.parentId))
    .filter((p): p is store.DeviceRow => !!p)
    .map((p) => parentView(p, device.id));
  return { parents };
});

app.post("/api/family/parents/:parentId/calls", async (req, reply) => {
  const device = auth(req, reply);
  if (!device) return;
  const parent = store.getDevice((req.params as { parentId: string }).parentId);
  const link = parent ? store.familyLink(parent.id, device.id) : null;
  if (!parent || !link) return fail(reply, 404, "Not linked to this person.");
  const view = parentView(parent, device.id);
  if (!view.canSendNow) return fail(reply, 429, view.reason ?? "Can't send right now.");
  if (hadCallToday(parent)) return fail(reply, 429, "They already had a practice call today.");
  const { scenarioId } = (req.body ?? {}) as { scenarioId?: string };
  // Library scenarios only: family can pick a story but never write one.
  if (!scenarioId || !getScenario(scenarioId)) return fail(reply, 400, "Pick a scenario from the library.");
  const tz = safeTz(parent.settings.timezone);
  const ringAt = randomTimeInWindow(parent.settings.window, tz, new Date(Date.now() + 60_000));
  if (!ringAt) return fail(reply, 400, "They haven't set a call window.");
  store.createCall({
    deviceId: parent.id,
    scenarioId,
    difficulty: nextDifficulty(parent.id),
    status: "scheduled",
    source: "family",
    ringAt: ringAt.toISOString(),
    senderDeviceId: device.id,
    senderName: link.memberName,
  });
  return { ringWindow: describeWindow(parent.settings.window) };
});

// ---- optional: serve the built web app from the same origin ----

if (config.webDir && existsSync(config.webDir)) {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".ico": "image/x-icon",
  };
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return fail(reply, 404, "Not found");
    const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(config.webDir, path);
    if (!file.startsWith(config.webDir) || !existsSync(file) || path === "/") file = join(config.webDir, "index.html");
    return reply.type(types[extname(file)] ?? "application/octet-stream").send(readFileSync(file));
  });
}

startScheduler();
await app.listen({ port: config.port, host: config.host });
