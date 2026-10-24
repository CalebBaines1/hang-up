import { config } from "./config.ts";

// Nebius Token Factory exposes an OpenAI-compatible chat completions API.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOpts {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  signal?: AbortSignal;
}

function body(opts: ChatOpts, stream: boolean) {
  return JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 300,
    temperature: opts.temperature ?? 0.8,
    stream,
    ...(opts.thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });
}

const RETRY_DELAYS_MS = [600, 2000];

/** Retries 429s and 5xx (Token Factory returns an occasional 503 under load). */
async function post(opts: ChatOpts, stream: boolean) {
  if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.nebiusBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.nebiusApiKey}`, "content-type": "application/json" },
      body: body(opts, stream),
      signal: opts.signal,
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    const text = (await res.text()).slice(0, 300);
    if (!retryable || attempt >= RETRY_DELAYS_MS.length || opts.signal?.aborted) throw new Error(`Token Factory ${res.status}: ${text}`);
    console.warn(`Token Factory ${res.status}, retrying`);
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

/** Streams content tokens (reasoning tokens are skipped). */
export async function* chatStream(opts: ChatOpts): AsyncGenerator<string> {
  const res = await post(opts, true);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {}
    }
  }
}

/** Streams under the hood: a long reasoning call held open with no bytes can be
 * cut off by a gateway, while a stream keeps the connection busy. */
export async function chat(opts: ChatOpts): Promise<string> {
  let out = "";
  for await (const delta of chatStream(opts)) out += delta;
  return out;
}

/** Pulls the first JSON object out of a model reply. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON in model reply");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
