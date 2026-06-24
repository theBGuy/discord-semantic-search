import { config } from "./config";
import { logger } from "./logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Endpoint {
  url: string;
  key?: string;
  label: string;
}

const localEndpoint: Endpoint = {
  url: config.OLLAMA_BASE_URL,
  key: config.OLLAMA_API_KEY,
  label: "local",
};
const cloudEndpoint: Endpoint | null = config.OLLAMA_CLOUD_URL
  ? { url: config.OLLAMA_CLOUD_URL, key: config.OLLAMA_CLOUD_API_KEY, label: "cloud" }
  : null;

/** When the cloud endpoint hits a session limit we stop using it until this time. */
let cloudDisabledUntil = 0;

class OllamaError extends Error {}
class RateLimitError extends Error {}

function headers(ep: Endpoint): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ep.key) h.Authorization = `Bearer ${ep.key}`;
  return h;
}

/** Single request to a specific endpoint, with timeout + bounded retry. Throws
 * RateLimitError on 429 (session/rate limit) so callers can fail over. */
async function request<T>(
  ep: Endpoint,
  path: string,
  body: unknown | undefined,
  retries = 3,
): Promise<T> {
  const url = `${ep.url.replace(/\/$/, "")}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.OLLAMA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: headers(ep),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 429) throw new RateLimitError(`Ollama ${ep.label} ${path} -> 429`);
        if (res.status < 500) {
          throw new OllamaError(
            `Ollama ${ep.label} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
          );
        }
        throw new Error(`Ollama ${ep.label} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof OllamaError || err instanceof RateLimitError) throw err;
      if (attempt < retries) {
        const delay = 500 * 2 ** attempt;
        logger.warn(
          { path, attempt, delay, endpoint: ep.label },
          "ollama request failed, retrying",
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** The endpoint chat should use right now: cloud unless it's in cooldown. */
function chatEndpoint(): Endpoint {
  if (cloudEndpoint && Date.now() >= cloudDisabledUntil) return cloudEndpoint;
  return localEndpoint;
}

// ── Embeddings (always local) ────────────────────────────────────────────────

interface EmbedResponse {
  embeddings: number[][];
}

export async function embed(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const data = await request<EmbedResponse>(localEndpoint, "/api/embed", {
    model: config.EMBED_MODEL,
    input: inputs,
    truncate: true,
  });
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
    throw new Error(
      `Ollama embed returned ${data.embeddings?.length ?? 0} vectors for ${inputs.length} inputs`,
    );
  }
  return data.embeddings;
}

export async function embedOne(input: string): Promise<number[]> {
  const [vec] = await embed([input]);
  if (!vec) throw new Error("Ollama embed returned no vector");
  return vec;
}

// ── Chat (cloud primary → local fallback) ────────────────────────────────────

interface ChatResponse {
  message?: { role: string; content?: string; thinking?: string };
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
}

function readChatContent(data: ChatResponse, model: string): string {
  const content = (data.message?.content ?? "").trim();
  if (!content) {
    logger.warn(
      {
        model,
        doneReason: data.done_reason,
        evalCount: data.eval_count,
        promptEvalCount: data.prompt_eval_count,
        hasThinking: Boolean(data.message?.thinking),
      },
      "chat returned empty content",
    );
  }
  return content;
}

function mkChatBody(model: string, messages: ChatMessage[]) {
  return { model, messages, stream: false, keep_alive: -1, options: { num_ctx: config.NUM_CTX } };
}

/** Non-streaming chat completion. Uses the cloud endpoint (with the primary `model`)
 * when available; on a session limit it switches to local (with `localModel`) and
 * parks the cloud endpoint for a cooldown. With no cloud configured, runs the primary
 * model locally. */
export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; localModel?: string } = {},
): Promise<string> {
  const cloudModel = opts.model ?? config.CHAT_MODEL;
  const localModel = opts.localModel ?? cloudModel;
  // Model for a given endpoint: cloud → cloudModel; local → localModel only when a
  // cloud endpoint exists (i.e. local is a fallback), otherwise the primary model.
  const modelFor = (ep: Endpoint) =>
    ep === cloudEndpoint ? cloudModel : cloudEndpoint ? localModel : cloudModel;

  const primary = chatEndpoint();
  try {
    const m = modelFor(primary);
    return readChatContent(
      await request<ChatResponse>(primary, "/api/chat", mkChatBody(m, messages)),
      m,
    );
  } catch (err) {
    if (err instanceof RateLimitError && primary === cloudEndpoint) {
      cloudDisabledUntil = Date.now() + config.OLLAMA_CLOUD_COOLDOWN_MS;
      logger.warn(
        { cooldownMs: config.OLLAMA_CLOUD_COOLDOWN_MS, localModel },
        "cloud Ollama session limit hit — falling back to local",
      );
      return readChatContent(
        await request<ChatResponse>(localEndpoint, "/api/chat", mkChatBody(localModel, messages)),
        localModel,
      );
    }
    throw err;
  }
}

// ── Introspection ────────────────────────────────────────────────────────────

/** Liveness probe against the local endpoint — does NOT load a model. */
export async function version(): Promise<string> {
  const data = await request<{ version: string }>(localEndpoint, "/api/version", undefined, 0);
  return data.version;
}

export function isCloudConfigured(): boolean {
  return cloudEndpoint !== null;
}

/** List model names from an endpoint: "cloud", "local", or "auto" (active chat
 * endpoint). Returns [] if the requested endpoint isn't configured. */
export async function listModels(scope: "auto" | "cloud" | "local" = "auto"): Promise<string[]> {
  const ep = scope === "cloud" ? cloudEndpoint : scope === "local" ? localEndpoint : chatEndpoint();
  if (!ep) return [];
  const data = await request<{ models?: { name: string }[] }>(ep, "/api/tags", undefined, 0);
  return (data.models ?? []).map((m) => m.name).sort();
}
