import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type CallSummary, type Difficulty, type Me, type Scenario } from "@hangup/client";
import { api, getPrefs, getToken, setToken } from "./api.ts";
import { audioContext } from "./audio/context.ts";
import { Icon } from "./components.tsx";
import { Debrief } from "./views/Debrief.tsx";
import { Family } from "./views/Family.tsx";
import { History } from "./views/History.tsx";
import { Home } from "./views/Home.tsx";
import { InCall } from "./views/InCall.tsx";
import { Onboarding } from "./views/Onboarding.tsx";
import { Ringing } from "./views/Ringing.tsx";
import { Settings } from "./views/Settings.tsx";

type Tab = "home" | "history" | "family" | "settings";
type Overlay = { kind: "ringing"; call: CallSummary } | { kind: "call"; call: CallSummary } | { kind: "debrief"; callId: string } | null;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(!getToken());
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<Overlay>(null);
  overlayRef.current = overlay;

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setNeedsOnboarding(true);
      } else setError("Can't reach Hang Up right now. Check your connection.");
    }
  }, []);

  const checkRinging = useCallback(async () => {
    if (overlayRef.current || !getToken()) return;
    try {
      const { call } = await api.ringing();
      if (call && !overlayRef.current) setOverlay({ kind: "ringing", call });
    } catch {}
  }, []);

  useEffect(() => {
    if (needsOnboarding) return;
    void refreshMe();
    api.opened().catch(() => {});
    api.catalog().then((c) => setScenarios(c.scenarios)).catch(() => {});
    void checkRinging();
    const poll = setInterval(() => document.visibilityState === "visible" && checkRinging(), 15000);
    const onVisible = () => document.visibilityState === "visible" && checkRinging();
    document.addEventListener("visibilitychange", onVisible);
    const onSw = (e: MessageEvent) => e.data?.type === "ring" && checkRinging();
    navigator.serviceWorker?.addEventListener("message", onSw);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onSw);
    };
  }, [needsOnboarding, refreshMe, checkRinging]);

  const practice = async (opts: { scenarioId?: string; difficulty?: Difficulty }) => {
    setBusy(true);
    setError(null);
    try {
      audioContext(); // unlock audio inside the tap
      const call = await api.practice(opts);
      // A short pause so it feels like a call arriving, not a button response.
      setTimeout(() => setOverlay({ kind: "ringing", call }), 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTimeout(() => setBusy(false), 1200);
    }
  };

  if (needsOnboarding)
    return (
      <div className="app">
        <Onboarding
          onDone={() => {
            setNeedsOnboarding(false);
          }}
        />
      </div>
    );

  if (!me)
    return (
      <div className="app">
        <div className="page" style={{ paddingTop: "40vh" }}>
          {error ? <div className="notice error">{error}</div> : <div className="spinner" />}
        </div>
      </div>
    );

  const scenarioOf = (id: string) => scenarios.find((s) => s.id === id);

  if (overlay?.kind === "ringing")
    return (
      <div className="app">
        <Ringing
          call={overlay.call}
          safeWord={me.settings.safeWord}
          onAnswer={() => {
            audioContext();
            setOverlay({ kind: "call", call: overlay.call });
          }}
          onDecline={() => {
            api.decline(overlay.call.id).catch(() => {});
            setOverlay(null);
          }}
        />
      </div>
    );

  if (overlay?.kind === "call")
    return (
      <div className="app">
        <InCall
          call={overlay.call}
          scenario={scenarioOf(overlay.call.scenarioId)}
          safeWord={me.settings.safeWord}
          serverSpeech={me.speech.server}
          prefs={getPrefs()}
          onEnded={() => setOverlay({ kind: "debrief", callId: overlay.call.id })}
        />
      </div>
    );

  if (overlay?.kind === "debrief")
    return (
      <div className="app">
        <Debrief
          callId={overlay.callId}
          serverSpeech={me.speech.server && getPrefs().voice !== "browser"}
          onClose={() => {
            setOverlay(null);
            void refreshMe();
          }}
          onReplay={(scenarioId, difficulty) => {
            setOverlay(null);
            void practice({ scenarioId, difficulty });
          }}
        />
      </div>
    );

  return (
    <div className="app">
      {error ? (
        <div style={{ padding: "16px 16px 0" }}>
          <div className="notice error">{error}</div>
        </div>
      ) : null}
      {tab === "home" ? <Home me={me} scenarios={scenarios} busy={busy} onPractice={practice} onOpenSettings={() => setTab("settings")} /> : null}
      {tab === "history" ? <History onOpen={(id) => setOverlay({ kind: "debrief", callId: id })} /> : null}
      {tab === "family" ? <Family me={me} scenarios={scenarios} onMeChange={setMe} /> : null}
      {tab === "settings" ? (
        <Settings
          me={me}
          onChange={setMe}
          onDeleted={() => {
            setToken(null);
            setMe(null);
            setNeedsOnboarding(true);
          }}
        />
      ) : null}
      <nav className="tabbar">
        {(
          [
            ["home", "Practice"],
            ["history", "History"],
            ["family", "Family"],
            ["settings", "Settings"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            <Icon name={id} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
