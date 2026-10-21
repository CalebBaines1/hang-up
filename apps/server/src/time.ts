import type { ScheduleWindow } from "@hangup/client";

// Minimal timezone maths with Intl so the server needs no date library.

function partsIn(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday };
}

export function safeTz(tz: string | undefined) {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {}
  return "UTC";
}

/** UTC instant of a wall-clock time in a timezone. */
export function zonedToUtc(tz: string, y: number, m: number, d: number, h: number, min: number) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = partsIn(tz, new Date(guess));
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return new Date(guess - (asIfUtc - guess));
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * A random moment inside the user's window, on an allowed day, between
 * `notBefore` and the next `horizonDays` days. Null if the window is empty.
 */
export function randomTimeInWindow(
  win: ScheduleWindow,
  tz: string,
  notBefore: Date,
  horizonDays = 8,
  rand = Math.random,
): Date | null {
  const start = toMin(win.start);
  let end = toMin(win.end);
  if (end <= start) end = start + 60;
  const slots: { from: number; to: number }[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const day = new Date(notBefore.getTime() + i * 86400000);
    const p = partsIn(tz, day);
    if (!win.days.includes(p.weekday)) continue;
    const from = zonedToUtc(tz, p.y, p.m, p.d, Math.floor(start / 60), start % 60).getTime();
    const to = zonedToUtc(tz, p.y, p.m, p.d, Math.floor(end / 60), end % 60).getTime();
    const f = Math.max(from, notBefore.getTime());
    if (to > f) slots.push({ from: f, to });
  }
  if (!slots.length) return null;
  // Pick among the first few eligible days so calls stay roughly on schedule.
  const pick = slots[Math.floor(rand() * Math.min(slots.length, 3))];
  return new Date(pick.from + rand() * (pick.to - pick.from));
}

export function describeWindow(win: ScheduleWindow) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days =
    win.days.length === 7 ? "any day" : win.days.length === 5 && !win.days.includes(0) && !win.days.includes(6) ? "weekdays" : win.days.map((d) => names[d]).join(", ");
  return `${days}, ${win.start} to ${win.end}`;
}

export function localDayKey(tz: string, d: Date) {
  const p = partsIn(tz, d);
  return `${p.y}-${p.m}-${p.d}`;
}
