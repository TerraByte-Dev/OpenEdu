import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// llm.ts calls @tauri-apps/plugin-http's fetch; the headless shim forwards to globalThis.fetch.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { preflightStructuredOutput } from "./llm";
import { preflightMessage } from "./plain-language";
import type { LLMConfig } from "../types";

const original = globalThis.fetch;
const CONFIG = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
const EIGHT_GB = 8 * 1024 ** 3;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { globalThis.fetch = original; vi.useRealTimers(); });

describe("the check before a course build", () => {
  it("reads a model still loading as a timeout and shows no model advice", async () => {
    // A cold model: /api/chat never answers until the check gives up. tauri-plugin-http rejects a
    // cancelled fetch with this bare string, never an AbortError.
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (!String(url).endsWith("/api/chat")) return Promise.reject("error sending request");
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject("Request canceled")));
    }) as unknown as typeof fetch;

    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(90_000);
    const r = await pending;

    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    const shown = preflightMessage(!!r.timedOut, r.reason ?? "", { model: CONFIG.model, provider: "ollama", ramBytes: EIGHT_GB });
    expect(shown).toBe("The tutor took too long to wake up. Try again — it is usually quicker the second time.");
    expect(shown).not.toMatch(/gemma|JSON|model/i);
  });

  it("on an 8 GB computer never tells the parent to get gemma4:e4b when the model gets it wrong", async () => {
    // Ollama answers, but never with the JSON the check asks for.
    globalThis.fetch = ((url: string) => {
      if (!String(url).endsWith("/api/chat")) return Promise.reject("error sending request");
      return Promise.resolve(new Response(JSON.stringify({ message: { content: "Sure! Here is a person: Bob, 40" }, done_reason: "stop" }), { status: 200 }));
    }) as unknown as typeof fetch;

    const r = await preflightStructuredOutput(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
    const shown = preflightMessage(false, r.reason ?? "", { model: CONFIG.model, provider: "ollama", ramBytes: EIGHT_GB });
    expect(shown).toBe("The tutor couldn't put this together this time. Try again.");
    expect(shown).not.toMatch(/e4b|JSON|structured/i);
  });
});
