import { describe, it, expect } from "vitest";
import { arithmeticFactNote, arithmeticFactTurn, askedArithmetic, TUTOR_LOOKBACK, withArithmeticFactNote } from "./arithmeticFact";
import { ASSESS_MESSAGE, QUIZ_MESSAGE } from "./suggestions";
import { inMasteryCheck } from "./answerCheck";
import { K12_FR_ITEMS } from "../eval/k12-flow-fr-items";
import { K12_ITEMS, K12_PILOT } from "../eval/k12-items";
import { formatK12FlowFrT1, formatK12FlowFrT2 } from "../eval/k12-flow-fr";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "../eval/k12-flow";

// The detector reads only the student's message; the turn gate adds the conversation (mastery check, the
// tutor's own question). Both run in TutorEngine.run (arithmeticFactTurn.test.ts pins the request).

const fact = (m: string) => {
  const f = askedArithmetic(m);
  return f && `${f.expression} = ${f.answer}`;
};

describe("askedArithmetic: what fires", () => {
  it.each([
    ["what is 7 times 8 in the times tables?", "7 × 8 = 56"],
    ["What is 7 times 8?", "7 × 8 = 56"],
    ["whats 7x8", "7 × 8 = 56"],
    ["what's 7 x 8?", "7 × 8 = 56"],
    ["What’s 6*7?", "6 × 7 = 42"],
    ["what is 9 × 6", "9 × 6 = 54"],
    ["what's 12 divided by 3", "12 ÷ 3 = 4"],
    ["what is 12 ÷ 4?", "12 ÷ 4 = 3"],
    ["what is 20 / 5?", "20 ÷ 5 = 4"],
    ["what is 15 + 27", "15 + 27 = 42"],
    ["what is 15+27?", "15 + 27 = 42"],
    ["what is 15 plus 27?", "15 + 27 = 42"],
    ["what is 50 - 18?", "50 − 18 = 32"],
    ["what is 50 minus 18?", "50 − 18 = 32"],
    ["what's 10 take away 4", "10 − 4 = 6"],
    ["what is 100 + 100?", "100 + 100 = 200"],
    ["what is 12 x 12", "12 × 12 = 144"],
    ["what is 144 divided by 12?", "144 ÷ 12 = 12"],
    ["what is 0 times 9?", "0 × 9 = 0"],
    ["what is double 8?", "double 8 = 16"],
    ["what is double twenty?", "double 20 = 40"],
    ["what is seven times eight?", "7 × 8 = 56"],
    ["how much is 4 times 5?", "4 × 5 = 20"],
    ["what does 6 times 7 equal?", "6 × 7 = 42"],
    ["wait... ok what does 3 plus 4 make?", "3 + 4 = 7"],
    ["can you tell me what 8 times 9 is?", "8 × 9 = 72"],
    ["I forgot what 7 times 8 is", "7 × 8 = 56"],
    ["i don't know what 6 x 8 is", "6 × 8 = 48"],
    ["7 x 8 = ?", "7 × 8 = 56"],
    ["7 times 8 equals what?", "7 × 8 = 56"],
    ["um, what is 7 times 8 again?", "7 × 8 = 56"],
    ["ok quick question: what is 11 times 11", "11 × 11 = 121"],
    ["what is the answer to 9 times 9?", "9 × 9 = 81"],
    ["What is 7 times 8 please?", "7 × 8 = 56"],
    ["I was doing my worksheet. What is 7 times 8?", "7 × 8 = 56"],
    ["Sorry I'm tired.\nwhat's 6 x 9", "6 × 9 = 54"],
  ])("%s", (message, expected) => {
    expect(fact(message)).toBe(expected);
  });

  it("keeps each operand's digits for the echo check", () => {
    expect(askedArithmetic("what is seven times 8?")?.operands).toEqual(["7", "8"]);
    expect(askedArithmetic("what is double twenty?")?.operands).toEqual(["20"]);
  });
});

