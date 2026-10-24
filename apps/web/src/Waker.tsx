import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { Logo } from "./components.tsx";

// When the web app is hosted apart from the API (Vercel in front of a Nebius
// VM that powers off when idle), make sure the API is up before showing the app.
const separateApi = new URL(api.baseUrl).origin !== window.location.origin;

async function healthy() {
  try {
    const res = await fetch(`${api.baseUrl}/api/health`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function Waker({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "waking" | "up" | "failed">(separateApi ? "checking" : "up");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!separateApi) return;
    let stop = false;
    (async () => {
      if (await healthy()) return setState("up");
      setState("waking");
      const started = Date.now();
      const tick = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
      try {
        await fetch("/api/wake", { method: "POST" });
      } catch {}
      while (!stop && Date.now() - started < 4 * 60_000) {
        await new Promise((r) => setTimeout(r, 4000));
        if (await healthy()) {
          clearInterval(tick);
          return setState("up");
        }
        // Keep nudging in case the VM was still stopping when we first asked.
        if (Date.now() - started > 30_000) fetch("/api/wake", { method: "POST" }).catch(() => {});
      }
      clearInterval(tick);
      if (!stop) setState("failed");
    })();
    return () => {
      stop = true;
    };
  }, []);

  if (state === "up") return <>{children}</>;
  return (
    <div className="app">
      <div className="page" style={{ paddingTop: "28vh", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Logo size={34} />
        </div>
        {state === "failed" ? (
          <>
            <div className="title" style={{ fontSize: 22, marginTop: 30 }}>
              The call line didn't start
            </div>
            <p className="subtitle">Try again in a minute.</p>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="spinner" />
            <div className="title" style={{ fontSize: 22 }}>
              {state === "checking" ? "Connecting…" : "Waking up the call line"}
            </div>
            {state === "waking" ? (
              <p className="subtitle">
                Hang Up sleeps when nobody's practicing, to save energy. This takes about a minute.
                {seconds > 0 ? ` (${seconds}s)` : ""}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
