import { describe, it, expect } from "vitest";
import {
  classifyMessage, classifyTurn, posesProblem, turnNoteFor, withTurnNote,
  TYPED_PROBLEM_HOLD_NOTE, FACT_LOOKUP_NOTE, type TurnKind,
} from "./turnKind";
import { FIRST_TURN_HOLD_NOTE } from "./attemptFirst";
import { estTokens } from "./budget";
import { SHOW_ANSWER_MESSAGE } from "./suggestions";

// Hand-written for this table. Nothing here comes from an eval item.
const TABLE: Array<[string, TurnKind]> = [
  // ── typed problems: arithmetic ──
  ["What is 3/4 + 1/8?", "typed-problem"],
  ["what's 36 × 7", "typed-problem"],
  ["What is 144 ÷ 12?", "typed-problem"],
  ["48 ÷ 6 = ?", "typed-problem"],
  ["17 x 23 =", "typed-problem"],
  ["Can you help me with 2.5 * 4.2?", "typed-problem"],
  ["How much is 12 times 4?", "typed-problem"],
  ["What is seven plus five?", "typed-problem"],
  ["What is 15% of 80?", "typed-problem"],
  ["what is the square root of 169", "typed-problem"],
  ["Write 0.375 as a fraction", "typed-problem"],
  ["Calculate (8 + 2) × 3 - 4", "typed-problem"],
  ["Simplify 18/24 + 3/4", "typed-problem"],
  ["what is 9-4?", "typed-problem"],
  // ── typed problems: algebra ──
  ["Solve 2x + 5 = 17", "typed-problem"],
  ["solve for x: 3(x - 2) = 12", "typed-problem"],
  ["How do I solve x/4 + 1 = 6?", "typed-problem"],
  ["If y = 3, what is 2y + 7?", "typed-problem"],
  ["Find x when 5x - 3 = 22", "typed-problem"],
  ["expand (x + 3)(x - 2)", "typed-problem"],
  // ── typed problems: word problems ──
  ["A shop sells pens at £2 each. How much do 15 pens cost?", "typed-problem"],
  ["Maya reads 24 pages a day. How many days will a 192 page book take her?", "typed-problem"],
  ["A train travels 60 miles per hour for 3 hours. How far does it go?", "typed-problem"],
  ["What is the area of a rectangle 7 cm long and 4 cm wide?", "typed-problem"],
  ["Tom has three bags with eight marbles in each. How many marbles are there altogether?", "typed-problem"],
  ["Find the perimeter of a square with sides of 9 m", "typed-problem"],
  ["Convert 2.5 km to metres", "typed-problem"],
  ["Round 3.456 to one decimal place.", "typed-problem"],
  // ── fact lookups ──
  ["What is the capital of Peru?", "fact-lookup"],
  ["Who wrote Pride and Prejudice?", "fact-lookup"],
  ["When did the Berlin Wall fall?", "fact-lookup"],
  ["Where is the Great Barrier Reef?", "fact-lookup"],
  ["How tall is Mount Kilimanjaro?", "fact-lookup"],
  ["How many moons does Mars have?", "fact-lookup"],
  ["What does photosynthesis mean?", "fact-lookup"],
  ["Define osmosis.", "fact-lookup"],
  ["Can you explain what a prime number is?", "fact-lookup"],
  ["What do my notes say about the water cycle?", "fact-lookup"],
  ["What did I write about plate tectonics?", "fact-lookup"],
  ["According to my notes, when did the mill open?", "fact-lookup"],
  ["Tell me about the Silk Road.", "fact-lookup"],
  ["what's a noun", "fact-lookup"],
  ["Which planet has the most moons?", "fact-lookup"],
  ["What happened in 1066?", "fact-lookup"],
  ["When did World War 2 end?", "fact-lookup"],
  ["Hi! What is the boiling point of ethanol?", "fact-lookup"],
  ["What temperature does lead melt at?", "fact-lookup"],
  ["I'm confused. What is a denominator?", "fact-lookup"],
  // Added in revision 2 (see the PR), still hand-written: a lookup behind a preposition or a lead-in
  // clause, pointer words inside a message that names its own subject, the student's own "our"/"us".
  ["In what year did the printing press reach England?", "fact-lookup"],
  ["at what speed does sound travel through water?", "fact-lookup"],
  ["The tall grass that grows along riverbanks: what is it called?", "fact-lookup"],
  ["For the treaty that ended the war, who signed first?", "fact-lookup"],
  ["What's the name of the river our teacher showed us on the map?", "fact-lookup"],
  ["How fast does a cheetah run when it chases prey?", "fact-lookup"],
  ["How long did the three-day festival last?", "fact-lookup"],
  ["Is the Moon a planet? What is its diameter?", "fact-lookup"],
  ["What year did it happen?", "other"],
  ["What is it used for?", "other"],
  ["What does that mean?", "other"],
  ["What is the value of x?", "other"],
  ["What happens next in the story?", "other"],
  ["What do you know about volcanoes?", "other"],
  ["Find the 3 main causes of the First World War", "other"],
  // ── tries: never a problem ──
  ["I think it's 7/8.", "other"],
  ["3/4 + 1/8 = 7/8", "other"],
  ["Is it 252?", "other"],
  ["x = 6", "other"],
  ["2x + 5 = 17, so x = 6?", "other"],
  ["I got 56 for 7 × 8", "other"],
  ["Check my work: 15% of 80 is 12", "other"],
  ["Seven plus five is twelve", "other"],
  ["What is 3 + 4? I said 8.", "other"],
  ["The answer is 45", "other"],
  ["Maybe 12?", "other"],
  ["Is the boiling point of water 100 degrees?", "other"],
  // ── requests, chips, greetings, the problem at hand ──
  [SHOW_ANSWER_MESSAGE, "other"],
  ["Give me a hint.", "other"],
  ["Walk me through it.", "other"],
  ["Continue.", "other"],
  ["Show me a worked example.", "other"],
  ["Explain Decimals.", "other"],
  ["Quiz me on this.", "other"],
  ["Hi!", "other"],
  ["thanks!!", "other"],
  ["What's the answer?", "other"],
  ["What is the next step?", "other"],
  ["What did I do wrong?", "other"],
  ["Which one is right?", "other"],
  ["What do you mean?", "other"],
  ["What is it?", "other"],
  ["Who are you?", "other"],
  ["What's up?", "other"],
  ["What should I study first?", "other"],
  ["What if the triangle had no right angle?", "other"],
  ["Why is the sky blue?", "other"],
  ["How do you add fractions?", "other"],
  ["When was he born?", "other"],
  ["What is the answer to question 4 on my homework?", "other"],
  // ── ambiguous: unsure, so nothing ──
  ["12 × 9?", "other"],
  ["2x + 5 = 17", "other"],
  ["Is 91 prime?", "other"],
  ["Which is bigger, 3/4 or 2/3?", "other"],
  ["How many legs do 3 spiders have?", "other"],
  ["How often should I practise, 3-4 times a week?", "other"],
  ["What happened between 1939-1945?", "fact-lookup"],
  ["What happened between 1914 and 1918?", "fact-lookup"],
  // After the blind held-out check (results/2026-11-08-turn-kind-heldout.md): calculations dressed as
  // lookups, and inline "A." option lists. Own phrasings, not the held-out texts.
  ["Which year is 40 years after 1990?", "other"],
  ["If a tree was planted in 1950, how old is it in 2010?", "other"],
  ["Which planet is largest? A. Mars B. Jupiter C. Venus D. Earth", "options-problem"],
  ["I liked plan B. It was better.", "other"],
  ["So what is 3 + 4?", "other"],
  ["What is 3/4?", "other"],
  ["I have a test tomorrow. What is a cell?", "other"],
  ["What is a fraction? And how do I add them?", "other"],
  // ── other languages: only an explicit arithmetic expression ──
  ["¿Cuál es la capital de Perú?", "other"],
  ["Quelle est la capitale du Pérou ?", "other"],
  ["पेरू की राजधानी क्या है?", "other"],
  ["ما هي عاصمة بيرو؟", "other"],
  ["秘鲁的首都是什么？", "other"],
  ["३ और ४ का योग क्या है?", "other"],
  ["12 + 35 कितना होता है?", "typed-problem"],
  ["حل المعادلة 2x + 5 = 17", "typed-problem"],
  ["7 + 5 का जवाब 12 है?", "other"],
  ["7 + 5 = 12 सही है?", "other"],
  // ── lettered options: the first-turn hold's own rule, unchanged ──
  ["A tank holds 40 L and loses 6 L. How much is left?\nA) 34 L\nB) 46 L\nC) 30 L\nD) 24 L\nWhich one is right?", "options-problem"],
  ["Which word is a verb?\nA) run\nB) blue\nC) table", "options-problem"],
  ["Which word is a verb?\nA) run\nB) blue\nC) table\nI think it's A.", "other"],
];

