import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// glossQuestion's deadline (review of PR #188, findings A and B), against a stand-in Ollama:
//   - A: it must work, and never throw, where AbortSignal.any and AbortSignal.timeout do not exist
//     (Safari before 17.4, WebKitGTK before 2.44). Node has both, so the test deletes them.
//   - B: when /api/ps says the chat model is not in memory, the gloss is the call that loads it and
//     gets the cold deadline, not the warm one.

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) }));

import { glossQuestion } from "./gloss";
import type { LLMConfig } from "../../types";

const MODEL = "gemma4:e2b";
const GLOSS = "What is photosynthesis?";
const ASK = "प्रकाश संश्लेषण क्या है?";
const config = { provider: "ollama", model: MODEL, ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
const messages = [{ role: "user" as const, content: ASK }];
const deadlines = { warm: 150, cold: 1_500 };

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

let loaded: unknown[] | "error" = [];
let chatDelayMs = 0;
let chatHangs = false;

function fakeOllama(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = new URL(String(input)).pathname;
  if (path === "/api/version") return Promise.resolve(json({ version: "0.40.15" }));
  if (path === "/api/ps") return loaded === "error" ? Promise.reject(new TypeError("connection refused")) : Promise.resolve(json({ models: loaded }));
  if (path !== "/api/chat") return Promise.resolve(new Response("not found", { status: 404 }));
  return new Promise((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    if (chatHangs) return;
    setTimeout(() => resolve(json({ message: { role: "assistant", content: JSON.stringify({ english: GLOSS }) }, done: true })), chatDelayMs);
  });
}

const savedAny = AbortSignal.any;
const savedTimeout = AbortSignal.timeout;

beforeEach(() => {
  globalThis.fetch = fakeOllama as typeof fetch;
  loaded = [{ name: MODEL, model: MODEL }];
  chatDelayMs = 0;
  chatHangs = false;
  // An older webview: neither API exists.
  delete (AbortSignal as { any?: unknown }).any;
  delete (AbortSignal as { timeout?: unknown }).timeout;
});

afterEach(() => {
  AbortSignal.any = savedAny;
  AbortSignal.timeout = savedTimeout;
});

describe("glossQuestion without AbortSignal.any and AbortSignal.timeout (finding A)", () => {
  it("returns the gloss, with and without the turn's own signal", async () => {
    expect((AbortSignal as { any?: unknown }).any).toBeUndefined();
    expect((AbortSignal as { timeout?: unknown }).timeout).toBeUndefined();
    expect(await glossQuestion(messages, ASK, config, { deadlines })).toMatchObject({ text: GLOSS });
    expect(await glossQuestion(messages, ASK, config, { deadlines, signal: new AbortController().signal })).toMatchObject({ text: GLOSS });
  });

  it("times out without throwing when the model never answers", async () => {
    chatHangs = true;
    const r = await glossQuestion(messages, ASK, config, { deadlines });
    expect(r.text).toBeNull();
    expect(r.error).toBe(`gloss timed out after ${deadlines.warm} ms`);
  });

  it("stops without throwing when the turn is aborted, and says so", async () => {
    chatHangs = true;
    const turn = new AbortController();
    setTimeout(() => turn.abort(), 20);
    const r = await glossQuestion(messages, ASK, config, { deadlines, signal: turn.signal });
    expect(r.text).toBeNull();
    expect(r.error).not.toMatch(/timed out/);
    expect(r.ms).toBeLessThan(deadlines.warm);
  });
});

describe("the cold deadline (finding B)", () => {
  it("keeps a gloss slower than the warm deadline when /api/ps does not list the model", async () => {
    loaded = [{ name: "nomic-embed-text:latest", model: "nomic-embed-text:latest" }];
    chatDelayMs = 400;
    const r = await glossQuestion(messages, ASK, config, { deadlines });
    expect(r).toMatchObject({ text: GLOSS });
    expect(r.ms).toBeGreaterThanOrEqual(chatDelayMs - 10);
  });

  it("uses the cold deadline when the probe fails, and still gives up at it", async () => {
    loaded = "error";
    chatDelayMs = 400;
    expect(await glossQuestion(messages, ASK, config, { deadlines })).toMatchObject({ text: GLOSS });
    chatHangs = true;
    const r = await glossQuestion(messages, ASK, config, { deadlines });
    expect(r.error).toBe(`gloss timed out after ${deadlines.cold} ms`);
    expect(r.ms).toBeGreaterThanOrEqual(deadlines.cold - 10);
    expect(r.ms).toBeLessThan(deadlines.cold + 500);
  });

  it("treats a runner at another num_ctx as cold, since the call reloads it", async () => {
    loaded = [{ name: MODEL, model: MODEL, context_length: 4096 }];
    chatDelayMs = 400;
    expect(await glossQuestion(messages, ASK, { ...config, contextTokens: 8192 }, { deadlines })).toMatchObject({ text: GLOSS });
  });

  it("keeps the warm deadline when the model is loaded, at the turn's num_ctx", async () => {
    loaded = [{ name: MODEL, model: MODEL, context_length: 8192 }];
    chatDelayMs = 400;
    const r = await glossQuestion(messages, ASK, { ...config, contextTokens: 8192 }, { deadlines });
    expect(r.text).toBeNull();
    expect(r.error).toBe(`gloss timed out after ${deadlines.warm} ms`);
  });
});
