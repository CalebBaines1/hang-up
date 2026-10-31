import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

if (config.dbPath !== ":memory:") mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL,
  family_code TEXT UNIQUE,
  last_open_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  sender_device_id TEXT,
  sender_name TEXT,
  ring_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  end_reason TEXT,
  transcript TEXT,
  result TEXT,
  score INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_device ON calls(device_id, created_at);
CREATE INDEX IF NOT EXISTS calls_ring ON calls(status, ring_at);

CREATE TABLE IF NOT EXISTS family_links (
  parent_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  member_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_device_id, member_device_id)
);

CREATE TABLE IF NOT EXISTS push_subs (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL PRIMARY KEY,
  sub TEXT NOT NULL
);
`);

// Migrations for databases created before a column existed.
const callColumns = new Set((db.prepare("PRAGMA table_info(calls)").all() as { name: string }[]).map((c) => c.name));
if (!callColumns.has("via")) db.exec("ALTER TABLE calls ADD COLUMN via TEXT NOT NULL DEFAULT 'app'");

export function getMeta(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}
export function setMeta(key: string, value: string) {
  db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
