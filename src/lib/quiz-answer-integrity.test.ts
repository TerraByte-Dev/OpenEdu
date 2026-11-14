import { describe, it, expect, vi, beforeEach } from "vitest";

// A gemma4:e2b readiness run (2026-11-14) made quizzes and promotion tests with enough questions but
// many wrong ones: unchecked time/money/fraction keys, explanations that correct themselves, repeated
// options, explanations naming a letter the shuffle had moved, and near-repeated questions. The audit's
// own examples are quoted below. Like quiz-letter-key.test.ts, the generator tests run the production
// path with the model call stubbed: the stub applies the same `validate` callLLMStructured would, and
// fails the call when it reports issues, as exhausted repairs do.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateQuizQuestions, generatePromotionTestQuestions, validateQuizBatch } from "./quiz";
import {
  quantityOf, checkAnswerConsistency, hasSelfCorrection, duplicateOptionPair, isNearDuplicate,
  dedupeByQuestionText, rewriteLetterRefs,
} from "./quiz-grading";
import { callLLMStructured } from "./llm";
import type { LLMConfig, Syllabus } from "../types";

const local = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const cloud = { provider: "anthropic", model: "claude-haiku-5-5", modelTier: "medium" } as unknown as LLMConfig;
const syllabus = {
  level: 2,
  title: "Telling time",
  subtopics: [{ id: "s1", title: "Elapsed time", key_concepts: ["minutes later"] }],
} as unknown as Syllabus;

type Raw = {
  question_text: string; question_type: string; options: string[]; correct_answer: string; difficulty_level: number;
  explanation: string; subtopic_id: string; blank_position: string; matching_pairs: Array<{ left: string; right: string }>;
};
const mc = (over: Partial<Raw>): Raw => ({
  question_text: "An analog clock shows the time at 1:45 PM. If you need to determine the time exactly 15 minutes later, what time will it be?",
  question_type: "multiple_choice",
  options: ["A) 1:30 PM", "B) 3:00 PM", "C) 2:00 PM", "D) 2:15 PM"],
  correct_answer: "C) 2:00 PM",
  difficulty_level: 2,
  explanation: "1:45 PM + 15 minutes = 2:00 PM. Therefore the answer is 2:00 PM.",
  subtopic_id: "s1",
  blank_position: "",
  matching_pairs: [],
  ...over,
});
const fib = (over: Partial<Raw>): Raw => ({
  ...mc({}), question_type: "fill_in_blank", options: [], blank_position: "The time will be ___.", ...over,
});
// Stems with no near-duplicate among them, for generator runs that need several clean questions.
const STEMS_245 = [
  "What time is 15 minutes after 2:30?",
  "School lets out at 2:30. The bus comes 15 minutes later. When does the bus come?",
  "A clock reads 2:30. Where will the hands point after a quarter of an hour?",
  "Practice begins at 2:30 and lasts a quarter hour. When does it end?",
  "If you start reading at 2:30 and read for 15 minutes, when do you stop?",
  "Snack time is 2:30. Clean-up comes a quarter hour later. When is clean-up?",
];
const STEMS_200 = [
  "Find the time 15 minutes after 1:45 PM.",
  "Lunch starts at 1:45 PM and lasts 15 minutes. When does it end?",
  "A bus leaves 15 minutes after 1:45 PM. When does it leave?",
  "Recess begins 15 minutes after 1:45 PM. At what time?",
];
const valid = (q: Raw) => validateQuizBatch([q], new Set(["s1"]), { tier: "tiny" });

// Stub the model: each structured question call takes the next entry of `script` (cycling), and runs
// the validator on it as callLLMStructured would.
function scriptModel(script: Array<(n: number) => Raw>) {
  let n = 0;
  vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
    if (opts.toolName === "emit_verdicts") return { verdicts: [] };
    const parsed = script[n % script.length](n);
    n += 1;
    const issues = opts.validate ? opts.validate(parsed as never) : [];
    if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
    return parsed;
  });
}

beforeEach(() => {
  vi.mocked(callLLMStructured).mockReset();
});

