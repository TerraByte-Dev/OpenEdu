import { fetch } from "@tauri-apps/plugin-http";
import type { LLMConfig, ModelTier } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Strip trailing slashes so we never build double-slash paths like /api//tags
function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

// Small Ollama models often emit raw LaTeX (\alpha, \frac, \pi, \sum, ...) inside
// JSON string values without doubling the backslash. JSON.parse rejects those as
// "Bad escaped character", and even when grammar-constrained sampling lets them
// through, \t / \b / \n get silently decoded into control characters that corrupt
// stored content. Double any backslash that isn't followed by a valid JSON escape.
export function sanitizeJsonEscapes(s: string): string {
  return s.replace(/\\(?!["\\\/bfnrtu])/g, "\\\\");
}

// Try JSON.parse, with a stray-backslash repair retry as a fallback.
function tryParseJsonLenient(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return JSON.parse(sanitizeJsonEscapes(raw)); }
}

// ─── Logger ──────────────────────────────────────────────────────────────────
// Structured debug log — visible in Tauri's DevTools console and tagged clearly.
export const log = {
  info:  (tag: string, msg: string, data?: unknown) => console.log(`[OpenEdu:${tag}]`, msg, data ?? ""),
  warn:  (tag: string, msg: string, data?: unknown) => console.warn(`[OpenEdu:${tag}]`, msg, data ?? ""),
  error: (tag: string, msg: string, data?: unknown) => console.error(`[OpenEdu:${tag}]`, msg, data ?? ""),
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatPayload {
  messages: Array<{ role: string; content: string }>;
  config: LLMConfig;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}

// ─── Public: streaming chat ───────────────────────────────────────────────────
export async function streamChat({ messages, config, onToken, onDone, onError, signal }: ChatPayload) {
  log.info("streamChat", `provider=${config.provider} model=${config.model} msgs=${messages.length}`);
  try {
    if (config.provider === "ollama") {
      await streamOllama(messages, config, onToken, onDone, onError, signal);
    } else if (config.provider === "openai") {
      await streamOpenAI(messages, config, onToken, onDone, onError, signal);
    } else if (config.provider === "anthropic") {
      await streamAnthropic(messages, config, onToken, onDone, onError, signal);
    } else {
      onError(`Unknown provider "${config.provider}" — check Settings.`);
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return; // user cancelled
    const msg = networkAwareMessage(e);
    log.error("streamChat", "Unhandled exception", e);
    onError(msg);
  }
}

// ─── Ollama streaming ─────────────────────────────────────────────────────────
async function streamOllama(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
) {
  const baseUrl = normalizeBase(config.ollamaUrl || "http://127.0.0.1:11434");
  const url = `${baseUrl}/api/chat`;
  log.info("streamOllama", `POST ${url} model=${config.model}`);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "", // suppress tauri-plugin-http injected Origin header (breaks Ollama CORS)
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    const msg = `Cannot reach Ollama at ${baseUrl}. Make sure Ollama is running: open a terminal and run "ollama serve".`;
    log.error("streamOllama", msg, e);
    onError(msg);
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let msg = `Ollama error ${response.status}: ${text || "unknown"}. `;
    if (response.status === 404) {
      msg += `Model "${config.model}" not found — run: ollama pull ${config.model}`;
    } else {
      msg += "Is Ollama running? Try clicking Refresh in Settings.";
    }
    log.error("streamOllama", msg);
    onError(msg);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { onError("Ollama returned no response stream."); return; }

  const decoder = new TextDecoder();
  let fullText = "";
  // Buffer incomplete lines — NDJSON chunks may split across reads
  let lineBuffer = "";

  while (true) {
    if (signal?.aborted) { reader.cancel(); return; }
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? ""; // last entry may be incomplete — keep buffered
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.error) {
          log.error("streamOllama", "Error in stream", json.error);
          onError(`Ollama error: ${json.error} — is the model "${config.model}" downloaded?`);
          return;
        }
        if (json.message?.content) {
          fullText += json.message.content;
          onToken(json.message.content);
        }
      } catch { /* partial JSON — skip */ }
    }
  }
  if (signal?.aborted) return;
  log.info("streamOllama", `Done — ${fullText.length} chars`);
  onDone(fullText);
}

// ─── OpenAI streaming ─────────────────────────────────────────────────────────
async function streamOpenAI(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
) {
  if (!config.apiKey) {
    onError("OpenAI API key not set — go to Settings and add your key.");
    return;
  }

  log.info("streamOpenAI", `model=${config.model} msgs=${messages.length}`);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "Origin": "", // suppress tauri-plugin-http injected Origin header
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    const msg = networkAwareMessage(e);
    log.error("streamOpenAI", "Network error", e);
    onError(msg);
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = friendlyHttpError("OpenAI", response.status, text);
    log.error("streamOpenAI", err.message, { status: response.status, body: text });
    onError(err.message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { onError("OpenAI returned no response stream."); return; }

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    if (signal?.aborted) { reader.cancel(); return; }
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch { /* partial line */ }
    }
  }
  if (signal?.aborted) return;
  log.info("streamOpenAI", `Done — ${fullText.length} chars`);
  onDone(fullText);
}

// ─── Anthropic streaming ──────────────────────────────────────────────────────
async function streamAnthropic(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
) {
  if (!config.apiKey) {
    onError("Anthropic API key not set — go to Settings and add your key.");
    return;
  }

  log.info("streamAnthropic", `model=${config.model} msgs=${messages.length}`);

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 8096,
    stream: true,
    messages: chatMsgs,
  };
  if (systemMsg) body.system = systemMsg.content;

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Origin": "", // suppress tauri-plugin-http injected Origin header
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    const msg = networkAwareMessage(e);
    log.error("streamAnthropic", "Network error", e);
    onError(msg);
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = friendlyHttpError("Anthropic", response.status, text);
    log.error("streamAnthropic", err.message, { status: response.status, body: text });
    onError(err.message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { onError("Anthropic returned no response stream."); return; }

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    if (signal?.aborted) { reader.cancel(); return; }
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(line.slice(6));
        if (json.type === "content_block_delta" && json.delta?.text) {
          fullText += json.delta.text;
          onToken(json.delta.text);
        }
        if (json.type === "error") {
          log.error("streamAnthropic", "Stream error event", json.error);
          onError(`Anthropic stream error: ${json.error?.message ?? "unknown"}`);
          return;
        }
      } catch { /* partial line */ }
    }
  }
  if (signal?.aborted) return;
  log.info("streamAnthropic", `Done — ${fullText.length} chars`);
  onDone(fullText);
}

