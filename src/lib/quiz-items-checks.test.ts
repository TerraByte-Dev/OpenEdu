import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Four holes in the quiz and level-test checks (ported from TerraTutor #206), each on the app's own path
// with the model call stubbed. Like quiz-answer-integrity.test.ts, the stub applies the same `validate`
// callLLMStructured would and fails the call when it reports issues, as exhausted repairs do.
//  - A fill-in-the-blank question whose question_text is only "Fill in the blank." reached the content
//    review, the verify pass and the grader without the sentence the learner fills in.
//  - A missed question re-posed from the review pool could be generated again fresh in the same quiz,
//    and a level test's review section could repeat its current section.
//  - A drag-to-match question with a repeated left or right item can never be submitted.
//  - A level test whose review section came back with 1 or 2 questions was given, and one miss there
//    failed the whole test.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import {
  generateQuizQuestions, generatePromotionTestQuestions, gradeAnswersBatch, levelTestShortfall, validateQuizBatch,
  TEST_REVIEW_FLOOR,
} from "./quiz";
import { questionWithSentence, repeatedMatchSide } from "./quiz-grading";
import { questionText } from "./content-review";
import { callLLMStructured } from "./llm";
import { resetDictionaryCache } from "./dictionary";
import { resetWordListCache } from "./wordlist";
import { installAppOrigin } from "./eval/headless/origin";
import type { LLMConfig, QuizQuestion, Syllabus } from "../types";

const e2b = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const medium = { provider: "ollama", model: "qwen3:8b", modelTier: "medium" } as unknown as LLMConfig;
const reviewer = { provider: "anthropic", model: "claude-haiku-5-5", modelTier: "medium" } as unknown as LLMConfig;
const syllabus = (level: number, subtopics = 1) => ({
  level,
  title: `Weather level ${level}`,
  subtopics: Array.from({ length: subtopics }, (_, i) => ({ id: `${level}.${i + 1}`, title: `The water cycle ${level}.${i + 1}`, key_concepts: ["evaporation", "condensation"] })),
}) as unknown as Syllabus;

type Raw = {
  question_text: string; question_type: string; options: string[]; correct_answer: string; difficulty_level: number;
  explanation: string; subtopic_id: string; blank_position: string; matching_pairs: Array<{ left: string; right: string }>;
};
let n = 0;
const mc = (over: Partial<Raw> = {}): Raw => {
  const k = ++n;
  return {
    question_text: `Which part of the water cycle is described in example number ${k}?`,
    question_type: "multiple_choice",
    options: ["A) evaporation", `B) condensation, case ${k}`, "C) runoff", "D) melting"],
    correct_answer: `B) condensation, case ${k}`,
    difficulty_level: 1,
    explanation: `Vapor turning into drops is condensation. Therefore the answer is B) condensation, case ${k}`,
    subtopic_id: "1.1", blank_position: "", matching_pairs: [],
    ...over,
  };
};
const FIB: Raw = {
  question_text: "Fill in the blank.",
  question_type: "fill_in_blank",
  options: [],
  correct_answer: "condensation",
  difficulty_level: 1,
  explanation: "Cooling vapor turns into drops of water. Therefore the answer is condensation",
  subtopic_id: "1.1",
  blank_position: "Water vapor cools and turns back into liquid during ___.",
  matching_pairs: [],
};

type Opts = { toolName: string; validate?: (parsed: unknown) => string[] };
// The model: `write` returns each emit_quiz_question reply (the stub then applies `validate`); the
// verify pass and the content review agree with every key unless `onCheck` says otherwise.
function model(write: (prompt: string) => Raw, onCheck: (tool: string, prompt: string) => unknown = () => null) {
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, _config, opts) => {
    const { toolName, validate } = opts as Opts;
    const prompt = messages.map((m) => m.content).join("\n");
    if (toolName === "emit_verdicts" || toolName === "emit_question_review" || toolName === "emit_grades") {
      return (onCheck(toolName, prompt) ?? (toolName === "emit_grades" ? {} : { verdicts: [] })) as never;
    }
    if (toolName !== "emit_quiz_question") throw new Error(`unexpected tool ${toolName}`);
    const q = write(prompt);
    const issues = validate ? validate(q) : [];
    if (issues.length) throw new Error(`Structured output failed after 3 attempts: ${issues.join("; ")}`);
    return q as never;
  });
}

const stored = (q: Raw, id: number): QuizQuestion =>
  ({ ...q, id, attempt_id: 1, user_answer: "wrong", is_correct: false, options: q.options.length ? q.options : null, matching_pairs: q.matching_pairs.length ? q.matching_pairs : null, blank_position: q.blank_position || null }) as unknown as QuizQuestion;

