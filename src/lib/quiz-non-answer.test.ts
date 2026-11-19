import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

// A typed answer that answers nothing, on the app's path: gradeAnswersBatch, which QuizFullScreen, the
// level test's finish and a handed-in level test's finish (level-test-checks.ts finishHandedInLevelTest)
// all call, and whose marks they store (updateQuizQuestionGrade), as progress reads them.
// TerraTutor click test 2026-11-19, gemma4:e2b: 4 of 5 typed "xyz" answers in a fractions quiz came back right and
// counted in the score, shown "Correct.". The bundled dictionary is read from public/ as the webview
// serves it; only the model call is stubbed.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch, NO_ANSWER_FEEDBACK, type AnswerToGrade } from "./quiz";
import { callLLMStructured } from "./llm";
import { resetDictionaryCache } from "./dictionary";
import { resetWordListCache } from "./wordlist";
import { installAppOrigin } from "./eval/headless/origin";
import type { LLMConfig } from "../types";

const config = () => ({ provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" }) as unknown as LLMConfig;
const original = globalThis.fetch;

// The click test's fill-in questions, answered "xyz".
const FRACTIONS: AnswerToGrade[] = [
  { index: 0, question: "In the fraction 3/4, the bottom number is called the ____.", expected: "denominator", student: "xyz", type: "fill_in_blank" },
  { index: 1, question: "If a pizza is cut into 8 equal slices and you eat 3, what fraction did you eat?", expected: "3/8", student: "xyz", type: "fill_in_blank" },
  { index: 2, question: "One half is the same as ____ fourths.", expected: "2", student: "xyz", type: "fill_in_blank" },
];
const prompted = () => vi.mocked(callLLMStructured).mock.calls.map((c) => (c[0] as Array<{ content: string }>)[0].content).join("\n");

describe("gradeAnswersBatch: an answer that answers nothing", () => {
  beforeAll(() => { resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  it("is marked wrong by code and told it doesn't answer the question, even when the model would say right", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "Correct.", correct: true } });
    const out = await gradeAnswersBatch([...FRACTIONS, { index: 7, question: "What is 1/2 + 1/4?", expected: "3/4", student: "?!", type: "short_answer" }], config());
    for (const i of [0, 1, 2, 7]) expect(out.get(i)).toEqual({ isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "exact" });
    expect(callLLMStructured).not.toHaveBeenCalled();
  }, 30_000);

  it("is marked wrong with no model on the computer too, not passed as unchecked", async () => {
    const out = await gradeAnswersBatch(FRACTIONS, null);
    for (const i of [0, 1, 2]) expect(out.get(i)).toEqual({ isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "exact" });
  }, 30_000);

  it("only that answer: a real answer beside it still goes to the model", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "The bottom number is the denominator.", correct: true } });
    const out = await gradeAnswersBatch([
      FRACTIONS[0],
      { index: 4, question: FRACTIONS[0].question, expected: "denominator", student: "the bottom one", type: "fill_in_blank" },
    ], config());
    expect(out.get(0)?.isCorrect).toBe(false);
    expect(out.get(4)).toEqual({ isCorrect: true, feedback: "The bottom number is the denominator.", by: "model" });
    expect(prompted()).toContain("the bottom one");
    expect(prompted()).not.toContain("xyz");
  }, 30_000);

  it.each(["denominater", "denomnator", "the denominator", "bottom", "Denominator!", "idk"])(
    "%j is not a non-answer: the key, a misspelling of it, a word, or a capital goes to the model or settles as before",
    async (student) => {
      vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "That names the bottom number.", correct: true } });
      const out = await gradeAnswersBatch([{ ...FRACTIONS[0], student }], config());
      expect(out.get(0)?.feedback).not.toBe(NO_ANSWER_FEEDBACK);
    }, 30_000);
});

