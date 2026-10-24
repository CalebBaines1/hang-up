import { useState } from "react";
import type { Difficulty, Me, Scenario } from "@hangup/client";
import { Handset, Logo, Sheet, scoreColor } from "../components.tsx";

const LEVELS: { id: Difficulty; label: string }[] = [
  { id: "clumsy", label: "Clumsy" },
  { id: "competent", label: "Competent" },
  { id: "expert", label: "Expert" },
];

function nextCallText(me: Me) {
  if (!me.nextCall) return null;
  if (me.nextCall.source === "family") return "A family member queued a practice call. It will ring inside your window.";
  const d = new Date(me.nextCall.ringAt);
  const day = d.toLocaleDateString([], { weekday: "long" });
  const h = d.getHours();
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return `Your next surprise call rings sometime ${day} ${part}.`;
}

export function Home({
  me,
  scenarios,
  busy,
  onPractice,
  onOpenSettings,
}: {
  me: Me;
  scenarios: Scenario[];
  busy: boolean;
  onPractice: (opts: { scenarioId?: string; difficulty?: Difficulty }) => void;
  onOpenSettings: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [level, setLevel] = useState<Difficulty>("competent");
  const name = me.settings.displayName;
  const next = nextCallText(me);

  return (
    <div className="page">
      <div className="row spread" style={{ marginBottom: 18 }}>
        <Logo size={30} />
      </div>

      <div className="title">{name ? `Hi ${name}.` : "Hi there."}</div>
      <p className="subtitle">Scammers call when you least expect it. Practice here, where it's safe.</p>

      <div className="practice-hero">
        <h2>Practice now</h2>
        <p>Your phone rings with a surprise scam call. Spot the tell and hang up.</p>
        <button className="btn btn-primary" disabled={busy} onClick={() => onPractice({})}>
          <Handset size={22} color="#0B1020" /> {busy ? "Dialing…" : "Ring me now"}
        </button>
        <button className="btn" style={{ marginTop: 8, fontWeight: 600, fontSize: 15 }} onClick={() => setPicking(true)}>
          Choose the scam and level
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{me.stats.calls}</b>
          <span>calls</span>
        </div>
        <div className="stat">
          <b style={{ color: me.stats.averageScore != null ? scoreColor(me.stats.averageScore) : undefined }}>{me.stats.averageScore ?? "–"}</b>
          <span>avg score</span>
        </div>
        <div className="stat">
          <b>{me.stats.streakDays}</b>
          <span>day streak</span>
        </div>
      </div>

      {me.settings.scheduleEnabled ? (
        next ? (
          <div className="card">
            <h3>Surprise calls are on</h3>
            <p>{next}</p>
          </div>
        ) : null
      ) : (
        <button className="card" style={{ width: "100%", textAlign: "left" }} onClick={onOpenSettings}>
          <h3>Get surprise calls</h3>
          <p>Real scams don't make appointments. Pick a window and Hang Up rings you at a random moment inside it.</p>
        </button>
      )}

      <div className="card">
        <h3>Always practice, never a real call</h3>
        <p>
          Calls happen inside this app only. Say “{me.settings.safeWord}” or tap the practice banner to end any call instantly.
        </p>
      </div>

      {picking ? (
        <Sheet onClose={() => setPicking(false)}>
          <h2 style={{ margin: "0 0 12px" }}>Pick a practice call</h2>
          <div className="field">
            <label>Difficulty</label>
            <div className="chips">
              {LEVELS.map((l) => (
                <button key={l.id} className={`chip ${level === l.id ? "on" : ""}`} onClick={() => setLevel(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {scenarios.map((s) => (
            <button
              key={s.id}
              className="list-item"
              onClick={() => {
                setPicking(false);
                onPractice({ scenarioId: s.id, difficulty: level });
              }}
            >
              <div className="grow">
                <div className="name">{s.title}</div>
                <div className="meta">{s.summary}</div>
              </div>
              <Handset size={20} color="var(--safe)" />
            </button>
          ))}
        </Sheet>
      ) : null}
    </div>
  );
}