// ─── 1. Clock times, money and fractions ──────────────────────────────────────

describe("quantityOf", () => {
  it("reads clock times, with and without AM/PM", () => {
    expect(quantityOf("D) 2:15 PM")).toEqual({ kind: "time", value: 14 * 60 + 15, meridiem: true });
    expect(quantityOf("2:15 p.m.")).toEqual({ kind: "time", value: 14 * 60 + 15, meridiem: true });
    expect(quantityOf("12:30 AM")).toEqual({ kind: "time", value: 30, meridiem: true });
    expect(quantityOf("C) 3:00")).toEqual({ kind: "time", value: 180 });
  });
  it("reads fractions and mixed numbers", () => {
    expect(quantityOf("D) 6/12")?.value).toBe(0.5);
    expect(quantityOf("1 1/2")?.value).toBe(1.5);
    expect(quantityOf("3/0")).toBeNull();
  });
  it("reads money in dollars, cents and coins", () => {
    expect(quantityOf("$0.45")).toEqual({ kind: "money", value: 45 });
    expect(quantityOf("45¢")).toEqual({ kind: "money", value: 45 });
    expect(quantityOf("45 cents")).toEqual({ kind: "money", value: 45 });
    expect(quantityOf("2 dollars and 50 cents")).toEqual({ kind: "money", value: 250 });
    expect(quantityOf("A) One Dime and one Penny")).toEqual({ kind: "money", value: 11, coins: true });
    expect(quantityOf("1 quarter, 2 dimes")).toEqual({ kind: "money", value: 45, coins: true });
  });
  it("reads nothing with other words around it, or a coin list without counts", () => {
    for (const s of ["about 2:15", "3/4 cup", "Quarters and dimes", "the 3:15 train", "9", "Thermometer", "5 + 5 + 5"]) {
      expect(quantityOf(s)).toBeNull();
    }
  });
});