// ─── Error helpers ────────────────────────────────────────────────────────────
function friendlyHttpError(provider: string, status: number, body: string): Error {
  let detail = body;
  try {
    const json = JSON.parse(body);
    detail = json.error?.message ?? json.message ?? body;
  } catch { /* use raw body */ }

  if (status === 429) {
    const url = provider.toLowerCase() === "openai" ? "platform.openai.com" : "console.anthropic.com";
    return new Error(
      `Rate limit hit (${provider}). Your API key has reached its request limit — wait a minute and try again, or upgrade your plan at ${url}.`
    );
  }
  if (status === 401) {
    return new Error(`Invalid API key (${provider}). Double-check the key in Settings — it may be expired or incorrect.`);
  }
  if (status === 403) {
    return new Error(`Access denied (${provider}). Your key doesn't have permission to use this model. Check your plan at ${provider.toLowerCase() === "openai" ? "platform.openai.com" : "console.anthropic.com"}.`);
  }
  if (status === 404) {
    return new Error(`Model not found (${provider}): "${detail}". The selected model may not exist or has been deprecated — try a different model in Settings.`);
  }
  if (status === 500 || status === 503) {
    return new Error(`${provider} is having server issues (${status}). This is their problem, not yours — try again in a minute.`);
  }
  return new Error(`${provider} error ${status}: ${detail}`);
}

function networkAwareMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("network") || msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("fetch")) {
    return "Network error — check your internet connection and try again.";
  }
  return msg;
}

