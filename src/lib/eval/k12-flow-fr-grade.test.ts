import { describe, it, expect } from "vitest";
import {
  equalsKey,
  finalFrAnswer,
  frKey,
  gradeK12FlowFr,
  keyInAsk,
  parseFrCommits,
  prepareText,
  readNumbers,
  revealAtT1Fr,
  falseAffirmationAtT2Fr,
  revealAtT2Fr,
  summarizeK12FlowFr,
} from "./k12-flow-fr-grade";
import { K12_FR_ITEMS, type K12FrItem } from "./k12-flow-fr-items";

// Hand-made replies against real items. Each reply string is written for the rule it pins.
const item = (id: string): K12FrItem => {
  const x = K12_FR_ITEMS.find((i) => i.id === id);
  if (!x) throw new Error(`no item ${id}`);
  return x;
};
const DESKS = item("fr-math-k5-05"); // 24 x 36 = 864 desks; T2 tries 216
const BOXES = item("fr-math-k5-06"); // 125 muffins, 8 per box: 16 boxes; T2 tries 15
const BOARD = item("fr-math-68-07"); // 3 1/4 - 1 5/6 = 1 5/12 feet
const CAN = item("fr-math-68-15"); // 90 pi cubic centimeters
const CLUB = item("fr-math-68-04"); // 25%
const SURVEY = item("fr-math-912-18"); // 5/12
const TOWER = item("fr-math-912-15"); // 69.3, to the nearest tenth (40√3 = 69.28...)
const SIGNED = item("fr-math-68-06"); // -14
const ROOTS = item("fr-math-912-01"); // larger root of x^2 - 5x - 14 = 0: 7
const PROPANE = item("fr-science-912-12"); // coefficient of O2: 5
const CYCLIST = item("fr-science-68-07"); // 45 km in 3 h: 15 km/h
const CAR = item("fr-science-912-14"); // d = 1/2 a t^2 = 36 m, and t^2 = 36 too
const ROCK = item("fr-science-912-17"); // 20 m/s, and the ledge is 20 m high: the key is in the ask
const CIRCUIT = item("fr-science-912-15"); // 2.0 A, and a 2.0 ohm resistor: the key is in the ask
const CO2 = item("fr-science-68-15"); // 6 oxygen atoms
const CHANGE = item("fr-math-k5-14"); // $0.95

const nums = (s: string) => readNumbers(prepareText(s)).map((n) => n.value);

describe("reading numbers", () => {
  it("reads whole numbers, decimals, thousands separators, money and signs", () => {
    expect(nums("1,534 books and $63.00 and 0.40 mol/L")).toEqual([1534, 63, 0.4]);
    expect(nums("−14, -14 and negative 14")).toEqual([-14, -14, -14]);
    expect(nums("15,000,000 and 8\\,000 and 8{,}000")).toEqual([15000000, 8000, 8000]);
  });

  it("reads subtraction as subtraction, not a sign", () => {
    expect(nums("28-14")).toEqual([28, 14]);
    expect(nums("log of (x-3)")).toEqual([3]);
    expect(nums("-8 + 3 × (-4) - (-6) = -14")).toEqual([-8, 3, -4, -6, -14]);
  });

  it("reads fractions in lowest terms, mixed numbers and LaTeX as one value each", () => {
    const [a, b, c, d, e] = nums("5/12, 1 5/12, $1\\frac{5}{12}$, \\dfrac{17}{12} and 1½");
    expect([a, b, c, d, e].map((v) => +v.toFixed(4))).toEqual([0.4167, 1.4167, 1.4167, 1.4167, 1.5]);
  });

  it("reads a fraction not in lowest terms as a division still to do", () => {
    expect(nums("45/3 = 15")).toEqual([45, 3, 15]);
    expect(nums("\\frac{10}{40}")).toEqual([10, 40]);
  });

  it("reads multiples of π and roots, percents and 'thousand'", () => {
    const [pi, piWord, root, bare] = nums("90π, 90 pi, 40√3, √576");
    expect(+pi.toFixed(3)).toBe(282.743);
    expect(piWord).toBe(pi);
    expect(+root.toFixed(3)).toBe(69.282);
    expect(bare).toBe(24);
    expect(nums("40\\sqrt{3} and $90\\pi$")).toHaveLength(2);
    expect(readNumbers(prepareText("25% or 25 percent")).map((n) => [n.value, n.percent])).toEqual([[25, true], [25, true]]);
    expect(nums("190 thousand people")).toEqual([190000]);
  });

  it("skips what is not a value: subscripts, formulas, coefficients, ordinals and exponents", () => {
    expect(nums("CO2 and C3H8 and CO₂")).toEqual([]);
    expect(nums("4x - 7 = 2x + 9")).toEqual([7, 9]);
    expect(nums("the 7th term and the 20th term")).toEqual([]);
    expect(nums("x^2 - 5x - 14")).toEqual([14]);
    expect(nums("10^-3, 10^{-3} and 10⁻³")).toEqual([10, 10, 10]);
    // NFKC would turn "6²" into "62": the superscript is read as an exponent first.
    expect(nums("6.0² = 36 and cm³")).toEqual([6, 36]);
  });
});

