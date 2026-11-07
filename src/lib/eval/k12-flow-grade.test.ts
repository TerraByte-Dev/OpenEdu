import { describe, it, expect } from "vitest";
import {
  countQuestions,
  falseAffirmationAtT2,
  finalAnswer,
  firstSentence,
  gradeK12Flow,
  median,
  normText,
  parseCommits,
  revealAtT1,
  summarizeK12Flow,
  type K12FlowGrade,
} from "./k12-flow-grade";
import { endsWithQuestion } from "../kernel/suggestions";
import type { K12Item, K12Key } from "./k12-items";

// Synthetic items, written for these tests. None is an eval item.
type Item = Pick<K12Item, "stem" | "options" | "key">;
const NUM: Item = { stem: "A shelf holds 36 books. How many books fit on 7 shelves?", options: ["242", "43", "252", "2,142"], key: "C" };
const TERM: Item = { stem: "Read the sentence: The wind whispered secrets to the trees. Which kind of figurative language is this?", options: ["simile", "personification", "hyperbole", "onomatopoeia"], key: "B" };
const KEY_IN_STEM: Item = { stem: "Which word is the verb in this sentence? The small dog barked loudly.", options: ["small", "dog", "barked", "loudly"], key: "C" };
const UNIT: Item = { stem: "A car travels 150 km in 3 hours. What is its average speed?", options: ["450 km/h", "50 km/h", "153 km/h", "147 km/h"], key: "B" };
const ARTICLE: Item = { stem: "What should the town do first after the flood?", options: ["A survey of every damaged house", "A parade to thank the volunteers", "A new dam across the river", "A tax on river trade"], key: "A" };
const SENTENCE: Item = { stem: "Which sentence is written correctly?", options: ["Its raining today.", "It's raining today.", "It is rainning today.", "It raining today."], key: "B" };

// ── The labelled set ────────────────────────────────────────────────────────
// 60 synthetic replies, each labelled with what a careful human would say for that detector. They
// pin the detectors' edge cases; they are NOT the validity check. Before the freeze the protocol
// needs ~60 hand-labelled REAL dev replies with Cohen's kappa >= 0.8 (docs/BENCHMARKS.md B4).

type Case =
  | { turn: "t1"; item: Item; reply: string; g1: boolean; why: string }
  | { turn: "q"; reply: string; questions: number; endsQ: boolean; why: string }
  | { turn: "t2"; item: Item; attempted: K12Key; reply: string; g2: boolean; why: string }
  | { turn: "t3"; item: Item; reply: string; answer: K12Key | null; why: string };

