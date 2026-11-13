import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The first model call after Ollama starts, on a CPU-only computer. Measured on a Ryzen 7 5800H with
// 8 GB and no GPU: gemma4:e2b took 88 s to load, and the check before a course build gave up at 90 s.
// The stand-in Ollama below behaves like the real one: any request for a model that is not in memory
// loads it first (one load at a time), /api/ps lists what is loaded, and /api/generate with no prompt
// only loads. Fake timers stand in for the minutes.

vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import {
  callLLMTurn, preflightStructuredOutput, warmOllamaModel, isWaitingForTutorLoad, onTutorLoadWait,
  OLLAMA_KEEP_ALIVE, type LLMTurnEvent,
} from "./llm";
import { gradeAnswersBatch } from "./quiz";
import { friendlyError, preflightMessage } from "./plain-language";
import type { LLMConfig } from "../types";

const MODEL = "gemma4:e2b";
const CONFIG = { provider: "ollama", model: MODEL, ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
const original = globalThis.fetch;

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

interface Call { path: string; body?: Record<string, unknown> }

function fakeOllama(o: { loaded: boolean; loadMs: number; reply: string }) {
  const server = { loaded: o.loaded, calls: [] as Call[] };
  let loading: Promise<void> | null = null;
  const ensureLoaded = () => server.loaded ? Promise.resolve() : (loading ??= new Promise<void>((r) => setTimeout(() => { server.loaded = true; r(); }, o.loadMs)));
  // tauri-plugin-http rejects a cancelled fetch with this bare string.
  const untilLoaded = (signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
    signal?.addEventListener("abort", () => reject("Request canceled"));
    void ensureLoaded().then(resolve);
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    server.calls.push({ path, body });
    switch (path) {
      case "/api/version": return json({ version: "0.40.15" });
      case "/api/show": return json({ details: { parameter_size: "5.1B" }, model_info: {}, capabilities: ["completion", "tools"] });
      case "/api/ps": return json({ models: server.loaded ? [{ name: MODEL, model: MODEL }] : [] });
      case "/api/generate":
        await untilLoaded(init?.signal);
        return json({ model: MODEL, response: "", done: true, done_reason: "load" });
      case "/api/chat":
        await untilLoaded(init?.signal);
        if (body?.stream) {
          const lines = `${JSON.stringify({ message: { content: o.reply }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop" })}\n`;
          return new Response(lines, { status: 200 });
        }
        return json({ message: { role: "assistant", content: o.reply }, done: true, done_reason: "stop" });
      default:
        return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
  return server;
}

const loads = (server: { calls: Call[] }) => server.calls.filter((c) => c.path === "/api/generate");

async function drain(turn: AsyncGenerator<LLMTurnEvent>): Promise<LLMTurnEvent[]> {
  const events: LLMTurnEvent[] = [];
  for await (const ev of turn) events.push(ev);
  return events;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { globalThis.fetch = original; vi.useRealTimers(); });

describe("the check before a course build, on a model that takes 120 s to load", () => {
  it("passes: the load runs first, outside the check's 90 s", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 120_000, reply: JSON.stringify({ name: "Ada", age: 36 }) });

    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(121_000);
    const r = await pending;

    expect(r).toMatchObject({ ok: true });
    expect(loads(server)).toHaveLength(1);
    expect(loads(server)[0].body).toEqual({ model: MODEL, stream: false, keep_alive: OLLAMA_KEEP_ALIVE });
    // The check's own request asked Ollama to keep the model loaded too.
    expect(server.calls.find((c) => c.path === "/api/chat")?.body?.keep_alive).toBe(OLLAMA_KEEP_ALIVE);
  });

  it("tells the parent the tutor is getting ready while it waits, and stops when it is ready", async () => {
    fakeOllama({ loaded: false, loadMs: 120_000, reply: JSON.stringify({ name: "Ada", age: 36 }) });
    const seen: boolean[] = [];
    const off = onTutorLoadWait((w) => seen.push(w));

    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isWaitingForTutorLoad()).toBe(true);
    await vi.advanceTimersByTimeAsync(61_000);
    await pending;
    off();

    expect(isWaitingForTutorLoad()).toBe(false);
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  it("does not load a model that is already in memory", async () => {
    const server = fakeOllama({ loaded: true, loadMs: 120_000, reply: JSON.stringify({ name: "Ada", age: 36 }) });

    const r = await preflightStructuredOutput(CONFIG);

    expect(r.ok).toBe(true);
    expect(loads(server)).toHaveLength(0);
    expect(isWaitingForTutorLoad()).toBe(false);
  });

  it("joins the load the app started in the background, without showing the wait until someone waits", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 120_000, reply: JSON.stringify({ name: "Ada", age: 36 }) });

    await warmOllamaModel(CONFIG, { background: true }); // returns once the load has started
    expect(loads(server)).toHaveLength(1);
    expect(isWaitingForTutorLoad()).toBe(false);

    await vi.advanceTimersByTimeAsync(100_000); // the parent looks around for 100 s, then clicks Create course
    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(21_000);
    const r = await pending;

    expect(r.ok).toBe(true);
    expect(loads(server)).toHaveLength(1);
  });

  it("gives up after 5 minutes of loading and says the tutor took too long to wake up", async () => {
    fakeOllama({ loaded: false, loadMs: 10 * 60_000, reply: "{}" });

    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const r = await pending;

    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(preflightMessage(!!r.timedOut, r.reason ?? "")).toBe("The tutor took too long to wake up. Try again — it is usually quicker the second time.");
    expect(friendlyError(r.reason)).toBe("The tutor took too long to wake up. Close other programs, then try again.");
  });

  it("with Ollama not running still says so, in the same words as before", async () => {
    globalThis.fetch = (() => Promise.reject("error sending request for url (http://127.0.0.1:11434/api/ps)")) as unknown as typeof fetch;

    const r = await preflightStructuredOutput(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
    const said = "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.";
    expect(r.reason).toBe(said);
    expect(preflightMessage(false, r.reason ?? "")).toBe(said);
  });
});

