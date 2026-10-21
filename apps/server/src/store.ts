import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CallDetail,
  CallResult,
  CallSource,
  CallStatus,
  CallSummary,
  Difficulty,
  EndReason,
  Settings,
  TranscriptLine,
} from "@hangup/client";
import { db } from "./db.ts";
import { getScenario } from "./scenarios.ts";

export const now = () => new Date().toISOString();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export const defaultSettings = (displayName = ""): Settings => ({
  displayName,
  safeWord: "pineapple",
  timezone: "UTC",
  scheduleEnabled: false,
  window: { days: [1, 2, 3, 4, 5], start: "18:00", end: "20:00" },
  callsPerWeek: 2,
  familyCallsEnabled: false,
  consentedAt: null,
});

export interface DeviceRow {
  id: string;
  settings: Settings;
  familyCode: string | null;
  lastOpenAt: string | null;
  createdAt: string;
}

function toDevice(r: any): DeviceRow {
  return {
    id: r.id,
    settings: { ...defaultSettings(), ...JSON.parse(r.settings) },
    familyCode: r.family_code,
    lastOpenAt: r.last_open_at,
    createdAt: r.created_at,
  };
}

export function createDevice(displayName?: string) {
  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO devices(id, token_hash, settings, created_at, last_open_at) VALUES(?, ?, ?, ?, ?)").run(
    id,
    hash(token),
    JSON.stringify(defaultSettings(displayName?.slice(0, 40) ?? "")),
    now(),
    now(),
  );
  return { deviceId: id, token };
}

export function deviceByToken(token: string | undefined): DeviceRow | null {
  if (!token) return null;
  const r = db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hash(token));
  return r ? toDevice(r) : null;
}

export function getDevice(id: string): DeviceRow | null {
  const r = db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
  return r ? toDevice(r) : null;
}

export function allDevices(): DeviceRow[] {
  return db.prepare("SELECT * FROM devices").all().map(toDevice);
}

export function saveSettings(id: string, settings: Settings) {
  db.prepare("UPDATE devices SET settings = ? WHERE id = ?").run(JSON.stringify(settings), id);
}

export function markOpened(id: string) {
  db.prepare("UPDATE devices SET last_open_at = ? WHERE id = ?").run(now(), id);
}

export function setFamilyCode(id: string, code: string | null) {
  db.prepare("UPDATE devices SET family_code = ? WHERE id = ?").run(code, id);
}

export function deviceByFamilyCode(code: string): DeviceRow | null {
  const r = db.prepare("SELECT * FROM devices WHERE family_code = ?").get(code.toUpperCase());
  return r ? toDevice(r) : null;
}

export function deleteDevice(id: string) {
  db.prepare("DELETE FROM devices WHERE id = ?").run(id);
}

// ---- calls ----

export interface CallRow {
  id: string;
  deviceId: string;
  scenarioId: string;
  difficulty: Difficulty;
  status: CallStatus;
  source: CallSource;
  senderDeviceId: string | null;
  senderName: string | null;
  ringAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endReason: EndReason | null;
  transcript: TranscriptLine[];
  result: CallResult | null;
  score: number | null;
  createdAt: string;
}

function toCall(r: any): CallRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    scenarioId: r.scenario_id,
    difficulty: r.difficulty,
    status: r.status,
    source: r.source,
    senderDeviceId: r.sender_device_id,
    senderName: r.sender_name,
    ringAt: r.ring_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    endReason: r.end_reason,
    transcript: r.transcript ? JSON.parse(r.transcript) : [],
    result: r.result ? JSON.parse(r.result) : null,
    score: r.score,
    createdAt: r.created_at,
  };
}

export function createCall(c: {
  deviceId: string;
  scenarioId: string;
  difficulty: Difficulty;
  status: CallStatus;
  source: CallSource;
  ringAt: string;
  senderDeviceId?: string;
  senderName?: string;
}): CallRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO calls(id, device_id, scenario_id, difficulty, status, source, sender_device_id, sender_name, ring_at, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, c.deviceId, c.scenarioId, c.difficulty, c.status, c.source, c.senderDeviceId ?? null, c.senderName ?? null, c.ringAt, now());
  return getCall(id)!;
}

export function getCall(id: string): CallRow | null {
  const r = db.prepare("SELECT * FROM calls WHERE id = ?").get(id);
  return r ? toCall(r) : null;
}