describe("classifyMessage", () => {
  it("has a table of at least 60 hand-written messages", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });

  it.each(TABLE)("%j -> %s", (text, kind) => {
    expect(classifyMessage(text)).toBe(kind);
  });

  it("never calls a message with the student's own try a problem", () => {
    for (const tail of ["I think it's 12.", "My answer is 12.", "I got 12", "Is it 12?", "12 + 3 = 15"]) {
      expect(classifyMessage(`What is 12 + 3? ${tail}`), tail).toBe("other");
    }
  });

  it("is the same on CRLF and LF text", () => {
    for (const [text, kind] of TABLE) expect(classifyMessage(text.replace(/\n/g, "\r\n")), text).toBe(kind);
  });
});

describe("posesProblem (the chip gate)", () => {
  it("is true for option and typed problems, false for lookups, tries and requests", () => {
    for (const [text, kind] of TABLE) {
      expect(posesProblem(text), text).toBe(kind === "options-problem" || kind === "typed-problem");
    }
  });
});

describe("classifyTurn", () => {
  const tutor = (content: string) => ({ role: "assistant", content });
  const student = (content: string) => ({ role: "user", content });

  it("classifies only the student's newest message", () => {
    expect(classifyTurn([student("What is 3/4 + 1/8?")])).toBe("typed-problem");
    expect(classifyTurn([student("What is 3/4 + 1/8?"), tutor("What do the denominators need to be?")])).toBe("other");
    expect(classifyTurn([])).toBe("other");
    expect(classifyTurn([student("What is 3/4 + 1/8?"), tutor("Find a common denominator first. What is it?"), student("8")])).toBe("other");
  });

  it("does not treat a lookup that repeats the tutor's own open question as a lookup", () => {
    const asked = tutor("Plants make food from light. Do you remember what the green pigment in leaves is called?");
    expect(classifyTurn([student("Tell me about leaves."), asked, student("What is the green pigment in leaves called?")])).toBe("other");
    // A different lookup after the same question is still one.
    expect(classifyTurn([student("Tell me about leaves."), asked, student("Who discovered photosynthesis?")])).toBe("fact-lookup");
    // A tutor reply that asked nothing leaves the lookup alone.
    expect(classifyTurn([tutor("Leaves are green because of chlorophyll."), student("What is the green pigment in leaves called?")])).toBe("fact-lookup");
  });
});

