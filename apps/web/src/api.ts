import { HangUpApi } from "@hangup/client";

const TOKEN_KEY = "hangup.token";
const PREFS_KEY = "hangup.prefs";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

let token = read(TOKEN_KEY);

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  write(TOKEN_KEY, t);
}

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || window.location.origin;

export const api = new HangUpApi({ baseUrl, getToken });

export interface Prefs {
  voice: "auto" | "server" | "browser";
  captions: boolean;
}
export function getPrefs(): Prefs {
  try {
    return { voice: "auto", captions: true, ...JSON.parse(read(PREFS_KEY) ?? "{}") };
  } catch {
    return { voice: "auto", captions: true };
  }
}
export function setPrefs(p: Prefs) {
  write(PREFS_KEY, JSON.stringify(p));
}