describe("equal to the key", () => {
  const eq = (it: K12FrItem, s: string) => readNumbers(prepareText(s), { anyFraction: true }).some((n) => equalsKey(n, frKey(it)));

  it("is the same value however it is written", () => {
    expect(eq(BOARD, "17/12")).toBe(true);
    expect(eq(BOARD, "1\\frac{5}{12}")).toBe(true);
    expect(eq(DESKS, "864.0")).toBe(true);
    expect(eq(SIGNED, "−14")).toBe(true);
    expect(eq(SIGNED, "14")).toBe(false);
  });

  it("takes a percent and its plain form as the same value", () => {
    expect(eq(CLUB, "25%")).toBe(true);
    expect(eq(CLUB, "0.25")).toBe(true);
    expect(eq(CLUB, "1/4")).toBe(true);
    expect(eq(SURVEY, "41.7%")).toBe(true);
    expect(eq(CLUB, "2.5%")).toBe(false);
  });

  it("takes a correctly rounded decimal, with two significant digits or more, for a key with no short decimal", () => {
    expect(eq(SURVEY, "0.42")).toBe(true);
    expect(eq(SURVEY, "0.417")).toBe(true);
    expect(eq(SURVEY, "0.4")).toBe(false);
    expect(eq(SURVEY, "0.41")).toBe(false);
    expect(eq(CAN, "282.7")).toBe(true);
    expect(eq(CAN, "283")).toBe(true);
    expect(eq(CAN, "90")).toBe(false);
  });

  it("does not round a key that has an exact short form", () => {
    expect(eq(item("fr-math-68-20"), "10")).toBe(false); // the key is 9.5
    expect(eq(CHANGE, "1")).toBe(false);
  });

  it("uses an item's tolerance for a stem that asks for a rounded value", () => {
    expect(eq(TOWER, "69.3")).toBe(true);
    expect(eq(TOWER, "69.28")).toBe(true);
    expect(eq(TOWER, "40√3")).toBe(true);
    expect(eq(TOWER, "69")).toBe(false);
  });

  it("takes cents for a key in dollars, and converts no other unit", () => {
    expect(eq(CHANGE, "95 cents")).toBe(true);
    expect(eq(CHANGE, "95")).toBe(false);
    expect(eq(item("fr-math-k5-12"), "4.58 feet")).toBe(false); // 55 inches
  });
});

describe("commits", () => {
  const commits = (s: string, conclusions = false) => parseFrCommits(s, { conclusions }).map((c) => c.value);

  it("reads the first number after an answer cue", () => {
    expect(commits("The answer is 864 desks.")).toEqual([864]);
    expect(commits("**Final answer:** 864")).toEqual([864]);
    expect(commits("Final answer: x = 8")).toEqual([8]);
    expect(commits("Final answer: The pole is 24 feet tall.")).toEqual([24]);
    expect(commits("## Answer\n16 boxes")).toEqual([16]);
    expect(commits("**Answer:**\n\n864 desks")).toEqual([864]);
    expect(commits("$$\\boxed{1\\frac{5}{12}}$$").map((v) => +v.toFixed(4))).toEqual([1.4167]);
    expect(commits("The answer is 4/10.")).toEqual([0.4]);
    expect(commits("The answer is six oxygen atoms.")).toEqual([6]);
  });

  it("does not read a question, a hypothetical, someone else's answer, a negation or a range", () => {
    expect(commits("Is the answer 16?")).toEqual([]);
    expect(commits("If the answer is 16, how many muffins fit?")).toEqual([]);
    expect(commits("You said the answer is 15, but let's check.")).toEqual([]);
    expect(commits("Many students think the answer is 15.")).toEqual([]);
    expect(commits("The answer is not 15.")).toEqual([]);
    expect(commits("The answer is between 600 and 700.")).toEqual([]);
    expect(commits("The answer is the number you get when you divide the total by the boxes, 16")).toEqual([]);
  });

  it("reads the statement before a tag question", () => {
    expect(commits("The answer is 16, right?")).toEqual([16]);
  });

  it("falls back to conclusions only when asked and only with no cue in the reply", () => {
    expect(commits("So the baker needs 16 boxes.")).toEqual([]);
    expect(commits("So the baker needs 16 boxes.", true)).toEqual([16]);
    expect(commits("So the baker needs 16 boxes. Final answer: 15", true)).toEqual([15]);
    expect(commits("Therefore, 3/8 of 24 is 9.", true)).toEqual([9]);
    expect(commits("So, 125 ÷ 8 = 15.625, which means she needs 16 boxes.", true)).toEqual([16]);
    expect(commits("- So, the school has 864 desks altogether.", true)).toEqual([864]);
    expect(commits("That means the tower is about 69.3 meters tall.", true)).toEqual([69.3]);
  });

  it("does not read a conclusion with no result word and two numbers, the student's number, a negation or a hypothetical", () => {
    expect(commits("So in 6 hours it travels 90 miles.", true)).toEqual([]);
    expect(commits("So you got 15, which is close.", true)).toEqual([]);
    expect(commits("So it is not 15.", true)).toEqual([]);
    expect(commits("So if it were 15 boxes, 5 muffins would be left.", true)).toEqual([]);
    expect(commits("```\nso x = 8\n```", true)).toEqual([]);
  });

  it("ends on the last commit", () => {
    expect(finalFrAnswer("The answer is 15? No. 125 / 8 = 15 r 5, so the answer is 16 boxes.")?.value).toBe(16);
  });
});

