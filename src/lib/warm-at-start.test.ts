import { describe, it, expect, vi, afterEach } from "vitest";

// When the app opens with Ollama set up, it starts loading the course-building model straight away,
// so the first Create course of the day finds it in memory.

vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("./store", () => ({
  getGenerationConfig: async () => ({ provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" }),
  getChatConfig: async () => { throw new Error("not used"); },
  getEmbeddingConfig: async () => { throw new Error("not used"); },
  getLLMProvider: async () => { throw new Error("not used"); },
}));

import { warmTutorInBackground, type SetupStatus } from "./setup-check";
import { isWaitingForTutorLoad, OLLAMA_KEEP_ALIVE } from "./llm";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

function recordingOllama() {
  const calls: Array<{ path: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/api/ps") return new Response(JSON.stringify({ models: [] }), { status: 200 });
    return new Promise<Response>(() => {}); // the load: still going when the app moves on
  }) as typeof fetch;
  return calls;
}

const READY: SetupStatus = { checks: [], ready: true, complete: true, ollama: "ready" };

describe("loading the tutor when the app opens", () => {
  it("starts loading the course-building model without waiting for it, and shows nothing", async () => {
    const calls = recordingOllama();

    await warmTutorInBackground(READY);

    expect(calls.map((c) => c.path)).toEqual(["/api/ps", "/api/generate"]);
    expect(calls[1].body).toEqual({ model: "gemma4:e2b", stream: false, keep_alive: OLLAMA_KEEP_ALIVE });
    expect(isWaitingForTutorLoad()).toBe(false);
  });

  it("does nothing for a cloud provider, or while setup still blocks", async () => {
    const calls = recordingOllama();

    await warmTutorInBackground({ checks: [], ready: true, complete: true }); // cloud: no Ollama state
    await warmTutorInBackground({ ...READY, ready: false, ollama: "no-model" });

    expect(calls).toEqual([]);
  });
});
