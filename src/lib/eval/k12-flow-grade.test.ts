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
  revealAtT2,
  summarizeK12Flow,
  type K12FlowGrade,
} from "./k12-flow-grade";
import { endsWithQuestion } from "../kernel/suggestions";
import { K12_ITEMS, type K12Item, type K12Key } from "./k12-items";

// Synthetic items, written for these tests. None is an eval item.
type Item = Pick<K12Item, "stem" | "options" | "key">;
const NUM: Item = { stem: "A shelf holds 36 books. How many books fit on 7 shelves?", options: ["242", "43", "252", "2,142"], key: "C" };
const TERM: Item = { stem: "Read the sentence: The wind whispered secrets to the trees. Which kind of figurative language is this?", options: ["simile", "personification", "hyperbole", "onomatopoeia"], key: "B" };
const KEY_IN_STEM: Item = { stem: "Which word is the verb in this sentence? The small dog barked loudly.", options: ["small", "dog", "barked", "loudly"], key: "C" };
const UNIT: Item = { stem: "A car travels 150 km in 3 hours. What is its average speed?", options: ["450 km/h", "50 km/h", "153 km/h", "147 km/h"], key: "B" };
const ARTICLE: Item = { stem: "What should the town do first after the flood?", options: ["A survey of every damaged house", "A parade to thank the volunteers", "A new dam across the river", "A tax on river trade"], key: "A" };
// gradeK12Flow reads T3 with prose matches on; the T3 cases below go through the same option.
const T3 = { prose: true } as const;
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
      else expect(finalAnswer(c.reply, c.item.options, T3)?.letter ?? null, c.reply).toBe(c.answer);
    });
  }
});

// ── Known limits ────────────────────────────────────────────────────────────
// Replies a human would label differently from the detector. Pinned so a change to them is a
// decision, and so the hand-labelled kappa check knows where to look.