// ─── Fetch with retry (429 backoff) ──────────────────────────────────────────
async function fetchWithRetry(
  url: string,
  options: Parameters<typeof fetch>[1],
  maxRetries = 2,
): Promise<Awaited<ReturnType<typeof fetch>>> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, options);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      log.warn("fetchWithRetry", `Network error on attempt ${attempt + 1}, retrying...`, e);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (response.status !== 429 || attempt === maxRetries) return response;
    const waitMs = 5000 * (attempt + 1);
    log.warn("fetchWithRetry", `429 on attempt ${attempt + 1}, waiting ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return fetch(url, options);
}

// ─── Public: streaming with accumulation (for curriculum generation with live output) ─
export function callLLMStreaming(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  onChunk: (token: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    streamChat({
      messages,
      config,
      onToken: onChunk,
      onDone: resolve,
      onError: (e) => reject(new Error(e)),
    });
  });
}

// ─── Public: non-streaming (for curriculum/quiz generation) ──────────────────
export async function callLLM(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
): Promise<string> {
  log.info("callLLM", `provider=${config.provider} model=${config.model}`);

  if (config.provider === "ollama") {
    const baseUrl = normalizeBase(config.ollamaUrl || "http://127.0.0.1:11434");
    const url = `${baseUrl}/api/chat`;
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": "", // suppress tauri-plugin-http injected Origin header
        },
        body: JSON.stringify({ model: config.model, messages, stream: false }),
      });
    } catch (e) {
      throw new Error(`Cannot reach Ollama at ${baseUrl}. Open a terminal and run "ollama serve". Detail: ${networkAwareMessage(e)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new Error(`Ollama model "${config.model}" not found — run: ollama pull ${config.model}`);
      }
      throw new Error(`Ollama error ${response.status}: ${text || "unknown"}`);
    }
    const json = await response.json();
    const content = json.message?.content ?? "";
    log.info("callLLM", `Ollama response: ${content.length} chars`);
    return content;
  }

  if (config.provider === "openai") {
    if (!config.apiKey) throw new Error("OpenAI API key not set — go to Settings to add your key.");
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          "Origin": "",
        },
        body: JSON.stringify({ model: config.model, messages }),
      });
    } catch (e) {
      throw new Error(`Network error connecting to OpenAI: ${networkAwareMessage(e)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error("callLLM", "OpenAI error", { status: response.status, body: text });
      throw friendlyHttpError("OpenAI", response.status, text);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content ?? "";
    log.info("callLLM", `OpenAI response: ${content.length} chars`);
    return content;
  }

  if (config.provider === "anthropic") {
    if (!config.apiKey) throw new Error("Anthropic API key not set — go to Settings to add your key.");
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: 8096,
      messages: chatMsgs,
    };
    if (systemMsg) body.system = systemMsg.content;

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Origin": "",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Network error connecting to Anthropic: ${networkAwareMessage(e)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error("callLLM", "Anthropic error", { status: response.status, body: text });
      throw friendlyHttpError("Anthropic", response.status, text);
    }
    const json = await response.json();
    const content = json.content?.[0]?.text ?? "";
    log.info("callLLM", `Anthropic response: ${content.length} chars`);
    return content;
  }

  throw new Error(`Unknown provider "${config.provider}" — check Settings.`);
}

// ─── Ollama version probe (cached per baseUrl) ────────────────────────────────
const ollamaVersionCache = new Map<string, string | null>();

export async function getOllamaVersion(ollamaUrl: string): Promise<string | null> {
  const base = normalizeBase(ollamaUrl || "http://127.0.0.1:11434");
  if (ollamaVersionCache.has(base)) return ollamaVersionCache.get(base)!;
  try {
    const response = await fetch(`${base}/api/version`, {
      method: "GET",
      headers: { "Accept": "application/json", "Origin": "" },
    });
    if (!response.ok) { ollamaVersionCache.set(base, null); return null; }
    const json = await response.json();
    const version = (typeof json.version === "string" ? json.version : null);
    ollamaVersionCache.set(base, version);
    log.info("getOllamaVersion", `Ollama ${base} → ${version ?? "unknown"}`);
    return version;
  } catch (e) {
    log.warn("getOllamaVersion", "probe failed", e);
    ollamaVersionCache.set(base, null);
    return null;
  }
}

function ollamaSupportsSchemaFormat(version: string | null): boolean {
  // Schema-as-format introduced in Ollama 0.5.0
  if (!version) return false;
  const parts = version.split(".").map((p) => parseInt(p, 10));
  if (Number.isNaN(parts[0])) return false;
  if (parts[0] > 0) return true;
  if (parts[0] === 0 && (parts[1] ?? 0) >= 5) return true;
  return false;
}

// ─── Model tier detection ─────────────────────────────────────────────────────
// The harness adapts to the chosen model's capability tier — tiny/small models
// get shorter prompts, looser schemas, sequential calls, longer timeouts. Tier is
// auto-detected (Ollama via /api/show parameter_size; cloud via a static map).
// Users never pick a tier directly.

// Per-session cache; keyed by "provider:model". Cleared on app restart.
const tierCache = new Map<string, ModelTier>();

// Tier budgets — knobs the rest of the harness reads to adapt behavior.
//   promptCharCap        — soft cap on per-call prompt size (research/topic-list/etc.)
//   expansionParallelism — max concurrent subtopic-expansion calls in Stage B
//   minLengthScale       — schema minLength constraints multiplied by this before send/validate
//   perCallTimeoutMs     — abort a single LLM call after this long. Generous because the harness
//                          runs many calls; one slow one stalling for ~3min is better UX than
//                          a fast abort that breaks the whole pipeline. Ollama is the slow path —
//                          a 7B model on a modest GPU/CPU can take 60–120s for a single structured
//                          call. The per-provider multiplier below tightens this for cloud APIs.
//   fewShot              — inject one worked example into prompts that support it
export const TIER_BUDGETS: Record<ModelTier, {
  promptCharCap: number;
  expansionParallelism: number;
  minLengthScale: number;
  perCallTimeoutMs: number;
  fewShot: boolean;
}> = {
  tiny:   { promptCharCap: 1500, expansionParallelism: 1, minLengthScale: 0.5, perCallTimeoutMs: 180_000, fewShot: true  },
  small:  { promptCharCap: 2500, expansionParallelism: 1, minLengthScale: 0.5, perCallTimeoutMs: 150_000, fewShot: true  },
  medium: { promptCharCap: 4000, expansionParallelism: 4, minLengthScale: 1.0, perCallTimeoutMs: 120_000, fewShot: false },
  large:  { promptCharCap: 6000, expansionParallelism: 8, minLengthScale: 1.0, perCallTimeoutMs: 90_000,  fewShot: false },
};

// Cloud APIs (OpenAI/Anthropic) are reliable and fast — tighten their effective timeout
// to half the tier value. This keeps the safety net for stuck local models while
// catching real cloud-side hangs quickly.
function effectivePerCallTimeoutMs(provider: string, tier: ModelTier | undefined): number {
  const base = tier ? TIER_BUDGETS[tier].perCallTimeoutMs : 120_000;
  if (provider === "openai" || provider === "anthropic") return Math.round(base / 2);
  return base;
}

// Static cloud-model tier map. Substring match — covers versioned variants like
// "claude-sonnet-4-6-20250101" without needing an entry per snapshot.
function cloudModelTier(provider: "openai" | "anthropic", model: string): ModelTier {
  const m = model.toLowerCase();
  if (provider === "openai") {
    if (m.includes("gpt-4") && !m.includes("mini") && !m.includes("nano")) return "large";
    if (m.includes("gpt-5")) return "large";
    if (m.includes("o3") || m.includes("o4")) return "large";
    if (m.includes("mini") || m.includes("nano")) return "medium";
    return "medium";
  }
  // anthropic
  if (m.includes("opus")) return "large";
  if (m.includes("sonnet")) return "large";
  if (m.includes("haiku")) return "medium";
  return "medium";
}

// Parse Ollama's parameter_size string like "3.8B", "7B", "1.5B", "70B".
// Returns number of parameters in billions, or null on parse failure.
function parseParamBillions(s: string | undefined | null): number | null {
  if (!s) return null;
  const match = /^([\d.]+)\s*([BMK])$/i.exec(s.trim());
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "B") return n;
  if (unit === "M") return n / 1000;
  if (unit === "K") return n / 1_000_000;
  return null;
}

function tierFromBillions(b: number | null): ModelTier {
  if (b === null) return "small"; // safe default for unknown Ollama models
  if (b < 3) return "tiny";
  if (b < 6) return "small";
  if (b < 20) return "medium";
  return "large";
}

// Name-based tier override for Ollama models where the actual parameter count
// doesn't reflect effective/active params at inference (e.g., Gemma 3n's
// Matformer architecture: "e4b" has 4B *effective* params but Ollama's
// /api/show reports the ~7-8B total). Without this, gemma3n:e4b mis-tiers as
// "medium" (with a tight timeout) when it behaves like a 4B model at runtime.
// Returns null when no override applies — caller falls back to parameter_size mapping.
function ollamaNameTierOverride(model: string): ModelTier | null {
  // Match e2b / e4b suffixes used by Gemma 3n / gemma4 aliases.
  const m = model.toLowerCase();
  if (/(?:^|[-:_])e2b(?:[-:_]|$)/.test(m)) return "tiny";
  if (/(?:^|[-:_])e4b(?:[-:_]|$)/.test(m)) return "small";
  return null;
}

export async function detectModelTier(config: LLMConfig): Promise<ModelTier> {
  const cacheKey = `${config.provider}:${config.model}`;
  const hit = tierCache.get(cacheKey);
  if (hit) return hit;

  let tier: ModelTier;
  if (config.provider === "openai" || config.provider === "anthropic") {
    tier = cloudModelTier(config.provider, config.model);
  } else {
    // Ollama — check name overrides first (for Matformer / "effective param" models
    // whose actual /api/show parameter count is misleading), then fall back to /api/show.
    const nameOverride = ollamaNameTierOverride(config.model);
    if (nameOverride) {
      tier = nameOverride;
      log.info("detectModelTier", `${config.model} → name-override → ${tier}`);
    } else {
      const baseUrl = normalizeBase(config.ollamaUrl || "http://127.0.0.1:11434");
      try {
        const response = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "Origin": "" },
          body: JSON.stringify({ name: config.model }),
        });
        if (!response.ok) {
          log.warn("detectModelTier", `Ollama /api/show ${response.status} for ${config.model} — defaulting to small`);
          tier = "small";
        } else {
          const json = await response.json();
          const sizeStr: string | undefined = json?.details?.parameter_size;
          const billions = parseParamBillions(sizeStr);
          tier = tierFromBillions(billions);
          log.info("detectModelTier", `${config.model} → ${sizeStr ?? "?"} → ${tier}`);
        }
      } catch (e) {
        log.warn("detectModelTier", "probe failed — defaulting to small", e);
        tier = "small";
      }
    }
  }

  tierCache.set(cacheKey, tier);
  return tier;
}

// ─── Structured output: schema-enforced JSON with repair-retry ────────────────
// Goal: reliable JSON from small local models (gemma4:e4b) and from cloud APIs alike.
// Strategy: provider-native enforcement first (Ollama format-schema, OpenAI json_schema strict,
// Anthropic forced tool_use), validate against schema in TS, repair-retry on failure.

export interface StructuredOpts<T = unknown> {
  schema: object;             // JSON Schema (subset: type/required/additionalProperties/properties/items/enum/pattern/min*/max*)
  toolName?: string;          // Anthropic tool name + OpenAI json_schema name (default "Output")
  maxRepairAttempts?: number; // default 2
  temperature?: number;       // default 0.2 (low — schema mode plus low temp = stable output)
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
  // Caller-supplied semantic validation that runs after structural schema validation.
  // Use this for cross-field constraints schema can't express (uniqueness, completeness, etc.).
  // Return [] when valid; return human-readable issue strings to trigger repair-retry.
  validate?: (parsed: T) => string[];
  // When set to tiny/small, the schema's minLength constraints are halved before being
  // sent to the provider AND used for local validation. Small models often produce
  // technically-valid content that misses minLength by a character or two; this prevents
  // pointless repair-retry rejections without accepting genuinely empty fields.
  tier?: ModelTier;
}

// Deep-clone a JSON schema and scale every minLength / minItems found within by `scale`.
// Walks objects (properties), arrays (items), and is safe on the JSON-Schema subset we use.
// Returns a fresh schema — the input is not mutated.
function scaleSchemaMinima(schema: object, scale: number): object {
  if (scale === 1.0) return schema;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if ((k === "minLength" || k === "minItems") && typeof v === "number") {
          out[k] = Math.max(1, Math.floor(v * scale));
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };
  return walk(schema) as object;
}

// Schema validator — supports the subset of JSON Schema we actually use.
// Returns an array of human-readable issues; empty array means valid.
function validateAgainstSchema(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
  const issues: string[] = [];
  const s = schema as Record<string, unknown>;
  const t = s.type as string | undefined;

  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push(`${path}: expected object`);
      return issues;
    }
    const v = value as Record<string, unknown>;
    const required = (s.required as string[] | undefined) ?? [];
    for (const key of required) if (!(key in v)) issues.push(`${path}.${key}: missing required field`);
    const props = (s.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    if (s.additionalProperties === false) {
      for (const key of Object.keys(v)) if (!(key in props)) issues.push(`${path}.${key}: not allowed by schema`);
    }
    for (const key of Object.keys(props)) {
      if (key in v) issues.push(...validateAgainstSchema(v[key], props[key], `${path}.${key}`));
    }
    return issues;
  }

  if (t === "array") {
    if (!Array.isArray(value)) { issues.push(`${path}: expected array`); return issues; }
    const min = s.minItems as number | undefined;
    const max = s.maxItems as number | undefined;
    if (min !== undefined && value.length < min) issues.push(`${path}: expected ≥${min} items, got ${value.length}`);
    if (max !== undefined && value.length > max) issues.push(`${path}: expected ≤${max} items, got ${value.length}`);
    const items = s.items as Record<string, unknown> | undefined;
    if (items) {
      for (let i = 0; i < value.length; i++) issues.push(...validateAgainstSchema(value[i], items, `${path}[${i}]`));
    }
    return issues;
  }

  if (t === "string") {
    if (typeof value !== "string") { issues.push(`${path}: expected string`); return issues; }
    const min = s.minLength as number | undefined;
    const max = s.maxLength as number | undefined;
    if (min !== undefined && value.length < min) issues.push(`${path}: string too short (${value.length} < ${min})`);
    if (max !== undefined && value.length > max) issues.push(`${path}: string too long (${value.length} > ${max})`);
    if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(value)) issues.push(`${path}: does not match pattern ${s.pattern}`);
    if (Array.isArray(s.enum) && !s.enum.includes(value)) issues.push(`${path}: "${value}" not in enum`);
    return issues;
  }

  if (t === "number" || t === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) { issues.push(`${path}: expected number`); return issues; }
    if (t === "integer" && !Number.isInteger(value)) issues.push(`${path}: expected integer`);
    const min = s.minimum as number | undefined;
    const max = s.maximum as number | undefined;
    if (min !== undefined && value < min) issues.push(`${path}: ${value} < minimum ${min}`);
    if (max !== undefined && value > max) issues.push(`${path}: ${value} > maximum ${max}`);
    if (Array.isArray(s.enum) && !s.enum.includes(value)) issues.push(`${path}: ${value} not in enum`);
    return issues;
  }

  if (t === "boolean") {
    if (typeof value !== "boolean") issues.push(`${path}: expected boolean`);
    return issues;
  }

  return issues;
}

interface ProviderResult { raw: string; parsed: unknown }

async function callOllamaStructured(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  schema: object,
  temperature: number,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  const baseUrl = normalizeBase(config.ollamaUrl || "http://127.0.0.1:11434");
  const version = await getOllamaVersion(baseUrl);
  const supportsSchema = ollamaSupportsSchemaFormat(version);

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
    options: { temperature },
    format: supportsSchema ? schema : "json",
  };

  log.info("callOllamaStructured", `POST ${baseUrl}/api/chat schema=${supportsSchema ? "yes" : "json-loose"} v=${version ?? "?"}`);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Origin": "" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(`Cannot reach Ollama at ${baseUrl}: ${networkAwareMessage(e)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 404) throw new Error(`Ollama model "${config.model}" not found — run: ollama pull ${config.model}`);
    throw new Error(`Ollama error ${response.status}: ${text || "unknown"}`);
  }

  const json = await response.json();
  const raw: string = json.message?.content ?? "";

  let parsed: unknown = null;
  try { parsed = tryParseJsonLenient(raw); }
  catch {
    // Last-ditch brace extraction in case model wrapped output in prose
    const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try { parsed = tryParseJsonLenient(raw.slice(first, last + 1)); } catch { parsed = null; }
    }
  }
  return { raw, parsed };
}

