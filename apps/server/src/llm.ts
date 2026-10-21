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

async function post(opts: ChatOpts, stream: boolean) {
  if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not set");
  const res = await fetch(`${config.nebiusBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.nebiusApiKey}`, "content-type": "application/json" },
    body: body(opts, stream),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
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

export async function chat(opts: ChatOpts): Promise<string> {
  const res = await post(opts, false);
  const json = (await res.json()) as { choices: { message: { content: string | null } }[] };
  return json.choices[0]?.message?.content ?? "";
}

/** Pulls the first JSON object out of a model reply. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON in model reply");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