export function updateCall(id: string, patch: Partial<Pick<CallRow, "status" | "startedAt" | "endedAt" | "endReason" | "transcript" | "result" | "score" | "ringAt">>) {
  const cols: Record<string, string> = {
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    endReason: "end_reason",
    transcript: "transcript",
    result: "result",
    score: "score",
    ringAt: "ring_at",
  };
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${cols[k]} = ?`);
    vals.push(k === "transcript" || k === "result" ? (v == null ? null : JSON.stringify(v)) : (v ?? null));
  }
  if (!sets.length) return;
  db.prepare(`UPDATE calls SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function callsForDevice(deviceId: string, limit = 50): CallRow[] {
  return db.prepare("SELECT * FROM calls WHERE device_id = ? ORDER BY COALESCE(started_at, ring_at, created_at) DESC LIMIT ?").all(deviceId, limit).map(toCall);
}

export function callsByStatus(status: CallStatus): CallRow[] {
  return db.prepare("SELECT * FROM calls WHERE status = ?").all(status).map(toCall);
}

export function pendingCallFor(deviceId: string): CallRow | null {
  const r = db.prepare("SELECT * FROM calls WHERE device_id = ? AND status IN ('scheduled', 'ringing') ORDER BY ring_at LIMIT 1").get(deviceId);
  return r ? toCall(r) : null;
}

export function summarize(c: CallRow): CallSummary {
  const s = getScenario(c.scenarioId);
  return {
    id: c.id,
    scenarioId: c.scenarioId,
    scenarioTitle: s?.title ?? c.scenarioId,
    callerId: s?.callerId ?? "Unknown",
    difficulty: c.difficulty,
    status: c.status,
    source: c.source,
    senderName: c.senderName,
    ringAt: c.ringAt,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    endReason: c.endReason,
    score: c.score,
    durationMs: c.startedAt && c.endedAt ? Date.parse(c.endedAt) - Date.parse(c.startedAt) : null,
  };
}

export function detail(c: CallRow): CallDetail {
  return { ...summarize(c), transcript: c.transcript, result: c.result };
}

// ---- family ----

export function linkFamily(parentId: string, memberId: string, memberName: string) {
  db.prepare(
    `INSERT INTO family_links(parent_device_id, member_device_id, member_name, created_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(parent_device_id, member_device_id) DO UPDATE SET member_name = excluded.member_name`,
  ).run(parentId, memberId, memberName.slice(0, 40), now());
}

export function familyMembers(parentId: string) {
  return db
    .prepare("SELECT * FROM family_links WHERE parent_device_id = ? ORDER BY created_at")
    .all(parentId)
    .map((r: any) => ({ deviceId: r.member_device_id as string, name: r.member_name as string, linkedAt: r.created_at as string, paused: !!r.paused }));
}

export function familyParents(memberId: string) {
  return db
    .prepare("SELECT * FROM family_links WHERE member_device_id = ? ORDER BY created_at")
    .all(memberId)
    .map((r: any) => ({ parentId: r.parent_device_id as string, memberName: r.member_name as string, paused: !!r.paused }));
}

export function familyLink(parentId: string, memberId: string) {
  const r: any = db.prepare("SELECT * FROM family_links WHERE parent_device_id = ? AND member_device_id = ?").get(parentId, memberId);
  return r ? { memberName: r.member_name as string, paused: !!r.paused } : null;
}

export function setLinkPaused(parentId: string, memberId: string, paused: boolean) {
  db.prepare("UPDATE family_links SET paused = ? WHERE parent_device_id = ? AND member_device_id = ?").run(paused ? 1 : 0, parentId, memberId);
}

export function unlinkFamily(parentId: string, memberId: string) {
  db.prepare("DELETE FROM family_links WHERE parent_device_id = ? AND member_device_id = ?").run(parentId, memberId);
}

// ---- push ----

export function savePushSub(deviceId: string, sub: { endpoint: string }) {
  db.prepare("INSERT INTO push_subs(device_id, endpoint, sub) VALUES(?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET device_id = excluded.device_id, sub = excluded.sub").run(
    deviceId,
    sub.endpoint,
    JSON.stringify(sub),
  );
}

export function pushSubs(deviceId: string): { endpoint: string; sub: any }[] {
  return db
    .prepare("SELECT * FROM push_subs WHERE device_id = ?")
    .all(deviceId)
    .map((r: any) => ({ endpoint: r.endpoint, sub: JSON.parse(r.sub) }));
}

export function deletePushSub(endpoint: string) {
  db.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(endpoint);
}
