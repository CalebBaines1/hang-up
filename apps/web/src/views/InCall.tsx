import { useEffect, useRef, useState } from "react";
import { CallSession, type CallSummary, type EndReason, type Scenario, type SpeechMode } from "@hangup/client";
import { api, type Prefs } from "../api.ts";
import { BrowserListener, BrowserSpeaker, browserSpeechSupported } from "../audio/browserSpeech.ts";
import { Mic } from "../audio/mic.ts";
import { VoicePlayer } from "../audio/player.ts";
import { playHangupTone, startAmbience } from "../audio/tones.ts";
import { Handset, Icon, Sheet, formatDuration, initials } from "../components.tsx";

interface Caption {
  key: string;
  role: "caller" | "user";
  text: string;
}

/** Fraction of words in `a` that also appear in `b`; used to ignore our own speaker echo. */
function overlap(a: string, b: string) {
  const words = a.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!words.length) return 0;
  const set = new Set(b.toLowerCase().match(/[a-z']+/g) ?? []);
  return words.filter((w) => set.has(w)).length / words.length;
}

export function InCall({
  call,
  scenario,
  safeWord,
  serverSpeech,
  prefs,
  onEnded,
}: {
  call: CallSummary;
  scenario: Scenario | undefined;
  safeWord: string;
  serverSpeech: boolean;
  prefs: Prefs;
  onEnded: (reason: EndReason) => void;
}) {
  const [status, setStatus] = useState("Connecting…");
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [showCaptions, setShowCaptions] = useState(prefs.captions);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const micRef = useRef<Mic | null>(null);
  const listenerRef = useRef<BrowserListener | null>(null);
  const finishRef = useRef<(reason: EndReason) => void>(() => {});
  const capsEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let started = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopAmbience: (() => void) | null = null;
    let callerSaying = "";
    let lastCallerLine = "";
    let callerQuietAt = 0;
    const player = new VoicePlayer();
    const speaker = new BrowserSpeaker();

    const wanted: SpeechMode = prefs.voice === "browser" ? "browser" : prefs.voice === "server" ? "server" : serverSpeech ? "server" : "browser";

    const cleanup = () => {
      if (timer) clearInterval(timer);
      stopAmbience?.();
      player.stop();
      speaker.stop();
      micRef.current?.stop();
      listenerRef.current?.stop();
    };

    const finish = (reason: EndReason) => {
      if (finished) return;
      finished = true;
      cleanup();
      playHangupTone();
      setTimeout(() => sessionRef.current?.close(), 400);
      onEnded(reason);
    };
    finishRef.current = finish;

    const callerIdle = () => {
      callerQuietAt = Date.now();
      listenerRef.current?.resume();
      if (micRef.current) micRef.current.callerTalking = false;
      setStatus("");
    };
    player.onIdle = callerIdle;
    speaker.onIdle = callerIdle;

    const bargeIn = () => {
      if (player.playing || speaker.speaking) {
        player.stop();
        speaker.stop();
        sessionRef.current?.bargeIn();
      }
    };

    (async () => {
      if (wanted === "browser" && !browserSpeechSupported()) {
        setError("This browser can't run the call's voice. Open Hang Up in Chrome or Safari, or turn on the speech server.");
        return;
      }
      const url = await api.sessionUrl(call.id);
      if (cancelled) return;
      const session = new CallSession(url, wanted);
      sessionRef.current = session;

      session.on("ready", async (m) => {
        started = Date.now();
        timer = setInterval(() => setElapsed(Date.now() - started), 500);
        stopAmbience = startAmbience(scenario?.ambience ?? "quiet");
        setStatus("");
        try {
          if (m.speech === "server") {
            const mic = new Mic({
              onSpeechStart: () => {
                bargeIn();
                session.send({ type: "utterance_start" });
              },
              onAudio: (pcm) => session.sendAudio(pcm),
              onSpeechEnd: () => session.send({ type: "utterance_end" }),
              onLevel: setLevel,
            });
            micRef.current = mic;
            await mic.start();
          } else {
            // Browser recognition hears the caller's voice through the speaker and
            // garbles it, so word matching can't tell echo from the user. Listen
            // only while the caller is quiet (no barge-in in this mode); the
            // listener is paused while the caller speaks.
            const echo = (text: string) => speaker.speaking || (Date.now() - callerQuietAt < 1500 && overlap(text, lastCallerLine) > 0.5);
            const listener = new BrowserListener(
              (text) => {
                if (echo(text)) return;
                session.sayText(text);
              },
              (interim) => {
                if (!echo(interim)) setLevel(0.6);
              },
            );
            listenerRef.current = listener;
            listener.start();
          }
        } catch {
          setError("Hang Up needs the microphone to hear you. Allow it in your browser settings and try again.");
        }
      });

      session.on("caller_audio", (m) => {
        if (micRef.current) micRef.current.callerTalking = true;
        player.enqueueWav(m.wav);
      });
      session.on("caller_say", (m) => {
        callerSaying += " " + m.text;
        listenerRef.current?.pause();
        speaker.say(m.text, m.voiceHint);
      });
      session.on("caller_text", (m) => {
        setCaptions((c) => {
          const key = `c${m.turn}`;
          const i = c.findIndex((x) => x.key === key);
          if (i >= 0) return c.map((x) => (x.key === key ? { ...x, text: m.text } : x));
          return [...c, { key, role: "caller", text: m.text }];
        });
      });
      session.on("caller_turn_end", () => {
        lastCallerLine = callerSaying;
        callerSaying = "";
      });
      session.on("user_text", (m) => {
        setCaptions((c) => [...c, { key: `u${Date.now()}`, role: "user", text: m.text }]);
      });
      session.on("thinking", () => setStatus(""));
      session.on("error", (m) => setError(m.message));
      session.on("ended", (m) => {
        if (!m.afterPlayback) return finish(m.reason);
        // Let the caller's last line finish before hanging up.
        const until = Date.now() + 15000;
        const wait = setInterval(() => {
          if ((!player.playing && !speaker.speaking) || Date.now() > until) {
            clearInterval(wait);
            finish(m.reason);
          }
        }, 200);
      });
      session.on("close", () => {
        if (!finished && started) finish("disconnected");
        else if (!started) setError("The call couldn't connect. Check your connection and try again.");
      });
      try {
        await session.ready();
      } catch {
        setError("The call couldn't connect. Check your connection and try again.");
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
      sessionRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    capsEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [captions]);

  const hangUp = () => {
    sessionRef.current?.hangUp();
    finishRef.current("hung_up");
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (micRef.current) micRef.current.muted = next;
    if (listenerRef.current) listenerRef.current.muted = next;
  };

  return (
    <div className="callscreen">
      <button className="practice-pill" onClick={() => setConfirmReveal(true)}>
        THIS IS PRACTICE · safe word “{safeWord}”
      </button>
      <div className="caller-head" style={{ marginTop: "5vh" }}>
        <div className="avatar-lg" style={{ width: 72, height: 72, fontSize: 28, marginBottom: 12 }}>
          {initials(call.callerId)}
        </div>
        <div className="who" style={{ fontSize: 28 }}>
          {call.callerId}
        </div>
        <div className="status">{status || formatDuration(elapsed)}</div>
        <div style={{ width: 80, margin: "10px auto 0", background: "#ffffff14", borderRadius: 2 }}>
          <div className="level" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </div>

      {error ? (
        <div className="notice error" style={{ marginTop: 24 }}>
          {error}
        </div>
      ) : null}

      <div className="captions" style={{ visibility: showCaptions ? "visible" : "hidden" }}>
        {captions.map((c) => (
          <div key={c.key} className={`cap ${c.role}`}>
            {c.text}
          </div>
        ))}
        <div ref={capsEnd} />
      </div>

      <div className="call-actions" style={{ marginTop: 16 }}>
        <div>
          <button className={`round grey ${muted ? "on" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            <Icon name={muted ? "micOff" : "mic"} size={30} />
          </button>
          <div className="round-label">{muted ? "Unmute" : "Mute"}</div>
        </div>
        <div>
          <button className="round red" onClick={hangUp} aria-label="Hang up">
            <Handset size={36} color="#fff" rotate={135} />
          </button>
          <div className="round-label">Hang up</div>
        </div>
        <div>
          <button className={`round grey ${showCaptions ? "on" : ""}`} onClick={() => setShowCaptions(!showCaptions)} aria-label="Captions">
            <Icon name="captions" size={30} />
          </button>
          <div className="round-label">Captions</div>
        </div>
      </div>

      {confirmReveal ? (
        <Sheet onClose={() => setConfirmReveal(false)}>
          <div className="kicker">This is practice</div>
          <h2 style={{ margin: "6px 0 8px" }}>This call is an AI simulation</h2>
          <p className="muted" style={{ lineHeight: 1.5, marginTop: 0 }}>
            Nobody real is on the line. You can keep practicing, or end the call now with no score. Saying “{safeWord}” does the same thing.
          </p>
          <div className="stack">
            <button className="btn btn-ghost" onClick={() => setConfirmReveal(false)}>
              Keep practicing
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                sessionRef.current?.revealPractice();
                finishRef.current("practice_reveal");
              }}
            >
              End practice call
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