describe("askedArithmetic: what does not fire", () => {
  it.each([
    // word problems and things after the operation
    "what is 7 times 8 apples?",
    "Sam has 7 bags with 8 apples in each. How many apples does he have?",
    "what is 3 apples plus 4 apples",
    "what is 7 times 8 if you add 2?",
    "what is 1 + 1 in binary?",
    "what is 7 times 8 in base 2",
    // more than one operation
    "what is 3 times 4 times 5?",
    "what is 5 + 3 and then double it?",
    "what is 7 times 8 and 7 times 9?",
    "what is 2 + 3 + 4",
    // times in other senses
    "how many times do I multiply?",
    "what is 3 times a day?",
    "what times are the classes?",
    "what time is it",
    "what is ten times bigger than 5?",
    // dates, ranges, events, clock times, lone numbers
    "what is 12/25?",
    "what's 9/11",
    "what is 9-11",
    "what is 11/19/2026",
    "what is 3:30 + 15?",
    "what is 3/4",
    "what is 56",
    "what is 1,000 + 5",
    // algebra
    "what is 2x + 3?",
    "what is x times 8?",
    "what is 2 x 3x",
    "what is 7 x?",
    // mixed numbers and too-big numbers are out of scope
    "what is 1 1/2 + 1/4?",
    "what is 12345 + 1",
    // a try, a check, a quiz request, working it out
    "is 7 x 8 56?",
    "7 times 8 is 56?",
    "I think 7 times 8 is 54",
    "what is 7 times 8? I think it's 54",
    "my answer is 56. what is 7 times 8?",
    "quiz me on 7 times 8",
    "can you quiz me: what is 7 x 8?",
    "test me. what is 7 times 8?",
    "ask me what 7 times 8 is",
    "give me a problem like what is 7 times 8",
    "Don't tell me the answer, what is 7 x 8?",
    "what is 7 times 8? just give me a hint",
    "let me try. what is 7 times 8?",
    "I want to figure it out myself. What is 7 x 8?",
    "I got 54. what is 7 times 8?",
    // asks about something else
    "what is the 7 times table?",
    "what is multiplication?",
    "why is 7 times 8 56?",
    "how do you work out 7 times 8?",
    "what does 7 times 8 mean?",
    "what is 7 to the power of 2?",
    "what is 10% of 50?",
    "what is the square root of 49?",
    // past fact size (Fable 2026-11-19: facts, not exercises)
    "what's 407 + 285?",
    "what is 101 + 1",
    "what is 13 times 4?",
    "what is 4 times 25?",
    "what is 7 divided by 2?",
    "what is 156 divided by 12",
    "what is 26 / 2",
    "what is 5 divided by 0?",
    "what is 3 - 5?",
    "what is half of 7?",
    "what is a third of 10",
    "what is double 101",
    "what is 007 times 8",
    // a fraction of a set is a Fractions course's own exercise, as a fraction sum is
    "what is half of 10",
    "what's a third of 12?",
    "what is a quarter of 20?",
    "what is one half of 8?",
    // fractions and decimals are exercises
    "what is 1/2 + 1/4?",
    "what is 3/4 + 1/6?",
    "what is 2/3 times 3/4",
    "what is half of 1/2?",
    "what is 0.5 + 0.25?",
    "what is 1.5 times 4?",
    "What is 4.5 - 1.75?",
    "what is 1/0 + 1",
    // the question is not the last sentence
    "what is 7 times 8? can we do fractions now",
    // a problem, a list or a try typed before the question (B4 G1: a typed problem is held, not answered)
    "A baker has 7 trays with 8 buns on each. How many buns? what is 7 times 8?",
    "Sam has 5 apples and gets 3 more. What is 5 + 3?",
    "My homework says: Lily had 12 stickers and gave 4 away. What is 12 - 4?",
    "There are 6 rows of 9 chairs.\nwhat's 6 x 9",
    "what is 7 times 8\nwhat is 9 times 6",
    "Tom has seven bags. Each bag has eight marbles. What is 7 times 8?",
    "A box holds a dozen eggs. What is 12 divided by 3?",
    "is it 56? what is 7 times 8",
    "",
  ])("%s", (message) => {
    expect(askedArithmetic(message)).toBeNull();
  });

  // B4 G1 ("no reveal at T1") on the k12-flow benchmarks: a problem the student types is held, not
  // answered. No message either flow sends fires, so the lever cannot move them (fr-math-k5-01, "what's
  // 407 + 285?", fired before the fact-size limits).
  it("fires on no message the k12-flow or k12-flow-fr benchmarks send", () => {
    const sent = [
      ...K12_FR_ITEMS.flatMap((item) => [formatK12FlowFrT1(item), formatK12FlowFrT2(item)]),
      ...[...K12_ITEMS, ...K12_PILOT].flatMap((item) => [formatK12FlowT1(item), formatK12FlowT2(item)]),
      K12_FLOW_T3,
    ];
    expect(sent.length).toBeGreaterThan(600);
    expect(sent.filter((m) => askedArithmetic(m))).toEqual([]);
    expect(K12_FR_ITEMS.map((i) => i.ask).filter((m) => askedArithmetic(m))).toEqual([]);
  });
});

