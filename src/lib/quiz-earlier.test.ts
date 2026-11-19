import { describe, it, expect, vi, beforeEach } from "vitest";

// A new study quiz on a level asks other questions than the learner's last quizzes on it did, where it can
// (TerraTutor click test 2026-11-19 part 3: three quizzes on one level in a row read alike). Through the
// app's own generateQuizQuestions with the model call stubbed; the stub applies `validate` as
// callLLMStructured does. The questions the review pool re-poses (missed ones) still repeat on purpose; this
// is about fresh ones. Port of TerraTutor PR #251.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateQuizQuestions } from "./quiz";
import type { EarlierQuestion } from "./quiz-grading";
import { callLLMStructured } from "./llm";
import type { LLMConfig, Syllabus } from "../types";

const local = { provider: "ollama", model: "qwen3:8b", modelTier: "medium" } as unknown as LLMConfig;
const cloud = { provider: "anthropic", model: "claude-haiku-5-5", modelTier: "medium" } as unknown as LLMConfig;
const syllabus = { level: 1, title: "Fractions level 1", subtopics: [{ id: "1.1", title: "Parts of a fraction", key_concepts: ["numerator", "denominator"] }] } as unknown as Syllabus;

let n = 0;
const fresh = () => {
  const k = ++n;
  return {
    question_text: `A bar is cut into ${k + 2} equal pieces. What does the number ${k + 2} tell you, case ${k}?`,
    question_type: "multiple_choice",
    options: [`A) how many pieces in all, case ${k}`, "B) how many you ate", "C) the size of one piece", "D) nothing"],
    correct_answer: `A) how many pieces in all, case ${k}`,
    difficulty_level: 1,
    explanation: `The bottom number counts all the pieces. Therefore the answer is A) how many pieces in all, case ${k}`,
    subtopic_id: "1.1", blank_position: "", matching_pairs: [],
  };
};
// Asked word for word by the last quiz (gemma4:e2b's first question, empty ledger, at temperature 0.2).
const CAKE = {
  question_text: "If a whole cake is divided into 10 equal slices, and you take 7 of those slices, what does the number 7 represent in the fraction 7/10?",
  question_type: "fill_in_blank",
  options: [],
  correct_answer: "the number of parts taken",
  difficulty_level: 1,
  explanation: "The top number counts the parts taken. Therefore the answer is the number of parts taken",
  subtopic_id: "1.1", blank_position: "In 7/10, the 7 is ___.", matching_pairs: [],
};
const earlier: EarlierQuestion[] = [{
  question_text: CAKE.question_text, correct_answer: CAKE.correct_answer, subtopic_id: "1.1",
  question_type: CAKE.question_type, blank_position: CAKE.blank_position,
}];
// A fill-in-the-blank question whose question_text is only "Fill in the blank." (seen live): the sentence
// is what it asks.
const blank = (sentence: string, key: string) => ({
  question_text: "Fill in the blank.", question_type: "fill_in_blank", options: [], correct_answer: key, difficulty_level: 1,
  explanation: `The bottom number counts the parts. Therefore the answer is ${key}`, subtopic_id: "1.1",
  blank_position: sentence, matching_pairs: [],
});

type Opts = { toolName: string; validate?: (parsed: unknown) => string[] };
const prompts: string[] = [];
function model(write: () => object) {
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, _config, opts) => {
    const { toolName, validate } = opts as Opts;
    if (toolName === "emit_verdicts") return { verdicts: [] } as never;
    if (toolName === "emit_question_review") return null as never;
    const prompt = messages.map((m) => m.content).join("\n");
    prompts.push(prompt);
    const count = Number(/Generate (\d+) quiz question/.exec(prompt)?.[1] ?? 1);
    const out = toolName === "emit_quiz_questions" ? { questions: Array.from({ length: count }, write) } : write();
    const issues = validate ? validate(out) : [];
    if (issues.length) throw new Error(`Structured output failed after 3 attempts: ${issues.join("; ")}`);
    return out as never;
  });
}

beforeEach(() => { n = 0; prompts.length = 0; });