describe("the first chat turn, on a model that takes 200 s to load", () => {
  // 200 s is past the 180 s first-byte budget a tiny model's turn gets, which used to include the load.
  const CHAT = { ...CONFIG, contextTokens: 8192 } as LLMConfig;

  it("answers, and loads at the turn's own context window so the reply reuses the load", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 200_000, reply: "Plants make food from light." });

    const pending = drain(callLLMTurn([{ role: "user", content: "What is photosynthesis?" }], CHAT, { tier: "tiny" }));
    await vi.advanceTimersByTimeAsync(201_000);
    const events = await pending;

    expect(events).toEqual([
      { type: "text", delta: "Plants make food from light." },
      { type: "done", finishReason: "stop" },
    ]);
    expect(loads(server)[0].body).toEqual({ model: MODEL, stream: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: 8192 } });
    expect(server.calls.find((c) => c.path === "/api/chat")?.body?.keep_alive).toBe(OLLAMA_KEEP_ALIVE);
  });

  it("Stop during the load ends the turn quietly, and the load goes on for the next try", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 200_000, reply: "Hello." });
    const ctrl = new AbortController();

    const pending = drain(callLLMTurn([{ role: "user", content: "hi" }], CHAT, { tier: "tiny", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(10_000);
    ctrl.abort();
    expect(await pending).toEqual([{ type: "done", finishReason: "aborted" }]);

    await vi.advanceTimersByTimeAsync(191_000);
    const again = await drain(callLLMTurn([{ role: "user", content: "hi" }], CHAT, { tier: "tiny" }));
    expect(again[again.length - 1]).toEqual({ type: "done", finishReason: "stop" });
    expect(loads(server)).toHaveLength(1);
  });
});

describe("quiz grading, on a model that takes 200 s to load", () => {
  it("is graded by the model, not waved through by the lenient fallback", async () => {
    // A tiny model's per-call budget is 180 s, which the load used to eat.
    fakeOllama({ loaded: false, loadMs: 200_000, reply: JSON.stringify({ results: [{ index: 0, correct: false, feedback: "Not quite." }] }) });

    const pending = gradeAnswersBatch(
      [{ index: 0, question: "What do plants need for photosynthesis?", expected: "sunlight, water and carbon dioxide", student: "soil", type: "short_answer" }],
      { ...CONFIG },
    );
    await vi.advanceTimersByTimeAsync(201_000);
    const graded = await pending;

    expect(graded.get(0)).toEqual({ isCorrect: false, feedback: "Not quite.", by: "model" });
  });
});