describe("answer keys for times, money and fractions are checked against the explanation", () => {
  it("rejects the audit's 1:45 PM + 15 min keyed \"2:15 PM\"", () => {
    const audit = mc({
      correct_answer: "D) 2:15 PM",
      explanation: "Adding 15 minutes to 1:45 PM moves the time forward. 45 minutes plus 15 minutes equals 60 minutes, which is exactly one hour. Therefore, 1:45 PM plus 15 minutes is 2:00 PM. Wait, re-evaluating: 1:45 PM + 15 minutes = 2:00 PM. Let's re-check the options provided against the calculation. 1:45 + 15 minutes = 2:00 PM. Let's adjust the options to ensure one is correct based on the calculation.",
    });
    expect(checkAnswerConsistency(audit)).toContain("different time");
    // Without the self-correction, the value check alone still catches it.
    expect(valid(mc({ correct_answer: "D) 2:15 PM", explanation: "1:45 PM + 15 minutes = 2:00 PM." }))).toHaveLength(1);
  });

  it("rejects the audit's 2:30 + 15 min keyed \"3:00\"", () => {
    const audit = mc({
      question_text: "An analog clock shows the time at 2:30. If you need to determine the time exactly 15 minutes later, what time will it be?",
      options: ["A) 2:40", "B) 3:15", "C) 3:00", "D) 2:45"],
      correct_answer: "C) 3:00",
      explanation: "Adding 15 minutes to 2:30 moves the time forward. 30 minutes plus 15 minutes equals 45 minutes, which is 3:15. Wait, let's re-evaluate the options based on the calculation. 2:30 + 15 minutes = 2:45. Let's check the options again. 2:30 + 15 minutes = 2:45. Option A is 2:45. Therefore the answer is A.",
    });
    expect(checkAnswerConsistency(audit)).not.toBeNull();
  });

  it("rejects a money or fraction key its explanation contradicts", () => {
    expect(checkAnswerConsistency(mc({ correct_answer: "A) One Dime and one Penny", explanation: "25 + 10 + 10 = 45. Therefore the answer is 45 cents." }))).not.toBeNull();
    expect(checkAnswerConsistency(mc({ correct_answer: "24 cents", explanation: "The change due is $1.00 - $0.75 = $0.25, or 25 cents." }))).not.toBeNull();
    expect(checkAnswerConsistency(mc({ correct_answer: "D) 6/12", explanation: "Multiply the top and bottom of 3/4 by 3. Therefore the answer is 9/12." }))).not.toBeNull();
  });

  it("leaves the audit's coin and fraction examples to the self-correction rule (their working never states a value)", () => {
    const coins = mc({
      correct_answer: "A) One Dime and one Penny",
      explanation: "To make $0.45 with the fewest coins, we prioritize the largest denomination less than or equal to the amount. $0.45 is best represented by one dime (10 cents) and one penny (1 cent), totaling 11 cents, which is incorrect. Let's re-evaluate: $0.45 = 45 cents. The optimal combination is one quarter (25 cents) and two pennies (2 cents), totaling 27 cents, which is incorrect. The correct combination: ",
    });
    const fraction = mc({
      correct_answer: "D) 6/12",
      explanation: "To find an equivalent fraction for 3/4 when the whole is divided into 12 parts, we determine the scaling factor. Since 4 multiplied by 3 equals 12, we must multiply the numerator (3) by 3 as well. Therefore, 3 x 3 = 9, and 4 x 3 = 12, making 9/12 the equivalent fraction. Wait, let's re-evaluate the options based on the visual concept. If 3/4 is the target, we look for a fraction with the same area",
    });
    expect(checkAnswerConsistency(coins)).toBeNull();
    expect(checkAnswerConsistency(fraction)).toBeNull();
    expect(valid(coins).join(" ")).toContain("corrects itself");
    expect(valid(fraction).join(" ")).toContain("corrects itself");
  });

  // The main risk of a stricter validator is rejecting a question that is right.
  it.each<[string, Partial<Raw>]>([
    ["time with working", {}],
    ["time key without AM/PM", { correct_answer: "C) 2:00", options: ["A) 1:30", "B) 3:00", "C) 2:00", "D) 2:15"] }],
    ["across noon", { correct_answer: "C) 12:00 PM", options: ["A) 11:30 AM", "B) 1:00 PM", "C) 12:00 PM", "D) 12:15 PM"], explanation: "11:45 AM + 15 minutes = 12:00 PM." }],
    ["the start time after Therefore", { correct_answer: "C) 2:45", options: ["A) 2:40", "B) 3:15", "C) 2:45", "D) 3:00"], explanation: "Therefore, 2:30 plus 15 minutes is 2:45." }],
    ["a time stated as minutes", { correct_answer: "C) 2:45", options: ["A) 2:40", "B) 3:15", "C) 2:45", "D) 3:00"], explanation: "30 minutes plus 15 minutes equals 45 minutes, so the time is 2:45." }],
    ["a ratio written like a time", { question_text: "Which ratio is equivalent to the ratio 2:5?", options: ["A) 6:15", "B) 5:20", "C) 4:15", "D) 7:10"], correct_answer: "A) 6:15", explanation: "Multiply both parts by 3: 2 × 3 = 6 and 5 × 3 = 15, so the ratio 2:5 = 6:15. A ratio of 4:10 = 12:30 too." }],
    ["change in dollars", { question_text: "A toy costs $0.55. You pay with $1.00. How much change do you get?", options: ["A) $0.45", "B) $0.55", "C) $0.35", "D) $1.55"], correct_answer: "A) $0.45", explanation: "$1.00 - $0.55 = $0.45." }],
    ["coins that make the amount", { question_text: "Which coins make 45 cents with the fewest coins?", options: ["A) One quarter and two dimes", "B) Four dimes and one nickel", "C) Nine nickels", "D) One quarter and one dime"], correct_answer: "A) One quarter and two dimes", explanation: "A quarter is 25 cents and two dimes are 20 cents: 25 + 20 = 45. Therefore the answer is 45 cents." }],
    ["coins counted in digits, values listed as facts", { question_text: "Which coins make 45 cents?", options: ["A) 1 quarter, 2 dimes", "B) 4 dimes", "C) 3 nickels", "D) 2 quarters"], correct_answer: "A) 1 quarter, 2 dimes", explanation: "A quarter = 25 cents and a dime = 10 cents." }],
    ["coin values listed as facts", { question_text: "Which single coin is worth the most?", options: ["A) One quarter", "B) One dime", "C) One nickel", "D) One penny"], correct_answer: "A) One quarter", explanation: "A quarter = 25 cents, a dime = 10 cents, a nickel = 5 cents and a penny = 1 cent." }],
    ["an equivalent fraction", { question_text: "Which fraction is equivalent to 3/4?", options: ["A) 9/12", "B) 8/12", "C) 3/12", "D) 6/12"], correct_answer: "A) 9/12", explanation: "Multiply the top and bottom by 3: 3 × 3 = 9 and 4 × 3 = 12, so 3/4 = 9/12." }],
    ["a fraction stated another way", { question_text: "What fraction of the pizza is left?", options: ["A) 1/2", "B) 1/4", "C) 3/4", "D) 1/8"], correct_answer: "A) 1/2", explanation: "4 of 8 slices are left. Therefore the answer is 2/4, which is the same as 1/2." }],
    ["a fraction of a fraction", { question_text: "What is half of one half?", options: ["A) 1/4", "B) 1/2", "C) 1", "D) 2/4"], correct_answer: "A) 1/4", explanation: "Therefore, 1/2 of 1/2 is 1/4." }],
    ["a mixed number", { question_text: "What is 3/2 as a mixed number?", options: ["A) 1 1/2", "B) 2 1/2", "C) 1 1/3", "D) 3 1/2"], correct_answer: "A) 1 1/2", explanation: "3/2 = 1 1/2 because 2 goes into 3 once with 1 left over." }],
  ])("accepts a correct question: %s", (_name, over) => {
    expect(valid(mc(over))).toEqual([]);
  });

  it("no longer rejects a correct numeric answer whose Therefore starts the arithmetic", () => {
    // Read as 14 before, so this correct question bounced (2026-11-14 run).
    const q = fib({
      question_text: "Carbon-14 has a mass number of 14 and atomic number 6. How many neutrons does it have?",
      correct_answer: "8",
      explanation: "Neutrons = Mass Number - Atomic Number. Therefore, 14 - 6 = 8.",
    });
    expect(checkAnswerConsistency(q)).toBeNull();
    // A key that is a phrase with numbers in it is not compared (each one flagged in the run was right).
    expect(checkAnswerConsistency(mc({
      question_text: "In 10 - 4 + 2 * 3, which operation comes first?",
      options: ["A) Subtraction (10 - 4)", "B) Addition (4 + 2)", "C) Division", "D) Multiplication (2 * 3)"],
      correct_answer: "D) Multiplication (2 * 3)",
      explanation: "Therefore, 2 * 3 must be calculated first (which is 6), leaving 10 - 4 + 6 = 12.",
    }))).toBeNull();
    expect(checkAnswerConsistency(fib({ correct_answer: "5 + 5 + 5", explanation: "5 × 3 means adding 5 a total of 3 times." }))).toBeNull();
    // ...and a real contradiction is still caught.
    expect(checkAnswerConsistency({ ...q, correct_answer: "6" })).not.toBeNull();
  });
});