describe("a repeat quiz on a level", () => {
  it("asks the model for other questions than the last quizzes asked", async () => {
    model(() => fresh());
    await generateQuizQuestions(syllabus, 3, { ...local }, [], undefined, null, null, undefined, earlier);
    expect(prompts[0]).toContain("Earlier quizzes on this level already asked these questions");
    expect(prompts[0]).toContain("[1.1] If a whole cake is divided into 10 equal slices");
  });

  it("sets a word-for-word repeat aside and asks again when it can", async () => {
    let calls = 0;
    model(() => (++calls === 1 ? { ...CAKE } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 5, { ...local }, [], undefined, null, null, undefined, earlier);
    expect(qs).toHaveLength(5);
    expect(qs.some((q) => q.question_text === CAKE.question_text)).toBe(false);
  });

  it("sets a near repeat aside too (same key, the stem reworded)", async () => {
    let calls = 0;
    model(() => (++calls === 1 ? { ...CAKE, question_text: "A whole cake is divided into 10 equal slices and you take 7 of those slices. What does the number 7 represent in the fraction 7/10?" } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 5, { ...local }, [], undefined, null, null, undefined, earlier);
    expect(qs).toHaveLength(5);
    expect(qs.some((q) => /whole cake/.test(q.question_text))).toBe(false);
  });

  it("uses a repeat to fill the quiz when the model writes nothing else", async () => {
    model(() => ({ ...CAKE }));
    const qs = await generateQuizQuestions(syllabus, 3, { ...local }, [], undefined, null, null, undefined, earlier);
    expect(qs.map((q) => q.question_text)).toEqual([CAKE.question_text]);
  });

  it("sends a cloud model none of the learner's earlier questions, and still sets a repeat aside", async () => {
    let calls = 0;
    model(() => (++calls === 1 ? { ...CAKE } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 3, { ...cloud }, [], undefined, null, null, undefined, earlier);
    for (const p of prompts) expect(p).not.toContain("whole cake");
    expect(qs.some((q) => q.question_text === CAKE.question_text)).toBe(false);
  });

  it("does not set aside a fill-in-the-blank question that shares only \"Fill in the blank.\" with an earlier one", async () => {
    const before: EarlierQuestion[] = [{ ...blank("In 3/4, the 4 is the ___.", "denominator") }];
    const next = blank("In 5/8, the 5 is the ___.", "numerator");
    let calls = 0;
    model(() => (++calls === 1 ? { ...next } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 3, { ...local }, [], undefined, null, null, undefined, before);
    expect(qs.some((q) => q.blank_position === next.blank_position)).toBe(true);
    // The do-not-repeat line names the sentence, not a bare "Fill in the blank.".
    expect(prompts[0]).toContain("[1.1] Fill in the blank. Sentence: In 3/4, the 4 is the ___.");
  });

  it("still sets aside the same fill-in-the-blank sentence asked again", async () => {
    const before: EarlierQuestion[] = [{ ...blank("In 3/4, the 4 is the ___.", "denominator") }];
    let calls = 0;
    model(() => (++calls === 1 ? { ...blank("In 3/4, the 4 is the ___.", "denominator") } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 3, { ...local }, [], undefined, null, null, undefined, before);
    expect(qs).toHaveLength(3);
    expect(qs.some((q) => q.blank_position === "In 3/4, the 4 is the ___.")).toBe(false);
  });

  it("does not set aside a matching question that shares only its stem with an earlier one", async () => {
    const match = (pairs: Array<[string, string]>) => ({
      question_text: "Match each word to its meaning.", question_type: "drag_to_match", options: [],
      correct_answer: "See matching_pairs", difficulty_level: 1, explanation: "Each word goes with its meaning.",
      subtopic_id: "1.1", blank_position: "", matching_pairs: pairs.map(([left, right]) => ({ left, right })),
    });
    const before: EarlierQuestion[] = [match([["numerator", "top number"], ["denominator", "bottom number"], ["whole", "all the parts"]])];
    const next = match([["half", "1 of 2 equal parts"], ["third", "1 of 3 equal parts"], ["fourth", "1 of 4 equal parts"]]);
    let calls = 0;
    model(() => (++calls === 1 ? { ...next } : fresh()));
    const qs = await generateQuizQuestions(syllabus, 3, { ...local }, [], undefined, null, null, undefined, before);
    expect(qs.some((q) => q.matching_pairs?.some((p) => p.left === "half"))).toBe(true);
  });

  it("with no earlier quizzes, prompts are as before", async () => {
    model(() => fresh());
    await generateQuizQuestions(syllabus, 2, { ...local }, [], undefined, null, null);
    for (const p of prompts) expect(p).not.toContain("Earlier quizzes");
  });
});
