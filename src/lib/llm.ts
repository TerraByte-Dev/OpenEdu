import { fetch } from "@tauri-apps/plugin-http";
import type { LLMConfig } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Strip trailing slashes so we never build double-slash paths like /api//tags
function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
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