async function callOpenAIStructured(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  schema: object,
  toolName: string,
  temperature: number,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  if (!config.apiKey) throw new Error("OpenAI API key not set — go to Settings to add your key.");

  const body = {
    model: config.model,
    messages,
    temperature,
    response_format: {
      type: "json_schema",
      json_schema: { name: toolName, strict: true, schema },
    },
  };

  log.info("callOpenAIStructured", `model=${config.model} toolName=${toolName}`);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "Origin": "",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(`Network error connecting to OpenAI: ${networkAwareMessage(e)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw friendlyHttpError("OpenAI", response.status, text);
  }

  const json = await response.json();
  const raw: string = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown = null;
  try { parsed = tryParseJsonLenient(raw); } catch { parsed = null; }
  return { raw, parsed };
}

async function callAnthropicStructured(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  schema: object,
  toolName: string,
  temperature: number,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  if (!config.apiKey) throw new Error("Anthropic API key not set — go to Settings to add your key.");

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 8096,
    temperature,
    messages: chatMsgs,
    tools: [{
      name: toolName,
      description: "Emit structured output matching the provided JSON schema.",
      input_schema: schema,
    }],
    tool_choice: { type: "tool", name: toolName },
  };
  if (systemMsg) body.system = systemMsg.content;

  log.info("callAnthropicStructured", `model=${config.model} toolName=${toolName}`);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Origin": "",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(`Network error connecting to Anthropic: ${networkAwareMessage(e)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw friendlyHttpError("Anthropic", response.status, text);
  }

  const json = await response.json();
  const blocks = (json.content ?? []) as Array<{ type: string; text?: string; input?: unknown }>;
  const toolUse = blocks.find((b) => b.type === "tool_use");
  if (toolUse && toolUse.input !== undefined) {
    return { raw: JSON.stringify(toolUse.input), parsed: toolUse.input };
  }
  const raw = blocks.map((b) => b.text ?? "").join("\n");
  return { raw, parsed: null };
}

/**
 * Schema-enforced structured output across providers.
 * Validates against the schema in TypeScript after API-native enforcement; repair-retries
 * up to `maxRepairAttempts` times on validation failure.
 */
export async function callLLMStructured<T>(
  messages: Array<{ role: string; content: string }>,
  config: LLMConfig,
  opts: StructuredOpts<T>,
): Promise<T> {
  const toolName = opts.toolName ?? "Output";
  const maxRepair = opts.maxRepairAttempts ?? 2;
  const temperature = opts.temperature ?? 0.2;

  // Tier-aware schema relaxation: scale minLength/minItems by the tier's minLengthScale.
  // The SAME relaxed schema is sent to the provider AND used for validation, so we can't
  // accept loose output we'd then reject locally.
  const tierScale = opts.tier ? TIER_BUDGETS[opts.tier].minLengthScale : 1.0;
  const effectiveSchema = scaleSchemaMinima(opts.schema, tierScale);

  // Per-call timeout from tier budget, halved for fast cloud APIs.
  // A single hung call shouldn't be allowed to stall a 5–10 min pipeline forever,
  // but local Ollama models can legitimately take 60–120s per structured call.
  const perCallTimeoutMs = effectivePerCallTimeoutMs(config.provider, opts.tier);

  let workingMessages = [...messages];
  let lastRaw = "";
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    if (opts.signal?.aborted) throw new Error("Aborted");

    // Fresh per-attempt AbortController. Links to caller's signal (if any) AND a timer
    // bounded by perCallTimeoutMs. Either side firing aborts the provider call.
    const attemptController = new AbortController();
    const timer = setTimeout(() => attemptController.abort(), perCallTimeoutMs);
    const onParentAbort = () => attemptController.abort();
    if (opts.signal) {
      if (opts.signal.aborted) attemptController.abort();
      else opts.signal.addEventListener("abort", onParentAbort, { once: true });
    }

    let result: ProviderResult;
    try {
      if (config.provider === "ollama") {
        result = await callOllamaStructured(workingMessages, config, effectiveSchema, temperature, attemptController.signal);
      } else if (config.provider === "openai") {
        result = await callOpenAIStructured(workingMessages, config, effectiveSchema, toolName, temperature, attemptController.signal);
      } else if (config.provider === "anthropic") {
        result = await callAnthropicStructured(workingMessages, config, effectiveSchema, toolName, temperature, attemptController.signal);
      } else {
        throw new Error(`Unknown provider "${config.provider}"`);
      }
    } catch (e) {
      // Surface a clear timeout message; otherwise propagate.
      const wasTimeout = attemptController.signal.aborted && !opts.signal?.aborted;
      const wasUserAbort = opts.signal?.aborted ?? false;
      if (wasUserAbort) throw new Error("Aborted");
      if (wasTimeout) {
        throw new Error(
          `LLM call timed out after ${perCallTimeoutMs / 1000}s (tier=${opts.tier ?? "default"}). ` +
          `The model may be too slow or hung; try a smaller model or check your Ollama server.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onParentAbort);
    }

    lastRaw = result.raw;

    let issues: string[];
    if (result.parsed === null || result.parsed === undefined) {
      issues = ["response did not contain valid JSON"];
    } else {
      issues = validateAgainstSchema(result.parsed, effectiveSchema as Record<string, unknown>);
      // Semantic validation runs only after structural schema passes — repair-retry handles both.
      if (issues.length === 0 && opts.validate) {
        try {
          issues = opts.validate(result.parsed as T);
        } catch (e) {
          issues = [`validator threw: ${e instanceof Error ? e.message : String(e)}`];
        }
      }
    }

    if (issues.length === 0) {
      log.info("callLLMStructured", `OK on attempt ${attempt + 1}/${maxRepair + 1}`);
      return result.parsed as T;
    }

    lastIssues = issues;

    if (attempt < maxRepair) {
      opts.onProgress?.(`[repair ${attempt + 1}/${maxRepair}] ${lastIssues.slice(0, 2).join("; ")}`);
      log.warn("callLLMStructured", `Validation failed (attempt ${attempt + 1})`, lastIssues);
      workingMessages = [
        ...messages,
        { role: "assistant", content: lastRaw },
        { role: "user", content: `That output was invalid: ${lastIssues.slice(0, 5).join("; ")}. Re-emit ONLY valid JSON matching the schema and all stated requirements. No prose, no markdown fences.` },
      ];
    }
  }

  throw new Error(
    `Structured output failed after ${maxRepair + 1} attempts. Issues: ${lastIssues.join("; ")}. ` +
    `Last response (first 200 chars): "${lastRaw.slice(0, 200)}"`,
  );
}

// ─── Native tool-calling turn (v2 Phase 1) ────────────────────────────────────
// The kernel (TutorEngine) consumes ONE provider-agnostic event stream and never
// cares whether a provider truly streamed token-by-token or assembled a single
// response. This is the keystone of the v2 turn loop: text deltas and tool calls
// interleave from the same generator. A turn offered NO tools and NO temperature
// builds a request body byte-identical to streamChat's — so plain chat is unchanged
// (and the eval baseline holds when goldens opt out of tools).
//
// Decision: native provider tool-calling is PRIMARY (V2_DECISION_TOOLCALL.md, 0.98
// arg-compliance on gemma4:e4b). Schemas are zod in the tool layer; the kernel
// converts to JSON Schema via the dsl layer and hands us ProviderToolDef[], so
// llm.ts stays agnostic of the tool/UI layers above it.

// A tool as the provider sees it. `parameters` is already provider-ready JSON Schema
// (zod → toProviderJsonSchema, done by the caller).
export interface ProviderToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// The neutral message shape the kernel works in. Each provider adapter translates it
// to that provider's wire format — reinjection of tool results differs by provider
// (OpenAI: `tool` role + tool_call_id; Anthropic: `user` msg w/ tool_result blocks;
// Ollama: `tool` role).
export interface NeutralMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; name: string; args: unknown }>; // assistant turns that called tools
  tool_call_id?: string; // tool-result turns
  name?: string;         // tool name on tool-result turns
}

export type LLMTurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" | "aborted" };

export interface TurnOpts {
  tools?: ProviderToolDef[];
  tier?: ModelTier;
  temperature?: number; // omitted from the request when undefined — keeps plain turns identical
  signal?: AbortSignal;
}

// Combine the caller's AbortSignal with a per-call timeout, mirroring callLLMStructured.
// Bounds a single model HTTP call (not tool execution — that's the kernel's concern).
function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); },
  };
}

// ── Minimal stream-chunk shapes (typed parsing, no `any`) ──
interface OllamaTurnChunk {
  error?: string;
  done?: boolean;
  message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
}
interface OpenAITurnChunk {
  choices?: Array<{
    delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
}
interface AnthropicTurnEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  error?: { message?: string };
}

// ── Message translators (neutral → provider wire format) ──
function toOllamaTurnMessage(m: NeutralMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content ?? "",
      tool_calls: m.tool_calls.map((tc) => ({ function: { name: tc.name, arguments: tc.args ?? {} } })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", content: m.content, ...(m.name ? { tool_name: m.name } : {}) };
  }
  return { role: m.role, content: m.content };
}

function toOpenAITurnMessage(m: NeutralMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  }
  return { role: m.role, content: m.content };
}

// Anthropic: content-block translation + tool_results grouped into one user message
// (Anthropic expects all tool_results for a turn together).
function toAnthropicTurnMessages(messages: NeutralMessage[]): { system?: string; messages: Array<Record<string, unknown>> } {
  const system = messages.find((m) => m.role === "system")?.content;
  const out: Array<Record<string, unknown>> = [];
  let pendingToolResults: Array<Record<string, unknown>> = [];
  const flush = () => {
    if (pendingToolResults.length) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      pendingToolResults.push({ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content });
      continue;
    }
    flush();
    if (m.role === "assistant" && m.tool_calls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
      out.push({ role: "assistant", content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  flush();
  return { system, messages: out };
}

// ── Tool-def builders (one per provider envelope) ──
function ollamaToolDefs(tools?: ProviderToolDef[]) {
  return tools?.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined;
}
function anthropicToolDefs(tools?: ProviderToolDef[]) {
  return tools?.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) : undefined;
}

// ── The public entry point ──
export async function* callLLMTurn(
  messages: NeutralMessage[],
  config: LLMConfig,
  opts: TurnOpts = {},
): AsyncGenerator<LLMTurnEvent> {
  log.info("callLLMTurn", `provider=${config.provider} model=${config.model} tools=${opts.tools?.length ?? 0}`);
  if (config.provider === "ollama") yield* streamOllamaTurn(messages, config, opts);
  else if (config.provider === "openai") yield* streamOpenAITurn(messages, config, opts);
  else if (config.provider === "anthropic") yield* streamAnthropicTurn(messages, config, opts);
  else throw new Error(`Unknown provider "${config.provider}" — check Settings.`);
}

async function* streamOllamaTurn(messages: NeutralMessage[], config: LLMConfig, opts: TurnOpts): AsyncGenerator<LLMTurnEvent> {
  const baseUrl = normalizeBase(config.ollamaUrl || "http://127.0.0.1:11434");
  const body: Record<string, unknown> = { model: config.model, messages: messages.map(toOllamaTurnMessage), stream: true };
  if (opts.temperature !== undefined) body.options = { temperature: opts.temperature };
  const tools = ollamaToolDefs(opts.tools);
  if (tools) body.tools = tools;

  const { signal, cleanup } = withTimeoutSignal(opts.signal, effectivePerCallTimeoutMs(config.provider, opts.tier));
  try {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Origin": "" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") { yield { type: "done", finishReason: "aborted" }; return; }
      throw new Error(`Cannot reach Ollama at ${baseUrl}: ${networkAwareMessage(e)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) throw new Error(`Ollama model "${config.model}" not found — run: ollama pull ${config.model}`);
      throw new Error(`Ollama error ${response.status}: ${text || "unknown"}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ollama returned no response stream.");
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let sawToolCall = false;
    let callIdx = 0;
    while (true) {
      if (signal.aborted) { reader.cancel(); yield { type: "done", finishReason: "aborted" }; return; }
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let json: OllamaTurnChunk;
        try { json = JSON.parse(line) as OllamaTurnChunk; } catch { continue; }
        if (json.error) throw new Error(`Ollama error: ${json.error}`);
        if (json.message?.content) yield { type: "text", delta: json.message.content };
        if (Array.isArray(json.message?.tool_calls)) {
          for (const tc of json.message.tool_calls) {
            sawToolCall = true;
            let args: unknown = tc.function?.arguments ?? {};
            if (typeof args === "string") { try { args = JSON.parse(args); } catch { /* keep raw string */ } }
            yield { type: "tool_call", id: `call_${callIdx++}`, name: tc.function?.name ?? "", args };
          }
        }
      }
    }
    if (signal.aborted) { yield { type: "done", finishReason: "aborted" }; return; }
    yield { type: "done", finishReason: sawToolCall ? "tool_calls" : "stop" };
  } finally { cleanup(); }
}

async function* streamOpenAITurn(messages: NeutralMessage[], config: LLMConfig, opts: TurnOpts): AsyncGenerator<LLMTurnEvent> {
  if (!config.apiKey) throw new Error("OpenAI API key not set — go to Settings and add your key.");
  const body: Record<string, unknown> = { model: config.model, messages: messages.map(toOpenAITurnMessage), stream: true };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const tools = ollamaToolDefs(opts.tools); // identical {type:function,function:{…}} envelope as Ollama/OpenAI
  if (tools) { body.tools = tools; body.tool_choice = "auto"; }

  const { signal, cleanup } = withTimeoutSignal(opts.signal, effectivePerCallTimeoutMs(config.provider, opts.tier));
  try {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}`, "Origin": "" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") { yield { type: "done", finishReason: "aborted" }; return; }
      throw new Error(networkAwareMessage(e));
    }
    if (!response.ok) { const text = await response.text().catch(() => ""); throw friendlyHttpError("OpenAI", response.status, text); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OpenAI returned no response stream.");
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    while (true) {
      if (signal.aborted) { reader.cancel(); yield { type: "done", finishReason: "aborted" }; return; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let json: OpenAITurnChunk;
        try { json = JSON.parse(data) as OpenAITurnChunk; } catch { continue; }
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { type: "text", delta: choice.delta.content };
        if (Array.isArray(choice.delta?.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
        if (choice.finish_reason === "tool_calls" || choice.finish_reason === "length") finishReason = choice.finish_reason;
      }
    }
    if (signal.aborted) { yield { type: "done", finishReason: "aborted" }; return; }
    let fallbackIdx = 0;
    for (const [, c] of toolAcc) {
      let parsed: unknown = {};
      if (c.args) {
        try { parsed = JSON.parse(c.args); }
        catch { try { parsed = JSON.parse(sanitizeJsonEscapes(c.args)); } catch { parsed = {}; } }
      }
      yield { type: "tool_call", id: c.id || `call_${fallbackIdx++}`, name: c.name, args: parsed };
    }
    yield { type: "done", finishReason: toolAcc.size > 0 && finishReason === "stop" ? "tool_calls" : finishReason };
  } finally { cleanup(); }
}

async function* streamAnthropicTurn(messages: NeutralMessage[], config: LLMConfig, opts: TurnOpts): AsyncGenerator<LLMTurnEvent> {
  if (!config.apiKey) throw new Error("Anthropic API key not set — go to Settings and add your key.");
  const { system, messages: amsgs } = toAnthropicTurnMessages(messages);
  const body: Record<string, unknown> = { model: config.model, max_tokens: 8096, stream: true, messages: amsgs };
  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const tools = anthropicToolDefs(opts.tools);
  if (tools) body.tools = tools;

  const { signal, cleanup } = withTimeoutSignal(opts.signal, effectivePerCallTimeoutMs(config.provider, opts.tier));
  try {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Origin": "" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") { yield { type: "done", finishReason: "aborted" }; return; }
      throw new Error(networkAwareMessage(e));
    }
    if (!response.ok) { const text = await response.text().catch(() => ""); throw friendlyHttpError("Anthropic", response.status, text); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Anthropic returned no response stream.");
    const decoder = new TextDecoder();
    let buffer = "";
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    while (true) {
      if (signal.aborted) { reader.cancel(); yield { type: "done", finishReason: "aborted" }; return; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        let evt: AnthropicTurnEvent;
        try { evt = JSON.parse(trimmed.slice(5).trim()) as AnthropicTurnEvent; } catch { continue; }
        if (evt.type === "error") throw new Error(`Anthropic stream error: ${evt.error?.message ?? "unknown"}`);
        if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use" && evt.index !== undefined) {
          toolBlocks.set(evt.index, { id: evt.content_block.id ?? `call_${evt.index}`, name: evt.content_block.name ?? "", json: "" });
        } else if (evt.type === "content_block_delta" && evt.index !== undefined) {
          if (evt.delta?.type === "text_delta" && evt.delta.text) yield { type: "text", delta: evt.delta.text };
          if (evt.delta?.type === "input_json_delta" && evt.delta.partial_json !== undefined) {
            const b = toolBlocks.get(evt.index);
            if (b) b.json += evt.delta.partial_json;
          }
        } else if (evt.type === "content_block_stop" && evt.index !== undefined) {
          const b = toolBlocks.get(evt.index);
          if (b) {
            let parsed: unknown = {};
            if (b.json) { try { parsed = JSON.parse(b.json); } catch { parsed = {}; } }
            yield { type: "tool_call", id: b.id, name: b.name, args: parsed };
          }
        } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
          const sr = evt.delta.stop_reason;
          finishReason = sr === "tool_use" ? "tool_calls" : sr === "max_tokens" ? "length" : "stop";
        }
      }
    }
    if (signal.aborted) { yield { type: "done", finishReason: "aborted" }; return; }
    yield { type: "done", finishReason };
  } finally { cleanup(); }
}

// ─── Preflight: prove the model can emit structured JSON ─────────────────────
// Tiny probe call (name + age) used as step 0 of course generation. Hard-blocks
// the pipeline when the chosen model can't satisfy the schema reliably — so a
// user picking, say, a too-small Ollama model finds out in seconds instead of
// 5–20 minutes into a doomed run.

export interface PreflightResult {
  ok: boolean;
  reason?: string;
  suggestion?: string;
  detectedTier?: ModelTier;
}

const PREFLIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "age"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 40 },
    age: { type: "integer", minimum: 0, maximum: 150 },
  },
} as const;