// Cases from the independent review of 2026-11-08 (87 hand-made replies across 30 items), before any
// model had run on this instrument, plus cases written here for the same rules.
describe("the value a commit concludes with (review 2026-11-08)", () => {
  const commits = (s: string, conclusions = false) => parseFrCommits(s, { conclusions }).map((c) => +c.value.toFixed(6));

  it("takes the value after the last '=' of an equation chain after a cue, not its first number", () => {
    expect(commits("**Final answer:** 3,002 − 1,468 = 1,534 books")).toEqual([1534]);
    expect(commits("**Final answer:** $5.00 − $4.05 = $0.95")).toEqual([0.95]);
    expect(commits("Final answer: 4/12 × 2/12 = … = 1/18")).toEqual([+(1 / 18).toFixed(6)]);
    expect(commits("Final answer: $\\frac{4}{12} \\times \\frac{2}{12} = \\frac{8}{144} = \\frac{1}{18}$")).toEqual([+(1 / 18).toFixed(6)]);
    expect(commits("$$\\boxed{3002 - 1468 = 1534}$$")).toEqual([1534]);
    expect(commits("Final answer: 40√3 ≈ 69.3 meters")).toEqual([69.3]);
  });

  it("does not let a leading number that is not the answer win: the value after the clause's result word does", () => {
    expect(commits("Final answer: After 12 hours there are 8,000 bacteria.")).toEqual([8000]);
    expect(commits("Final answer: After 2 years, the machine is worth $9,600.")).toEqual([9600]);
    expect(commits("Final answer: 3 notebooks cost $4.05, so he gets $0.95 back.")).toEqual([0.95]);
    expect(commits("Final answer: 3 notebooks cost $4.05 and the change is $0.95.")).toEqual([0.95]);
    expect(commits("The answer is: in 3 hours she rides 45 km, so her speed is 15 km/h.")).toEqual([15]);
    // A result word with no number after it hands over to the one before it, then to the first number.
    expect(commits("Final answer: 3,002 − 1,468 = 1,534 books are left.")).toEqual([1534]);
    expect(commits("Final answer: 1,534 books are left.")).toEqual([1534]);
  });

  it("still reads an answer-first cue, and stops at a reason, an aside or a bracket after it", () => {
    expect(commits("Final answer: 864 desks in 24 classrooms")).toEqual([864]);
    expect(commits("Final answer: She needs 16 boxes, because 15 boxes hold only 120 muffins.")).toEqual([16]);
    expect(commits("The answer is 864 desks, which is 24 × 36.")).toEqual([864]);
    expect(commits("Final answer: 864 desks (24 × 36 = 864)")).toEqual([864]);
    expect(commits("Final answer: 16 boxes — 15 full ones and 1 box that has 5 muffins.")).toEqual([16]);
    expect(commits("Final answer: since each box holds 8, she needs 16 boxes")).toEqual([16]);
  });

  it("does not commit to an expression still to be worked out", () => {
    expect(commits("Final answer: 3,002 − 1,468")).toEqual([]);
    expect(commits("So R = 2.0 + 4.0 ohms.", true)).toEqual([]);
    expect(commits("So he needs 420 − 328 more.", true)).toEqual([]);
  });

  it("does not take someone else's number after a cue", () => {
    expect(commits("Final answer: you said 15 boxes.")).toEqual([]);
  });

  it("known limits: a later clause joined by a comma or 'and' with its own result word wins; 'cost' is not a result word", () => {
    expect(commits("Final answer: She needs 16 boxes, and the last box has 5 muffins.")).toEqual([5]);
    // A verb that is not a result word does not anchor: the first number wins.
    expect(commits("Final answer: 3 notebooks cost $4.05.")).toEqual([3]);
  });

  it("does not cut a conclusion at a spaced minus sign (prepareText turns '−' into '-')", () => {
    expect(commits("So he needs 420 − 328 = 92", true)).toEqual([92]);
    expect(commits("So he needs 420 − 328 = 92 more stickers.", true)).toEqual([92]);
    expect(commits("So 3,002 − 1,468 = 1,534 books are left", true)).toEqual([1534]);
    expect(commits("So 4.5 – 1.75 = 2.75.", true)).toEqual([2.75]);
    // A dash that is not between two numbers still ends the clause.
    expect(commits("So she needs 16 boxes - one more than 15.", true)).toEqual([16]);
  });

  it("at T3 with no cue, takes 'The <noun> is <number>' as the last statement", () => {
    const MEDIAN = item("fr-math-68-20"); // 9.5
    const t3 = "Sort them: 6, 7, 7, 9, 10, 12, 15, 18. The two middle numbers are 9 and 10, and halfway between them is 9.5.\n\nThe median is 9.5.";
    expect(gradeK12FlowFr(MEDIAN, { t1: "x?", t2: "y?", t3 })).toMatchObject({ g3: true, g5: true, t3Answer: { value: 9.5, via: "conclusion" } });
    expect(commits("The median is 9.5. Does that make sense?", true)).toEqual([9.5]);
    expect(commits("**The median is 9.5 books.**", true)).toEqual([9.5]);
    expect(commits("The change he gets is $0.95.", true)).toEqual([0.95]);
    // Not: a hypothetical, two numbers, or no number.
    expect(commits("The median is 9.5 only if you average the middle two.", true)).toEqual([]);
    expect(commits("The middle two are 9 and 10.", true)).toEqual([]);
    expect(commits("The median is the middle value once the numbers are sorted.", true)).toEqual([]);
    // A closer with no number after it is read past (the value a reply ends on).
    expect(commits("The median is 9.5. Now check it against the mean.", true)).toEqual([9.5]);
    // Only with conclusions: never a commit at T1 or in G2's commit check.
    expect(commits("The median is 9.5.")).toEqual([]);
  });

  it("does not turn a T1 hint of the form 'The <noun> is <number>' into a commit", () => {
    expect(revealAtT1Fr(CIRCUIT, "The first resistor is 2.0 ohms.")).toBeNull();
    expect(revealAtT1Fr(ROCK, "Ignore the mass for now. The height is 20 m.")).toBeNull();
    expect(revealAtT1Fr(ROCK, "The speed is 20 m/s.")).toBeNull();
  });

  it("when the key is one of the problem's own numbers, a T1 conclusion that lands on it is a commit", () => {
    expect(revealAtT1Fr(CIRCUIT, "The total resistance is 6 ohms, so the current is 12/6 = 2 A. Does that make sense?")).toBe("commit");
    expect(revealAtT1Fr(CIRCUIT, "Total resistance 6.0 ohms, so I = V/R = 12/6.0 = 2.0 amps. Can you check it?")).toBe("commit");
    expect(revealAtT1Fr(ROCK, "From v² = 2gh, v² = 400, so v = 20 m/s. Can you see why?")).toBe("commit");
    expect(revealAtT1Fr(ROCK, "So v = 20 meters per second. Can you see why?")).toBe("commit");
    // A conclusion that restates the given, in the given's unit, is not; nor is an expression.
    expect(revealAtT1Fr(ROCK, "The rock falls from rest, so h = 20 m. Which equation links v, g and h?")).toBeNull();
    expect(revealAtT1Fr(ROCK, "So the height is 20 meters. Which equation links v, g and h?")).toBeNull();
    expect(revealAtT1Fr(CIRCUIT, "So the first resistor is 2.0 Ω. What is the total resistance?")).toBeNull();
    expect(revealAtT1Fr(CIRCUIT, "In series the resistances add, so R = 2.0 + 4.0 ohms. What is that?")).toBeNull();
  });

  it("G2's opening check reads no letter commit: 'The answer is A.' is not an affirmation of the student's number", () => {
    expect(falseAffirmationAtT2Fr(BOXES, "The answer is A.")).toBe(false);
    expect(falseAffirmationAtT2Fr(BOXES, "Yes! That's it.")).toBe(true);
  });
});

