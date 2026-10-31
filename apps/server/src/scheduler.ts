import type { CallRow, DeviceRow } from "./store.ts";
import type { Difficulty } from "@hangup/client";
import { pushToDevice } from "./push.ts";
import { getScenario, scenarios } from "./scenarios.ts";
import { allDevices, callsByStatus, callsForDevice, createCall, pendingCallFor, purgeOldTranscripts, updateCall } from "./store.ts";
import { localDayKey, randomTimeInWindow, safeTz } from "./time.ts";

const RING_TIMEOUT_MS = 2 * 60 * 1000;

/** Next difficulty from the last three scores, so the trainer gets harder as you improve. */
export function nextDifficulty(deviceId: string): Difficulty {
  const scores = callsForDevice(deviceId, 10)
    .filter((c) => c.score != null)
    .slice(0, 3)
    .map((c) => c.score!);
  if (scores.length < 2) return "clumsy";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return avg >= 80 ? "expert" : avg >= 55 ? "competent" : "clumsy";
}

export function randomScenarioId(deviceId: string) {
  const recent = new Set(callsForDevice(deviceId, 3).map((c) => c.scenarioId));
  const pool = scenarios.filter((s) => !recent.has(s.id));
  return (pool.length ? pool : scenarios)[Math.floor(Math.random() * (pool.length || scenarios.length))].id;
}

/** A failed call pauses all calls until the user opens the app again. */
export function inFailureCooldown(device: DeviceRow) {
  const last = callsForDevice(device.id, 5).find((c) => c.status === "scored" && c.score != null);
  if (!last || !last.endedAt) return false;
  const failed = last.score! < 50 || last.endReason === "payload_given";
  return failed && (!device.lastOpenAt || device.lastOpenAt < last.endedAt);
}

/** At most one practice call per local day; a screened call counts. */
export function hadCallToday(device: DeviceRow, at = new Date()) {
  const tz = safeTz(device.settings.timezone);
  const today = localDayKey(tz, at);
  return callsForDevice(device.id, 5).some((c) => {
    const at = c.startedAt ?? (c.status === "declined" ? c.ringAt : null);
    return at && c.source !== "practice" && localDayKey(tz, new Date(at)) === today;
  });
}

function planScheduledCall(device: DeviceRow) {
  const s = device.settings;
  if (!s.scheduleEnabled || !s.consentedAt || pendingCallFor(device.id) || inFailureCooldown(device)) return;
  // A screened (declined) call uses up its slot like an answered one.
  const last = callsForDevice(device.id, 10).find((c) => c.source === "schedule" && (c.startedAt || c.status === "declined"));
  const lastAt = last ? (last.startedAt ?? last.ringAt) : null;
  const gapMs = (7 / Math.min(3, Math.max(1, s.callsPerWeek))) * 86400000 * 0.8;
  let notBefore = new Date(Math.max(Date.now() + 5 * 60_000, lastAt ? Date.parse(lastAt) + gapMs : 0));
  if (hadCallToday(device, notBefore)) notBefore = new Date(notBefore.getTime() + 12 * 3600_000);
  const ringAt = randomTimeInWindow(s.window, safeTz(s.timezone), notBefore);
  if (!ringAt) return;
  createCall({
    deviceId: device.id,
    scenarioId: randomScenarioId(device.id),
    difficulty: nextDifficulty(device.id),
    status: "scheduled",
    source: "schedule",
    ringAt: ringAt.toISOString(),
  });
}

export async function ring(call: CallRow) {
  updateCall(call.id, { status: "ringing" });
  const scenario = getScenario(call.scenarioId);
  await pushToDevice(call.deviceId, {
    title: scenario?.callerId ?? "Incoming call",
    body: call.senderName ? `Practice call from ${call.senderName} · Hang Up` : "Incoming practice call · Hang Up",
    callId: call.id,
    callerId: scenario?.callerId ?? "Unknown",
    senderName: call.senderName,
    url: `/?ring=${call.id}`,
  });
}

export async function tick() {
  const nowMs = Date.now();
  for (const c of callsByStatus("scheduled")) {
    if (c.ringAt && Date.parse(c.ringAt) <= nowMs) await ring(c);
  }
  for (const c of callsByStatus("ringing")) {
    if (c.ringAt && Date.parse(c.ringAt) < nowMs - RING_TIMEOUT_MS) updateCall(c.id, { status: "missed" });
  }
  for (const d of allDevices()) planScheduledCall(d);
  purgeOldTranscripts();
}

export function startScheduler(everyMs = 20_000) {
  const run = () => tick().catch((err) => console.error("scheduler", err));
  run();
  return setInterval(run, everyMs);
}
