import type {
  CallDetail,
  CallSummary,
  CallVia,
  Difficulty,
  FamilyMember,
  FamilyParent,
  Me,
  Persona,
  Scenario,
  Settings,
} from "./types.ts";

export interface ApiOptions {
  /** e.g. "https://api.hangup.app". No trailing slash. */
  baseUrl: string;
  /** Returns the device token, or null before registration. */
  getToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class HangUpApi {
  constructor(private opts: ApiOptions) {}

  get baseUrl() {
    return this.opts.baseUrl;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.opts.getToken();
    const f = this.opts.fetch ?? fetch;
    const res = await f(this.opts.baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {}
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  register(displayName?: string) {
    return this.req<{ deviceId: string; token: string }>("POST", "/api/devices", { displayName });
  }
  me() {
    return this.req<Me>("GET", "/api/me");
  }
  updateSettings(patch: Partial<Settings>) {
    return this.req<Me>("PATCH", "/api/me/settings", patch);
  }
  /** Tell the server the app was opened (clears the after-failure cool-down). */
  opened() {
    return this.req<void>("POST", "/api/me/opened");
  }
  deleteMyData() {
    return this.req<void>("DELETE", "/api/me");
  }

  catalog() {
    return this.req<{ scenarios: Scenario[]; personas: Persona[] }>("GET", "/api/scenarios");
  }

  /** Text a 6-digit code to this number (E.164, e.g. +15551234567). */
  startPhoneVerification(phone: string) {
    return this.req<void>("POST", "/api/me/phone", { phone });
  }
  /** Confirm the texted code. On success the number is saved and real phone calls are turned on. */
  confirmPhone(code: string) {
    return this.req<Me>("POST", "/api/me/phone/verify", { code });
  }
  removePhone() {
    return this.req<Me>("DELETE", "/api/me/phone");
  }

  /** "Practice now": creates a call that rings immediately (via "phone" dials the verified number). */
  practice(opts: { scenarioId?: string; difficulty?: Difficulty; via?: CallVia } = {}) {
    return this.req<CallSummary>("POST", "/api/calls", opts);
  }
  /** A scheduled or family call whose ring time has arrived, if any. */
  ringing() {
    return this.req<{ call: CallSummary | null }>("GET", "/api/calls/ringing");
  }
  decline(callId: string) {
    return this.req<void>("POST", `/api/calls/${callId}/decline`);
  }
  history() {
    return this.req<{ calls: CallSummary[] }>("GET", "/api/calls");
  }
  call(callId: string) {
    return this.req<CallDetail>("GET", `/api/calls/${callId}`);
  }
  /** URL of the coach's spoken debrief (WAV). Needs the token as a query param for <audio>. */
  async debriefAudioUrl(callId: string) {
    const token = await this.opts.getToken();
    return `${this.opts.baseUrl}/api/calls/${callId}/debrief.wav?token=${encodeURIComponent(token ?? "")}`;
  }

  pushKey() {
    return this.req<{ publicKey: string }>("GET", "/api/push/key");
  }
  subscribePush(subscription: unknown) {
    return this.req<void>("POST", "/api/push/subscribe", { subscription });
  }
  /** Native iPhone app: register the PushKit VoIP token so calls ring through CallKit. */
  registerVoip(token: string, sandbox: boolean) {
    return this.req<{ enabled: boolean }>("POST", "/api/push/voip", { token, sandbox });
  }

  // Family: the parent opts in and shares a code; the family member links with it.
  familyMembers() {
    return this.req<{ members: FamilyMember[] }>("GET", "/api/family/members");
  }
  setMemberPaused(deviceId: string, paused: boolean) {
    return this.req<void>("PATCH", `/api/family/members/${deviceId}`, { paused });
  }
  removeMember(deviceId: string) {
    return this.req<void>("DELETE", `/api/family/members/${deviceId}`);
  }
  linkFamily(code: string, yourName: string) {
    return this.req<{ parent: FamilyParent }>("POST", "/api/family/link", { code, yourName });
  }
  familyParents() {
    return this.req<{ parents: FamilyParent[] }>("GET", "/api/family/parents");
  }
  sendFamilyCall(parentDeviceId: string, scenarioId: string) {
    return this.req<{ ringWindow: string }>("POST", `/api/family/parents/${parentDeviceId}/calls`, { scenarioId });
  }

  /** WebSocket URL for a call session. */
  async sessionUrl(callId: string) {
    const token = await this.opts.getToken();
    const u = this.opts.baseUrl.replace(/^http/, "ws");
    return `${u}/api/calls/${callId}/session?token=${encodeURIComponent(token ?? "")}`;
  }
}