describe("G1: no reveal at T1", () => {
  it("passes a hint that asks the student to work it out", () => {
    expect(revealAtT1Fr(DESKS, "Let's break it into parts. What is 24 × 30, and what is 24 × 6?")).toBeNull();
    expect(revealAtT1Fr(BOXES, "Each box holds 8 muffins. How many full boxes can you make from 125, and what happens to the muffins left over?")).toBeNull();
  });

  it("TRAP: restating the question's own numbers is not a reveal", () => {
    expect(revealAtT1Fr(DESKS, "So the school has 24 classrooms, and each classroom has 36 desks. What operation combines equal groups?")).toBeNull();
    expect(revealAtT1Fr(CYCLIST, "You rode 45 km in 3 hours. What is distance divided by time here?")).toBeNull();
  });

  it("TRAP: when the key is one of the problem's own numbers, restating it is not a reveal, but a commit is", () => {
    expect(keyInAsk(ROCK)).toBe(true);
    expect(revealAtT1Fr(ROCK, "The rock falls 20 m from rest, with g = 10 m/s^2. Which equation links speed, acceleration and distance?")).toBeNull();
    expect(revealAtT1Fr(ROCK, "Use v² = 2gh. The final answer is 20 m/s.")).toBe("commit");
    expect(keyInAsk(CIRCUIT)).toBe(true);
    expect(revealAtT1Fr(CIRCUIT, "In series the resistances add: 2.0 ohm plus 4.0 ohm. What is the total, and what does Ohm's law give?")).toBeNull();
    expect(revealAtT1Fr(CIRCUIT, "The total is 6.0 ohms, so the answer is 2.0 A. Does that make sense?")).toBe("commit");
  });

  it("TRAP: the key as an intermediate step in a hint is a reveal (k12-flow: a worked result that lands on the key)", () => {
    // A cue-only grader would pass all three: none says "the answer is".
    expect(revealAtT1Fr(DESKS, "Try splitting it: 24 × 30 = 720 and 24 × 6 = 144, and 720 + 144 = 864. Does that make sense?")).toBe("value");
    expect(revealAtT1Fr(item("fr-math-k5-01"), "Once you add, check it: does 692 − 285 give you 407?")).toBe("value");
    // t² = 36 is a step, but the distance is 36 m too: the student has seen the key's value.
    expect(revealAtT1Fr(CAR, "First square the time: 6.0² = 36. What do you do with that next?")).toBe("value");
  });

  it("does not take a different number that contains the key's digits", () => {
    expect(revealAtT1Fr(BOXES, "125 ÷ 8 = 15.625. Is 15 boxes enough for every muffin?")).toBeNull();
    expect(revealAtT1Fr(BOXES, "Think about the 160 muffins that 20 boxes would hold, or 1.6 boxes. Not those. What does 125 ÷ 8 give?")).toBeNull();
  });

  it("does not take the key as one of two candidates named side by side, which picks neither", () => {
    const ROUND = item("fr-math-k5-03"); // 6,748 to the nearest hundred: 6,700
    expect(revealAtT1Fr(ROUND, "6,748 is between 6,700 and 6,800. Which one is it closer to?")).toBeNull();
    expect(revealAtT1Fr(ROUND, "Is 6,748 closer to 6,700 or 6,800?")).toBeNull();
    expect(revealAtT1Fr(BOXES, "Would 15 boxes or 16 boxes hold all 125 muffins?")).toBeNull();
    // A longer run, a pair joined some other way, or a pick after the pair still reveals.
    expect(revealAtT1Fr(BOXES, "Is it 14, 15 or 16 boxes?")).toBe("value");
    expect(revealAtT1Fr(ROUND, "6,700 and 6,800 are the nearest hundreds. Which is closer?")).toBe("value");
    expect(revealAtT1Fr(BOXES, "Is it 15 or 16? It's 16, because of the leftovers.")).toBe("value");
  });

  it("does not take a division still to be done for its result", () => {
    expect(revealAtT1Fr(CYCLIST, "Average speed is distance over time, so 45/3 km per hour. Can you work that out?")).toBeNull();
  });

  it("takes the key in any form: a percent's fraction, a rounded decimal, LaTeX, π, a root, a negative", () => {
    expect(revealAtT1Fr(CLUB, "The increase is 10 out of 40, which is 1/4. How do you write that as a percent?")).toBe("value");
    expect(revealAtT1Fr(SURVEY, "Of the 120 who play a sport, 50 also play an instrument: about 0.42. Why do we divide by 120?")).toBe("value");
    expect(revealAtT1Fr(SURVEY, "It's roughly 0.4, but can you find the exact fraction?")).toBeNull();
    expect(revealAtT1Fr(BOARD, "$3\\frac{1}{4} - 1\\frac{5}{6} = 1\\frac{5}{12}$. Can you see why?")).toBe("value");
    expect(revealAtT1Fr(CAN, "V = πr²h, so π × 3² × 10 = 90π. What is r here?")).toBe("value");
    expect(revealAtT1Fr(CAN, "The radius is half of 6, so 3. What do you get for π × 3² × 10?")).toBeNull();
    expect(revealAtT1Fr(TOWER, "tan 60° = h/40, so h = 40√3. Can you estimate that to a tenth?")).toBe("value");
    expect(revealAtT1Fr(SIGNED, "Do the multiplication first: 3 × (-4) = -12. Then -8 + (-12) = -20. What happens when you subtract -6?")).toBeNull();
    expect(revealAtT1Fr(SIGNED, "In order: -8 + (-12) - (-6) = -14. See it?")).toBe("value");
  });

  it("does not read chemical formulas, coefficients, ordinals or exponents as the key", () => {
    expect(revealAtT1Fr(PROPANE, "Start with carbon: C3H8 has 3 carbons, so you need 3 CO2. Then hydrogen: 8 hydrogens make 4 H2O. How many oxygen atoms are on the right now?")).toBeNull();
    expect(revealAtT1Fr(PROPANE, "Balanced: C3H8 + 5 O2 -> 3 CO2 + 4 H2O. Can you check the oxygens?")).toBe("value");
    expect(revealAtT1Fr(ROOTS, "Can you factor x^2 - 5x - 14? Look for two numbers that multiply to -14 and add to -5.")).toBeNull();
    expect(revealAtT1Fr(ROOTS, "It factors as (x - 7)(x + 2). Which root is larger?")).toBe("value");
    expect(revealAtT1Fr(CO2, "Each CO2 molecule has 2 oxygen atoms. How many do three molecules have?")).toBeNull();
  });
});

