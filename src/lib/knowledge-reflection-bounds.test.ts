import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The post-turn reflection (updateKnowledgeFiles, what ChatTab runs after every reply) never delays the
// learner's next reply on a CPU-only PC: it is length-capped, timed out, and stopped by ChatTab's signal when
// the next turn starts or the chat closes. A stopped one writes nothing and throws nothing.
// llm.ts is real here; only Ollama is played (plugin-http's shim forwards to globalThis.fetch).
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("./db", () => ({
  getTutorInstructions: vi.fn(async () => ({})),
  saveTutorInstruction: vi.fn(async () => {}),
}));

import { updateKnowledgeFiles, REFLECTION_MAX_TOKENS, REFLECTION_TIMEOUT_MS } from "./knowledge";
import { saveTutorInstruction } from "./db";
import type { LLMConfig } from "../types";
import chatSource from "../components/ChatTab.tsx?raw";

const config = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434", contextTokens: 8192 } as unknown as LLMConfig;
const REPLY = { message: { content: '{"knowledge_map": "Knows that 6 x 7 = 42."}' } };

const original = globalThis.fetch;
let requests: Array<{ body: Record<string, unknown>; signal?: AbortSignal }> = [];

/** Ollama that answers at once (`hang` false) or only ever rejects when the request is aborted. */
function ollama(hang: boolean) {
  globalThis.fetch = ((_input: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    requests.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
    if (!hang) return Promise.resolve(Response.json(REPLY));
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requests = [];
  vi.mocked(saveTutorInstruction).mockClear();
});
afterEach(() => { globalThis.fetch = original; vi.useRealTimers(); });

const reflect = (signal?: AbortSignal) =>
  updateKnowledgeFiles("course-1", "Is 6 x 7 = 42?", "Yes, 6 x 7 = 42.", config, "default", signal);

describe("the post-turn reflection's bounds", () => {
  it("asks Ollama for at most REFLECTION_MAX_TOKENS, on the chat's window, and writes the answer", async () => {
    ollama(false);
    await reflect(new AbortController().signal);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.options).toEqual({ num_ctx: 8192, num_predict: REFLECTION_MAX_TOKENS });
    expect(requests[0].signal).toBeDefined();
    expect(saveTutorInstruction).toHaveBeenCalledWith("course-1", "knowledge_map", "Knows that 6 x 7 = 42.");
  });

  it("stops at once when the next turn starts, sends nothing again and writes nothing", async () => {
    ollama(true);
    const turn = new AbortController();
    const run = reflect(turn.signal);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    turn.abort();
    await run; // resolves: no retry back-off, no throw
    expect(requests[0].signal?.aborted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(saveTutorInstruction).not.toHaveBeenCalled();
  });

  it("is dropped quietly after REFLECTION_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    ollama(true);
    let done = false;
    const run = reflect().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(REFLECTION_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(requests).toHaveLength(1);
    expect(saveTutorInstruction).not.toHaveBeenCalled();
  });

  it("calls no model when the next turn already started", async () => {
    ollama(false);
    const turn = new AbortController();
    turn.abort();
    await reflect(turn.signal);
    expect(requests).toHaveLength(0);
    expect(saveTutorInstruction).not.toHaveBeenCalled();
  });
});

// TerraTutor's click test 2026-11-19: the study log gemma4:e2b wrote held a literal "[Current Date]".
describe("the post-turn reflection's template blanks", () => {
  it("writes the real date for a date blank, \"the student\" for a name blank, and drops an Insert blank", async () => {
    const files = {
      study_log: "[Current Date] Practised 6 x 7 with [Student Name].",
      learning_profile: "[Insert learning style here] Likes short examples.",
    };
    globalThis.fetch = (async () => Response.json({ message: { content: JSON.stringify(files) } })) as unknown as typeof fetch;
    await reflect();
    const today = new Date().toLocaleDateString();
    expect(saveTutorInstruction).toHaveBeenCalledWith("course-1", "study_log", `[${today}] Practised 6 x 7 with the student.`);
    expect(saveTutorInstruction).toHaveBeenCalledWith("course-1", "learning_profile", "Likes short examples.");
    for (const call of vi.mocked(saveTutorInstruction).mock.calls) expect(String(call[2])).not.toMatch(/\[(?:current date|student name|insert)/i);
  });
});

// ChatTab is React over Tauri and has no render test here; this pins the wiring the tests above rely on.
describe("ChatTab's reflection signal", () => {
  it("passes its own signal, and aborts it when the next turn starts and when the chat closes", () => {
    expect(chatSource).toMatch(/updateKnowledgeFiles\(courseId, userText, result\.text, config, "default", reflection\.signal\)/);
    const runTurn = chatSource.slice(chatSource.indexOf("const runTurn = async"));
    expect(runTurn.slice(0, 300)).toContain("reflectionRef.current?.abort();");
    const cleanup = chatSource.slice(chatSource.indexOf("turnOwnerRef.current = null;"));
    expect(cleanup.slice(0, 200)).toContain("reflectionRef.current?.abort();");
  });
});
