import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// llm.ts calls @tauri-apps/plugin-http's fetch. The headless shim forwards to globalThis.fetch, which
// here refuses every connection the way WebView2 does ("Failed to fetch"). Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMTurn, pullOllamaModel, type NeutralMessage } from "./llm";
import type { LLMConfig } from "../types";

const USER: NeutralMessage[] = [{ role: "user", content: "hi" }];
const original = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
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
    expect(msg).toContain("isn't running on this computer. Start Ollama");
    expect(msg).not.toMatch(/internet/i);
  });

  it("while pulling a model from local Ollama says the same", async () => {
    await expect(pullOllamaModel("gemma4:e2b", "http://localhost:11434")).rejects.toThrow(/isn't running on this computer/);
  });

  it("to Ollama on another computer names that address, not the internet", async () => {
    const msg = await turnError({ provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://192.168.1.20:11434" } as LLMConfig);
    expect(msg).toContain("Ollama isn't answering at http://192.168.1.20:11434");
    expect(msg).not.toMatch(/internet/i);
  });

  it("to a cloud provider still says to check the internet connection", async () => {
    const msg = await turnError({ provider: "openai", model: "gpt-4o-mini", apiKey: "test-key" } as LLMConfig);
    expect(msg).toContain("check your internet connection");
  });
});
