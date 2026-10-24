import { useState } from "react";
import { api, setToken } from "../api.ts";
import { Mic } from "../audio/mic.ts";
import { Logo, Toggle } from "../components.tsx";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [safeWord, setSafeWord] = useState("pineapple");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await api.register(name);
      setToken(reg.token);
      await api.updateSettings({
        displayName: name,
        safeWord,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        consentedAt: new Date().toISOString(),
      });
      try {
        await Mic.requestPermission();
      } catch {
        // They can allow the mic on the first call instead.
      }
      onDone();
    } catch (e) {
      setToken(null);
      setError((e as Error).message || "Couldn't reach Hang Up. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      <Logo size={32} />
      {step === 0 ? (
        <div style={{ marginTop: "8vh" }}>
          <div className="kicker">Scam call practice</div>
          <div className="title" style={{ fontSize: 36 }}>
            The best defense is hanging up.
          </div>
          <p className="subtitle" style={{ fontSize: 17 }}>
            Hang Up rings you with realistic AI scam calls: a fake bank, a grandchild in trouble, a tax warrant. Then a coach shows you the tell you
            missed, in thirty seconds.
          </p>
          <div className="card">
            <h3>How it works</h3>
            <p>1. You pick when it can ring and a safe word.</p>
            <p>2. Your phone rings. Answer it like a real call.</p>
            <p>3. Hang up when you spot the scam, then hear your debrief.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setStep(1)}>
            Get started
          </button>
        </div>
      ) : step === 1 ? (
        <div style={{ marginTop: "5vh" }}>
          <div className="kicker">Before we start</div>
          <div className="title">This is practice, and you're in control.</div>
          <div className="card">
            <h3>Never a real phone call</h3>
            <p>Calls ring inside this app only. Hang Up has no phone numbers and can't call anyone.</p>
          </div>
          <div className="card">
            <h3>An AI plays the scammer</h3>
            <p>
              Your voice is sent to our servers on Nebius to run the call (NVIDIA Parakeet hears you, Nemotron replies). Audio is never stored. Numbers you
              say are removed from the transcript, which is kept for your debrief and deleted after 30 days.
            </p>
          </div>
          <div className="card">
            <h3>Stop any call instantly</h3>
            <p>Say your safe word or tap the “This is practice” banner. No real brands, no cloned voices.</p>
          </div>
          <div className="row" style={{ margin: "18px 0" }}>
            <Toggle label="I understand" on={consent} onChange={setConsent} />
            <span style={{ lineHeight: 1.4 }}>I understand these calls are AI practice and agree to the call being processed for my debrief.</span>
          </div>
          <button className="btn btn-primary" disabled={!consent} onClick={() => setStep(2)}>
            Continue
          </button>
        </div>
      ) : (
        <div style={{ marginTop: "5vh" }}>
          <div className="kicker">Almost done</div>
          <div className="title">Set up your calls</div>
          <div className="field">
            <label>Your first name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="So the coach can talk to you" maxLength={40} autoFocus />
          </div>
          <div className="field">
            <label>Safe word: say it on any call to end it</label>
            <input value={safeWord} onChange={(e) => setSafeWord(e.target.value.replace(/\s/g, ""))} maxLength={24} />
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          <button className="btn btn-primary" disabled={busy || safeWord.length < 3} onClick={finish}>
            {busy ? "Setting up…" : "Allow microphone and start"}
          </button>
          <p className="muted small" style={{ textAlign: "center", marginTop: 12 }}>
            The microphone is only used during a practice call.
          </p>
        </div>
      )}
    </div>
  );
}