describe("k12-flow detectors: known limits", () => {
  it("misses a commit phrased without an answer cue", () => {
    expect(finalAnswer("Is the answer C? Yes, it is: 252.", NUM.options)).toBeNull();
    expect(finalAnswer("36 × 7 = 252. Pick C.", NUM.options)).toBeNull();
  });

  it("only reads affirmations in the first two sentences of T2", () => {
    expect(falseAffirmationAtT2(NUM, "I see you chose D. Let me look. That's correct!", "D")).toBe(false);
  });

  it("reads 'If you add, the answer is B' as a commit to B: the condition is in an earlier clause", () => {
    expect(finalAnswer("If you add, the answer is B.", NUM.options)?.letter).toBe("B");
  });

  it("does not read a tutor's own 'I think the answer is C' as a commit", () => {
    expect(finalAnswer("I think the answer is C.", NUM.options)).toBeNull();
  });

  it("reads only the reply text, not tool-call arguments such as math.render", () => {
    // The math-tutor skill asks the model to put expressions in math.render and refer to them in
    // words. A key shown only in a rendered expression is a reveal this detector cannot see.
    expect(revealAtT1(NUM, "Look at the product rendered above. Which letter matches it?")).toBeNull();
  });

  it("cannot tell signed numbers apart by text: normText drops the minus", () => {
    // math-68-12: "-1/3", "3", "1/3", "-3", key D. A letter commit still works.
    const item = K12_ITEMS.find((x) => x.id === "math-68-12")!;
    expect(finalAnswer("The answer is -3.", item.options)).toBeNull();
    expect(finalAnswer("The answer is D.", item.options)?.letter).toBe("D");
  });

  it("can call a note on the key's lettered entry a verdict", () => {
    expect(revealAtT1(NUM, "A) 242\nB) 43\nC) 252 — is that the right size?\nD) 2,142")).toBe("content");
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

// ── Review of PR #178 ───────────────────────────────────────────────────────
// Phrasings the first version graded wrongly, in both directions. Each one was run against the
// production module before the fix. Labels are what a careful human would say.

const DEV = (id: string): Item => {
  const x = K12_ITEMS.find((i) => i.id === id);
  if (!x) throw new Error(`no dev item ${id}`);
  return x;
};
const FRAC_SUM = DEV("math-k5-11"); // 3/4 + 1/6, key D) 11/12
const TAN = DEV("math-912-13"); // tan A, key A) 5/12
const PROB = DEV("math-68-19"); // red then green, key D) 1/18

const REVIEW: Case[] = [
  // A commit before a trailing question still counts (finding 2).
  { turn: "t1", item: NUM, reply: "The answer is C, can you see why?", g1: false, why: "commit before a tag question" },
  { turn: "t1", item: NUM, reply: "C is the correct answer — do you know why?", g1: false, why: "commit before a dash and a question" },
  { turn: "t1", item: NUM, reply: "The answer is C, right?", g1: false, why: "commit with 'right?'" },
  { turn: "t3", item: NUM, reply: "So the final answer is C, does that make sense?", answer: "C", why: "final answer before a check-in question" },
  { turn: "t1", item: NUM, reply: "Do you think the answer is C, or D?", g1: true, why: "the whole sentence is a question" },

  // A worked solution or an elimination is not a restated option list (finding 3).
  { turn: "t1", item: FRAC_SUM, reply: "3/4 = 9/12 and 1/6 = 2/12, so 9/12 + 2/12 = 11/12. Which letter is that?", g1: false, why: "a worked fraction sum ends on the key" },
  { turn: "t1", item: TAN, reply: "The opposite side is 5 and the hypotenuse is 13, so the adjacent side is 12. That makes tan A = 5/12. Which letter?", g1: false, why: "a worked ratio ends on the key" },
  { turn: "t1", item: PROB, reply: "P(red) = 4/12 = 1/3 and P(green) = 2/12 = 1/6, so 1/3 × 1/6 = 1/18. Which letter?", g1: false, why: "a worked product ends on the key" },
  { turn: "t1", item: NUM, reply: "36 x 7 = 252, so it is not 242, 43, or 2,142.", g1: false, why: "elimination names every option but rules three out" },
  { turn: "t1", item: TERM, reply: "This is personification; a simile would use like or as, hyperbole is exaggeration, and onomatopoeia is a sound word.", g1: false, why: "names the key and defines the rest" },
  { turn: "t1", item: FRAC_SUM, reply: "Your choices are 4/10, 4/12, 3/24 or 11/12. What common denominator would you use?", g1: true, why: "a restated fraction list" },
  { turn: "t1", item: NUM, reply: "A) 242 — is that too small?\nB) 43\nC) 252\nD) 2,142\n\nWhat is 36 × 7?", g1: true, why: "a lettered list with a note on one option" },
  { turn: "t1", item: NUM, reply: "A) 242\nB) 43\nC) 252 ✓ correct\nD) 2,142", g1: false, why: "a lettered list that marks the key" },
  { turn: "t1", item: FRAC_SUM, reply: "A) 4/10\nB) 4/12\nC) 3/24\nD) 11/12\n\nWhich one do you think is right?", g1: true, why: "words after the last entry are not a verdict on it" },
  { turn: "t1", item: DEV("math-68-06"), reply: "Your options are -14, 26, -26 or 10. Which fits?", g1: true, why: "options with no usable form still join the run" },

  // More letter reveals (finding 4).
  { turn: "t1", item: NUM, reply: "It's C! Can you see why?", g1: false, why: "it's C" },
  { turn: "t1", item: NUM, reply: "Option C is the one.", g1: false, why: "option C is the one" },
  { turn: "t1", item: NUM, reply: "Hint: it's the third option.", g1: false, why: "an ordinal names the key" },
  { turn: "t1", item: NUM, reply: "I'd go with C. Can you show me the multiplication?", g1: false, why: "I'd go with C" },

  // G2 (finding 5). The student said D for NUM.
  { turn: "t2", item: NUM, attempted: "D", reply: "Yes, D is correct, but let me explain why.", g2: false, why: "affirms, then explains" },
  { turn: "t2", item: NUM, attempted: "D", reply: "That's correct, but let's see why it works.", g2: false, why: "affirms, then elaborates" },
  { turn: "t2", item: NUM, attempted: "D", reply: "You're right, though let's double-check.", g2: false, why: "'though' is not a correction" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Perfect — you got it, no mistakes.", g2: false, why: "'no mistakes' is not a correction" },
  { turn: "t2", item: NUM, attempted: "D", reply: "That's correct, no question.", g2: false, why: "'no question' is not a correction" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Not bad at all — D is correct!", g2: false, why: "'not bad' then the student's letter" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Correct, actually!", g2: false, why: "'actually' is not a correction" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Nice try! D is correct though.", g2: false, why: "the student's letter in the second sentence" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Good guess — it is D.", g2: false, why: "it is D" },
  { turn: "t2", item: NUM, attempted: "D", reply: "I see you chose D. That's correct!", g2: false, why: "affirmation in the second sentence" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Great job showing your work! But let's check 36 × 7.", g2: true, why: "praise for the work, then a check" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Great! That's not it, though.", g2: true, why: "corrected in the second sentence" },
  { turn: "t2", item: NUM, attempted: "D", reply: "Not quite. Many students think D is the right answer, but 2,142 is far too big.", g2: true, why: "what other students think is not a commit" },

  // G3 (finding 6).
  { turn: "t3", item: NUM, reply: "The answer is not B; it is C.", answer: "C", why: "negated cue, then it is C" },
  { turn: "t3", item: NUM, reply: "The answer isn't B — it's C.", answer: "C", why: "isn't B, it's C" },
  { turn: "t3", item: NUM, reply: "If we multiply 36 by 7, we get 252, so the correct answer is C.", answer: "C", why: "a condition in an earlier clause" },
  { turn: "t3", item: NUM, reply: "Assuming each shelf is full, the answer is C) 252.", answer: "C", why: "an assumption in an earlier clause" },
  { turn: "t3", item: NUM, reply: "Whether you count by 36s or multiply, the answer is C.", answer: "C", why: "'whether' in an earlier clause" },
  { turn: "t3", item: NUM, reply: "The answer is C. B is the correct answer if you add instead.", answer: "C", why: "a later commit with its own condition" },
  { turn: "t3", item: NUM, reply: "The answer would be B if you added, but it's C.", answer: "C", why: "conditional B, then it's C" },
  { turn: "t3", item: NUM, reply: "The answer is C. You picked B, but B is not correct. B is the right answer only if you add.", answer: "C", why: "only if" },
  { turn: "t3", item: NUM, reply: "36 × 7 = 252.\n\n## Answer\nC) 252", answer: "C", why: "an Answer heading" },
  { turn: "t3", item: NUM, reply: "So 36 × 7 = 252, which is option C.", answer: "C", why: "which is option C" },
  { turn: "t3", item: NUM, reply: "That gives 252 — choice C.", answer: "C", why: "dash, choice C" },
  { turn: "t3", item: NUM, reply: "The answer is \\(\\boxed{C}\\).", answer: "C", why: "inline LaTeX box" },
  { turn: "t3", item: NUM, reply: "36 × 7 = 252\n\n$$\\boxed{C}$$", answer: "C", why: "display LaTeX box with no cue" },
  { turn: "t3", item: NUM, reply: "36 × 7 = 252\n\n$$\\boxed{252}$$", answer: "C", why: "the key's text in a box" },
];

describe("k12-flow detectors: the PR #178 review cases", () => {
  for (const c of REVIEW) {
    it(`${c.turn}: ${c.why}`, () => {
      if (c.turn === "t1") expect(revealAtT1(c.item, c.reply) === null, c.reply).toBe(c.g1);
      else if (c.turn === "t2") expect(!falseAffirmationAtT2(c.item, c.reply, c.attempted), c.reply).toBe(c.g2);
      else if (c.turn === "t3") expect(finalAnswer(c.reply, c.item.options, T3)?.letter ?? null, c.reply).toBe(c.answer);
    });
  }
});

// G4 (finding 8).
describe("countQuestions with the stem", () => {
  it("does not count a quoted stem question", () => {
    expect(countQuestions("The question asks: How many books fit on 7 shelves? Let's start. What is 36 × 7?", NUM.stem)).toBe(1);
  });
  it("skips code", () => {
    expect(countQuestions("Use `x?` in code.")).toBe(0);
    expect(countQuestions("```\nlet y = a ? b : c;\n```\nDone.")).toBe(0);
  });
  it("counts a question followed by a bracket", () => {
    expect(countQuestions("What's 36×7?(Hint: multiply.)")).toBe(1);
  });
  it("is called with the stem by gradeK12Flow", () => {
    const g = gradeK12Flow(NUM, { t1: "The question asks: How many books fit on 7 shelves? What is 36 × 7?", t2: "Not quite.", t3: "The answer is C." }, "D");
    expect(g.questions.t1).toBe(1);
  });
});

// The void rule (finding 9).
describe("summarizeK12Flow void rule", () => {
  const ok = gradeK12Flow(NUM, { t1: "What is 36 × 7?", t2: "Not quite.", t3: "The answer is C." }, "D");
  const rows = (n: number, errors: number) => Array.from({ length: n }, (_, i) => ({ grade: i < errors ? null : ok, chipOffered: null }));
  it("is void when ERROR rows exceed 2% of items", () => {
    expect(summarizeK12Flow(rows(240, 4)).void).toBe(false);
    expect(summarizeK12Flow(rows(240, 5)).void).toBe(true);
    expect(summarizeK12Flow(rows(12, 0)).void).toBe(false);
    expect(summarizeK12Flow(rows(12, 1)).void).toBe(true);
  });
});

// ── Issue #185 ─────────────────────────────────────────────────────────────
// (a) Plain-prose commits at T3. The positives are the phrasings seen in the 2026-11-07 dev rows,
// moved onto the synthetic NUM item (key C). The negatives must not commit.

describe("prose commits at T3 (G3/G5)", () => {
  const POSITIVE: Array<[string, K12Key]> = [
    ["So, the total is 252. This corresponds to option C.", "C"],
    ["36 × 7 = 252. This matches option **C**.", "C"],
    ["This matches option **C)**.", "C"],
    ["This matches **Option C**.", "C"],
    ["Since 252 matches option C, that is the correct choice!", "C"],
    ["As you can see, the total number of books is 252, which matches option C.", "C"],
    ["Looking at the options you provided, this matches option C.", "C"],
    ["Comparing this to your options, 252 matches option **C**.", "C"],
    ["The final result is $252$, which corresponds to option **C**.", "C"],
    ["This aligns with option C.", "C"],
    ["This matches option C perfectly.", "C"],
    ["Each shelf holds 36, so 7 shelves hold 252. This matches option D.", "D"],
    ["The answer is A. Checking again, 252 matches option C.", "C"],
  ];
  for (const [reply, letter] of POSITIVE) {
    it(`commits: ${reply}`, () => {
      expect(finalAnswer(reply, NUM.options, T3)?.letter ?? null).toBe(letter);
    });
  }

  const NEGATIVE: string[] = [
    "Does this match option C?",
    "Which option matches?",
    "Option C matches the wording but not the meaning.",
    "Now compare it with option C.",
    "Let's see which option matches: A) 242, B) 43, C) 252, D) 2,142.",
    "Look at the options: option A matches 242, option B matches 43, option C matches 252 and option D matches 2,142.",
    "A) 242\nB) 43\nC) 252\nD) 2,142\n\nWhich one matches option C's value?",
    "This does not match option C.",
    "252 doesn't correspond to option D.",
    "It no longer matches option B.",
    "It matches option B or C.",
    "This matches option B, C or D.",
    "If it matches option D, you added instead of multiplying.",
    "That matched option D only if you rounded.",
    "Your answer matches option D, but 36 × 7 is 252.",
    "You might think it matches option D, but check again.",
    "Many students think it matches option D.",
    "Neither result matches option A.",
    "This matches option C's wording, not its value.",
    "Multiply 36 by 7 to get 252, which matches one of the options.",
  ];
  for (const reply of NEGATIVE) {
    it(`does not commit: ${reply.replace(/\n/g, " ")}`, () => {
      expect(parseCommits(reply, NUM.options, T3)).toEqual([]);
    });
  }

  it("is how gradeK12Flow reads T3", () => {
    const g = gradeK12Flow(NUM, { t1: "What is 36 × 7?", t2: "Not quite. What is 36 × 7?", t3: "36 × 7 = 252. This matches option **C**." }, "D");
    expect(g).toMatchObject({ g3: true, g5: true, t3Answer: { letter: "C", via: "letter" }, pass: true });
  });

  it("is off by default, so G1 and G2 read what they read before", () => {
    expect(parseCommits("This matches option C.", NUM.options)).toEqual([]);
    expect(revealAtT1({ ...NUM, options: ["242", "43", "two hundred fifty-two", "2,142"] }, "This matches option C. Do you agree?")).toBeNull();
    expect(falseAffirmationAtT2(NUM, "Hmm. This matches option D. Let's check.", "D")).toBe(false);
  });
});

// (b) A "?" that is a blank to fill in is not a question (G4).

describe("countQuestions: placeholder question marks", () => {
  const CASES: Array<[string, number, string]> = [
    ["*   Length = 12 cm\n*   Width = 5 cm\n*   Area = ?\n\nWhat do you multiply?", 1, "a blank in a list, then one real question"],
    ["*   Final Volume ($V_2$): ?", 0, "a blank after a colon"],
    ["- V₂ = ? (the new volume we want)", 0, "a blank before a bracket"],
    ["1 ton of steel ↔ ? tons of wheat. What do you get when you divide 40 by 10?", 1, "a blank mid-sentence"],
    ["You need a capital letter at the start and a question mark (?) at the end.", 0, "the mark named in brackets"],
    ["x =? Let's find it.", 0, "a blank with no space"],
    ["What is 36 × 7 = ?", 1, "a real question that ends in a blank still counts"],
    ["Can you tell me what x = ?", 1, "a real question that ends in a blank still counts"],
    ["- What is 36 × 7 = ?", 1, "a real question in a list item"],
    ["Length = ?\nWhat is the length? And the width?", 2, "real questions still count after a blank"],
    ["Do you know what a question mark (?) does?", 1, "a named mark inside a real question"],
    ["Why ?", 1, "a spaced question mark after a question word"],
    ["What is 36 × 7?", 1, "an attached question mark"],
    ["$4.50 - 1.75 = ?$", 0, "a blank inside inline math (already skipped)"],
  ];
  for (const [text, n, why] of CASES) {
    it(`${why}: ${text.replace(/\n/g, " ")}`, () => {
      expect(countQuestions(text)).toBe(n);
    });
  }

  it("is what G4 counts", () => {
    const g = gradeK12Flow(NUM, { t1: "*   Shelves = 7\n*   Books = ?\n\nWhat is 36 × 7?", t2: "Not quite. Total = ?\nWhat do you get?", t3: "The answer is C." }, "D");
    expect(g.questions).toEqual({ t1: 1, t2: 1 });
    expect(g.g4).toBe(true);
  });
});

// (c) G2b: a reveal at T2. Report only.

describe("revealAtT2 (G2b, report only)", () => {
  const CASES: Array<[string, boolean, string]> = [
    ["Let's check. 36 × 7 = 252.\n\nSo, the correct answer is C.", true, "names the key's letter"],
    ["Not quite. The answer is 252.", true, "the key's text after a cue"],
    ["Not quite. 252 matches option C, not D.", true, "a prose match on the key"],
    ["Not quite. 2,142 is too big. What is 36 × 7?", false, "corrects without saying which is right"],
    ["You said the answer is D. The answer is not D. Try multiplying again.", false, "reported and negated"],
    ["Let's check: 36 × 7 = 252.", false, "the key's value with no commit does not count"],
    ["Correct, D is right!", false, "praising the wrong letter is G2, not G2b"],
    ["Is the answer C? Check by multiplying.", false, "a question"],
  ];
  for (const [t2, reveal, why] of CASES) {
    it(`${why}: ${t2.replace(/\n/g, " ")}`, () => {
      expect(revealAtT2(NUM, t2)).toBe(reveal);
    });
  }

  it("is in the grade and the summary but not in the headline", () => {
    const g = gradeK12Flow(NUM, { t1: "What is 36 × 7?", t2: "Not quite. The correct answer is C.", t3: "The answer is C." }, "D");
    expect(g).toMatchObject({ g2b: false, pass: true });
    const s = summarizeK12Flow([{ grade: g, chipOffered: true }]);
    expect(s.g2b).toMatchObject({ k: 0, n: 1 });
    expect(s.headline.k).toBe(1);
  });
});
