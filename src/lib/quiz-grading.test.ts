import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  numericValueOf,
  extractConcludingNumber,
  checkAnswerConsistency,
  isNumericReasoningQuestion,
  gradeFreeTextDeterministic,
  buildBatchGradePrompt,
  parseBatchGradeResults,
  buildVerifyPrompt,
  parseVerifyDrops,
  type QuestionLike,
  type GradeItem,
  type VerifyItem,
} from "./quiz-grading";

const q = (over: Partial<QuestionLike>): QuestionLike => ({
  question_text: "",
  question_type: "multiple_choice",
  correct_answer: "",
  explanation: "",
  options: null,
  ...over,
});

describe("normalizeAnswer", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeAnswer("  The   Mitochondria  ")).toBe("mitochondria");
  });
  it("strips option labels, quotes, and terminal punctuation", () => {
    expect(normalizeAnswer("B) Photosynthesis.")).toBe("photosynthesis");
    expect(normalizeAnswer('"kelvin"')).toBe("kelvin");
  });
  it("normalizes a unicode minus", () => {
    expect(normalizeAnswer("−5")).toBe("-5");
  });
});

describe("numericValueOf", () => {
  it("extracts the primary number, ignoring labels and units", () => {
    expect(numericValueOf("C) 9 electrons")).toBe(9);
    expect(numericValueOf("0.01 m³")).toBe(0.01);
    expect(numericValueOf("1,000")).toBe(1000);
    expect(numericValueOf("−5")).toBe(-5);
  });
  it("returns null when there is no number", () => {
    expect(numericValueOf("True")).toBeNull();
    expect(numericValueOf("See matching_pairs")).toBeNull();
    expect(numericValueOf("")).toBeNull();
  });
});

describe("extractConcludingNumber", () => {
  it("takes the last equation result", () => {
    expect(extractConcludingNumber("First 2 + 2 = 4, then 4 × 2 = 8.")).toBe(8);
  });
  it("reads 'the answer is N' / 'therefore N'", () => {
    expect(extractConcludingNumber("Therefore the answer is 9.")).toBe(9);
  });
  it("returns null when the explanation states no result", () => {
    expect(extractConcludingNumber("It depends on the electron configuration.")).toBeNull();
  });
});

describe("checkAnswerConsistency", () => {
  it("flags the C³⁻ screenshot bug (explanation concludes 9, answer stored 6)", () => {
    const issue = checkAnswerConsistency(q({
      question_text: "Carbon-12 has 6 protons and 6 neutrons. If it forms a negative ion (C³⁻), how many electrons will it have?",
      correct_answer: "6",
      explanation: "A neutral carbon atom has 6 electrons. A 3- charge means it gained 3 electrons: 6 + 3 = 9.",
    }));
    expect(issue).not.toBeNull();
    expect(issue).toContain("9");
  });
  it("passes a self-consistent numeric question", () => {
    expect(checkAnswerConsistency(q({
      correct_answer: "9",
      explanation: "It gains 3 electrons, so 6 + 3 = 9.",
    }))).toBeNull();
  });
  it("ignores non-numeric answers and explanations without a result", () => {
    expect(checkAnswerConsistency(q({ correct_answer: "kelvin", explanation: "The SI unit of temperature." }))).toBeNull();
    expect(checkAnswerConsistency(q({ correct_answer: "5", explanation: "Count them carefully." }))).toBeNull();
  });
  it("matches an MC option label against an equation result", () => {
    expect(checkAnswerConsistency(q({
      correct_answer: "C) 8",
      explanation: "2 + 2 = 4, doubled is 4 × 2 = 8.",
    }))).toBeNull();
  });
});

describe("isNumericReasoningQuestion", () => {
  it("catches multi-quantity derivations (the ion trap)", () => {
    expect(isNumericReasoningQuestion(q({
      question_text: "Carbon-12 has 6 protons and 6 neutrons. If it forms C³⁻, how many electrons will it have?",
      correct_answer: "9",
    }))).toBe(true);
  });
  it("catches explicit arithmetic and unit conversion", () => {
    expect(isNumericReasoningQuestion(q({ question_text: "What is 7 × 8?", correct_answer: "56" }))).toBe(true);
    expect(isNumericReasoningQuestion(q({ question_text: "Convert 10 L to cubic meters.", correct_answer: "0.01" }))).toBe(true);
  });
  it("leaves recall-style numeric questions alone (no quantities in the stem)", () => {
    expect(isNumericReasoningQuestion(q({ question_text: "How many bones are in the adult human body?", correct_answer: "206" }))).toBe(false);
  });
  it("never flags non-numeric answers", () => {
    expect(isNumericReasoningQuestion(q({ question_text: "How many sides does a triangle have? Calculate.", correct_answer: "three" }))).toBe(false);
    expect(isNumericReasoningQuestion(q({ question_text: "Water boils at 100 °C.", question_type: "true_false", correct_answer: "True" }))).toBe(false);
  });
});