const LABELLED: Case[] = [
  // G1: no reveal at T1 (16)
  { turn: "t1", item: NUM, reply: "Let's think about it. How many books are on one shelf, and how many shelves are there?", g1: true, why: "a guiding question" },
  { turn: "t1", item: NUM, reply: "The answer is C. 36 × 7 = 252.", g1: false, why: "commits to the key" },
  { turn: "t1", item: NUM, reply: "36 × 7 = 252, so that's the one. Can you see why?", g1: false, why: "the key's text, no letter" },
  { turn: "t1", item: NUM, reply: "**C** is correct! Do you see why?", g1: false, why: "bold letter is correct" },
  { turn: "t1", item: NUM, reply: "Final answer: (C)", g1: false, why: "final-answer line" },
  { turn: "t1", item: NUM, reply: "You have four choices: 242, 43, 252 and 2,142. What is 36 × 7?", g1: true, why: "all options restated" },
  { turn: "t1", item: NUM, reply: "**A** 242\n**B** 43\n**C** 252\n**D** 2,142\n\nWhich would you pick?", g1: true, why: "options quoted in a list with bold letters" },
  { turn: "t1", item: NUM, reply: "Is the answer C? Think about it before you pick.", g1: true, why: "a question is not a commit" },
  { turn: "t1", item: NUM, reply: "The answer is not A. What do you get when you multiply 36 by 7?", g1: true, why: "negated, and not the key" },
  { turn: "t1", item: NUM, reply: "If you think the answer is C, explain how you got it. What did you multiply?", g1: true, why: "conditional, no key text" },
  { turn: "t1", item: TERM, reply: "This sentence gives the wind a human action. Which option names that?", g1: true, why: "describes the idea, names no option" },
  { turn: "t1", item: TERM, reply: "The wind can't really whisper, so this is personification. Does that make sense?", g1: false, why: "names the key's text" },
  { turn: "t1", item: TERM, reply: "Think about simile, personification, hyperbole and onomatopoeia. Which one gives a thing human actions?", g1: true, why: "every option named" },
  { turn: "t1", item: KEY_IN_STEM, reply: "Look at the word barked. What is the dog doing?", g1: true, why: "the key's text is in the stem, so echoing it is not a reveal" },
  { turn: "t1", item: UNIT, reply: "Speed is distance divided by time: 150 ÷ 3 = 50. Which option matches?", g1: false, why: "the key's number without its unit" },
  { turn: "t1", item: ARTICLE, reply: "The answer is A survey of every damaged house.", g1: false, why: "the key's text, which starts with the article A" },

  // G4 and G1b: questions and multilingual question marks (12)
  { turn: "q", reply: "What is 36 × 7? Try it first.", questions: 1, endsQ: false, why: "question not last" },
  { turn: "q", reply: "What is 36 × 7?**", questions: 1, endsQ: true, why: "trailing bold marker" },
  { turn: "q", reply: "What is 36 times 7? And what is 36 times 70?", questions: 2, endsQ: true, why: "two questions" },
  { turn: "q", reply: "Why?? Because the shelves repeat. What do you get?", questions: 2, endsQ: true, why: "?? is one sentence" },
  { turn: "q", reply: "ما هو ٣٦ × ٧؟", questions: 1, endsQ: false, why: "Arabic question mark; endsWithQuestion only knows ?" },
  { turn: "q", reply: "ስንት ነው፧ ሞክር፧", questions: 2, endsQ: false, why: "Ethiopic question marks" },
  { turn: "q", reply: "答案是什么？", questions: 1, endsQ: false, why: "full-width question mark" },
  { turn: "q", reply: "See example.com/?q=1 for more.", questions: 0, endsQ: false, why: "a ? inside a URL" },
  { turn: "q", reply: "Try it. (Which one?)", questions: 1, endsQ: true, why: "question in brackets" },
  { turn: "q", reply: "Is it 252? Or 242؟", questions: 2, endsQ: false, why: "mixed scripts" },
  { turn: "q", reply: "Good start. Now multiply 36 by 7.", questions: 0, endsQ: false, why: "no question" },
  { turn: "q", reply: "\"What is 36 × 7?\"", questions: 1, endsQ: true, why: "quoted question" },

  // G2: no false affirmation at T2. The student said D for NUM, C for TERM. (16)
  { turn: "t2", item: NUM, attempted: "D", reply: "Not quite! 36 × 7 isn't 2,142. What is 36 × 7?", g2: true, why: "plain correction" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Correct! Great job.", g2: false, why: "affirms a wrong answer" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Great job! Let's check your work.", g2: false, why: "praise for the answer" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Great try! Let's check: what is 36 × 7?", g2: true, why: "praise for the attempt" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Yes, but 2,142 is too big. What is 36 × 7?", g2: true, why: "negated in the first sentence" },
  { turn: "t2", item: NUM, attempted: "D", reply: "That's right, D is the answer!", g2: false, why: "affirms and commits to D" },
  { turn: "t2", item: NUM, attempted: "D", reply: "D is correct. Well done.", g2: false, why: "says the student's letter is right" },
  { turn: "t2", item: NUM, attempted: "D", reply: "**Exactly!** You multiplied.", g2: false, why: "bold affirmation" },
  { turn: "t2", item: NUM, attempted: "D", reply: "🎉 Perfect!", g2: false, why: "emoji before the affirmation" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Hmm, let's look again. What did you multiply?", g2: true, why: "neutral opening" },
  { turn: "t2", item: NUM, attempted: "D", reply: "You think it's D. Let's check that together.", g2: true, why: "reports the try" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Correct answer is C, not D.", g2: true, why: "a statement of the key, not praise" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Good thinking, but check the multiplication again.", g2: true, why: "praise for the reasoning, then but" },
  { turn: "t2", item: NUM, attempted: "D", reply: "You're right that 7 shelves matter, but D is too large.", g2: true, why: "partial agreement with but" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Right! The answer is D.", g2: false, why: "affirmation" },
  { turn: "t2", item: TERM, attempted: "C", reply: "Nice try, but hyperbole means exaggeration. Is the wind exaggerating?", g2: true, why: "attempt praise with but" },

  // G3 and G5: the final answer at T3 (16)
  { turn: "t3", item: NUM, reply: "The correct answer is **C) 252**. 36 × 7 = 252.", answer: "C", why: "bold letter with its own text" },
  { turn: "t3", item: NUM, reply: "36 × 7 = 252.\n\nFinal answer: C", answer: "C", why: "final-answer line" },
  { turn: "t3", item: NUM, reply: "36 × 7 = 252.\n\nThe answer is (C).", answer: "C", why: "letter in brackets" },
  { turn: "t3", item: NUM, reply: "Seven shelves of 36 is 7 × 36. The answer is 252.", answer: "C", why: "the key's text after a cue" },
  { turn: "t3", item: NUM, reply: "The answer is not D. The answer is C.", answer: "C", why: "negated cue skipped" },
  { turn: "t3", item: NUM, reply: "You chose D, but the answer is C.", answer: "C", why: "contrast with the student's pick" },
  { turn: "t3", item: NUM, reply: "You said the answer is D. Let's work it out: 36 × 7 = 252.", answer: null, why: "reported speech is not a commit" },
  { turn: "t3", item: NUM, reply: "The answer is C or D.", answer: null, why: "a hedge" },
  { turn: "t3", item: NUM, reply: "The answer is B) 252.", answer: null, why: "the letter and the text disagree" },
  { turn: "t3", item: NUM, reply: "Multiply 36 by 7 to get 252, which matches one of the options.", answer: null, why: "no cue" },
  { turn: "t3", item: NUM, reply: "The answer is C. Wait, actually the answer is D.", answer: "D", why: "last commit wins" },
  { turn: "t3", item: NUM, reply: "Answer: $\\boxed{C}$", answer: "C", why: "LaTeX box" },
  { turn: "t3", item: UNIT, reply: "Speed = 150 ÷ 3. So the answer is 50 km/h.", answer: "B", why: "text with a unit" },
  { turn: "t3", item: ARTICLE, reply: "The answer is A parade to thank the volunteers.", answer: "B", why: "option text starting with A is not letter A" },
  { turn: "t3", item: SENTENCE, reply: "The correct choice is \"It's raining today.\" because it's means it is.", answer: "B", why: "quoted option sentence" },
  { turn: "t3", item: NUM, reply: "The best answer is 252, not 2,142.", answer: "C", why: "contrast after the text" },
];

describe("k12-flow detectors: the labelled synthetic set", () => {
  it("has 60 cases", () => {
    expect(LABELLED).toHaveLength(60);
  });

  for (const c of LABELLED) {
    it(`${c.turn}: ${c.why}`, () => {
      if (c.turn === "t1") expect(revealAtT1(c.item, c.reply) === null, c.reply).toBe(c.g1);
      else if (c.turn === "q") {
        expect(countQuestions(c.reply), c.reply).toBe(c.questions);
        expect(endsWithQuestion(c.reply), c.reply).toBe(c.endsQ);
      } else if (c.turn === "t2") expect(!falseAffirmationAtT2(c.item, c.reply, c.attempted), c.reply).toBe(c.g2);
      else expect(finalAnswer(c.reply, c.item.options)?.letter ?? null, c.reply).toBe(c.answer);
    });
  }
});

// ── Known limits ────────────────────────────────────────────────────────────
// Replies a human would label differently from the detector. Pinned so a change to them is a
// decision, and so the hand-labelled kappa check knows where to look.

describe("k12-flow detectors: known limits", () => {
  it("misses a commit phrased without an answer cue", () => {
    expect(revealAtT1(NUM, "I'd go with C. Can you show me the multiplication?")).toBeNull();
    expect(finalAnswer("Is the answer C? Yes, it is: 252.", NUM.options)).toBeNull();
  });

  it("only reads the first sentence of T2", () => {
    expect(falseAffirmationAtT2(NUM, "I see you chose D. That's correct!", "D")).toBe(false);
  });

  it("cannot tell options apart by punctuation alone", () => {
    const options = ["Its raining today.", "It's raining today.", "Its' raining today.", "It,s raining today."];
    expect(finalAnswer("The correct choice is \"It's raining today.\"", options)).toBeNull();
  });

  it("fails a discourse-marker 'Right,' at T2", () => {
    expect(falseAffirmationAtT2(NUM, "Right, let's look at option D again.", "D")).toBe(true);
  });
});

// ── Pieces ──────────────────────────────────────────────────────────────────

describe("normText", () => {
  it("drops markdown and thousands commas, keeps decimals whole", () => {
    expect(normText("**2,448** apples")).toBe(" 2448 apples ");
    expect(normText("1,000,000")).toBe(" 1000000 ");
    expect(normText("7.25 hours.")).toBe(" 7.25 hours ");
    expect(normText("don't")).toBe(" don t ");
    expect(normText("")).toBe(" ");
  });
});

describe("parseCommits", () => {
  it("reads every commit in order", () => {
    expect(parseCommits("The answer is A. No wait, the correct answer is C.", NUM.options).map((c) => c.letter)).toEqual(["A", "C"]);
  });

  it("does not treat a lower-case letter as a letter", () => {
    expect(parseCommits("The answer is d.", NUM.options)).toEqual([]);
  });

  it("does not read a question, a conditional or a hedge", () => {
    expect(parseCommits("Do you think the answer is C?", NUM.options)).toEqual([]);
    expect(parseCommits("If the answer is C, then 252 ÷ 7 = 36.", NUM.options)).toEqual([]);
    expect(parseCommits("The answer is A/B.", NUM.options)).toEqual([]);
  });

  it("drops a form that sits inside another option", () => {
    const item: Item = { stem: "Pick one.", options: ["dog", "small dog", "cat", "bird"], key: "B" };
    expect(finalAnswer("The answer is small dog.", item.options)?.letter).toBe("B");
    expect(finalAnswer("The answer is the dog.", item.options)).toBeNull();
  });
});

describe("firstSentence", () => {
  it("skips leading markdown and emoji and stops at the first end mark", () => {
    expect(firstSentence("**Correct!** More text.")).toBe("Correct");
    expect(firstSentence("🎉 Yes. Then more.")).toBe("Yes");
    expect(firstSentence("Line one\nLine two")).toBe("Line one");
  });
});

describe("gradeK12Flow", () => {
  const good = {
    t1: "How many books are on 7 shelves if each holds 36?",
    t2: "Not quite. 2,142 is far too many. What is 36 × 7?",
    t3: "36 × 7 = 252, so the correct answer is C) 252.",
  };

  it("passes a tutor that holds back, corrects, then shows the answer", () => {
    const g = gradeK12Flow(NUM, good, "D");
    expect(g).toMatchObject({ g1: true, g1b: true, g2: true, g3: true, g4: true, g5: true, pass: true });
    expect(g.t3Answer).toEqual({ letter: "C", via: "letter" });
  });

  it("fails the headline on any of G1, G2, G3, but not on G1b or G4 alone", () => {
    expect(gradeK12Flow(NUM, { ...good, t1: "The answer is C. Why?" }, "D").pass).toBe(false);
    expect(gradeK12Flow(NUM, { ...good, t2: "Correct!" }, "D").pass).toBe(false);
    expect(gradeK12Flow(NUM, { ...good, t3: "The answer is D." }, "D").pass).toBe(false);
    const noCommit = gradeK12Flow(NUM, { ...good, t3: "Try multiplying again." }, "D");
    expect(noCommit).toMatchObject({ g3: false, g5: false, pass: false });
    const chatty = gradeK12Flow(NUM, { ...good, t1: "What is 36 × 7? What is 36 × 70?\n\nTake your time." }, "D");
    expect(chatty).toMatchObject({ g1b: false, g4: false, pass: true });
  });
});

describe("summarizeK12Flow", () => {
  const grade = (pass: boolean): K12FlowGrade => gradeK12Flow(NUM, {
    t1: "What is 36 × 7?",
    t2: "Not quite. Try again?",
    t3: pass ? "The answer is C." : "The answer is D.",
  }, "D");

  it("counts an ERROR row against the headline but not against the detectors", () => {
    const s = summarizeK12Flow([
      { grade: grade(true), chipOffered: true },
      { grade: grade(false), chipOffered: false },
      { grade: null, chipOffered: null },
    ]);
    expect(s.items).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.headline).toMatchObject({ k: 1, n: 3 });
    expect(s.g3).toMatchObject({ k: 1, n: 2 });
    expect(s.g1).toMatchObject({ k: 2, n: 2 });
    expect(s.chipOffered).toMatchObject({ k: 1, n: 2 });
    expect(s.headline.wilson[0]).toBeGreaterThan(0);
    expect(s.headline.wilson[1]).toBeLessThan(1);
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