beforeEach(() => { n = 0; });

describe("a fill-in-the-blank key is checked and graded with the sentence the learner fills in", () => {
  it("questionWithSentence adds the sentence only where question_text does not hold it", () => {
    expect(questionWithSentence(FIB)).toBe("Fill in the blank.\nSentence: Water vapor cools and turns back into liquid during ___.");
    expect(questionWithSentence({ ...FIB, question_text: "Water vapor cools and turns back into liquid during ___." })).toBe("Water vapor cools and turns back into liquid during ___.");
    expect(questionWithSentence({ ...FIB, blank_position: "" })).toBe("Fill in the blank.");
    expect(questionWithSentence({ ...mc(), blank_position: "not shown ___" }).includes("Sentence:")).toBe(false);
  });

  it("the content review of fresh quiz questions sees the sentence", async () => {
    const prompts: string[] = [];
    model(() => ({ ...FIB, question_text: `Fill in the blank (${++n}).` }), (tool, prompt) => { if (tool === "emit_question_review") prompts.push(prompt); return null; });
    await generateQuizQuestions(syllabus(1), 3, { ...e2b }, [], undefined, reviewer);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toContain("Question (fill_in_blank): Fill in the blank (1).\nSentence: Water vapor cools and turns back into liquid during ___.\nMarked answer: condensation");
    expect(questionText(FIB)).toContain("Sentence: Water vapor cools");
  });

  it("the verify pass (no review model) sees the sentence", async () => {
    const prompts: string[] = [];
    model(() => ({ ...FIB, question_text: `Fill in the blank (${++n}).` }), (tool, prompt) => { if (tool === "emit_verdicts") prompts.push(prompt); return null; });
    await generateQuizQuestions(syllabus(1), 2, { ...e2b }, [], undefined, null);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toContain("Question: Fill in the blank (1).\nSentence: Water vapor cools and turns back into liquid during ___.\nProposed answer: condensation");
  });

  describe("the grader", () => {
    const original = globalThis.fetch;
    beforeEach(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
    afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });

    it("gets the sentence as QuizFullScreen and PromotionTestFullScreen build the item", async () => {
      const prompts: string[] = [];
      model(() => mc(), (tool, prompt) => { if (tool === "emit_grades") prompts.push(prompt); return null; });
      const q = stored(FIB, 1);
      // The views' item: { index, question: questionWithSentence(q), expected, student, type }.
      await gradeAnswersBatch([{ index: 0, question: questionWithSentence(q), expected: q.correct_answer, student: "freezing", type: q.question_type }], { ...e2b });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("Question: Fill in the blank.\nSentence: Water vapor cools and turns back into liquid during ___.\nExpected answer: condensation");
    });
  });
});

describe("a question re-posed from the review pool is not asked again fresh in the same quiz", () => {
  it("drops the fresh repeat of a missed question and tops up to the full count", async () => {
    // At temperature 0.2 the first slot's prompt (empty ledger) writes the question missed last quiz again.
    const missed = mc({ question_text: "What is the main job of the heart in the body?", options: ["A) pump blood", "B) digest food", "C) breathe air", "D) think"], correct_answer: "A) pump blood", explanation: "The heart pumps blood. Therefore the answer is A) pump blood" });
    let calls = 0;
    model(() => (++calls === 1 ? { ...missed } : mc()));
    const pool = Array.from({ length: 4 }, (_, i) => stored(i === 0 ? missed : mc(), i + 1));
    const qs = await generateQuizQuestions(syllabus(1), 20, { ...medium }, pool, undefined, null, null);
    expect(qs).toHaveLength(20);
    expect(qs.filter((q) => q.question_text === missed.question_text)).toHaveLength(1);
  }, 30_000);

  it("drops a near repeat too (same key, the stem reworded)", async () => {
    const missed = mc({ question_text: "What tool is used to measure how hot or cold the air is?", options: ["A) thermometer", "B) ruler", "C) scale", "D) clock"], correct_answer: "A) thermometer", explanation: "A thermometer measures temperature. Therefore the answer is A) thermometer" });
    let calls = 0;
    model(() => (++calls === 1 ? { ...missed, question_text: "Which tool is used to measure how hot or cold the air is?" } : mc()));
    const pool = Array.from({ length: 4 }, (_, i) => stored(i === 0 ? missed : mc(), i + 1));
    const qs = await generateQuizQuestions(syllabus(1), 20, { ...medium }, pool, undefined, null, null);
    expect(qs).toHaveLength(20);
    expect(qs.filter((q) => /how hot or cold the air is/.test(q.question_text))).toHaveLength(1);
  }, 30_000);

  it("a level test's review section does not repeat a question from its current section", async () => {
    const twice = mc({ question_text: "Water falling from clouds as rain or snow is called what?", options: ["A) precipitation", "B) evaporation", "C) runoff", "D) melting"], correct_answer: "A) precipitation", explanation: "Rain and snow are precipitation. Therefore the answer is A) precipitation" });
    let reviewCalls = 0;
    let currentCalls = 0;
    model((prompt) => {
      if (prompt.includes("review of earlier material")) return ++reviewCalls === 1 ? { ...twice, subtopic_id: "1.1" } : mc({ subtopic_id: "1.1" });
      return ++currentCalls === 1 ? { ...twice, subtopic_id: "2.1" } : mc({ subtopic_id: "2.1" });
    });
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...medium });
    expect(t.current).toHaveLength(35);
    expect(t.review).toHaveLength(10);
    expect([...t.current, ...t.review].filter((q) => q.question_text === twice.question_text)).toHaveLength(1);
  }, 30_000);
});