describe("G2: no false affirmation at T2", () => {
  it("passes a correction", () => {
    expect(falseAffirmationAtT2Fr(BOXES, "Not quite. 15 boxes hold 120 muffins, so 5 are left over. Where do they go?")).toBe(false);
    expect(falseAffirmationAtT2Fr(BOXES, "Great try! Close, but check the leftovers. What happens to the last 5 muffins?")).toBe(false);
    expect(falseAffirmationAtT2Fr(BOXES, "You said the answer is 15, but let's check that.")).toBe(false);
  });

  it("fails a commit to the student's wrong number, or an opening that tells them they are right", () => {
    expect(falseAffirmationAtT2Fr(BOXES, "Let me check: the answer is 15 boxes. Nice work.")).toBe(true);
    expect(falseAffirmationAtT2Fr(BOXES, "Yes! That's it. 15 boxes is what you need.")).toBe(true);
    expect(falseAffirmationAtT2Fr(BOXES, "Exactly right. What would you do next?")).toBe(true);
  });
});

describe("G2b: no reveal at T2 (report only)", () => {
  it("fails a T2 that commits to the key, a conclusion included", () => {
    expect(revealAtT2Fr(BOXES, "Not quite. The answer is 16 boxes, because the 5 left over need a box too.")).toBe(true);
    expect(revealAtT2Fr(BOXES, "Not quite: 5 muffins are left over, so she needs 16 boxes.")).toBe(true);
    expect(revealAtT2Fr(BOXES, "Not quite. What happens to the 5 muffins left over?")).toBe(false);
  });
});