// ─── 2. Explanations that correct themselves ──────────────────────────────────

describe("explanations with visible self-correction are rejected", () => {
  it.each([
    "Adding 15 minutes to 4:50 moves the minutes past 50 to 65. Since 60 minutes equals one hour, 65 minutes is 1 hour and 5 minutes past the hour, which is 5:05. Wait, re-evaluating: 4:50 + 10 minutes is 5:00.",
    "First, perform the multiplication: 2 * 3 = 6. The expression becomes 10 - 6 + 5. Wait, let's re-evaluate the options based on the calculation.",
    "A 15-minute interval is equivalent to a quarter of an hour. Adding 15 minutes to 8:20 results in 8:35. Ah, the correct calculation is 8:20 + 15 minutes = 8:35. Let's adjust the options.",
    "The term containing the variable m is -4m. The coefficient is -4. Wait, re-reading the question.",
    "The noun 'libro' is masculine singular. Option A is grammatically correct, but Option C is the intended correct choice among the options provided.",
    "To simplify to 10x, combine like terms. Let's re-examine the options. Re-evaluating the first one: 5x + 3x - 2x = 6x.",
    "Actually, I made a mistake: 7 x 5 is 35.",
    "If the calculation is 28.2, none of the options match.",
  ])("rejects: %s", (explanation) => {
    expect(hasSelfCorrection(explanation)).toBe(true);
    expect(valid(fib({ correct_answer: "x", explanation })).join(" ")).toContain("corrects itself");
  });

  it.each([
    "Wait for the water to boil before adding the pasta; boiling happens at 100 °C.",
    "Many people think spiders are insects, but they are actually arachnids.",
    "Let's check: 3 + 4 = 7, so the answer is 7.",
    "Let's count the syllables: ba-na-na has 3.",
    "Let's correct the sentence: 'He go' should be 'He goes'.",
    "Scientists re-evaluate a hypothesis when new evidence appears.",
    "Rechecking your work helps you catch mistakes.",
    "Let's re-read the passage: the clue is in the second sentence.",
    "Let's re-examine the picture: the shadow points away from the sun.",
    "A rain gauge measures rain, so it is not the right tool; the answer is the thermometer.",
  ])("accepts a clean explanation: %s", (explanation) => {
    expect(hasSelfCorrection(explanation)).toBe(false);
  });

  it("a self-correcting question is replaced by the retry/top-up path, not shipped", async () => {
    const wobbly = mc({ correct_answer: "D) 2:15 PM", explanation: "1:45 PM + 15 minutes = 2:00 PM. Wait, let's re-check the options." });
    scriptModel([
      () => wobbly,
      (n) => mc({ question_text: STEMS_200[Math.floor(n / 2) % 4] }),
    ]);
    const qs = await generateQuizQuestions(syllabus, 3, local);
    expect(qs).toHaveLength(3);
    for (const q of qs) expect(hasSelfCorrection(q.explanation)).toBe(false);
  });
});

