import { useEffect, useState } from "react";
import type { CallSummary } from "@hangup/client";
import { api } from "../api.ts";
import { formatDuration, initials, relativeDay, scoreColor } from "../components.tsx";

const LABEL: Partial<Record<CallSummary["status"], string>> = {
  missed: "Missed",
  declined: "Declined",
  ringing: "Ringing",
  active: "In progress",
  ended: "Scoring…",
};

/** Declining a surprise call is a good habit, so it shows as screened, not as a miss. */
function statusLabel(c: CallSummary) {
  if (c.status === "scored") return c.endReason === "disconnected" ? "Dropped" : "No score";
  if (c.status === "declined" && c.source !== "practice") return "Screened";
  return LABEL[c.status] ?? "";
}

export function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);

  useEffect(() => {
    api.history().then((r) => setCalls(r.calls)).catch(() => setCalls([]));
  }, []);

  return (
    <div className="page">
      <div className="title">History</div>
      <p className="subtitle">Every call, its score and the coach's notes.</p>
      {calls === null ? <div className="spinner" /> : null}
      {calls?.length === 0 ? (
        <div className="card">
          <h3>No calls yet</h3>
          <p>Tap “Ring me now” on the home screen for your first practice call.</p>
        </div>
      ) : null}
      {calls?.map((c) => {
        const openable = c.status === "scored" || c.status === "ended";
        return (
          <button key={c.id} className="list-item" disabled={!openable} onClick={() => openable && onOpen(c.id)}>
            <div className="avatar">{initials(c.callerId)}</div>
            <div className="grow">
              <div className="name">{c.scenarioTitle}</div>
              <div className="meta">
                {relativeDay(c.startedAt ?? c.ringAt)} · {c.difficulty}
                {c.durationMs ? ` · ${formatDuration(c.durationMs)}` : ""}
                {c.senderName ? ` · from ${c.senderName}` : ""}
              </div>
            </div>
            {c.score != null ? (
              <div className="score-pill" style={{ color: scoreColor(c.score), background: "#ffffff0c" }}>
                {c.score}
              </div>
            ) : (
              <span className="muted small">{statusLabel(c)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