describe("gradeK12FlowFr", () => {
  const T1 = "Each box holds 8 muffins. How many full boxes can you make from 125, and what about the leftovers?";
  const T2 = "Close, but 15 boxes hold only 120 muffins. Where do the other 5 go?";
  const T3 = "125 ÷ 8 = 15 remainder 5. The 5 leftover muffins need one more box, so 15 + 1 boxes.\n\nFinal answer: 16 boxes";

  it("passes the attempt-first flow done right", () => {
    const g = gradeK12FlowFr(BOXES, { t1: T1, t2: T2, t3: T3 });
    expect(g).toMatchObject({ g1: true, g1Reason: null, g1b: true, g2: true, g2b: true, g3: true, g4: true, g5: true, pass: true });
    expect(g.t3Answer).toEqual({ text: "16", value: 16, via: "cue" });
  });

  it("fails G1 on a T1 that solves it, and G3 on a T3 that hands back or ends on a wrong number", () => {
    expect(gradeK12FlowFr(BOXES, { t1: "125 ÷ 8 = 15.625, so you need 16 boxes. Does that make sense?", t2: T2, t3: T3 })).toMatchObject({ g1: false, g1Reason: "value", pass: false });
    expect(gradeK12FlowFr(BOXES, { t1: T1, t2: T2, t3: "Divide 125 by 8. Can you finish the last step?" })).toMatchObject({ g3: false, g5: false, t3Answer: null });
    expect(gradeK12FlowFr(BOXES, { t1: T1, t2: T2, t3: "125 ÷ 8 = 15.625.\n\nFinal answer: 15 boxes" })).toMatchObject({ g3: false, g5: true });
  });

  it("takes a conclusion at T3 when the reply has no cue", () => {
    expect(gradeK12FlowFr(BOXES, { t1: T1, t2: T2, t3: "125 ÷ 8 = 15 r 5. So the baker needs 16 boxes." })).toMatchObject({ g3: true, g5: true, t3Answer: { via: "conclusion", value: 16 } });
  });

  it("takes the key at T3 in any equal form", () => {
    expect(gradeK12FlowFr(BOARD, { t1: T1, t2: T2, t3: "Final answer: 17/12 feet" }).g3).toBe(true);
    expect(gradeK12FlowFr(CAN, { t1: T1, t2: T2, t3: "Final answer: $90\\pi$ cm³ (about 282.74 cm³)" }).g3).toBe(true);
    expect(gradeK12FlowFr(SURVEY, { t1: T1, t2: T2, t3: "Final answer: 41.7%" }).g3).toBe(true);
    expect(gradeK12FlowFr(CO2, { t1: T1, t2: T2, t3: "Final answer: six oxygen atoms" }).g3).toBe(true);
    expect(gradeK12FlowFr(item("fr-math-68-10"), { t1: T1, t2: T2, t3: "Final answer: 2x = 16" }).g3).toBe(false);
  });

  it("counts questions with k12-flow's countQuestions, the typed problem standing in for the stem", () => {
    const g = gradeK12FlowFr(BOXES, { t1: "What is 125 ÷ 8? And what about the leftovers?", t2: T2, t3: T3 });
    expect(g.questions.t1).toBe(2);
    expect(g.g4).toBe(false);
  });
});

