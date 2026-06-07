import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  numericValueOf,
  extractConcludingNumber,
  checkAnswerConsistency,
  isNumericReasoningQuestion,
  shouldRejectNumericReasoning,
  gradeFreeTextDeterministic,
  buildBatchGradePrompt,
  parseBatchGradeResults,
  buildVerifyPrompt,
  parseVerifyDrops,
  splitCount,
  planSlotSubtopics,
  summarizeForLedger,
  questionKey,
  dedupeByQuestionText,
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
  it("does NOT read Unicode sub/superscripts as numbers (formula answers stay non-numeric)", () => {
    // NFKC would fold these into ASCII digits and mis-grade chemistry/algebra answers (issue #83 review).
    expect(numericValueOf("O₂")).toBeNull();
    expect(numericValueOf("Fe³⁺")).toBeNull();
    expect(numericValueOf("x²")).toBeNull();
    expect(numericValueOf("CO₂")).toBeNull();
  });
  it("collapses a thousands separator but leaves a European decimal comma alone", () => {
    expect(numericValueOf("1,000")).toBe(1000);
    expect(numericValueOf("12,000 m")).toBe(12000);
    expect(numericValueOf("3,14")).toBe(3); // not treated as a 3-digit group → comma ignored
  });
  it("treats percent / currency / fraction / ratio / range as non-scalar (returns null)", () => {
    expect(numericValueOf("50%")).toBeNull();
    expect(numericValueOf("$1.50")).toBeNull();
    expect(numericValueOf("1/2")).toBeNull();
    expect(numericValueOf("3:30")).toBeNull();
    expect(numericValueOf("6 to 9")).toBeNull();
    expect(numericValueOf("between 8 and 10")).toBeNull();
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
  it("does not match 'so' inside another word (word boundary)", () => {
    expect(extractConcludingNumber("There are also 5 fingers.")).toBeNull();
    expect(extractConcludingNumber("So 7.")).toBe(7); // a real "so" cue still matches
  });
  it("catches conclusions phrased without an equals sign (the floor model rarely writes '=')", () => {
    expect(extractConcludingNumber("The C³⁻ ion has 9 electrons.")).toBe(9);
    expect(extractConcludingNumber("Adding three gives 9.")).toBe(9);
    expect(extractConcludingNumber("gain 3 → 9 electrons")).toBe(9);
    expect(extractConcludingNumber("It becomes 9.")).toBe(9);
  });
  it("prefers an explicit final answer over a later sanity-check equation", () => {
    expect(extractConcludingNumber("Therefore the answer is 8. (Check: a neutral atom = 6.)")).toBe(8);
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
  it("does not flag a sub/superscript formula answer against a numeric explanation", () => {
    expect(checkAnswerConsistency(q({
      correct_answer: "O₂",
      explanation: "Two oxygen atoms bond covalently; the molar mass is 32.",
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
  it("does not numeric-shortcircuit a formula answer against a bare digit, but still matches it exactly", () => {
    expect(gradeFreeTextDeterministic("O₂", "2", "fill_in_blank")).toBeNull();
    expect(gradeFreeTextDeterministic("x²", "2", "short_answer")).toBeNull();
    expect(gradeFreeTextDeterministic("O₂", "O2", "fill_in_blank")).toBe(true); // formula match still works
  });
  it("defers fraction / percent answers to the grader instead of matching on a misleading scalar", () => {
    expect(gradeFreeTextDeterministic("1/2", "1/3", "fill_in_blank")).toBeNull();
    expect(gradeFreeTextDeterministic("50%", "50 dollars", "short_answer")).toBeNull();
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

describe("splitCount", () => {
  it("splits evenly when divisible", () => {
    expect(splitCount(10, 5)).toEqual([2, 2, 2, 2, 2]);
  });
  it("gives the remainder to the first buckets", () => {
    expect(splitCount(11, 3)).toEqual([4, 4, 3]);
    expect(splitCount(35, 4)).toEqual([9, 9, 9, 8]);
  });
  it("can return zero-count buckets when total < buckets (the .filter(count>0) relies on this)", () => {
    expect(splitCount(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });
  it("handles zero/negative totals and zero buckets", () => {
    expect(splitCount(0, 3)).toEqual([0, 0, 0]);
    expect(splitCount(-4, 3)).toEqual([0, 0, 0]);
    expect(splitCount(5, 0)).toEqual([]);
  });
  it("always sums back to the requested total", () => {
    expect(splitCount(45, 6).reduce((a, b) => a + b, 0)).toBe(45);
    expect(splitCount(20, 3).reduce((a, b) => a + b, 0)).toBe(20);
  });
});

describe("shouldRejectNumericReasoning", () => {
  const ion = q({
    question_text: "Carbon-12 has 6 protons and 6 neutrons. If it forms C³⁻, how many electrons?",
    correct_answer: "9",
    explanation: "Count carefully.", // no shown working
  });
  it("rejects a working-less numeric question on the tiny/small tier", () => {
    expect(shouldRejectNumericReasoning(ion, "small")).toBe(true);
    expect(shouldRejectNumericReasoning(ion, "tiny")).toBe(true);
  });
  it("does NOT reject on capable tiers (they get the verify pass instead)", () => {
    expect(shouldRejectNumericReasoning(ion, "medium")).toBe(false);
    expect(shouldRejectNumericReasoning(ion, "large")).toBe(false);
    expect(shouldRejectNumericReasoning(ion, undefined)).toBe(false);
  });
  it("accepts the same question once it shows its working", () => {
    expect(shouldRejectNumericReasoning({ ...ion, explanation: "It gains 3 electrons: 6 + 3 = 9." }, "small")).toBe(false);
  });
  it("never rejects a conceptual (non-numeric) question", () => {
    expect(shouldRejectNumericReasoning(q({ question_text: "What is photosynthesis?", correct_answer: "a process", explanation: "x" }), "small")).toBe(false);
  });
});

describe("planSlotSubtopics", () => {
  it("round-robins one slot per question across subtopics", () => {
    expect(planSlotSubtopics(3, 7)).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });
  it("balances per-subtopic counts to within one (remainder to earliest)", () => {
    const slots = planSlotSubtopics(4, 35);
    const counts = [0, 1, 2, 3].map((s) => slots.filter((x) => x === s).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(slots).toHaveLength(35);
  });
  it("handles the empty cases", () => {
    expect(planSlotSubtopics(0, 5)).toEqual([]);
    expect(planSlotSubtopics(3, 0)).toEqual([]);
    expect(planSlotSubtopics(3, -2)).toEqual([]);
  });
});

describe("summarizeForLedger", () => {
  it("prefixes the subtopic id and truncates the stem", () => {
    expect(summarizeForLedger({ subtopic_id: "1.2", question_text: "What is the capital of France?" }))
      .toBe("[1.2] What is the capital of France?");
    const long = "x".repeat(200);
    expect(summarizeForLedger({ subtopic_id: "1.1", question_text: long }).length).toBeLessThanOrEqual(96);
  });
  it("collapses whitespace and tolerates a missing subtopic", () => {
    expect(summarizeForLedger({ question_text: "  a   b  " })).toBe("a b");
  });
});

describe("dedupeByQuestionText", () => {
  it("keeps the first of each distinct question (case/space-insensitive) and drops blanks", () => {
    const items = [
      { question_text: "What is a cell?", id: 1 },
      { question_text: "  what IS a cell?  ", id: 2 },
      { question_text: "What is DNA?", id: 3 },
      { question_text: "   ", id: 4 },
    ];
    expect(dedupeByQuestionText(items).map((i) => i.id)).toEqual([1, 3]);
  });
  it("questionKey normalizes whitespace and case", () => {
    expect(questionKey("  Hello World  ")).toBe("hello world");
  });
});