describe("gradeFreeTextDeterministic", () => {
  it("matches normalized exact answers", () => {
    expect(gradeFreeTextDeterministic("Mitochondria", "the mitochondria", "fill_in_blank")).toBe(true);
  });
  it("matches numeric value answers regardless of phrasing/units", () => {
    expect(gradeFreeTextDeterministic("9", "9 electrons", "fill_in_blank")).toBe(true);
    expect(gradeFreeTextDeterministic("0.01 m³", "0.010", "short_answer")).toBe(true);
  });
  it("defers prose mismatches to the LLM (returns null, never false)", () => {
    expect(gradeFreeTextDeterministic("Photosynthesis converts light to energy", "plants make food from sunlight", "written_response")).toBeNull();
    expect(gradeFreeTextDeterministic("9", "8", "fill_in_blank")).toBeNull();
  });
  it("does not numeric-shortcircuit essay-style expected answers", () => {
    // expected has a number but is mostly prose → must defer, not match on the stray digit
    expect(gradeFreeTextDeterministic("There are 3 branches of government", "3", "written_response")).toBeNull();
  });
  it("returns null when either side is empty", () => {
    expect(gradeFreeTextDeterministic("", "x", "short_answer")).toBeNull();
    expect(gradeFreeTextDeterministic("x", "  ", "short_answer")).toBeNull();
  });
});

describe("buildBatchGradePrompt", () => {
  const items: GradeItem[] = [
    { index: 0, question: "What is a cell?", expected: "the basic unit of life", student: "smallest living thing", type: "short_answer" },
    { index: 3, question: "Define osmosis", expected: "water moving across a membrane", student: "water flow", type: "written_response" },
  ];
  it("includes every item with its stable index and the JSON contract", () => {
    const p = buildBatchGradePrompt(items);
    expect(p).toContain("[index 0]");
    expect(p).toContain("[index 3]");
    expect(p).toContain('"results"');
    expect(p).toContain("smallest living thing");
  });
  it("appends math rules when provided", () => {
    expect(buildBatchGradePrompt(items, "PLAIN TEXT MATH ONLY")).toContain("PLAIN TEXT MATH ONLY");
  });
});

describe("parseBatchGradeResults", () => {
  const items: GradeItem[] = [
    { index: 0, question: "q0", expected: "e", student: "s", type: "short_answer" },
    { index: 1, question: "q1", expected: "e", student: "s", type: "short_answer" },
  ];
  it("maps results back by index", () => {
    const map = parseBatchGradeResults({ results: [
      { index: 0, correct: true, feedback: "good" },
      { index: 1, correct: false, feedback: "off" },
    ] }, items);
    expect(map.get(0)).toEqual({ isCorrect: true, feedback: "good" });
    expect(map.get(1)).toEqual({ isCorrect: false, feedback: "off" });
  });
  it("defaults missing/malformed entries to lenient-correct", () => {
    const map = parseBatchGradeResults({ results: [{ index: 0, correct: false, feedback: "x" }] }, items);
    expect(map.get(0)?.isCorrect).toBe(false);
    expect(map.get(1)).toEqual({ isCorrect: true, feedback: "" }); // not returned → lenient
  });
  it("is lenient when the whole response is missing", () => {
    const map = parseBatchGradeResults(null, items);
    expect([...map.values()].every((v) => v.isCorrect)).toBe(true);
  });
});

describe("verify pass helpers", () => {
  const items: VerifyItem[] = [
    { index: 0, question: "2+2?", options: ["3", "4"], proposed: "4" },
    { index: 1, question: "capital of France?", proposed: "Berlin" },
  ];
  it("builds a prompt that hides nothing and lists options", () => {
    const p = buildVerifyPrompt(items);
    expect(p).toContain("[index 0]");
    expect(p).toContain("Options: 3 | 4");
    expect(p).toContain('"verdicts"');
  });
  it("drops only indices judged incorrect", () => {
    const drop = parseVerifyDrops({ verdicts: [
      { index: 0, proposed_is_correct: true },
      { index: 1, proposed_is_correct: false },
    ] }, items);
    expect(drop.has(0)).toBe(false);
    expect(drop.has(1)).toBe(true);
  });
  it("keeps items with missing verdicts (model silence never drains the count)", () => {
    const drop = parseVerifyDrops({ verdicts: [] }, items);
    expect(drop.size).toBe(0);
    expect(parseVerifyDrops(null, items).size).toBe(0);
  });
});