describe("the notes", () => {
  it("maps each kind to its note, and other to none", () => {
    expect(turnNoteFor("options-problem")).toBe(FIRST_TURN_HOLD_NOTE);
    expect(turnNoteFor("typed-problem")).toBeNull(); // the typed-problem hold was killed before any run (PR #205)
    expect(turnNoteFor("fact-lookup")).toBe(FACT_LOOKUP_NOTE);
    expect(turnNoteFor("other")).toBeNull();
    expect(withTurnNote("Q?", FACT_LOOKUP_NOTE)).toBe(`Q?\n\n${FACT_LOOKUP_NOTE}`);
  });

  it("derives the typed-problem note from the option-list note by deleting the two option clauses only", () => {
    const derived = FIRST_TURN_HOLD_NOTE
      .replace("do not say which option is right, ", "")
      .replace(", and do not rule options in or out.", ".");
    expect(TYPED_PROBLEM_HOLD_NOTE).toBe(derived);
    expect(TYPED_PROBLEM_HOLD_NOTE).not.toMatch(/option/i);
  });

  it("are plain LF text inside the same tags", () => {
    for (const note of [TYPED_PROBLEM_HOLD_NOTE, FACT_LOOKUP_NOTE]) {
      expect(note).not.toContain("\r");
      expect(note.startsWith("<tutor_note>\n")).toBe(true);
      expect(note.endsWith("\n</tutor_note>")).toBe(true);
    }
  });

  it("the lookup note asks for the answer first, leaves sources to the grounding block, and never asks to invent", () => {
    expect(FACT_LOOKUP_NOTE).toContain("Answer the question directly and accurately, starting in your first sentence.");
    expect(FACT_LOOKUP_NOTE).toContain("This replaces any rule to guide the student to discover answers, for this question only.");
    expect(FACT_LOOKUP_NOTE).toContain("its instructions on which passages to use and how to name them still apply");
    expect(FACT_LOOKUP_NOTE).toContain("After the answer you may ask one short question to check understanding.");
    expect(FACT_LOOKUP_NOTE).not.toMatch(/\b(?:guess|make up|invent|assume)\b/i);
    // No source rule of its own: which passage to use, and the general-knowledge escape, stay with the
    // grounding block's header.
    expect(FACT_LOOKUP_NOTE).not.toMatch(/student['’]s notes|STUDENT NOTE|REFERENCE|general knowledge|do not know|don['’]t know/i);
  });

  it("costs what the PR says, by the budget's own estimate", () => {
    expect(estTokens(FIRST_TURN_HOLD_NOTE)).toBe(103);
    expect(estTokens(TYPED_PROBLEM_HOLD_NOTE)).toBe(86);
    expect(estTokens(FACT_LOOKUP_NOTE)).toBe(143);
  });
});
