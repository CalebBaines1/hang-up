import { useEffect, useRef, useState } from "react";
import type { CallDetail, Difficulty } from "@hangup/client";
import { api } from "../api.ts";
import { BrowserSpeaker } from "../audio/browserSpeech.ts";
import { Icon, ScoreRing, formatDuration } from "../components.tsx";

const NEXT: Record<Difficulty, Difficulty> = { clumsy: "competent", competent: "expert", expert: "expert" };

function verdict(score: number) {
  if (score >= 80) return { title: "Scam stopped", sub: "You'd have kept your money." };
  if (score >= 50) return { title: "Close call", sub: "You held on, but a real scammer had openings." };
  return { title: "The scammer got through", sub: "That's what practice is for. Here's the tell." };
}

export function Debrief({
  callId,
  serverSpeech,
  onClose,
  onReplay,
}: {
  callId: string;
  serverSpeech: boolean;
  onClose: () => void;
  onReplay: (scenarioId: string, difficulty: Difficulty) => void;
}) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakerRef = useRef<BrowserSpeaker | null>(null);

  useEffect(() => {
    let stop = false;
    let tries = 0;
    const poll = async () => {
      try {
        const c = await api.call(callId);
        if (stop) return;
        if (c.status === "scored" || tries > 60) {
          setCall(c);
          return;
        }
      } catch {
        if (tries > 5) return setFailed(true);
      }
      tries++;
      setTimeout(poll, 1500);
    };
    poll();
    return () => {
      stop = true;
      audioRef.current?.pause();
      speakerRef.current?.stop();
    };
  }, [callId]);

  const playCoach = async () => {
    const spoken = call?.result?.debrief.spoken;
    if (!spoken) return;
    if (playing) {
      audioRef.current?.pause();
      speakerRef.current?.stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    if (serverSpeech) {
      try {
        const a = audioRef.current ?? new Audio();
        audioRef.current = a;
        a.src = await api.debriefAudioUrl(callId);
        a.onended = () => setPlaying(false);
        await a.play();
        return;
      } catch {
        // fall through to browser voice
      }
    }
    const sp = new BrowserSpeaker();
    speakerRef.current = sp;
    sp.onIdle = () => setPlaying(false);
    sp.say(spoken, { gender: "female", pitch: 1.0, rate: 1.0 });
  };

  // Try to start the coach automatically once the debrief is ready.
  useEffect(() => {
    if (call?.result) void playCoach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.result]);

  if (failed)
    return (
      <div className="page">
        <div className="notice error">Couldn't load this call.</div>
        <button className="btn btn-ghost" onClick={onClose}>
          Back
        </button>
      </div>
    );

  if (!call || call.status !== "scored")
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: "25vh" }}>
        <div className="spinner" />
        <div className="title" style={{ fontSize: 22 }}>
          Your coach is reviewing the call
        </div>
        <p className="subtitle">NVIDIA Nemotron is reading the transcript for the tells.</p>
      </div>
    );

  const r = call.result;
  const flags = new Map(r?.redFlags.map((f) => [f.turn, f.label]) ?? []);

  return (
    <div className="page">
      <div className="row spread">
        <div className="kicker">Debrief · {call.scenarioTitle}</div>
        <button className="muted small" onClick={onClose}>
          Done
        </button>
      </div>

      {call.senderName ? <div className="notice" style={{ marginTop: 12 }}>{call.senderName} sent you this practice call.</div> : null}

      {!r ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{call.endReason === "disconnected" ? "The call dropped" : "Practice call ended"}</h3>
          <p>
            {call.endReason === "safe_word"
              ? "You used your safe word, so there's no score. That's exactly what it's for."
              : call.endReason === "disconnected"
                ? "The connection dropped, so there's no score and it won't count against you. Try the call again."
                : "You ended the practice call, so there's no score this time."}
          </p>
        </div>
      ) : (
        <>
          <ScoreRing score={r.score} />
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div className="title" style={{ fontSize: 24, margin: 0 }}>
              {verdict(r.score).title}
            </div>
            <div className="muted">
              {verdict(r.score).sub} · {formatDuration(call.durationMs)} on the line
            </div>
          </div>

          <button className="btn btn-ghost" onClick={playCoach} style={{ marginBottom: 14 }}>
            <Icon name="play" /> {playing ? "Stop the coach" : "Hear your coach (30 sec)"}
          </button>

          {r.payloadWarning ? (
            <div className="notice error">
              It sounded like you read out a real card or account number. If it was real, call your bank on the number on your card.
            </div>
          ) : null}

          <div className="card">
            <div className="kicker" style={{ color: "var(--danger)" }}>
              The biggest tell
            </div>
            <h3 style={{ marginTop: 6 }}>{r.debrief.biggestTell}</h3>
            <p>{r.debrief.scam}</p>
          </div>
          <div className="card">
            <div className="kicker">Earliest moment to hang up</div>
            <p style={{ marginTop: 6, color: "var(--text)" }}>{r.debrief.earliestMoment}</p>
          </div>
          {r.debrief.beforePitch ? (
            <div className="card">
              <div className="kicker">What they were about to ask</div>
              <p style={{ marginTop: 6, color: "var(--text)" }}>{r.debrief.beforePitch}</p>
            </div>
          ) : null}
          <div className="card">
            <div className="kicker" style={{ color: "var(--safe)" }}>
              You did well
            </div>
            <p style={{ marginTop: 6, color: "var(--text)" }}>{r.debrief.didWell}</p>
          </div>
          <div className="card">
            <div className="kicker">Next time</div>
            <p style={{ marginTop: 6, color: "var(--text)" }}>{r.debrief.doDifferently}</p>
          </div>

          <div className="card">
            <h3>How the score adds up</h3>
            {r.signals.map((s) => (
              <div key={s.id} className={`signal ${s.hit ? "" : "miss"}`}>
                <span>{s.label}</span>
                <span className={`pts ${s.points > 0 ? "plus" : "minus"}`}>
                  {s.points > 0 ? "+" : ""}
                  {s.points}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn btn-ghost" onClick={() => setShowTranscript(!showTranscript)} style={{ marginBottom: 14 }}>
        {showTranscript ? "Hide transcript" : "Show transcript with red flags"}
      </button>

      {showTranscript ? (
        <div style={{ marginBottom: 14 }}>
          {call.transcript.length === 0 ? <p className="muted">Nothing was said.</p> : null}
          {call.transcript.map((l, i) => (
            <div key={i}>
              <div className={`tline ${l.role} ${flags.has(i) ? "flag" : ""}`}>
                <div className="who">
                  {l.role === "caller" ? call.callerId : "You"} · {formatDuration(l.t)}
                </div>
                {l.text}
                {flags.has(i) ? (
                  <div>
                    <span className="flag-label">⚑ {flags.get(i)}</span>
                  </div>
                ) : null}
              </div>
              {r?.earliestHangupTurn === i ? <div className="hangup-here">↑ You could have hung up here</div> : null}
            </div>
          ))}
          <p className="muted small">Numbers you said were removed before saving. Transcripts are deleted after 30 days.</p>
        </div>
      ) : null}

      <div className="stack">
        {!r && call.endReason === "disconnected" ? (
          <button className="btn btn-primary" onClick={() => onReplay(call.scenarioId, call.difficulty)}>
            Try the call again
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => onReplay(call.scenarioId, NEXT[call.difficulty])}>
            {call.difficulty === "expert" ? "Replay at expert level" : `Try it at ${NEXT[call.difficulty]} level`}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>

      {r ? (
        <div className="powered">
          Scored by <b>NVIDIA Nemotron</b> on <i>Nebius Token Factory</i>
        </div>
      ) : null}
    </div>
  );
}
