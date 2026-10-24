import { useEffect } from "react";
import type { CallSummary } from "@hangup/client";
import { startRingtone } from "../audio/tones.ts";
import { Handset, initials } from "../components.tsx";

export function Ringing({
  call,
  safeWord,
  onAnswer,
  onDecline,
}: {
  call: CallSummary;
  safeWord: string;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  useEffect(() => {
    let stop: (() => void) | null = null;
    try {
      stop = startRingtone();
    } catch {
      // Audio may be locked until the first tap; the screen still rings visually.
    }
    return () => stop?.();
  }, []);

  return (
    <div className="callscreen ringing">
      <div className="practice-pill">PRACTICE CALL · safe word “{safeWord}”</div>
      <div className="caller-head">
        <div className="avatar-lg">{initials(call.callerId)}</div>
        <div className="who">{call.callerId}</div>
        <div className="status">{call.senderName ? `mobile · sent by ${call.senderName}` : "mobile"}</div>
      </div>
      <div className="call-actions">
        <div>
          <button className="round red" onClick={onDecline} aria-label="Decline">
            <Handset size={34} color="#fff" rotate={135} />
          </button>
          <div className="round-label">Decline</div>
        </div>
        <div>
          <button className="round green" onClick={onAnswer} aria-label="Answer">
            <Handset size={34} color="#fff" />
          </button>
          <div className="round-label">Answer</div>
        </div>
      </div>
    </div>
  );
}
