import { describe, it, expect, vi, beforeEach } from "vitest";

// gemma4:e2b writes a multiple-choice key as the letter alone ("D") while its options read "D) ...".
// In the B9 readiness run (2026-11-13) that was 1,818 of 2,127 question calls, and the validator's
// repair loop got the same letter back, so quizzes came out empty. These tests run the production
// generator with the model call stubbed: the stub applies the same `validate` callLLMStructured
// would, and fails the call when it reports issues, as exhausted repairs do.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateQuizQuestions, validateQuizBatch } from "./quiz";
import { resolveLetterKey } from "./quiz-grading";
import { callLLMStructured } from "./llm";
import type { LLMConfig, Syllabus } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const syllabus = {
  level: 1,
  title: "Phonics",
  subtopics: [{ id: "s1", title: "Rhyming words", key_concepts: ["rhyme", "word families"] }],
} as unknown as Syllabus;

const mc = (correct_answer: string, options = ["A) cat and dog", "B) sun and moon", "C) red and blue", "D) hop and top"]) => ({
  question_text: "Which pair of words rhymes?",
  question_type: "multiple_choice",
  options,
  correct_answer,
  difficulty_level: 1,
  explanation: "Hop and top end with the same sound.",
  subtopic_id: "s1",
  blank_position: "",
  matching_pairs: [],
});

describe("resolveLetterKey", () => {
  it.each(["D", "d", "D)", "(D)", "D.", " D ", "Option D"])("maps %j to the labelled option", (key) => {
    expect(resolveLetterKey(mc(key)).correct_answer).toBe("D) hop and top");
  });

  it("maps a letter by position when the options carry no labels", () => {
    const q = mc("B", ["cat and dog", "sun and moon", "red and blue", "hop and top"]);
    expect(resolveLetterKey(q).correct_answer).toBe("sun and moon");
  });

  it("leaves a key that already names an option alone", () => {
    expect(resolveLetterKey(mc("D) hop and top")).correct_answer).toBe("D) hop and top");
    expect(resolveLetterKey(mc("hop and top")).correct_answer).toBe("hop and top");
  });

  it("leaves a bare letter alone when an option's own text is that letter", () => {
    const q = mc("A", ["A) A", "B) B", "C) C", "D) D"]);
    expect(resolveLetterKey(q).correct_answer).toBe("A");
  });

  it("leaves a letter with no matching option, and non-multiple-choice questions, alone", () => {
    expect(resolveLetterKey(mc("D", ["A) x", "B) y", "C) z"])).correct_answer).toBe("D");
    const tf = { ...mc("A"), question_type: "true_false", options: [] };
    expect(resolveLetterKey(tf).correct_answer).toBe("A");
  });
});

describe("validateQuizBatch with a letter key", () => {
  it("accepts a bare letter that names an option", () => {
    expect(validateQuizBatch([mc("D")], new Set(["s1"]), { tier: "tiny" })).toEqual([]);
  });

  it("still rejects a key that names no option", () => {
    expect(validateQuizBatch([mc("hop and stop")], new Set(["s1"]), { tier: "tiny" })).toHaveLength(1);
  });
});

describe("generateQuizQuestions on a model that answers with the letter", () => {
  beforeEach(() => {
    let n = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      n += 1;
      const parsed = { ...mc("D"), question_text: `Which pair of words rhymes? (${n})` };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
      return parsed;
    });
  });

  it("returns a full quiz whose key is the option's text", async () => {
    const qs = await generateQuizQuestions(syllabus, 3, config);
    expect(qs).toHaveLength(3);
    for (const q of qs) {
      expect(q.options).toContain(q.correct_answer);
      expect(q.correct_answer.replace(/^[A-D]\)\s*/, "")).toBe("hop and top");
    }
  });
});
