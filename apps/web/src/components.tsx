import { useEffect, useState, type ReactNode } from "react";

export function Handset({ size = 28, color = "currentColor", rotate = 0 }: { size?: number; color?: string; rotate?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden>
      <path
        fill={color}
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
      />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="row" style={{ gap: size * 0.35 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(135deg, var(--brand), var(--brand2))",
        }}
      >
        <Handset size={size * 0.62} color="#0B1020" rotate={135} />
      </div>
      <span style={{ fontWeight: 900, fontSize: size * 0.72, letterSpacing: "-0.03em" }}>Hang Up</span>
    </div>
  );
}

type IconName = "home" | "history" | "family" | "settings" | "mic" | "micOff" | "captions" | "shield" | "play" | "bell";

const ICONS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  history: "M12 3a9 9 0 1 1-8.5 6H6a7 7 0 1 0 1.6-2.9L10 8.5H3v-7l2.2 2.2A9 9 0 0 1 12 3zm-1 4h2v5.2l3.6 2.1-1 1.7L11 13.4z",
  family:
    "M8 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm8.5 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM2 19c0-3.3 2.7-6 6-6s6 2.7 6 6v1H2zm13.2 1v-1c0-1.9-.7-3.6-1.9-4.9A5 5 0 0 1 22 18.5V20z",
  settings:
    "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.3 2h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.8v1.8l2 1.8-1.7 2.9-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-2.9 2-1.8v-1.8l-2-1.8 1.7-2.9 2.5.9 1.6-.9z",
  mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z",
  micOff:
    "M19 11a7 7 0 0 1-1.3 4.1l-1.5-1.5A5 5 0 0 0 17 11zm-4-.2-6-6V5a3 3 0 1 1 6 0zM3.3 2.3 21.7 20.7l-1.4 1.4-4.2-4.2a7 7 0 0 1-3.1 1V22h-2v-3.1A7 7 0 0 1 5 12h2a5 5 0 0 0 7.6 4.3L13 14.7A3 3 0 0 1 9 12v-1.6L1.9 3.7z",
  captions: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 5v4h5v-1.5H7.5v-1H11V10zm7 0v4h5v-1.5h-3.5v-1H18V10z",
  shield: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10z",
  play: "M8 5v14l11-7z",
  bell: "M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z",
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d={ICONS[name]} />
    </svg>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function scoreColor(score: number) {
  return score >= 80 ? "var(--safe)" : score >= 50 ? "var(--brand)" : "var(--danger)";
}

export function ScoreRing({ score, size = 168 }: { score: number; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  return (
    <svg className="score-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#ffffff14" strokeWidth={12} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={scoreColor(score)}
        strokeWidth={12}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#F4F6FB" fontSize={size * 0.3} fontWeight={800}>
        {shown}
      </text>
    </svg>
  );
}

export function initials(label: string) {
  const clean = label.replace(/[^\p{L}\s]/gu, "").trim();
  if (!clean) return "?";
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function formatDuration(ms: number | null) {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function relativeDay(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