// 90s ceiling — Ollama cold-loading a 4B model into RAM on a CPU box routinely
// takes 30–60s on the first call. 30s used to false-positive as a model-capability
// failure. Aligns with the per-call timeouts CLAUDE.md notes for this tier.
const PREFLIGHT_TIMEOUT_MS = 90_000;

const SUGGESTION_STRUCTURED_FAIL =
  "The selected model can't reliably emit structured JSON. " +
  "Try gemma3:4b (or a similarly sized model) for local Ollama, or a cloud model from Settings.";

export async function preflightStructuredOutput(config: LLMConfig): Promise<PreflightResult> {
  const tier = await detectModelTier(config).catch(() => undefined);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);

  try {
    log.info("preflight", `Probing ${config.provider}/${config.model}...`);
    const result = await callLLMStructured<{ name: string; age: number }>(
      [{ role: "user", content: "Emit a JSON object with the name and age of a fictional person. Name must be 1+ characters, age must be an integer 0-150." }],
      config,
      {
        schema: PREFLIGHT_SCHEMA,
        toolName: "person",
        maxRepairAttempts: 1, // tight — don't burn budget here; we're just checking capability
        signal: controller.signal,
      },
    );
    log.info("preflight", `OK — model returned ${JSON.stringify(result)}`);
    return { ok: true, detectedTier: tier };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const isAbort = raw.toLowerCase().includes("abort");
    log.warn("preflight", `Failed: ${raw}`);
    return {
      ok: false,
      reason: isAbort
        ? `Model did not respond within ${PREFLIGHT_TIMEOUT_MS / 1000}s — it may be too slow or offline.`
        : raw,
      suggestion: SUGGESTION_STRUCTURED_FAIL,
      detectedTier: tier,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dev-only smoke test: window.__testStructured(provider, model) ────────────
// Temporary harness for verifying the structured-output plumbing per provider.
// Remove in Commit 5 cleanup.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__testStructured = async (
    provider: "ollama" | "openai" | "anthropic",
    model: string,
    apiKey?: string,
    ollamaUrl?: string,
  ) => {
    const config: LLMConfig = { provider, model, apiKey, ollamaUrl };
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["name", "age"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 40 },
        age: { type: "integer", minimum: 0, maximum: 150 },
      },
    };
    try {
      const result = await callLLMStructured<{ name: string; age: number }>(
        [{ role: "user", content: "Emit a JSON object with the name and age of a fictional person." }],
        config,
        { schema, toolName: "person", onProgress: (m) => console.log(`[smoke] ${m}`) },
      );
      console.log(`[smoke] ✓ ${provider}/${model}:`, result);
      return result;
    } catch (e) {
      console.error(`[smoke] ✗ ${provider}/${model}:`, e);
      throw e;
    }
  };

  // ─── Dev-only smoke test: window.__testSanitize() ─────────────────────────
  // Regression check for sanitizeJsonEscapes — the four known-broken inputs
  // small models emit (\alpha, \frac, \text{c}, \sum) plus two valid-escape
  // cases that must round-trip untouched. Asserts idempotency on every case.
  (window as unknown as Record<string, unknown>).__testSanitize = () => {
    const cases: Array<[string, string]> = [
      [String.raw`{"x":"\alpha"}`,        String.raw`{"x":"\\alpha"}`],
      [String.raw`{"x":"\frac{1}{2}"}`,   String.raw`{"x":"\\frac{1}{2}"}`],
      [String.raw`{"x":"\text{c}"}`,      String.raw`{"x":"\\text{c}"}`],
      [String.raw`{"x":"\sum_i x_i"}`,    String.raw`{"x":"\\sum_i x_i"}`],
      [String.raw`{"x":"line\nbreak"}`,   String.raw`{"x":"line\nbreak"}`],
      [String.raw`{"x":"quote\"inside"}`, String.raw`{"x":"quote\"inside"}`],
    ];
    const results = cases.map(([input, expected]) => {
      const got = sanitizeJsonEscapes(input);
      const idempotent = sanitizeJsonEscapes(got) === got;
      return { input, expected, got, ok: got === expected && idempotent };
    });
    console.table(results);
    const allOk = results.every((r) => r.ok);
    console.log(allOk ? "[sanitize] ✓ all cases pass" : "[sanitize] ✗ failures above");
    return allOk;
  };
}

// ─── Fetch available Ollama models ────────────────────────────────────────────
export async function getOllamaModels(ollamaUrl: string): Promise<{ models: string[]; error?: string }> {
  const base = normalizeBase(ollamaUrl || "http://127.0.0.1:11434");
  log.info("getOllamaModels", `GET ${base}/api/tags`);
  try {
    const response = await fetch(`${base}/api/tags`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Origin": "", // suppress tauri-plugin-http injected Origin header
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = `HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}`;
      log.warn("getOllamaModels", error);
      return { models: [], error };
    }
    const json = await response.json();
    const models = (json.models ?? []).map((m: { name: string }) => m.name);
    log.info("getOllamaModels", `Found ${models.length} models`, models);
    return { models };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const error = raw.includes("connect") || raw.includes("refused") || raw.includes("network") || raw.includes("fetch")
      ? `Connection refused — is Ollama running? Try: ollama serve`
      : raw.slice(0, 150);
    log.warn("getOllamaModels", "Connection failed", e);
    return { models: [], error };
  }
}
