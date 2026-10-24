import { useEffect, useState } from "react";
import type { FamilyMember, FamilyParent, Me, Scenario } from "@hangup/client";
import { api } from "../api.ts";
import { Handset, Sheet, Toggle, initials, relativeDay, scoreColor } from "../components.tsx";

export function Family({ me, scenarios, onMeChange }: { me: Me; scenarios: Scenario[]; onMeChange: (me: Me) => void }) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [parents, setParents] = useState<FamilyParent[]>([]);
  const [code, setCode] = useState("");
  const [yourName, setYourName] = useState(me.settings.displayName);
  const [sendTo, setSendTo] = useState<FamilyParent | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = () => {
    api.familyMembers().then((r) => setMembers(r.members)).catch(() => {});
    api.familyParents().then((r) => setParents(r.parents)).catch(() => {});
  };
  useEffect(load, []);

  const setOptIn = async (on: boolean) => {
    onMeChange(await api.updateSettings({ familyCallsEnabled: on }));
  };

  const link = async () => {
    try {
      const r = await api.linkFamily(code, yourName);
      setMsg({ text: `Linked with ${r.parent.name}.` });
      setCode("");
      load();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  const send = async (parent: FamilyParent, scenario: Scenario) => {
    setSendTo(null);
    try {
      const r = await api.sendFamilyCall(parent.deviceId, scenario.id);
      setMsg({ text: `Queued “${scenario.title}”. It will ring ${parent.name} at a random moment in their window (${r.ringWindow}).` });
      load();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  return (
    <div className="page">
      <div className="title">Family</div>
      <p className="subtitle">Send a parent a surprise practice call. They opt in on their own phone and stay in control.</p>
      {msg ? <div className={`notice ${msg.error ? "error" : ""}`}>{msg.text}</div> : null}

      <div className="kicker" style={{ margin: "8px 0 10px" }}>
        People you practice with
      </div>
      {parents.map((p) => (
        <div key={p.deviceId} className="card">
          <div className="row">
            <div className="avatar">{initials(p.name)}</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>{p.name}</h3>
              <p className="small">
                {p.recentScores.length ? `Last score ${p.recentScores[0].score} · ${relativeDay(p.recentScores[0].at)}` : "No practice calls yet"}
              </p>
            </div>
          </div>
          {p.recentScores.length ? (
            <div className="chips" style={{ marginTop: 12 }}>
              {p.recentScores.map((s, i) => (
                <span key={i} className="chip" style={{ color: scoreColor(s.score) }}>
                  {s.score} · {s.scenarioTitle}
                </span>
              ))}
            </div>
          ) : null}
          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!p.canSendNow} onClick={() => setSendTo(p)}>
            <Handset size={20} color="#0B1020" /> Send {p.name} a practice call
          </button>
          {p.reason ? <p className="small" style={{ marginTop: 8 }}>{p.pendingCall ? `Queued. It rings in their window (${p.pendingCall.ringWindow}).` : p.reason}</p> : null}
        </div>
      ))}

      <div className="card">
        <h3>Link with a family member</h3>
        <p className="small" style={{ marginBottom: 12 }}>
          Ask them to turn on “Let family send me practice calls” below on their phone and read you their code.
        </p>
        <div className="field">
          <label>Their family code</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. K7Q2MX" maxLength={6} autoCapitalize="characters" />
        </div>
        <div className="field">
          <label>Your name, as they'll see it</label>
          <input value={yourName} onChange={(e) => setYourName(e.target.value)} placeholder="e.g. Caleb" maxLength={40} />
        </div>
        <button className="btn btn-ghost" disabled={code.length < 6 || !yourName.trim()} onClick={link}>
          Link
        </button>
      </div>

      <div className="kicker" style={{ margin: "22px 0 10px" }}>
        Calls you receive
      </div>
      <div className="card">
        <div className="row spread">
          <div>
            <h3>Let family send me practice calls</h3>
            <p className="small">Calls ring at a random time in your window. One a day at most, from the scenario library only.</p>
          </div>
          <Toggle label="Let family send practice calls" on={me.settings.familyCallsEnabled} onChange={setOptIn} />
        </div>
        {me.settings.familyCallsEnabled && me.familyCode ? (
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <div className="muted small">Your family code</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.18em", color: "var(--brand)" }}>{me.familyCode}</div>
          </div>
        ) : null}
        {members.map((m) => (
          <div key={m.deviceId} className="row spread" style={{ marginTop: 14 }}>
            <div>
              <b>{m.name}</b>
              <div className="small muted">{m.paused ? "Paused" : "Can send you practice calls"} · sees your scores, never transcripts</div>
            </div>
            <div className="row">
              <button
                className="btn btn-ghost btn-small"
                onClick={async () => {
                  await api.setMemberPaused(m.deviceId, !m.paused);
                  load();
                }}
              >
                {m.paused ? "Resume" : "Pause"}
              </button>
              <button
                className="btn btn-danger btn-small"
                onClick={async () => {
                  await api.removeMember(m.deviceId);
                  load();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {sendTo ? (
        <Sheet onClose={() => setSendTo(null)}>
          <h2 style={{ margin: "0 0 4px" }}>Pick a scam for {sendTo.name}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            It rings at a random moment in their window, and the debrief tells them you sent it.
          </p>
          {scenarios.map((s) => (
            <button key={s.id} className="list-item" onClick={() => send(sendTo, s)}>
              <div className="grow">
                <div className="name">{s.title}</div>
                <div className="meta">{s.summary}</div>
              </div>
            </button>
          ))}
        </Sheet>
      ) : null}
    </div>
  );
}
