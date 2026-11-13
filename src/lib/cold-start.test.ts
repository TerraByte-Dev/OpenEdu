import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The first model call after Ollama starts, on a CPU-only computer. Measured on a Ryzen 7 5800H with
// 8 GB and no GPU: gemma4:e2b took 88 s to load, and the check before a course build gave up at 90 s.
// The stand-in Ollama below behaves like the real one: it keeps one runner per model at one num_ctx,
// and any request for a model that is not in memory, or at another num_ctx, loads it first (one load
// at a time, in order). /api/ps lists what is loaded and at what size, and /api/generate with no
// prompt only loads. Fake timers stand in for the minutes.

vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

import {
  callLLMTurn, callLLMStreaming, preflightStructuredOutput, warmOllamaModel, isWaitingForTutorLoad, onTutorLoadWait,
  unloadOllamaModels, OLLAMA_KEEP_ALIVE, type LLMTurnEvent,
} from "./llm";
import { gradeAnswersBatch } from "./quiz";
import { friendlyError, preflightMessage, MODEL_LOAD_TIMED_OUT } from "./plain-language";
import { getChatTurnConfig, getGenerationConfig } from "./store";
import { warmTutorInBackground } from "./setup-check";
import { STORE_FILE, STORE_KEYS } from "./store-keys";
import { seedStore, resetStores } from "./eval/headless/shims/plugin-store";
import type { LLMConfig } from "../types";

const MODEL = "gemma4:e2b";
// What store.ts getOllamaNumCtx gives every call: the model supports 128k, the cap is 8192.
const NUM_CTX = 8192;
const CONFIG = { provider: "ollama", model: MODEL, ollamaUrl: "http://127.0.0.1:11434", contextTokens: NUM_CTX } as LLMConfig;
// What Ollama picks for a request that names no num_ctx. It varies by version and machine; any value
// other than NUM_CTX means a second runner.
const OLLAMA_DEFAULT_CTX = 4096;
const original = globalThis.fetch;

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

type Body = Record<string, unknown> & { options?: { num_ctx?: number }; format?: unknown };
interface Call { path: string; body?: Body }

