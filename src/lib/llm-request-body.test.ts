import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// llm.ts calls @tauri-apps/plugin-http's fetch. The headless shim forwards to globalThis.fetch, so the
// stub below sees the exact request body every call site builds. Nothing here touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLM, callLLMStructured, callLLMTurn, cloudModelTier, streamChat, type NeutralMessage, type ProviderToolDef } from "./llm";
import type { LLMConfig } from "../types";

const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
const TOOLS: ProviderToolDef[] = [{ name: "notebook_search", description: "Search notes", parameters: { type: "object", properties: { q: { type: "string" } } } }];
const USER: NeutralMessage[] = [{ role: "user", content: "hi" }];

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");

let bodies: Array<Record<string, unknown>> = [];
const original = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const anthropic = String(input).includes("anthropic.com");
    if (body.stream) {
      return new Response(anthropic
        ? sse([{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }])
        : sse([{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"]), { status: 200 });
    }
    return Response.json(anthropic
      ? { content: [{ type: "text", text: "ok" }, { type: "tool_use", input: { ok: true } }] }
      : { choices: [{ message: { content: "{\"ok\":true}" } }] });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = original; vi.useRealTimers(); });

const config = (model: string): LLMConfig =>
  ({ provider: model.startsWith("claude") ? "anthropic" : "openai", model, apiKey: "test-key" }) as LLMConfig;

// Every path a cloud model reaches: course building, the tutor turn ChatTab runs through TutorEngine,
// plain callLLM (Verify key, small helpers) and streamChat. `temperature` is what that path is given.
const PATHS: Array<{ name: string; temperature?: number; run: (c: LLMConfig) => Promise<unknown> }> = [
  { name: "callLLMStructured", temperature: 0.2, run: (c) => callLLMStructured(USER, c, { schema: SCHEMA }) },
  {
    name: "callLLMTurn", temperature: 0.3,
    run: async (c) => { for await (const ev of callLLMTurn(USER, c, { tools: TOOLS, temperature: 0.3 })) void ev; },
  },
  { name: "callLLM", run: (c) => callLLM(USER, c) },
  {
    name: "streamChat",
    run: (c) => new Promise<void>((resolve, reject) =>
      void streamChat({ messages: USER, config: c, onToken: () => {}, onDone: () => resolve(), onError: (e) => reject(new Error(e)) })),
  },
];

// What each model must and must not be sent. `temperature: "kept"` means it is sent when the path has one.
const EXPECT: Record<string, { temperature: "kept" | "never"; reasoning_effort?: string; thinking?: unknown; max_tokens?: number }> = {
  "gpt-6.1-sol": { temperature: "never" },
  "gpt-6-luna": { temperature: "never", reasoning_effort: "none" },
  "claude-haiku-5-5": { temperature: "never", thinking: { type: "disabled" }, max_tokens: 8096 },
  "claude-opus-4-6": { temperature: "kept", max_tokens: 8096 },
};

describe("the request body each call site sends (issue #2)", () => {
  for (const [model, want] of Object.entries(EXPECT)) {
    for (const path of PATHS) {
      it(`${path.name} → ${model}`, async () => {
        await path.run(config(model));
        expect(bodies).toHaveLength(1);
        const body = bodies[0];
        expect(body.model).toBe(model);

        if (want.temperature === "kept" && path.temperature !== undefined) expect(body.temperature).toBe(path.temperature);
        else expect(body).not.toHaveProperty("temperature");

        if (want.reasoning_effort) expect(body.reasoning_effort).toBe(want.reasoning_effort);
        else expect(body).not.toHaveProperty("reasoning_effort");

        if (want.thinking) expect(body.thinking).toEqual(want.thinking);
        else expect(body).not.toHaveProperty("thinking");

        if (want.max_tokens) expect(body.max_tokens).toBe(want.max_tokens);
        else expect(body).not.toHaveProperty("max_tokens");
        expect(body).not.toHaveProperty("max_completion_tokens");
      });
    }
  }
});

describe("callLLMStructured's timeout on the OpenAI generation default", () => {
  it("waits the full 90s for gpt-6.1-sol before timing out", async () => {
    vi.useFakeTimers();
    // A provider that never answers; it only rejects when the per-call controller aborts.
    globalThis.fetch = ((_input: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    })) as unknown as typeof fetch;

    let error: Error | undefined;
    const call = callLLMStructured(USER, config("gpt-6.1-sol"), { schema: SCHEMA, tier: cloudModelTier("openai", "gpt-6.1-sol") })
      .catch((e: Error) => { error = e; });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000); // the abort, plus fetchWithRetry's back-off on the aborted retries
    await call;
    expect(error?.message).toMatch(/timed out after 90s/);
  });
});