describe("arithmeticFactTurn: the conversation", () => {
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string) => ({ role: "assistant", content });

  it("fires on a plain question, first turn or mid-chat", () => {
    expect(arithmeticFactTurn([u("what is 7 times 8 in the times tables?")])?.answer).toBe("56");
    expect(arithmeticFactTurn([u("let's do fractions"), a("Sure! What is 1/4 + 1/4?"), u("wait what's 7 times 8")])?.answer).toBe("56");
  });

  it("never in a mastery check: assess mode, or a request for one among the student's last messages", () => {
    expect(arithmeticFactTurn([u("what is 7 times 8?")], "assess")).toBeNull();
    expect(arithmeticFactTurn([u(ASSESS_MESSAGE), a("Here is your question: what is 1/2 of 6?"), u("what is 6 times 9?")])).toBeNull();
    expect(arithmeticFactTurn([u("quiz me on times tables"), a("Okay! What is 9 times 6?"), u("what's 9 times 6?")])).toBeNull();
    expect(arithmeticFactTurn([u("Quiz me on this."), a("What is 3 x 4?"), u("what is 2 times 2")])).toBeNull();
  });

  it("not when one of the tutor's last messages holds every operand: it may have asked that very sum", () => {
    expect(arithmeticFactTurn([u("hi"), a("Let's practise. What is 7 × 8?"), u("what is 7 times 8?")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("A baker has seven trays with eight buns on each. How many buns?"), u("what's 7 times 8")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("Try this: 15 + 27 = ?"), u("what is 15 + 27")])).toBeNull();
    // one operand only is not the tutor's question
    expect(arithmeticFactTurn([u("hi"), a("We have 8 slices of pizza."), u("what is 7 times 8?")])?.answer).toBe("56");
    // 18 is not 8, 0.75 is not 7 (only a whole number not run into another counts)
    expect(arithmeticFactTurn([u("hi"), a("There are 18 and 0.75 here."), u("what is 7 times 8?")])?.answer).toBe("56");
    // a plural number word counts
    expect(arithmeticFactTurn([u("hi"), a("What do eight sevens make?"), u("what is 7 times 8?")])).toBeNull();
  });

  it("not when the tutor asked it before a hint, in practice or past the check's window", () => {
    const practice = [u("hi"), a("What is 7 × 8?"), u("idk"), a("What is 7 × 4? Then double it."), u("what is 7 times 8?")];
    expect(arithmeticFactTurn(practice)).toBeNull();
    const answered = [1, 2, 3, 4].flatMap((n) => [a(`Question ${n}: what is ${n} + 1?`), u(String(n + 1))]);
    const quiz = [u(QUIZ_MESSAGE), ...answered,
      a("Question 5: There are 7 boxes. Each has 8 pens. How many pens?"), u("hmm"),
      a("Think about multiplying the boxes by the pens in each."), u("what is 7 times 8")];
    expect(inMasteryCheck(quiz)).toBe(false); // the quiz request is past the window: only the echo check holds
    expect(arithmeticFactTurn(quiz)).toBeNull();
    // the tutor's question is TUTOR_LOOKBACK messages back at most
    const older = [u("hi"), a("What is 7 × 8?"), ...Array.from({ length: TUTOR_LOOKBACK }, () => [u("ok"), a("Let's look at fractions.")]).flat(), u("what is 7 times 8?")];
    expect(arithmeticFactTurn(older)?.answer).toBe("56");
  });

  it("not when the tutor's message holds the answer and an operand: the inverse question", () => {
    expect(arithmeticFactTurn([u("hi"), a("What is 54 ÷ 6?"), u("what's 6 times 9?")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("What is 42 - 15?"), u("what is 15 + 27?")])).toBeNull();
  });

  it("counts the words that stand for a number: half, twice, double, third, triple, quarter, dozen", () => {
    expect(arithmeticFactTurn([u("hi"), a("What is half of 16?"), u("what is 16 / 2")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("What is a dozen times 3?"), u("what is 12 times 3")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("What is twice 9?"), u("what is 9 times 2")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("What is a third of 12?"), u("what is 12 / 3")])).toBeNull();
    expect(arithmeticFactTurn([u("hi"), a("How many quarters make 2 dollars?"), u("what is 2 times 4")])).toBeNull();
    // "halfway" is not "half"
    expect(arithmeticFactTurn([u("hi"), a("We are halfway through 16 pages."), u("what is 16 / 2")])?.answer).toBe("8");
  });

  it("not on the student's own word problem a message or a few back: it is their exercise (B4 G1)", () => {
    const reply = a("Good one! What operation do you think we need?");
    expect(arithmeticFactTurn([u("Sam has 7 bags with 8 marbles in each. How many marbles?"), reply, u("what is 7 times 8?")])).toBeNull();
    expect(arithmeticFactTurn([u("Sam has seven bags with eight marbles in each. How many marbles?"), reply, u("what is seven times eight?")])).toBeNull();
    expect(arithmeticFactTurn([u("Sam has 7 bags with 8 marbles in each."), u("How many marbles?"), reply, u("hmm"), a("Think about groups."), u("what's 7 times 8")])).toBeNull();
    // one number of the student's is not the question
    expect(arithmeticFactTurn([u("I am 8 years old"), a("Nice! What shall we learn?"), u("what is 7 times 8?")])?.answer).toBe("56");
    // a problem older than the tutor's last TUTOR_LOOKBACK messages is out of the window
    const older = [u("Sam has 7 bags with 8 marbles in each."), ...Array.from({ length: TUTOR_LOOKBACK + 1 }, () => [a("Let's look at fractions."), u("ok")]).flat()];
    expect(arithmeticFactTurn([...older, u("what is 7 times 8?")])?.answer).toBe("56");
  });

  it("answers one piece of the tutor's question: that is the student's own work", () => {
    expect(arithmeticFactTurn([u("hi"), a("What is 7 × 8?"), u("what is 7 times 4?")])?.answer).toBe("28");
    expect(arithmeticFactTurn([u("hi"), a("What is 7 × 8?"), u("what is 8 times 8?")])).toBeNull();
  });

  it("only on the student's newest message", () => {
    expect(arithmeticFactTurn([u("what is 7 times 8?"), a("7 × 8 = 56.")])).toBeNull();
    expect(arithmeticFactTurn([])).toBeNull();
  });
});

describe("the note", () => {
  it("states the fact twice: as data, then as what to say first", () => {
    const f = askedArithmetic("what is 7 times 8?")!;
    const note = arithmeticFactNote(f);
    expect(note.startsWith("<arithmetic_fact>\n7 × 8 = 56\n</arithmetic_fact>\n<tutor_note>\n")).toBe(true);
    expect(note).toContain("Give it in your first sentence: 7 × 8 = 56.");
    expect(note.endsWith("Do not mention this note.\n</tutor_note>")).toBe(true);
    expect(withArithmeticFactNote("what is 7 times 8?", f)).toBe(`what is 7 times 8?\n\n${note}`);
  });
});
