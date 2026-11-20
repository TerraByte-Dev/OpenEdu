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
  dedupeByQuestionText, rewriteLetterRefs, keyForm, sameKeyForm, normalizeOption,
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
const DIME_STEMS = [
  "Which coin is worth 10 cents?",
  "Name the thinnest US coin.",
  "Two nickels make the same amount as which coin?",
  "Which coin has Franklin Roosevelt on it?",
  "Ten pennies trade for one of what?",
  "A roll of 50 of them holds five dollars. What coin is it?",
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

// ─── 1b. Equation and method keys ─────────────────────────────────────────────

// The B9 rerun 2 audit (gemma4:e2b, 2026-11-14) found the value check reading the wrong number from
// two kinds of key: an equation option ("B) 24 ÷ 3 = 8" was read as 24) and a method key ("Subtract 7
// from both sides" was read as 7). Both rejected correct questions; one-step equations lost 29 calls.
describe("equation and method keys", () => {
  const division = {
    question_text: "24 cookies are shared equally by 3 friends. Which division fact shows how many each friend gets?",
    options: ["A) 24 ÷ 4 = 6", "B) 24 ÷ 3 = 8", "C) 24 - 3 = 21", "D) 3 × 6 = 18"],
    correct_answer: "B) 24 ÷ 3 = 8",
    explanation: "Sharing 24 among 3 friends is 24 ÷ 3. Therefore the answer is 8.",
  };
  const firstStep = {
    question_text: "To solve x + 7 = 12, what should you do first?",
    options: ["A) Subtract 7 from both sides", "B) Add 7 to both sides", "C) Multiply both sides by 7", "D) Divide both sides by 12"],
    correct_answer: "A) Subtract 7 from both sides",
    explanation: "Subtracting 7 from both sides leaves x by itself: x = 12 - 7 = 5.",
  };

  it.each<[string, Partial<Raw>]>([
    ["an equation option, read by its result", division],
    ["repeated addition", {
      question_text: "Which addition fact matches 5 groups of 8?",
      options: ["A) 8 + 5 = 13", "B) 8 + 8 + 8 + 8 + 8 = 40", "C) 5 + 5 + 5 = 15", "D) 8 + 8 = 16"],
      correct_answer: "B) 8 + 8 + 8 + 8 + 8 = 40",
      explanation: "5 groups of 8 is 5 × 8 = 40.",
    }],
    ["an option stating two facts", {
      question_text: "Which division facts go with 4 × 9 = 36?",
      options: ["A) 36 ÷ 6 = 6", "B) 36 - 9 = 27", "C) 9 ÷ 4 = 36", "D) 36 ÷ 9 = 4, and 36 ÷ 4 = 9."],
      correct_answer: "D) 36 ÷ 9 = 4, and 36 ÷ 4 = 9.",
      explanation: "Division undoes multiplication, so 36 ÷ 9 = 4.",
    }],
    ["an equation option whose explanation restates the stem's fact", {
      question_text: "A 4 by 6 array models 4 × 6 = 24. Which division fact goes with it?",
      options: ["A) 24 ÷ 3 = 8", "B) 24 ÷ 6 = 4", "C) 24 - 6 = 18", "D) 6 ÷ 4 = 24"],
      correct_answer: "B) 24 ÷ 6 = 4",
      explanation: "The array shows 4 × 6 = 24. Dividing the total by the 6 columns gives the 4 rows. Therefore the answer is B.",
    }],
    ["a method key", firstStep],
    ["a two-step method key", {
      question_text: "Which steps solve 4x - 7 = 13?",
      options: ["A) Add 7 to both sides, then divide both sides by 4.", "B) Subtract 7 from both sides, then divide both sides by 4.", "C) Divide both sides by 4, then add 7.", "D) Multiply both sides by 4."],
      correct_answer: "A) Add 7 to both sides, then divide both sides by 4.",
      explanation: "Adding 7 to both sides gives 4x = 20. Then x = 20 ÷ 4 = 5.",
    }],
  ])("accepts a correct question: %s", (_name, over) => {
    expect(valid(mc(over))).toEqual([]);
  });

  it("accepts a method key on a fill-in-the-blank question", () => {
    expect(checkAnswerConsistency(fib({
      question_text: "In 3x = 45, what step finds x?",
      correct_answer: "Divide both sides by 3 to isolate x.",
      explanation: "Dividing both sides by 3 gives x = 45 ÷ 3 = 15.",
    }))).toBeNull();
  });

  it("still rejects an equation option whose result the explanation contradicts", () => {
    const wrong = mc({ ...division, options: ["A) 24 ÷ 4 = 6", "B) 24 ÷ 3 = 7", "C) 24 - 3 = 21", "D) 3 × 6 = 18"], correct_answer: "B) 24 ÷ 3 = 7" });
    expect(checkAnswerConsistency(wrong)).toContain("works toward 8");
    expect(checkAnswerConsistency(mc({ ...firstStep, options: ["A) x = 7", "B) x = 5", "C) x = 19", "D) x = 12"], correct_answer: "A) x = 7" }))).toContain("works toward 5");
  });

  it("still rejects the audit's true contradictions (12.5 vs 12, 34 cm vs 37 cm)", () => {
    expect(checkAnswerConsistency(fib({
      question_text: "A 25 m rope is cut into 2 equal pieces. How long is each piece, in meters?",
      correct_answer: "12",
      explanation: "Divide the length by the number of pieces: 25 ÷ 2 = 12.5. Therefore the answer is 12.5.",
    }))).toContain("works toward 12.5");
    expect(checkAnswerConsistency(mc({
      question_text: "A rectangle is 10 cm long and 7 cm wide. What is its perimeter?",
      options: ["A) 34 cm", "B) 37 cm", "C) 70 cm", "D) 17 cm"],
      correct_answer: "B) 37 cm",
      explanation: "Add all four sides: 10 + 7 + 10 + 7 = 34 cm.",
    }))).toContain("works toward 34");
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

  // TerraTutor click test 2026-11-19 part 2, issue 5: a question with two right options marked the child
  // wrong for the one that was not the key string. Code catches the cases it can read for sure.
  // End marks, articles and hyphens are what K-2 English questions ask about, so options that differ
  // only in them are different answers.
  it("keeps options apart that differ in end marks, articles or hyphens", () => {
    for (const [question_text, options, key] of [
      ["Which sentence is a question?", ["A) I like cats.", "B) I like cats?", "C) I like cats!", "D) I like dogs."], "B) I like cats?"],
      ["Which one asks something?", ["A) Is it red?", "B) Is it red.", "C) It is red.", "D) Red it is."], "A) Is it red?"],
      ["Which greeting shows strong feeling?", ["A) Hello!", "B) Hello.", "C) Hello?", "D) Hello,"], "A) Hello!"],
      ["Which is right?", ["A) a apple", "B) an apple", "C) the apples", "D) an apples"], "B) an apple"],
      ["Which uses a definite article?", ["A) a cat", "B) the cat", "C) cats", "D) an cat"], "B) the cat"],
      ["Which is spelled right?", ["A) ice-cream", "B) ice cream", "C) icecreem", "D) ise cream"], "B) ice cream"],
      ["Which one needs a hyphen?", ["A) well-known", "B) well known", "C) wellknown", "D) wel known"], "A) well-known"],
      ["Which word means to cover again?", ["A) re-cover", "B) re cover", "C) recover", "D) uncover"], "A) re-cover"],
    ] as Array<[string, string[], string]>) {
      expect(duplicateOptionPair(options, question_text), options.join(" | ")).toBeNull();
      const q = mc({ question_text, options, correct_answer: key, explanation: `That one is right. Therefore the answer is ${key}` });
      expect(valid(q).filter((i) => /same answer|same number/.test(i)), question_text).toEqual([]);
    }
  });

  it("catches the same number written the same way", () => {
    expect(duplicateOptionPair(["A) 0.5", "B) 0.50", "C) 0.05", "D) 5"])).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) .5", "B) 0.5", "C) 1.5", "D) 2"])).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) 1,000", "B) 100", "C) 1000", "D) 10"])).toEqual([0, 2]);
    expect(duplicateOptionPair(["A) 50%", "B) 5%", "C) 50 percent", "D) 500%"])).toEqual([0, 2]);
  });

  it("leaves signs, negatives and different numbers alone", () => {
    expect(duplicateOptionPair(["A) ?", "B) !", "C) .", "D) ,"])).toBeNull();
    expect(duplicateOptionPair(["A) +", "B) -", "C) ×", "D) ÷"])).toBeNull();
    expect(duplicateOptionPair(["A) -5", "B) 5", "C) - 5 + 1", "D) 0"])).toBeNull();
    expect(duplicateOptionPair(["A) 1/2", "B) 2/4", "C) 0.5", "D) 50%"])).toBeNull(); // forms differ: optionEqualToKey's case
  });

  it("keeps the same number written two ways when the stem asks how it is written", () => {
    for (const [stem, options] of [
      ["Which shows 3 digits after the decimal point?", ["A) 0.5", "B) 0.50", "C) 0.500", "D) 5"]],
      ["Round 0.496 to the nearest hundredth.", ["A) 0.5", "B) 0.50", "C) 0.49", "D) 0.4"]],
      ["Which shows one thousand with a comma?", ["A) 1,000", "B) 1000", "C) 100", "D) 10,00"]],
    ] as Array<[string, string[]]>) {
      expect(duplicateOptionPair(options, stem), stem).toBeNull();
    }
    expect(duplicateOptionPair(["A) 0.5", "B) 0.50", "C) 0.49", "D) 0.4"], "How much of the cake is left?")).toEqual([0, 1]);
  });

  // Review of the OpenEdu port of TerraTutor #251, 2026-11-19: false rejections, each costing a regeneration.
  it("keeps a misconception question that names both numbers, and options that differ in a/an or a hyphen", () => {
    const ask = (question_text: string, options: string[], key: string) =>
      valid(mc({ question_text, options, correct_answer: key, explanation: `That one is right. Therefore the answer is ${key}` })).filter((i) => /same answer|same number/.test(i));
    expect(ask("Which is greater: 0.5 or 0.50?", ["A) 0.5", "B) 0.50", "C) They are equal", "D) You can't tell"], "C) They are equal")).toEqual([]);
    expect(ask("Which is spelled correctly?", ["A) twenty-one", "B) twenty one", "C) twentyone", "D) twenty-won"], "A) twenty-one")).toEqual([]);
    expect(ask("Which is right?", ["A) a eighth", "B) an eighth", "C) an eight", "D) a eight"], "B) an eighth")).toEqual([]);
    // A stem about hyphens or articles asks how it is written (review of the #252 port, 2026-11-19).
    expect(ask("Which number uses a hyphen correctly?", ["A) twenty-one", "B) twenty one", "C) twentyone", "D) twenty-won"], "A) twenty-one")).toEqual([]);
    expect(ask("Which uses the correct article?", ["A) a half", "B) half", "C) an half", "D) the half"], "A) a half")).toEqual([]);
    // A stem that names only one of them still gets the twins caught.
    expect(duplicateOptionPair(["A) 0.5", "B) 0.50", "C) 0.05", "D) 5"], "Is 0.5 more than 0.05?")).toEqual([0, 1]);
    expect(ask("What fraction of the pie is left?", ["A) one eighth", "B) 0.125", "C) one fourth", "D) one half"], "A) one eighth")).not.toEqual([]);
  });

  // Letter case (Fable's decision for TerraTutor #252, 2026-11-19): case-only twins stay apart only on a
  // stem about capitals.
  it("keeps options that differ only in case apart when the stem is about capitals, and nowhere else", () => {
    const ask = (question_text: string, options: string[], key: string) =>
      valid(mc({ question_text, options, correct_answer: key, explanation: `That one is right. Therefore the answer is ${key}` })).filter((i) => /same answer/.test(i));
    for (const [question_text, options, key] of [
      ["Which sentence uses a capital letter correctly?", ["A) Hello.", "B) hello.", "C) HELLO.", "D) hEllo."], "A) Hello."],
      ["Which name is capitalized correctly?", ["A) Odessa", "B) odessa", "C) ODESSA", "D) oDessa"], "A) Odessa"],
      ["Which word is a proper noun?", ["A) Texas", "B) texas", "C) state", "D) river"], "A) Texas"],
      ["Which letter is uppercase?", ["A) B", "B) b", "C) d", "D) p"], "A) B"],
      ["Which word should start with a capital?", ["A) Monday", "B) monday", "C) dog", "D) blue"], "A) Monday"],
      ["Which shows correct capitalization?", ["A) New York", "B) new york", "C) NEW YORK", "D) New york"], "A) New York"],
    ] as Array<[string, string[], string]>) {
      expect(duplicateOptionPair(options, question_text), question_text).toBeNull();
      expect(ask(question_text, options, key), question_text).toEqual([]);
    }
    expect(duplicateOptionPair(["A) The Normal Force.", "B) the normal  force", "C) Gravity", "D) Friction"], "Which force pushes up on a book on a table?")).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) Paris", "B) paris", "C) Rome", "D) Lyon"], "What is the capital of France?")).toEqual([0, 1]);
    // "Capitalism" is not about capitals (review of the #252 port, 2026-11-19).
    expect(duplicateOptionPair(["A) Capitalism", "B) capitalism", "C) Socialism", "D) Feudalism"], "What economic system is capitalism?")).toEqual([0, 1]);
    expect(duplicateOptionPair(["A) Hello.", "B) Hello", "C) Bye.", "D) Hi."], "Which word needs a capital letter?")).toEqual([0, 1]);
  });

  it("keeps a fraction, number word or ordinal question whose options name the key's number another way", () => {
    const ask = (question_text: string, options: string[], key: string) =>
      valid(mc({ question_text, options, correct_answer: key, explanation: `That one is right. Therefore the answer is ${key}` })).filter((i) => /same number/.test(i));
    expect(ask("Which fraction has 8 as its denominator?", ["A) 1/2", "B) 4/8", "C) 1/4", "D) 2/3"], "B) 4/8")).toEqual([]);
    expect(ask("Which word is the number 4?", ["A) four", "B) 4", "C) for", "D) fore"], "A) four")).toEqual([]);
    expect(ask("What is the ordinal for 3?", ["A) third", "B) 1/3", "C) three", "D) thirty"], "A) third")).toEqual([]);
  });

  it("validateQuizBatch rejects an option that is the key's number written another way", () => {
    const half = (options: string[], key: string, question_text = "What fraction of the pizza is left?") =>
      mc({ question_text, options, correct_answer: key, explanation: `Half of it is left. Therefore the answer is ${key}` });
    for (const [options, key] of [
      [["A) 1/2", "B) 0.5", "C) 1/3", "D) 1/4"], "A) 1/2"],
      [["A) 1/3", "B) 1/2", "C) one half", "D) 1/4"], "B) 1/2"],
      [["A) 2/4", "B) 1/3", "C) 1/2", "D) 3/4"], "C) 1/2"],
      [["A) 50%", "B) 1/3", "C) 1/2", "D) 25%"], "C) 1/2"],
      [["A) 3 quarters", "B) 3/4", "C) 1/2", "D) 1/4"], "B) 3/4"],
    ] as Array<[string[], string]>) {
      expect(valid(half(options, key)).join(" "), options.join(" | ")).toContain("is the same number as the correct answer");
    }
    expect(valid(mc({ question_text: "What is 3 + 4?", options: ["A) 7", "B) seven", "C) 8", "D) 6"], correct_answer: "A) 7", explanation: "3 + 4 = 7. Therefore the answer is 7" })).join(" "))
      .toContain("is the same number as the correct answer");
    // Review of TerraTutor #252, 2026-11-19: a hyphen, a space or a missing article is the same number on a
    // math stem; only "a" against "an" (both there) is what an English question asks.
    for (const [question_text, options, key] of [
      ["What is 20 + 1?", ["A) twenty-one", "B) twenty one", "C) twelve", "D) nineteen"], "A) twenty-one"],
      ["How much of the pizza is left?", ["A) a half", "B) half", "C) a third", "D) a quarter"], "A) a half"],
    ] as Array<[string, string[], string]>) {
      expect(valid(mc({ question_text, options, correct_answer: key, explanation: `That much. Therefore the answer is ${key}` })).join(" "), question_text)
        .toContain("is the same number as the correct answer");
    }
    // Two distractors that equal each other but not the key leave the child's mark right.
    expect(valid(half(["A) 1/3", "B) 2/4", "C) 0.5", "D) 1/4"], "A) 1/3"))).toEqual([]);
  });

  it("keeps a question about how a number is written", () => {
    for (const question_text of ["Which of these is written as a decimal?", "Which fraction is in simplest form?", "Write 2/4 in lowest terms.", "What is 0.5 as a fraction?", "Which shows one half as a percent?"]) {
      const q = mc({ question_text, options: ["A) 1/2", "B) 0.5", "C) 2/4", "D) 50%"], correct_answer: "B) 0.5", explanation: "0.5 is the decimal. Therefore the answer is 0.5" });
      expect(valid(q).filter((i) => /same number/.test(i)), question_text).toEqual([]);
    }
  });

  it("through the real generator, a two-right-answers question is rewritten before it is shown", async () => {
    scriptModel([
      () => mc({ question_text: "What fraction of the pizza is left?", options: ["A) 1/2", "B) 0.5", "C) 1/3", "D) 1/4"], correct_answer: "A) 1/2", explanation: "Half is left. Therefore the answer is 1/2" }),
      (n) => mc({ question_text: STEMS_200[Math.floor(n / 2) % 4] }),
    ]);
    const qs = await generateQuizQuestions(syllabus, 3, local);
    expect(qs).toHaveLength(3);
    expect(qs.some((q) => q.options?.some((o) => /0\.5/.test(o)))).toBe(false);
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
        // Six different questions keyed "dime": SAME_KEY_CAP sets 4 aside and the quiz's minimum takes them back.
        questions: DIME_STEMS.map((stem) => mc({
          question_text: stem,
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

  // Click test 2026-11-19 part 6: fractions L1 asked this twice, once with "take" and once with "eat", and
  // the model keyed the two in other words.
  const take = {
    question_text: "If a whole cake is divided into 10 equal slices, and you take 7 of those slices, what does the number 7 represent in the fraction 7/10?",
    question_type: "short_answer", options: [] as string[], correct_answer: "the number of parts taken",
  };
  const eat = {
    ...take,
    question_text: "If a whole cake is divided into 10 equal slices, and you eat 7 of those slices, what does the number 7 represent in the fraction 7/10?",
    correct_answer: "the number of slices you ate",
  };

  it("matches a reworded repeat whose free-text key is worded differently", () => {
    expect(isNearDuplicate(take, eat)).toBe(true);
    expect(dedupeByQuestionText([take, eat]).map((q) => q.correct_answer)).toEqual([take.correct_answer]);
  });

  it("keeps free-text questions apart when their numbers differ in order, or they ask different things", () => {
    // Same words and the same numbers as a set, asked about the other number.
    expect(isNearDuplicate(
      take,
      { ...take, question_text: take.question_text.replace("the number 7", "the number 10"), correct_answer: "the number of parts in the whole cake" },
    )).toBe(false);
    // A pizza question that asks for the number against one that asks what the number means.
    expect(isNearDuplicate(
      { ...take, question_text: "A pizza is cut into 8 equal slices and you eat 5 of them. What number represents the part eaten?", correct_answer: "5" },
      { ...take, question_text: "A pizza is cut into 8 equal slices and you eat 5 of them. What does 5 represent in 5/8?", correct_answer: "the number of slices eaten" },
    )).toBe(false);
    // Top against bottom: the same numbers and nearly the same stem, keys with no word in common.
    expect(isNearDuplicate(
      { ...take, question_type: "fill_in_blank", question_text: "In 3/4, the top number is called the ___.", correct_answer: "numerator" },
      { ...take, question_type: "fill_in_blank", question_text: "In 3/4, the bottom number is called the ___.", correct_answer: "denominator" },
    )).toBe(false);
  });

  // Review of this fix: a short stem with the one word it asks about swapped clears the stem overlap, and
  // the two keys often share a word. Different questions; they stay apart (the last clause differs).
  it("keeps apart short free-text questions that swap the word they ask about", () => {
    const sa = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "short_answer", options: [] as string[] });
    const pairs: Array<[ReturnType<typeof sa>, ReturnType<typeof sa>]> = [
      [sa("In a fraction, what does the numerator tell you?", "how many parts are taken"),
        sa("In a fraction, what does the denominator tell you?", "how many equal parts the whole is divided into")],
      [sa("A pizza is cut into 8 slices and you eat 3. In 3/8, what does the top number tell you?", "how many slices you ate"),
        sa("A pizza is cut into 8 slices and you eat 3. In 3/8, what does the bottom number tell you?", "how many slices the pizza was cut into")],
      [sa("Read the story. What is the main idea of the first paragraph?", "the fox is hungry and looks for food"),
        sa("Read the story. What is the main idea of the second paragraph?", "the fox finds food near the river")],
      [sa("Think about a plant. What is the job of the roots?", "to take in water from the soil"),
        sa("Think about a plant. What is the job of the leaves?", "to take in sunlight to make food")],
      [sa("In the water cycle, what is evaporation?", "liquid water turning into water vapor"),
        sa("In the water cycle, what is condensation?", "water vapor turning into liquid water")],
    ];
    for (const [x, y] of pairs) {
      expect(isNearDuplicate(x, y)).toBe(false);
      expect(dedupeByQuestionText([x, y])).toHaveLength(2);
    }
    // Only the setup reworded, the asking clause the same: still the live repeat.
    expect(isNearDuplicate(take, eat)).toBe(true);
  });

  // Review of the port of TerraTutor #259: keys that share only a pronoun are not the same answer.
  it("keeps apart free-text questions whose keys share only a pronoun", () => {
    const sa = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "short_answer", options: [] as string[] });
    const kind = sa("In the story, Ana shares her lunch with a new student. What does this tell you about Ana?", "she is kind");
    const unkind = sa("In the story, Ana shouts at a new student. What does this tell you about Ana?", "she is unkind and rude");
    expect(isNearDuplicate(kind, unkind)).toBe(false);
    expect(dedupeByQuestionText([kind, unkind])).toHaveLength(2);
    // ... a reflexive one too (review of TerraTutor's take-back, TerraTutor #261, 2026-11-19).
    expect(isNearDuplicate(sa(kind.question_text, "she herself is kind"), sa(unkind.question_text, "she herself is rude"))).toBe(false);
  });

  // TerraTutor live test part 8 issue 2: a quiz asked about the cell membrane 7 times in 19, keyed "The cell
  // membrane" and "Cell membrane" by turns.
  it("reads a key without a leading article, case or punctuation, for repeats only", () => {
    expect(keyForm("A) The Cell Membrane")).toBe("cell membrane");
    expect(keyForm("cell membrane.")).toBe("cell membrane");
    expect(keyForm("Cell-membrane!")).toBe("cell membrane");
    expect(keyForm("an igneous rock")).toBe("igneous rock");
    // A key with a digit keeps its signs: -3 is not 3, $5 is not 5.
    expect(keyForm("-3")).not.toBe(keyForm("3"));
    expect(keyForm("$5")).not.toBe(keyForm("5"));
    // "a" alone is a key ("a" or "an" before "apple?"), not an article.
    expect(keyForm("a")).toBe("a");
    // Grading still reads the key as written (normalizeOption keeps the article).
    expect(normalizeOption("The Cell Membrane")).toBe("the cell membrane");
    expect(sameKeyForm({ question_text: "", question_type: "true_false", correct_answer: "True" })).toBeNull();
    expect(sameKeyForm({ question_text: "", question_type: "drag_to_match", correct_answer: "See matching_pairs" })).toBeNull();
    for (const k of ["7", "seven", "3/4", "three quarters", "2:30 PM", "$1.25", "two dimes"]) {
      expect(sameKeyForm({ question_text: "", question_type: "short_answer", correct_answer: k })).toBeNull();
    }
    expect(sameKeyForm({ question_text: "", question_type: "multiple_choice", correct_answer: "B) Lava" })).toBe("lava");
  });

  it("matches the same question keyed with and without \"the\"", () => {
    const mcq = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "multiple_choice", options: [correct_answer, "B) Nucleus"] });
    expect(isNearDuplicate(
      mcq("Which part of the cell controls what goes in and out?", "A) The cell membrane"),
      mcq("Which part of a cell controls what goes in and out?", "A) Cell membrane"),
    )).toBe(true);
  });

  // Review of TerraTutor #263 (the same-key fix): a lower stem bar for one key (0.6 of content words) called these pairs
  // repeats. Each pair asks two things, and the cap, not the near-duplicate check, limits one key.
  it("keeps the 0.85 bar for one key: a classification asked of two things is two questions", () => {
    const sa = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "short_answer", options: [] as string[] });
    const pairs: Array<[string, string, string]> = [
      ["Is 8 even or odd?", "Is 12 even or odd?", "Even"],
      ["Is 7 prime or composite?", "Is 13 prime or composite?", "prime"],
      ["Is a dog living or nonliving?", "Is a rock living or nonliving?", "living"],
      ["Is 'dog' a noun or a verb?", "Is 'cat' a noun or a verb?", "noun"],
      ["What is a synonym for happy?", "What is a synonym for glad?", "joyful"],
      ["Is ice solid, liquid or gas?", "Is steam solid, liquid or gas?", "solid"],
      ["Is a whale a mammal or a fish?", "Is a dolphin a mammal or a fish?", "mammal"],
      ["Who was president during the Civil War?", "Who gave the Gettysburg Address during the Civil War?", "Abraham Lincoln"],
    ];
    for (const [x, y, key] of pairs) expect(isNearDuplicate(sa(x, key), sa(y, key)), `${x} / ${y}`).toBe(false);
  });

  it("keeps the apostrophe in a key: its / it's and well / we'll are what a grammar question contrasts", () => {
    expect(keyForm("it's")).not.toBe(keyForm("its"));
    expect(keyForm("We'll")).not.toBe(keyForm("well"));
    expect(keyForm("we're")).not.toBe(keyForm("were"));
    expect(keyForm("can't")).not.toBe(keyForm("cant"));
    expect(keyForm("she'll")).not.toBe(keyForm("shell"));
    expect(keyForm("B) It’s.")).toBe("it's");
    const mcq = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "multiple_choice", options: ["A) its", "B) it's", "C) is", "D) it"] });
    expect(isNearDuplicate(
      mcq("Which word is a contraction for 'it is'?", "B) it's"),
      mcq("Which word shows that something belongs to 'it'?", "A) its"),
    )).toBe(false);
    const fb = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "fill_in_blank", options: [] as string[] });
    expect(isNearDuplicate(
      fb("Choose well or we'll: ___ see you at the party tonight.", "We'll"),
      fb("Choose well or we'll: She sings very ___ at the party.", "well"),
    )).toBe(false);
  });

  // Review of OpenEdu's port of TerraTutor #263: dropping every non-letter turned "<", ">", "=", "+" and "-"
  // into "" and "Na+" into "na", so a mirror question (the same stem words) was dropped as a repeat.
  it("keeps a symbol in a key: a comparison or sign question and its mirror are two questions", () => {
    const fb = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "fill_in_blank", options: [] as string[] });
    const sa = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "short_answer", options: [] as string[] });
    const pairs: Array<[ReturnType<typeof fb>, ReturnType<typeof fb>]> = [
      [fb("Which symbol makes this true: 34 ___ 43?", "<"), fb("Which symbol makes this true: 43 ___ 34?", ">")],
      [fb("Which symbol makes this true: 34 ___ 34?", "="), fb("Which symbol makes this true: 34 ___ 43?", "<")],
      [fb("Which sign makes 6 _ 2 = 8 true?", "+"), fb("Which sign makes 6 _ 2 = 4 true?", "-")],
      [sa("What is the symbol for a sodium ion?", "Na+"), sa("What is the symbol for sodium?", "Na")],
      // The minus sign typed as a hyphen at the end of the key (#405 review).
      [sa("Write the symbol for a chlorine ion.", "Cl-"), sa("Write the symbol for a chlorine atom.", "Cl")],
      [sa("Write the formula for a hydroxide ion.", "OH-"), sa("Write the formula for a hydroxide group.", "OH")],
    ];
    for (const [x, y] of pairs) {
      expect(keyForm(x.correct_answer), `${x.correct_answer} / ${y.correct_answer}`).not.toBe(keyForm(y.correct_answer));
      expect(isNearDuplicate(x, y), `${x.question_text} / ${y.question_text}`).toBe(false);
      expect(dedupeByQuestionText([x, y])).toHaveLength(2);
    }
    // A key that is only punctuation is never blank, so it cannot match every other such key.
    expect(keyForm("?")).not.toBe("");
    // Punctuation still goes: the live cell-membrane keys stay one key.
    expect(keyForm("Cell-membrane!")).toBe("cell membrane");
  });

  // Ported from TerraTutor #265.
  it("reads a minus sign before punctuation or a quote too", () => {
    expect(keyForm("Cl-, Na+")).not.toBe(keyForm("Cl, Na+"));
    expect(keyForm("Cl-; Na+")).not.toBe(keyForm("Cl; Na+"));
    expect(keyForm("(Cl-)")).not.toBe(keyForm("(Cl)"));
    expect(keyForm("\"Cl-\"")).not.toBe(keyForm("\"Cl\""));
    expect(keyForm("\"Cl-\"")).toContain("cl−");
    expect(keyForm("Cl-/Na+")).not.toBe(keyForm("Cl/Na+"));
    // A hyphen inside a word, or between words, still goes.
    expect(keyForm("Cell-membrane, nucleus")).toBe("cell membrane nucleus");
    expect(keyForm("cell - membrane")).toBe("cell membrane");
  });

  it("local path: a K-2 compare question and its mirror both reach the quiz", async () => {
    const compare = { level: 1, title: "Comparing numbers", subtopics: [{ id: "s1", title: "Compare with <, >, =", key_concepts: ["less than"] }] } as unknown as Syllabus;
    const script = [
      { question_text: "Which symbol makes this true: 34 ___ 43?", blank_position: "34 ___ 43", correct_answer: "<", explanation: "34 is less than 43. Therefore the answer is <" },
      { question_text: "Which symbol makes this true: 43 ___ 34?", blank_position: "43 ___ 34", correct_answer: ">", explanation: "43 is greater than 34. Therefore the answer is >" },
      { question_text: "Which symbol makes this true: 34 ___ 34?", blank_position: "34 ___ 34", correct_answer: "=", explanation: "34 is equal to 34. Therefore the answer is =" },
    ];
    scriptModel([(n) => ({ ...fib({}), ...script[n % script.length] })]);
    const qs = await generateQuizQuestions(compare, 3, local);
    expect(qs.map((q) => q.correct_answer)).toEqual(["<", ">", "="]);
  });

  // #405 review: the minus sign typed as a hyphen ("Cl-") read as "cl", so the ion's question was dropped
  // as a repeat of the atom's.
  it("local path: an ion question and its atom's both reach the quiz", async () => {
    const ions = { level: 3, title: "Ions", subtopics: [{ id: "s1", title: "Ion symbols", key_concepts: ["charge"] }] } as unknown as Syllabus;
    const script = [
      { question_text: "Write the chemical symbol for a chlorine ion.", correct_answer: "Cl-", explanation: "A chlorine ion has one extra electron. Therefore the answer is Cl-" },
      { question_text: "Write the chemical symbol for a chlorine atom.", correct_answer: "Cl", explanation: "Chlorine's symbol is Cl. Therefore the answer is Cl" },
      { question_text: "Write the chemical symbol for a sodium ion.", correct_answer: "Na+", explanation: "A sodium ion has lost one electron. Therefore the answer is Na+" },
    ];
    scriptModel([(n) => ({ ...mc({}), question_type: "short_answer", options: [], ...script[n % script.length] })]);
    const qs = await generateQuizQuestions(ions, 3, local);
    expect(qs.map((q) => q.correct_answer)).toEqual(["Cl-", "Cl", "Na+"]);
  });

  it("does not count a classification's pick toward the same-key cap", () => {
    const sa = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "short_answer", options: [] as string[] });
    expect(sameKeyForm(sa("Is 8 even or odd?", "Even"))).toBeNull();
    expect(sameKeyForm(sa("Is ice a solid, liquid or gas?", "a solid"))).toBeNull();
    expect(sameKeyForm(sa("Is 'dog' a noun or a verb?", "noun"))).toBeNull();
    expect(sameKeyForm({ question_text: "Which kind of animal is a whale?", correct_answer: "A) Mammal", question_type: "multiple_choice", options: ["A) Mammal", "B) Fish"] })).toBeNull();
    expect(sameKeyForm({ question_text: "Is this a fact or an opinion: 'Red is the best color.'", correct_answer: "B) Opinion", question_type: "multiple_choice", options: ["A) Fact", "B) Opinion"] })).toBeNull();
    // The live repeats never name their key, and have four options: the cap still counts them.
    expect(sameKeyForm({ question_text: "What thin layer surrounds every cell?", correct_answer: "A) The cell membrane", question_type: "multiple_choice", options: ["A) The cell membrane", "B) Nucleus", "C) Cell wall", "D) Mitochondria"] })).toBe("cell membrane");
    expect(sameKeyForm(sa("What flows out of an erupting volcano?", "the lava"))).toBe("lava");
  });

  it("keeps the 0.85 bar for true/false and number keys, where equal keys are normal", () => {
    // 8 of 11 words, 5 of 7 content words: both true, two different facts.
    const tf = (question_text: string) => ({ question_text, correct_answer: "True", question_type: "true_false", options: ["True", "False"] });
    expect(isNearDuplicate(
      tf("Magma is melted rock found under the ground. True or false?"),
      tf("Lava is melted rock that has reached the ground. True or false?"),
    )).toBe(false);
    // 10 of 12 words, 6 of 8 content words and numbers: both 7, two different sums.
    const wp = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "word_problem", options: [] as string[] });
    expect(isNearDuplicate(
      wp("Sam has 12 apples and gives away 5 apples. How many apples are left?", "7"),
      wp("Sam has 10 apples and gives away 3 apples. How many apples are left?", "7"),
    )).toBe(false);
    expect(isNearDuplicate(
      wp("Sam has 12 apples and gives away 5 apples. How many apples are left?", "seven"),
      wp("Sam has 10 apples and gives away 3 apples. How many apples are left?", "seven"),
    )).toBe(false);
  });

  it("keeps the equal-key rule for word problems, and for a bare fill-in-the-blank stem", () => {
    const wp = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "word_problem", options: [] as string[] });
    expect(isNearDuplicate(
      wp("Sam has 4 red apples and 2 green apples. Which color does Sam have more of?", "red apples"),
      wp("Sam has 4 red apples and 2 green apples. Which color does Sam have fewer of?", "green apples"),
    )).toBe(false);
    // The live pair's shape, typed as word problems (or a type the app doesn't know): equal key only.
    expect(isNearDuplicate({ ...take, question_type: "word_problem" }, { ...eat, question_type: "word_problem" })).toBe(false);
    expect(isNearDuplicate({ ...take, question_type: "essay" }, { ...eat, question_type: "essay" })).toBe(false);
    const fb = (question_text: string, correct_answer: string) => ({ question_text, correct_answer, question_type: "fill_in_blank", options: [] as string[] });
    expect(dedupeByQuestionText([fb("Fill in the blank with the right word.", "water vapor"), fb("Fill in the blank.", "liquid water")])).toHaveLength(2);
  });

  it("keeps the equal-key rule for numbers, quantities and multiple choice", () => {
    const stem = (s: string) => `A pizza is cut into 8 equal slices and you eat 5 of them. ${s}`;
    // Same stem numbers, one key a number: not free text.
    expect(isNearDuplicate(
      { ...take, question_text: stem("How many slices are eaten?"), correct_answer: "5" },
      { ...take, question_text: stem("How many slices did you eat?"), correct_answer: "five slices eaten" },
    )).toBe(false);
    expect(isNearDuplicate(
      { ...take, question_text: stem("What fraction is eaten?"), correct_answer: "5/8" },
      { ...take, question_text: stem("What fraction was eaten?"), correct_answer: "the part eaten" },
    )).toBe(false);
    // Multiple choice: two options with a shared word are still two different answers.
    expect(isNearDuplicate(
      { question_text: stem("What does 5 represent in 5/8?"), question_type: "multiple_choice", options: ["A) the slices eaten", "B) the slices left"], correct_answer: "A) the slices eaten" },
      { question_text: stem("What does 5 represent in 5/8?"), question_type: "multiple_choice", options: ["A) the slices eaten", "B) the slices left"], correct_answer: "B) the slices left" },
    )).toBe(false);
    // A free-text key against a multiple-choice one.
    expect(isNearDuplicate(
      { ...take, question_text: stem("What does 5 represent in 5/8?"), correct_answer: "the slices eaten" },
      { question_text: stem("What does 5 represent in 5/8?"), question_type: "multiple_choice", options: ["A) the slices eaten", "B) the slices left"], correct_answer: "B) the slices left" },
    )).toBe(false);
  });

  it("local path: the live reworded repeat is dropped and the quiz is topped up", async () => {
    const fractions = { level: 1, title: "Fractions", subtopics: [{ id: "s1", title: "Parts of a fraction", key_concepts: ["numerator"] }] } as unknown as Syllabus;
    const others = [
      { question_text: "Name the part of a fraction above the line.", correct_answer: "the numerator" },
      { question_text: "Name the part of a fraction below the line.", correct_answer: "the denominator" },
    ];
    const script = [take, eat, ...others];
    scriptModel([(n) => ({
      ...fib({}), question_type: "short_answer", blank_position: "", ...script[n % script.length],
      explanation: `The top number counts the parts taken. Therefore the answer is ${script[n % script.length].correct_answer}`,
    })]);
    const qs = await generateQuizQuestions(fractions, 3, local);
    expect(qs.map((q) => q.question_text)).toEqual([take.question_text, ...others.map((o) => o.question_text)]);
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