// ─── 3. Distinct options ──────────────────────────────────────────────────────

describe("multiple-choice options must be distinct", () => {
  it("catches the audit's repeated options", () => {
    expect(duplicateOptionPair(["A) 13x - 11", "B) 13x - 11", "C) 13x - 11", "D) 13x - 11"])).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) print('Hello World')", "B) print(\"Hello World\")", "C) print('Hello World')", "D) print(\"Hello World\")"])).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) dag", "B) dag", "C) dig", "D) dig"])).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) The Normal Force.", "B) the normal  force", "C) Gravity", "D) Friction"])).toEqual([0, 1]);
  });

  it("leaves options that differ alone", () => {
    expect(duplicateOptionPair(["A) print('100')", "B) print(100)", "C) print(integer=100)", "D) print(1OO)"])).toBeNull();
    expect(duplicateOptionPair(["A) -6x + 15", "B) 6x + 15", "C) -6x - 15", "D) 6x - 15"])).toBeNull();
  });

  it("validateQuizBatch rejects twins even when the key is one of them", () => {
    const q = mc({ question_text: "Which line prints Hello World?", options: ["A) print('Hello World')", "B) print(\"Hello World\")", "C) print(Hello World)", "D) echo Hello World"], correct_answer: "B) print(\"Hello World\")", explanation: "Text in Python goes in quotes." });
    expect(valid(q).join(" ")).toContain("are the same answer");
    expect(valid(mc({}))).toEqual([]);
  });
});

// ─── 4. Letters in explanations after the shuffle ─────────────────────────────

