import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// llm.ts calls @tauri-apps/plugin-http's fetch. The headless shim forwards to globalThis.fetch, which
// here refuses every connection the way the real plugin does: invoke('plugin:http|fetch_send')
// rejects with reqwest 0.12's bare string, not an Error. Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMTurn, pullOllamaModel, type NeutralMessage } from "./llm";
import type { LLMConfig } from "../types";

const USER: NeutralMessage[] = [{ role: "user", content: "hi" }];
const original = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() => Promise.reject("error sending request for url (http://127.0.0.1:11434/api/chat)")) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = original; });

async function turnError(config: LLMConfig): Promise<string> {
  try {
    for await (const ev of callLLMTurn(USER, config)) void ev;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the turn to fail");
}

describe("a refused connection", () => {
  it("to local Ollama says Ollama isn't running, not to check the internet", async () => {
    const msg = await turnError({ provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig);
    expect(msg).toBe("Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.");
  });

  it("while pulling a model from local Ollama says the same", async () => {
    await expect(pullOllamaModel("gemma4:e2b", "http://localhost:11434")).rejects.toThrow(
      new Error("Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again."),
    );
  });

  it("to Ollama on another computer names that address, not the internet", async () => {
    const msg = await turnError({ provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://192.168.1.20:11434" } as LLMConfig);
    expect(msg).toBe("Ollama isn't answering at http://192.168.1.20:11434. Check that the computer running it is on and Ollama is started.");
  });

  it("to a cloud provider still says to check the internet connection", async () => {
    const msg = await turnError({ provider: "openai", model: "gpt-4o-mini", apiKey: "test-key" } as LLMConfig);
    expect(msg).toBe("Network error — check your internet connection and try again.");
  });
});

// The real plugin rejects a cancelled fetch with the bare string "Request canceled" (Rust
// Error::RequestCanceled), never an AbortError. Before headers arrive — a CPU-only model loading —
// that must end the turn quietly, not claim Ollama isn't running.
describe("a fetch cancelled before Ollama answers", () => {
  const LOCAL = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;

  beforeEach(() => {
    globalThis.fetch = ((_u: unknown, init: RequestInit) => new Promise((_, rej) => {
      init.signal!.addEventListener("abort", () => rej("Request canceled"));
    })) as unknown as typeof fetch;
  });
  afterEach(() => { vi.useRealTimers(); });

  it("by Stop ends the turn as aborted, with no error", async () => {
    const ctrl = new AbortController();
    const events = [];
    const turn = callLLMTurn(USER, LOCAL, { signal: ctrl.signal });
    const next = turn.next();
    ctrl.abort();
    const first = await next;
    if (!first.done) events.push(first.value);
    for await (const ev of turn) events.push(ev);
    expect(events[events.length - 1]).toEqual({ type: "done", finishReason: "aborted" });
  });

  it("by the first-byte stall timer ends the turn as stalled, with no error", async () => {
    vi.useFakeTimers();
    const events = [];
    const turn = callLLMTurn(USER, LOCAL);
    const next = turn.next();
    await vi.advanceTimersByTimeAsync(120_001);
    const first = await next;
    if (!first.done) events.push(first.value);
    for await (const ev of turn) events.push(ev);
    expect(events[events.length - 1]).toEqual({ type: "done", finishReason: "stalled" });
  });
});