function fakeOllama(o: { loaded: false | number; loadMs: number; reply: string | ((body: Body) => string) }) {
  // runnerCtx: the num_ctx of the loaded runner, null while none is loaded. runnerLoads counts every
  // load, including the reload a request at another num_ctx forces.
  const server = { runnerCtx: o.loaded === false ? null : o.loaded as number | null, runnerLoads: 0, calls: [] as Call[] };
  let queue = Promise.resolve();
  const ensureLoaded = (ctx: number) => (queue = queue.then(() => {
    if (server.runnerCtx === ctx) return;
    server.runnerCtx = null;
    server.runnerLoads++;
    return new Promise<void>((r) => setTimeout(() => { server.runnerCtx = ctx; r(); }, o.loadMs));
  }));
  // tauri-plugin-http rejects a cancelled fetch with this bare string.
  const untilLoaded = (body: Body | undefined, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
    signal?.addEventListener("abort", () => reject("Request canceled"));
    void ensureLoaded(body?.options?.num_ctx ?? OLLAMA_DEFAULT_CTX).then(resolve);
  });
  const reply = (body: Body) => typeof o.reply === "string" ? o.reply : o.reply(body);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Body : undefined;
    server.calls.push({ path, body });
    switch (path) {
      case "/api/version": return json({ version: "0.40.15" });
      case "/api/tags": return json({ models: [{ name: MODEL }] });
      case "/api/show": return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma4", "gemma4.context_length": 131072 }, capabilities: ["completion", "tools"] });
      case "/api/ps": return json({ models: server.runnerCtx === null ? [] : [{ name: MODEL, model: MODEL, context_length: server.runnerCtx }] });
      case "/api/generate":
        if (body?.keep_alive === 0) { server.runnerCtx = null; return json({ model: MODEL, response: "", done: true, done_reason: "unload" }); }
        await untilLoaded(body, init?.signal);
        return json({ model: MODEL, response: "", done: true, done_reason: "load" });
      case "/api/chat":
        await untilLoaded(body, init?.signal);
        if (body?.stream) {
          const lines = `${JSON.stringify({ message: { content: reply(body) }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop" })}\n`;
          return new Response(lines, { status: 200 });
        }
        return json({ message: { role: "assistant", content: reply(body!) }, done: true, done_reason: "stop" });
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
    expect(loads(server)[0].body).toEqual({ model: MODEL, stream: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: NUM_CTX } });
    expect(server.runnerLoads).toBe(1);
    // The check's own request asked Ollama to keep the model loaded too.
    expect(server.calls.find((c) => c.path === "/api/chat")?.body?.keep_alive).toBe(OLLAMA_KEEP_ALIVE);
  });

  it("tells the parent the model is loading while it waits, and stops when it is ready", async () => {
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

  it("does not load a model that is already in memory at the same size", async () => {
    const server = fakeOllama({ loaded: NUM_CTX, loadMs: 120_000, reply: JSON.stringify({ name: "Ada", age: 36 }) });

    const r = await preflightStructuredOutput(CONFIG);

    expect(r.ok).toBe(true);
    expect(loads(server)).toHaveLength(0);
    expect(server.runnerLoads).toBe(0);
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
    expect(server.runnerLoads).toBe(1);
  });

  it("gives up after 5 minutes of loading and says the model took too long to load, in the same words everywhere", async () => {
    fakeOllama({ loaded: false, loadMs: 10 * 60_000, reply: "{}" });

    const pending = preflightStructuredOutput(CONFIG);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const r = await pending;

    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(preflightMessage(!!r.timedOut, r.reason ?? "")).toBe("The learning model took too long to load. Close other programs, then try again.");
    expect(friendlyError(r.reason)).toBe(MODEL_LOAD_TIMED_OUT);
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
  it("answers, and loads at the turn's own context window so the reply reuses the load", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 200_000, reply: "Plants make food from light." });

    const pending = drain(callLLMTurn([{ role: "user", content: "What is photosynthesis?" }], CONFIG, { tier: "tiny" }));
    await vi.advanceTimersByTimeAsync(201_000);
    const events = await pending;

    expect(events).toEqual([
      { type: "text", delta: "Plants make food from light." },
      { type: "done", finishReason: "stop" },
    ]);
    expect(loads(server)[0].body).toEqual({ model: MODEL, stream: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: NUM_CTX } });
    expect(server.runnerLoads).toBe(1);
    expect(server.calls.find((c) => c.path === "/api/chat")?.body?.keep_alive).toBe(OLLAMA_KEEP_ALIVE);
  });

  it("Stop during the load ends the turn quietly, and the load goes on for the next try", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 200_000, reply: "Hello." });
    const ctrl = new AbortController();

    const pending = drain(callLLMTurn([{ role: "user", content: "hi" }], CONFIG, { tier: "tiny", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(10_000);
    ctrl.abort();
    expect(await pending).toEqual([{ type: "done", finishReason: "aborted" }]);

    await vi.advanceTimersByTimeAsync(191_000);
    const again = await drain(callLLMTurn([{ role: "user", content: "hi" }], CONFIG, { tier: "tiny" }));
    expect(again[again.length - 1]).toEqual({ type: "done", finishReason: "stop" });
    expect(loads(server)).toHaveLength(1);
    expect(server.runnerLoads).toBe(1);
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

describe("one model, one size: app open, then chat, then Create course, then quiz grading", () => {
  const ANSWER = [{ index: 0, question: "What do plants need for photosynthesis?", expected: "sunlight, water and carbon dioxide", student: "soil", type: "short_answer" as const }];
  // Each request gets the answer its schema asks for; a chat turn and the pedagogy step get prose.
  const reply = (body: Body) => {
    const props = (body.format as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
    if ("results" in props) return JSON.stringify({ results: [{ index: 0, correct: false, feedback: "Not quite." }] });
    if ("name" in props) return JSON.stringify({ name: "Ada", age: 36 });
    return "Plants make food from light.";
  };

  beforeEach(() => {
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.provider]: "ollama", [STORE_KEYS.chatModel]: MODEL, [STORE_KEYS.genModel]: MODEL });
  });

  // The app's own configs, in the order a family meets them on a cold CPU-only computer.
  async function dayOne() {
    await warmTutorInBackground({ checks: [], ready: true, complete: true, ollama: "ready" });
    await vi.advanceTimersByTimeAsync(30_000); // the app-open load is still running when the learner chats

    const { config: chat } = await getChatTurnConfig();
    const events = await settle(drain(callLLMTurn([{ role: "user", content: "What is photosynthesis?" }], chat, { tier: "tiny" })));

    // Create course: the check, then a step that streams (the pedagogy step), then quiz grading.
    const gen = await getGenerationConfig();
    const preflight = await settle(preflightStructuredOutput(gen));
    const pedagogy = await settle(callLLMStreaming([{ role: "user", content: "Write the tutor's pedagogy." }], gen, () => {}));
    const graded = await settle(gradeAnswersBatch(ANSWER, await getGenerationConfig()));
    return { events, preflight, pedagogy, graded };
  }

  // Time runs on through each step, so a reload finishes (and is counted) instead of hanging the test.
  async function settle<T>(p: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(200_000);
    return p;
  }

  it("loads the model exactly once, and every request names the same num_ctx", async () => {
    const server = fakeOllama({ loaded: false, loadMs: 88_000, reply });

    const { events, preflight, pedagogy, graded } = await dayOne();

    expect(events[events.length - 1]).toEqual({ type: "done", finishReason: "stop" });
    expect(preflight.ok).toBe(true);
    expect(pedagogy).toBe("Plants make food from light.");
    expect(graded.get(0)?.by).toBe("model");
    expect(server.runnerLoads).toBe(1);
    expect(loads(server)).toHaveLength(1);
    const sizes = server.calls.filter((c) => c.path === "/api/chat" || c.path === "/api/generate").map((c) => c.body?.options?.num_ctx);
    expect(new Set(sizes)).toEqual(new Set([NUM_CTX]));
  });

  it("the stand-in does charge a reload: a course-building call at Ollama's default size loads again", async () => {
    // The shape before this change: chat at 8192, course building with no num_ctx.
    const server = fakeOllama({ loaded: false, loadMs: 88_000, reply });
    const { config: chat } = await getChatTurnConfig();
    const turn = drain(callLLMTurn([{ role: "user", content: "hi" }], chat, { tier: "tiny" }));
    await vi.advanceTimersByTimeAsync(89_000);
    await turn;

    const pending = gradeAnswersBatch(ANSWER, { ...chat, contextTokens: undefined });
    await vi.advanceTimersByTimeAsync(89_000);
    await pending;

    expect(server.runnerLoads).toBe(2);
  });
});

describe("closing the app", () => {
  it("unloads the models it used, once", async () => {
    globalThis.fetch = (async () => json({ models: [] })) as typeof fetch;
    await unloadOllamaModels(); // forget what earlier tests used
    const server = fakeOllama({ loaded: NUM_CTX, loadMs: 1_000, reply: "ok" });
    await warmOllamaModel(CONFIG);

    await unloadOllamaModels();
    await unloadOllamaModels();

    expect(loads(server).map((c) => c.body)).toEqual([{ model: MODEL, keep_alive: 0 }]);
    expect(server.runnerCtx).toBeNull();
  });
});