describe("gradeAnswersBatch: a real answer with no vowel, or an abbreviation", () => {
  beforeAll(() => { resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  // Review of TerraTutor #245, 2026-11-19: a K-2 spelling of a right answer other than the key, or a lower-case
  // abbreviation of the key, was stored wrong as 'exact' with NO_ANSWER_FEEDBACK.
  const items: AnswerToGrade[] = [
    { index: 0, question: "Name an animal that lives in the ocean.", expected: "fish", student: "shrk", type: "short_answer" },
    { index: 1, question: "Name a slow animal.", expected: "snail", student: "trtl", type: "short_answer" },
    { index: 2, question: "Who was president during most of World War II?", expected: "Franklin D. Roosevelt", student: "fdr", type: "short_answer" },
    { index: 3, question: "Which president said \"Ask not what your country can do for you\"?", expected: "John F. Kennedy", student: "jfk", type: "short_answer" },
  ];

  it("goes to the model, which marks it", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({
      answer_1: { feedback: "A shark lives in the ocean.", correct: true },
      answer_2: { feedback: "A turtle is slow.", correct: true },
      answer_3: { feedback: "FDR was president then.", correct: true },
      answer_4: { feedback: "JFK said it.", correct: true },
    });
    const out = await gradeAnswersBatch(items, config());
    for (const i of [0, 1, 2, 3]) {
      expect(out.get(i)?.feedback).not.toBe(NO_ANSWER_FEEDBACK);
      expect(out.get(i)?.by).not.toBe("exact");
    }
    for (const s of ["shrk", "trtl", "fdr", "jfk"]) expect(prompted()).toContain(s);
  }, 30_000);

  it("with no model on the computer is passed as unchecked, as before, not marked wrong", async () => {
    const out = await gradeAnswersBatch(items, null);
    for (const i of [0, 1, 2, 3]) expect(out.get(i)).toMatchObject({ isCorrect: true, by: "fallback" });
  }, 30_000);
});

describe("gradeAnswersBatch: a sign that names the key, a sound word, a short spelling", () => {
  beforeAll(() => { resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  // Review of the OpenEdu port of TerraTutor #245, 2026-11-19: each was stored wrong as 'exact' with
  // NO_ANSWER_FEEDBACK; on master it went to the model, or passed as unchecked with no model.
  const items: AnswerToGrade[] = [
    { index: 0, question: "Which sign means greater than?", expected: "greater than", student: ">", type: "short_answer" },
    { index: 1, question: "What goes at the end of an asking sentence?", expected: "a question mark", student: "?", type: "short_answer" },
    { index: 2, question: "Which sign means out of one hundred?", expected: "percent sign", student: "%", type: "short_answer" },
    { index: 3, question: "What sound does an angry dog make?", expected: "woof", student: "grrr", type: "short_answer" },
    { index: 4, question: "What do plants need to grow?", expected: "sunlight", student: "wtr", type: "short_answer" },
    { index: 5, question: "Which president said \"Ask not what your country can do for you\"?", expected: "Kennedy", student: "jfk", type: "short_answer" },
  ];

  it("goes to the model", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue(Object.fromEntries(items.map((_, i) => [`answer_${i + 1}`, { feedback: "Yes.", correct: true }])));
    const out = await gradeAnswersBatch(items, config());
    for (const it of items) expect(out.get(it.index)?.by).toBe("model");
    for (const s of ["grrr", "wtr", "jfk"]) expect(prompted()).toContain(s);
  }, 30_000);

  it("with no model on the computer is passed as unchecked, as before", async () => {
    const out = await gradeAnswersBatch(items, null);
    for (const it of items) expect(out.get(it.index)).toMatchObject({ isCorrect: true, by: "fallback" });
  }, 30_000);
});

describe("gradeAnswersBatch: a right mark whose feedback says nothing was answered", () => {
  beforeAll(() => { resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  // An answer code cannot call a non-answer (a word), so the model marks it.
  const item: AnswerToGrade = { index: 0, question: "What is the bottom number of a fraction called?", expected: "The denominator", student: "banana", type: "short_answer" };
  const grade = async (feedback: string, correct: boolean) => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback, correct } });
    return (await gradeAnswersBatch([item], config())).get(0)!;
  };

  it.each([
    "The student did not provide an answer.",
    "The student didn't give an answer.",
    "No answer was given.",
    "That is not an answer.",
  ])("%j: marked wrong and told it doesn't answer the question", async (feedback) => {
    expect(await grade(feedback, true)).toEqual({ isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "model" });
  }, 30_000);

  it.each([
    "The student did not write the unit, but 12 is right.",
    "The answer does not include the word 'number' but means the same.",
    "No units are given, but the amount is right.",
    "It is not a full sentence, but it names the denominator.",
    // Words that can be about the topic, not the answer (review of TerraTutor #245, 2026-11-19).
    "Yes, Jabberwocky is a nonsense poem.",
    "Correct: Edward Lear wrote nonsense verse.",
    "Right, a password should use random letters and numbers.",
    "Correct; the plant gives no response to touch.",
    "Correct. 'Gibberish' means words that make no sense.",
    "The student did not answer the question in a full sentence, but 12 is right.",
    // Said of the answer, but not that none was given: the feedback is rewritten, the mark stands.
    "No response.",
    "The answer does not answer the question.",
    "The student's answer doesn't address the question.",
    "This is gibberish.",
    "The student typed random letters.",
    "The word is unrelated to the question.",
    "The student did not provide an answer, but the working shows 12, which is right.",
  ])("%j: the mark stands", async (feedback) => {
    const out = await grade(feedback, true);
    expect(out.isCorrect).toBe(true);
    expect(out.feedback).not.toBe(NO_ANSWER_FEEDBACK);
  }, 30_000);

  it.each([
    ["No response.", NO_ANSWER_FEEDBACK],
    ["This is gibberish.", NO_ANSWER_FEEDBACK],
    ["The word is unrelated to the question.", NO_ANSWER_FEEDBACK],
  ])("on a wrong mark %j is still told it doesn't answer the question", async (feedback, shown) => {
    expect(await grade(feedback, false)).toEqual({ isCorrect: false, feedback: shown, by: "model" });
  }, 30_000);
});