describe("explanations name the letter the learner sees", () => {
  const labelOf = (key: string) => /^([A-D])\)/.exec(key)?.[1];

  it("rewrites the letter references to where each option moved", () => {
    const moved = { A: "C", B: "D", C: "A", D: "B" } as Record<string, string>;
    expect(rewriteLetterRefs("Option A is 2:45. Options B and D are too late. Therefore the answer is A.", (l) => moved[l]))
      .toBe("Option C is 2:45. Options D and B are too late. Therefore the answer is C.");
    expect(rewriteLetterRefs("Therefore the answer is D) 2:15 PM. Choice (B) is wrong.", (l) => moved[l]))
      .toBe("Therefore the answer is B) 2:15 PM. Choice (D) is wrong.");
    // Letters that are not option labels are left alone.
    for (const text of [
      "The answer is A triangle. Vitamin D is a vitamin.",
      "The letter B makes the /b/ sound, as in ball.",
      "The third line is G and the space above it is A) in the treble clef (Middle C) sits below.",
      "If P(A) = 0.5 and P(B) = 0.25, then P(A and B) = 0.125 for independent events.",
    ]) expect(rewriteLetterRefs(text, (l) => moved[l])).toBe(text);
  });

  it("through the real shuffle, the explanation's letter is the key's label (local path)", async () => {
    scriptModel([(n) => mc({
      question_text: STEMS_245[n % 6],
      options: ["A) 2:45", "B) 3:15", "C) 3:00", "D) 2:40"],
      correct_answer: "A",
      explanation: "2:30 + 15 minutes = 2:45. Option A is 2:45, and option D (2:40) is only 10 minutes later. Therefore the answer is A.",
    })]);
    // Pin one run of the shuffle (Math.random() = 0 sends A to D and D to C), then let the rest vary.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const [pinned] = await generateQuizQuestions(syllabus, 1, local);
    random.mockRestore();
    expect(pinned.correct_answer).toBe("D) 2:45");
    expect(pinned.explanation).toBe("2:30 + 15 minutes = 2:45. Option D is 2:45, and option C (2:40) is only 10 minutes later. Therefore the answer is D.");

    const qs = await generateQuizQuestions(syllabus, 5, local);
    expect(qs).toHaveLength(5);
    for (const q of qs) {
      const key = labelOf(q.correct_answer)!;
      const forty = labelOf(q.options!.find((o) => o.endsWith("2:40"))!)!;
      expect(q.explanation).toBe(`2:30 + 15 minutes = 2:45. Option ${key} is 2:45, and option ${forty} (2:40) is only 10 minutes later. Therefore the answer is ${key}.`);
    }
  });

  it("leaves the explanation alone when the options are themselves letters", async () => {
    scriptModel([() => mc({
      question_text: "Which letter comes right after A in the alphabet?",
      options: ["A) C", "B) B", "C) D", "D) E"],
      correct_answer: "B) B",
      explanation: "The alphabet starts A, B, C, so the answer is B.",
    })]);
    const [q] = await generateQuizQuestions(syllabus, 1, local);
    expect(q.explanation).toBe("The alphabet starts A, B, C, so the answer is B.");
  });

  it("through the real shuffle, cloud batched path, with unlabelled options mapped by position", async () => {
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      const parsed = {
        questions: STEMS_245.map((stem) => mc({
          question_text: stem.replace(/2:30/g, "10 cents"),
          options: ["penny", "nickel", "dime", "quarter"],
          correct_answer: "dime",
          explanation: "A dime is worth 10 cents. Therefore the answer is C.",
        })),
      };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(issues.join("; "));
      return parsed;
    });
    const qs = await generateQuizQuestions(syllabus, 6, cloud);
    expect(qs).toHaveLength(6);
    for (const q of qs) expect(q.explanation).toBe(`A dime is worth 10 cents. Therefore the answer is ${labelOf(q.correct_answer)}.`);
  });
});

// ─── 5. Near-duplicate questions ──────────────────────────────────────────────

