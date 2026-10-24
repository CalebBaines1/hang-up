// One shared AudioContext, created (and unlocked) from a user gesture such as
// tapping "Answer", which iOS Safari requires before any sound can play.
let ctx: AudioContext | null = null;

export function audioContext() {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