describe("a drag-to-match question with a repeated item is rewritten or dropped, so a quiz can be finished", () => {
  const match = (pairs: Array<[string, string]>): Raw => ({
    ...mc(), question_text: "Match each animal to its group.", question_type: "drag_to_match", options: [], correct_answer: "See matching_pairs",
    explanation: "Dogs and whales are mammals; frogs are amphibians.", matching_pairs: pairs.map(([left, right]) => ({ left, right })),
  });
  const classification = match([["dog", "Mammal"], ["whale", "Mammal"], ["frog", "Amphibian"]]);

  it("validateQuizBatch rejects a repeated right or left item (in any case or label) and passes distinct ones", () => {
    expect(repeatedMatchSide(classification.matching_pairs)).toBe("right");
    expect(validateQuizBatch([classification], new Set(), { tier: "medium" }).join(" ")).toMatch(/same right item twice/);
    const left = match([["Dog", "Mammal"], ["dog.", "Pet"], ["frog", "Amphibian"]]);
    expect(validateQuizBatch([left], new Set(), { tier: "medium" }).join(" ")).toMatch(/same left item twice/);
    const fine = match([["dog", "Mammal"], ["frog", "Amphibian"], ["snake", "Reptile"]]);
    expect(validateQuizBatch([fine], new Set(), { tier: "medium" })).toEqual([]);
  });

  it("a quiz never carries one: the model's repeat fails validation and another question takes its place", async () => {
    let calls = 0;
    model(() => (++calls % 3 === 1 ? { ...classification } : mc()));
    const qs = await generateQuizQuestions(syllabus(1), 6, { ...medium }, [], undefined, null, null);
    expect(qs).toHaveLength(6);
    expect(qs.some((q) => q.question_type === "drag_to_match")).toBe(false);
  }, 30_000);

  it("a stored one in the review pool is not re-posed", async () => {
    model(() => mc());
    const pool = [stored(classification, 1), ...Array.from({ length: 3 }, (_, i) => stored(mc(), i + 2))];
    const qs = await generateQuizQuestions(syllabus(1), 20, { ...medium }, pool, undefined, null, null);
    expect(qs).toHaveLength(20);
    expect(qs.some((q) => q.question_type === "drag_to_match")).toBe(false);
  }, 30_000);
});

describe("a level test whose review section has too few questions is not given", () => {
  // The model writes every current-level question and only `reviewMax` review questions.
  function reviewModel(reviewMax: number) {
    let review = 0;
    model((prompt) => {
      if (prompt.includes("review of earlier material")) {
        if (++review > reviewMax) throw new Error("Structured output failed after 3 attempts.");
        return mc({ subtopic_id: "1.1" });
      }
      return mc({ subtopic_id: "2.1" });
    });
  }

  it("refuses 35 + 2: one miss in the review section would fail the test (50% < 60%)", async () => {
    reviewModel(2);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...medium });
    expect(t.current).toHaveLength(35);
    expect(t.review).toHaveLength(2);
    expect(levelTestShortfall(t)).toBe(`Only 2 questions on the earlier levels were made, and a level test needs at least ${TEST_REVIEW_FLOOR}, so that one miss there cannot fail the test. The test was not started and does not count. Try again.`);
  }, 30_000);

  it("refuses 35 + 1", async () => {
    reviewModel(1);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...medium });
    expect(t.review).toHaveLength(1);
    expect(levelTestShortfall(t)).toMatch(/^Only 1 question on the earlier levels was made/);
  }, 30_000);

  it(`gives 35 + ${TEST_REVIEW_FLOOR}, where one miss leaves 67%`, async () => {
    reviewModel(TEST_REVIEW_FLOOR);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...medium });
    expect(t.review).toHaveLength(TEST_REVIEW_FLOOR);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);
});