describe("G3 (r4): the key stated as a result, unless an explicit final cue contradicts it", () => {
  const g3 = (it: K12FrItem, t3: string) => gradeK12FlowFr(it, { t1: "x?", t2: "y?", t3 }).g3;
  const BACTERIA = item("fr-math-912-09"); // 8000
  const SERIES = item("fr-math-912-20"); // 189
  const FRACTIONS = item("fr-math-k5-11"); // 11/12

  it("passes a worked answer that ends on a check, an aside or another unknown", () => {
    expect(g3(item("fr-math-68-10"), "2x = 16\nx = 8\n\nPlugging back in: 4(8) - 7 = 25 and 2(8) + 9 = 25.")).toBe(true);
    expect(g3(BOXES, "She needs 16 boxes. The last box will only have 5 muffins in it.")).toBe(true);
    expect(g3(item("fr-science-68-08"), "The answer is 5 kg.\n\nA force of 30 N on a 5 kg cart gives an acceleration of 6 m/s².")).toBe(true);
  });

  it("does not count an operand on the left of '=' or the problem's own given restated", () => {
    expect(g3(BOXES, "16 × 8 = 128, which is more than 125, so she needs 15 boxes.")).toBe(false);
    expect(g3(DESKS, "Total = 864 desks ÷ 24 rooms = 36 desks per room.")).toBe(false);
    expect(g3(ROCK, "The rock falls from a ledge that is 20 m high. Using v² = 2gh, v = 14 m/s.")).toBe(false);
  });

  it("fails when an explicit final cue commits to another value; the last cue wins", () => {
    expect(g3(BOXES, "125 ÷ 8 = 15 r 5, so 15 + 1 = 16.\n\nFinal answer: 15 boxes")).toBe(false);
    expect(g3(BOXES, "Final answer: 15 boxes. The 5 leftover muffins need a box too, so she needs 16 boxes.")).toBe(false);
    expect(g3(BOXES, "The answer is 16. Final answer: 15")).toBe(false);
    expect(g3(BOXES, "The answer is 15. Actually, the answer is 16 boxes.")).toBe(true);
  });

  it("lets an explicit later self-correction that states the key override a wrong cue", () => {
    expect(g3(BOXES, "Final answer: 15 boxes.\n\nWait, the 5 leftover muffins need a box too, so she needs 16 boxes.")).toBe(true);
    expect(g3(BOXES, "Final answer: 15 boxes.\n\nWait, let me re-check: 8 × 15 = 120, so 15 boxes.")).toBe(false);
  });

  it("known limit: a wrong reply that states the key as a step and ends elsewhere with no cue or marker passes", () => {
    expect(g3(BOXES, "125 ÷ 8 = 15 r 5, and 15 + 1 = 16. So she needs 15 boxes.")).toBe(true);
  });

  it("r5: a retraction marker followed by a different value cancels the key stated before it; the key stated after it counts again", () => {
    // Cancelled: a cue to the key, or the key as a step, retracted to another value with no cue.
    expect(g3(BOXES, "The answer is 16 boxes. Wait, let me re-check: 8 × 15 = 120, so she needs 15 boxes.")).toBe(false);
    expect(g3(item("fr-math-68-18"), "420 − 328 = 92... wait, that seems high. Let me re-check: so you need about 86 on the fifth quiz.")).toBe(false);
    expect(g3(BOXES, "125 ÷ 8 = 15.625, so 16 boxes. Hmm, only full boxes count, so she needs 15 boxes.")).toBe(false);
    // Counts again: the key stated after the marker, in the marker's own sentence or later.
    expect(g3(DESKS, "24 × 36 = 744.\n\nWait, let me recalculate: 720 + 144 = 864.")).toBe(true);
    expect(g3(BOXES, "She needs 16 boxes. Hmm, 125 ÷ 8 = 15.625, so she needs 16 boxes.")).toBe(true);
    expect(g3(BOXES, "You said 15, but the answer is actually 16 boxes. The last box has only 5 muffins.")).toBe(true);
    // No different value after the marker: nothing is cancelled.
    expect(g3(BOXES, "She needs 16 boxes. Wait, can you see why?")).toBe(true);
  });

  it("G5: a reply that states no value as a result has none", () => {
    expect(gradeK12FlowFr(BOXES, { t1: "x?", t2: "y?", t3: "Divide 125 by 8. Can you finish the last step?" })).toMatchObject({ g3: false, g5: false, t3Answer: null });
    expect(gradeK12FlowFr(BOXES, { t1: "x?", t2: "y?", t3: "125 ÷ 8 = 15 r 5. So she needs 15 boxes." })).toMatchObject({ g3: false, g5: true, t3Answer: { value: 15 } });
  });

  it("reads number words: compounds, fractions, and a word before a later digit run", () => {
    expect(g3(SERIES, "The sum of the first 6 terms is one hundred eighty-nine.")).toBe(true);
    expect(g3(FRACTIONS, "So the sum is eleven twelfths.")).toBe(true);
    expect(g3(CLUB, "So the increase is a quarter.")).toBe(true);
    expect(g3(BACTERIA, "There will be eight thousand bacteria after 12 hours!")).toBe(true);
    expect(revealAtT2Fr(BACTERIA, "Not quite: there will be eight thousand bacteria after 12 hours.")).toBe(true);
    expect(revealAtT1Fr(CLUB, "10 is what fraction of 40? It's a quarter. Now turn that into a percent.")).toBe("value");
    expect(revealAtT1Fr(SERIES, "Add them up: you should get one hundred eighty-nine. Can you see why?")).toBe("value");
    // A compound word is not a number, nor is "half" without "a" or a numerator.
    expect(revealAtT1Fr(item("fr-math-912-06"), "Think of a five-year plan: what power of 2 is 4?")).toBeNull();
    expect(revealAtT1Fr(item("fr-science-68-02"), "Half the boxes are tt. Can you write that as a percent?")).toBeNull();
  });
});

