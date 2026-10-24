import { useState } from "react";
import type { Me, Settings as S } from "@hangup/client";
import { api, getPrefs, setPrefs, type Prefs } from "../api.ts";
import { Toggle } from "../components.tsx";
import { enablePush, isIos, isStandalone, pushSupported } from "../push.ts";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function Settings({ me, onChange, onDeleted }: { me: Me; onChange: (me: Me) => void; onDeleted: () => void }) {
  const [s, setS] = useState<S>(me.settings);
  const [prefs, setP] = useState<Prefs>(getPrefs());
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pushState, setPushState] = useState<string | null>(
    pushSupported() && Notification.permission === "granted" ? "Notifications are on for this device." : null,
  );

  const save = async (patch: Partial<S>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      onChange(await api.updateSettings(patch));
      setMsg(null);
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  const updatePrefs = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setP(next);
    setPrefs(next);
  };

  const turnOnNotifications = async () => {
    if (isIos() && !isStandalone()) {
      setPushState("On iPhone, first add Hang Up to your Home Screen (Share → Add to Home Screen), then turn this on from there.");
      return;
    }
    const r = await enablePush().catch(() => "unsupported" as const);
    setPushState(
      r === "granted"
        ? "Notifications are on for this device."
        : r === "denied"
          ? "Notifications are blocked. Allow them in your browser settings."
          : "This browser can't receive call notifications. Calls will still ring while Hang Up is open.",
    );
  };

  return (
    <div className="page">
      <div className="title">Settings</div>
      <p className="subtitle">You choose when it rings and how to stop it.</p>
      {msg ? <div className={`notice ${msg.error ? "error" : ""}`}>{msg.text}</div> : null}

      <div className="card">
        <div className="field">
          <label>Your first name (scammers at higher levels will use it)</label>
          <input value={s.displayName} maxLength={40} onChange={(e) => setS({ ...s, displayName: e.target.value })} onBlur={() => save({ displayName: s.displayName })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Safe word: say it on any call to end it instantly</label>
          <input value={s.safeWord} maxLength={24} onChange={(e) => setS({ ...s, safeWord: e.target.value })} onBlur={() => save({ safeWord: s.safeWord })} />
        </div>
      </div>

      <div className="card">
        <div className="row spread">
          <div>
            <h3>Surprise calls</h3>
            <p className="small">Rings at a random moment inside your window.</p>
          </div>
          <Toggle
            label="Surprise calls"
            on={s.scheduleEnabled}
            onChange={(v) => save({ scheduleEnabled: v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          />
        </div>
        {s.scheduleEnabled ? (
          <div style={{ marginTop: 16 }}>
            <div className="field">
              <label>Days</label>
              <div className="chips">
                {DAYS.map((d, i) => (
                  <button
                    key={i}
                    className={`chip ${s.window.days.includes(i) ? "on" : ""}`}
                    style={{ width: 38, textAlign: "center", padding: "8px 0" }}
                    onClick={() => {
                      const days = s.window.days.includes(i) ? s.window.days.filter((x) => x !== i) : [...s.window.days, i];
                      save({ window: { ...s.window, days } });
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="row field">
              <div style={{ flex: 1 }}>
                <label>From</label>
                <input type="time" value={s.window.start} onChange={(e) => save({ window: { ...s.window, start: e.target.value } })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>To</label>
                <input type="time" value={s.window.end} onChange={(e) => save({ window: { ...s.window, end: e.target.value } })} />
              </div>
            </div>
            <div className="field">
              <label>Calls per week</label>
              <div className="chips">
                {[1, 2, 3].map((n) => (
                  <button key={n} className={`chip ${s.callsPerWeek === n ? "on" : ""}`} onClick={() => save({ callsPerWeek: n })}>
                    {n} a week
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-ghost" onClick={turnOnNotifications}>
              Ring this device even when the app is closed
            </button>
            {pushState ? <p className="small muted" style={{ marginTop: 10 }}>{pushState}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>Call voice</h3>
        <p className="small" style={{ marginBottom: 12 }}>
          {me.speech.server
            ? "Using NVIDIA Parakeet and Kokoro voices from the Hang Up speech server."
            : "The speech server is offline, so calls use your browser's built-in voice."}
        </p>
        <div className="chips">
          {(["auto", "server", "browser"] as const).map((v) => (
            <button key={v} className={`chip ${prefs.voice === v ? "on" : ""}`} onClick={() => updatePrefs({ voice: v })}>
              {v === "auto" ? "Automatic" : v === "server" ? "Speech server" : "Browser voice"}
            </button>
          ))}
        </div>
        <div className="row spread" style={{ marginTop: 14 }}>
          <span>Show live captions during calls</span>
          <Toggle label="Captions" on={prefs.captions} onChange={(v) => updatePrefs({ captions: v })} />
        </div>
      </div>

      <div className="card">
        <h3>Your data</h3>
        <p className="small" style={{ marginBottom: 12 }}>
          Call audio is never stored. Numbers you say are removed from transcripts before saving, and transcripts are deleted after 30 days. Nothing is used
          to train models.
        </p>
        {confirmDelete ? (
          <div className="stack">
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api.deleteMyData();
                onDeleted();
              }}
            >
              Yes, delete everything
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete my data
          </button>
        )}
      </div>
    </div>
  );
}
