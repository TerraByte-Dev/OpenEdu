import { describe, it, expect, vi, beforeEach } from "vitest";

// A learner on the quiz or level test "making" screen had no way out while a slow computer wrote 20 or
// 45 questions one model call at a time. "Stop and go back" aborts the signal the screen passes in.
// These run the production generators with the model call stubbed, the stub honouring the signal as
// callLLMStructured does ("Aborted" once it fires): after a stop no further model call is made, and the
// generator rejects rather than return a short set, so the screen never creates an attempt.
// Port of TerraTutor PR #178.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateQuizQuestions, generatePromotionTestQuestions } from "./quiz";
import { callLLMStructured } from "./llm";
import type { LLMConfig, Syllabus } from "../types";

const local = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const cloud = { provider: "anthropic", model: "claude-haiku-4-5", modelTier: "medium" } as unknown as LLMConfig;
const syllabus = (level: number) => ({
  level,
  title: "Animals",
  subtopics: [{ id: `s${level}`, title: "Animal homes", key_concepts: ["nests", "dens"] }],
}) as unknown as Syllabus;

// Stems with no near-duplicate among them (the generators drop look-alikes).
const STEMS = [
  "Birds build nests from twigs and grass.",
  "A fox sleeps in an underground den.",
  "Honeybees store food inside a waxy hive.",
  "Beavers make lodges with sticks and mud in ponds.",
  "Rabbits dig burrows called warrens.",
  "Spiders spin silk webs to catch insects.",
  "Bats often rest upside down in caves.",
  "Owls may nest inside hollow tree trunks.",
];
const question = (n: number, subtopic: string) => ({
  question_text: STEMS[n % STEMS.length],
  question_type: "true_false",
  options: ["True", "False"],
  correct_answer: "True",
  difficulty_level: 1,
  explanation: "Animals have homes. Therefore the answer is True.",
  subtopic_id: subtopic,
  blank_position: "",
  matching_pairs: [],
});

const CHECKS = new Set(["emit_verdicts", "emit_question_review"]);

// Every question call answers until `stopAt` calls were made; then the learner presses Stop (the
// controller aborts) during that call, which ends as callLLMStructured ends on an abort.
function stubModel(stop: AbortController, stopAt: number, batched = false) {
  let calls = 0;
  vi.mocked(callLLMStructured).mockImplementation(async (msgs, _cfg, opts) => {
    if (opts.signal?.aborted) throw new Error("Aborted");
    if (opts.toolName === "emit_verdicts") return { verdicts: [] } as never;
    if (opts.toolName === "emit_question_review") return { findings: [] } as never;
    calls += 1;
    if (calls >= stopAt) {
      stop.abort();
      throw new Error("Aborted");
    }
    const sub = /id="([^"]+)"/.exec(msgs[0].content as string)?.[1] ?? "s1";
    return (batched ? { questions: [0, 1, 2].map((i) => question(calls * 3 + i, sub)) } : question(calls, sub)) as never;
  });
}

const questionCalls = () => vi.mocked(callLLMStructured).mock.calls.filter(([, , o]) => !CHECKS.has(o.toolName ?? ""));

beforeEach(() => {
  vi.mocked(callLLMStructured).mockReset();
});

describe("stopping while the questions are being made", () => {
  it("quiz, local (one call a question): stops after the call it was in, and rejects", async () => {
    const stop = new AbortController();
    stubModel(stop, 3);
    await expect(generateQuizQuestions(syllabus(1), 20, { ...local }, [], undefined, null, null, stop.signal)).rejects.toThrow(/Aborted/);
    expect(questionCalls()).toHaveLength(3);
    for (const [, , o] of vi.mocked(callLLMStructured).mock.calls) expect(o.signal).toBe(stop.signal);
  });

  it("quiz, cloud (batched): rejects instead of returning what the other batches made", async () => {
    const stop = new AbortController();
    stubModel(stop, 1, true);
    await expect(generateQuizQuestions(syllabus(1), 20, { ...cloud }, [], undefined, null, null, stop.signal)).rejects.toThrow(/Aborted/);
    for (const [, , o] of vi.mocked(callLLMStructured).mock.calls) expect(o.signal).toBe(stop.signal);
  });

  it("quiz with a content review model: a stop during the review rejects, though the review swallows its own errors", async () => {
    const stop = new AbortController();
    const reviewer = { ...cloud };
    vi.mocked(callLLMStructured).mockImplementation(async (msgs, _cfg, opts) => {
      if (opts.signal?.aborted) throw new Error("Aborted");
      if (opts.toolName === "emit_question_review") {
        stop.abort();
        throw new Error("Aborted");
      }
      const n = vi.mocked(callLLMStructured).mock.calls.length;
      return question(n, /id="([^"]+)"/.exec(msgs[0].content as string)?.[1] ?? "s1") as never;
    });
    await expect(generateQuizQuestions(syllabus(1), 5, { ...local }, [], undefined, reviewer, null, stop.signal)).rejects.toThrow(/Aborted/);
    const reviews = vi.mocked(callLLMStructured).mock.calls.filter(([, , o]) => o.toolName === "emit_question_review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0][2].signal).toBe(stop.signal);
    // Nothing was asked for after the stop (the review call was the last one).
    const calls = vi.mocked(callLLMStructured).mock.calls;
    expect(calls[calls.length - 1][2].toolName).toBe("emit_question_review");
  });

  it("level test: a stop in the current section makes no review-section call", async () => {
    const stop = new AbortController();
    stubModel(stop, 5);
    await expect(generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...local }, undefined, null, stop.signal)).rejects.toThrow(/Aborted/);
    expect(questionCalls()).toHaveLength(5);
    expect(questionCalls().some(([msgs]) => (msgs[0].content as string).includes("review of earlier material"))).toBe(false);
  });

  it("level test: stopped before it began, it calls no model at all", async () => {
    const stop = new AbortController();
    stop.abort();
    stubModel(stop, 99);
    await expect(generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...local }, undefined, null, stop.signal)).rejects.toThrow(/Aborted/);
    expect(questionCalls()).toHaveLength(0);
  });

  it("not stopped, the same stub makes a whole quiz (the signal changes nothing)", async () => {
    const stop = new AbortController();
    stubModel(stop, Infinity);
    const qs = await generateQuizQuestions(syllabus(1), 5, { ...local }, [], undefined, null, null, stop.signal);
    expect(qs).toHaveLength(5);
    expect(stop.signal.aborted).toBe(false);
  });
});