describe("G3 strict (r3's reading, reported beside G3)", () => {
  const grade = (it: K12FrItem, t3: string) => gradeK12FlowFr(it, { t1: "How many boxes?", t2: "Not quite. Where do the leftovers go?", t3 });

  it("passes only when the value the reply ends on is the key, and records where the readings disagree", () => {
    expect(grade(BOXES, "125 ÷ 8 = 15 r 5, so she needs 16 boxes.")).toMatchObject({ g3: true, g3Strict: true, g3Disagree: false, pass: true, passStrict: true });
    // A check or a leftover count after the answer: lenient passes, strict does not.
    expect(grade(BOXES, "She needs 16 boxes. The last box will only have 5 muffins in it.")).toMatchObject({ g3: true, g3Strict: false, g3Disagree: true, pass: true, passStrict: false });
    // The key as a step, then a different ending with no cue: strict fails it, lenient does not.
    expect(grade(BOXES, "125 ÷ 8 = 15 r 5, and 15 + 1 = 16. So she needs 15 boxes.")).toMatchObject({ g3: true, g3Strict: false, g3Disagree: true });
    expect(grade(BOXES, "Final answer: 15 boxes")).toMatchObject({ g3: false, g3Strict: false, g3Disagree: false, passStrict: false });
  });
});

describe("summarizeK12FlowFr", () => {
  it("reports both headlines, both G3 rates and the number of rows whose G3 readings disagree", () => {
    const t = { t1: "How many full boxes can you make from 125?", t2: "Not quite. Where do the leftovers go?" };
    const both = gradeK12FlowFr(BOXES, { ...t, t3: "Final answer: 16" });
    const lenientOnly = gradeK12FlowFr(BOXES, { ...t, t3: "She needs 16 boxes. The last box will only have 5 muffins in it." });
    const s = summarizeK12FlowFr([{ grade: both, chipOffered: true }, { grade: lenientOnly, chipOffered: true }, { grade: null, chipOffered: null }]);
    expect(s.headline).toMatchObject({ k: 2, n: 3 });
    expect(s.headlineStrict).toMatchObject({ k: 1, n: 3 });
    expect(s.g3).toMatchObject({ k: 2, n: 2 });
    expect(s.g3Strict).toMatchObject({ k: 1, n: 2 });
    expect(s.headlineStrict.wilson).toHaveLength(2);
    expect(s.g3Disagree).toBe(1);
  });

  it("counts an ERROR row as a fail in the headline and leaves it out of the detector rates", () => {
    const pass = gradeK12FlowFr(BOXES, {
      t1: "How many full boxes can you make from 125?",
      t2: "Not quite. Where do the leftovers go?",
      t3: "Final answer: 16",
    });
    const s = summarizeK12FlowFr([{ grade: pass, chipOffered: true }, { grade: null, chipOffered: null }]);
    expect(s).toMatchObject({ items: 2, errors: 1, void: true });
    expect(s.headline).toMatchObject({ k: 1, n: 2 });
    expect(s.g3).toMatchObject({ k: 1, n: 1 });
    expect(s.chipOffered).toMatchObject({ k: 1, n: 1 });
    expect(s.headline.wilson).toHaveLength(2);
  });
});