describe("near-duplicate questions in one quiz or test", () => {
  const a = { question_text: "What tool is used to measure how hot or cold the air is?", correct_answer: "C) Thermometer" };
  const b = { question_text: "Which tool is specifically used to measure how hot or cold the air is?", correct_answer: "B) Thermometer" };

  it("matches the audit's reworded repeats with the same key", () => {
    expect(isNearDuplicate(a, b)).toBe(true);
    expect(isNearDuplicate(
      { question_text: "Which subatomic particle is found in the nucleus and carries no electrical charge?", correct_answer: "D) Neutron" },
      { question_text: "Which subatomic particle is found in the nucleus and has no electrical charge?", correct_answer: "A) Neutron" },
    )).toBe(true);
    expect(isNearDuplicate(
      { question_text: "Lines of latitude are parallel to each other and run in which general direction across the Earth?", correct_answer: "D) East to West" },
      { question_text: "Lines of latitude are parallel to each other and run in which direction?", correct_answer: "B) East to West" },
    )).toBe(true);
  });

  it("keeps questions with a different key, however alike the stems", () => {
    expect(isNearDuplicate(
      { question_text: "An analog clock shows the time at 2:30. If you need to determine the time exactly 15 minutes later, what time will it be?", correct_answer: "D) 2:45" },
      { question_text: "An analog clock shows the time at 1:45 PM. If you need to determine the time exactly 15 minutes later, what time will it be?", correct_answer: "C) 2:00 PM" },
    )).toBe(false);
    expect(isNearDuplicate(a, { question_text: "What tool is used to measure how much rain fell?", correct_answer: "Thermometer" })).toBe(false);
  });

  it("dedupeByQuestionText keeps the first of a near-duplicate pair", () => {
    expect(dedupeByQuestionText([a, b, { question_text: "What does a rain gauge measure?", correct_answer: "Rain" }]).map((q) => q.question_text))
      .toEqual([a.question_text, "What does a rain gauge measure?"]);
  });

  it("local path: a near-repeat is dropped and the quiz is topped up with a different question", async () => {
    const stems = [a.question_text, b.question_text, "Which instrument shows wind direction?", "What does a rain gauge measure?"];
    const keys = ["C) Thermometer", "C) Thermometer", "C) Wind vane", "C) Rain"];
    scriptModel([(n) => mc({
      question_text: stems[n % 4], correct_answer: keys[n % 4], explanation: "This is the tool for that job.",
      options: ["A) Barometer", "B) Ruler", keys[n % 4], "D) Scale"],
    })]);
    const qs = await generateQuizQuestions(syllabus, 3, local);
    expect(qs.map((q) => q.question_text)).toEqual([stems[0], stems[2], stems[3]]);
  });

  it("promotion test, cloud path: the section drops the repeat", async () => {
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      return { questions: [a, b].map((x) => mc({ ...x, correct_answer: "C) Thermometer", options: ["A) Barometer", "B) Ruler", "C) Thermometer", "D) Scale"], explanation: "A thermometer measures temperature." })) };
    });
    const { current } = await generatePromotionTestQuestions(syllabus, [], cloud);
    expect(current.map((q) => q.question_text)).toEqual([a.question_text]);
  });
});

// ─── Stricter validation and the quiz floor ───────────────────────────────────

describe("stricter validation does not leave a quiz silently empty", () => {
  it("a model that only writes rejected questions gets the existing error, not an empty quiz", async () => {
    scriptModel([() => mc({ explanation: "1:45 PM + 15 minutes = 2:00 PM. Wait, let's re-check." })]);
    await expect(generateQuizQuestions(syllabus, 4, local)).rejects.toThrow(/Could not generate quiz questions/);
  });

  it("when every other question is rejected, top-up rounds still return the clean ones", async () => {
    // Each failed call here stands for one whose repairs were all used up. Three rounds of top-up get
    // three of four; QuizFullScreen shows its short-quiz notice for that, as before.
    scriptModel([
      () => mc({ options: ["A) 2:00 PM", "B) 2:00 PM", "C) 2:15 PM", "D) 1:30 PM"], correct_answer: "A) 2:00 PM" }),
      (n) => mc({ question_text: STEMS_200[Math.floor(n / 2) % 4] }),
    ]);
    const qs = await generateQuizQuestions(syllabus, 4, local);
    expect(qs.map((q) => q.question_text)).toEqual(STEMS_200.slice(0, 3));
    for (const q of qs) expect(duplicateOptionPair(q.options!)).toBeNull();
  });
});
