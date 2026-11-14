import { describe, it, expect } from "vitest";
import { ReplyClaimFilter, filterReplyClaims, praises, rejects, claimsMastery, VERDICT_LINE, type ClaimFilterOptions } from "./replyClaims";
import type { Verdict } from "./answerCheck";

// The claim filter the kernel runs every model call's text through (TutorEngine.ts; the turns
// themselves are in answerCheckTurn.test.ts). Replies here are made up.

const opts = (verdict: Verdict | null, written = false): ClaimFilterOptions => ({ verdict, masteryWritten: () => written });
const run = (text: string, verdict: Verdict | null = null, written = false) => filterReplyClaims(text, opts(verdict, written));

/** The text fed in every way it could arrive: whole, and in pieces of 1, 2, 3 and 7 characters. */
function streamed(text: string, o: ClaimFilterOptions): string[] {
  const out = [];
  for (const size of [text.length || 1, 1, 2, 3, 7]) {
    const f = new ReplyClaimFilter(o);
    let shown = "";
    for (let i = 0; i < text.length; i += size) shown += f.push(text.slice(i, i + size));
    out.push(shown + f.flush());
  }
  return out;
}

describe("text with no claim comes out byte for byte, however it streams", () => {
  const replies = [
    "Let's work it out together. What is 6 x 7?",
    "Here is a list:\n\n- one\n- two\n\n1. first\n2. second",
    "Use the formula $A = \\pi r^2$. The radius is 3.5 cm, so the area is about 38.5 cm².  \n\nTry the next one!",
    "```python\nprint(\"Correct!\")\nprint(\"You have mastered loops\")\n```\nThat code prints two lines.",
    "Trailing spaces stay.   ",
    "",
    "Once you have mastered this, we will move on. Let's check if you have mastered loops.",
    "You're on the right track. The correct answer is 63. Is that right? Turn right at the corner.",
    "You haven't mastered this yet, and that's okay. I can't mark it as mastered until the quiz.",
    "The skill is mastered through practice. This counts as mastered when you score 90% on the quiz. Students who have reached mastery move on.",
    // Rules about mastery, and the past (from a review of the first draft).
    "To mark a skill as mastered, you need three right in a row. A skill is marked as mastered after you pass the quiz.",
    "Skills are marked as mastered when you score 80% on the quiz. Your progress page shows which skills are marked as mastered.",
    "Remember, you mastered counting to 10 last time.",
    "1. Add the tens.\n2. Then the ones:\n\n    ```\n    print(\"You have mastered loops\")\n    ```\n\nDone.",
  ];
  it.each(replies)("%j", (text) => {
    for (const verdict of [null, "correct", "partly", "unsure"] as const) {
      for (const out of streamed(text, opts(verdict))) expect(out, String(verdict)).toBe(text);
    }
  });

  // On a wrong answer a reply that never says so gets the verdict line first (below); the rest is untouched.
  it.each(replies)("%j, on a wrong answer, after the verdict line", (text) => {
    const led = !text ? "" : /^(?:```|\d+\.\s)/.test(text) ? `${VERDICT_LINE.incorrect}\n\n${text}` : `${VERDICT_LINE.incorrect} ${text}`;
    for (const out of streamed(text, opts("incorrect"))) expect(out).toBe(led);
  });
});

describe("mastery claims", () => {
  it.each([
    "You have mastered times tables.",
    "You've now mastered fractions!",
    "You have officially mastered this topic.",
    "I will mark that as mastered.",
    "I'll mark Equal Groups as mastered for you.",
    "I think we can mark that as mastered.",
    "Equal Groups is now marked as mastered.",
    "You have shown mastery of division.",
  ])("%j is taken out when nothing was saved, and kept when it was", (claim) => {
    const text = `Nice thinking. ${claim} Want another one?`;
    expect(run(text)).toBe("Nice thinking. Want another one?");
    expect(run(text, null, true)).toBe(text);
  });

  it("as a whole line, its line break stays", () => {
    expect(run("Well explained.\n\nYou have mastered loops.\n\nNext up: lists.")).toBe("Well explained.\n\n\n\nNext up: lists.");
  });

  it("is not read at all on a turn outside a mastery check, and nothing is held", () => {
    const f = new ReplyClaimFilter({ verdict: null, masteryWritten: () => false, checkMastery: false });
    expect(f.push("You have mastered loops")).toBe("You have mastered loops");
    expect(f.push(". Since you've mastered addition, try this.")).toBe(". Since you've mastered addition, try this.");
    expect(f.flush()).toBe("");
  });

  it("is never read in a question, a condition or a negation", () => {
    for (const s of ["Do you think you have mastered it?", "When you have mastered this, try the quiz.", "You have not mastered it yet.", "If you have mastered loops, take the test."]) {
      expect(claimsMastery(s), s).toBe(false);
    }
  });
});

describe("against a verdict", () => {
  it("incorrect: praise for the answer, whole or in part, is taken out; the first claim becomes the verdict", () => {
    expect(run("That is correct! You correctly multiplied. Now try 7 x 8.", "incorrect")).toBe("That's not right yet. Now try 7 x 8.");
    expect(run("**Correct!** Well done.", "incorrect")).toBe("That's not right yet.");
    expect(run("Yes, that's right, 6 x 8 is 46.", "incorrect")).toBe("That's not right yet.");
    expect(run("Great, but 6 x 8 is 48.", "incorrect")).toBe("That's not right yet. 6 x 8 is 48.");
    expect(run("Great! Let's look at it again.", "incorrect")).toBe("That's not right yet. Let's look at it again.");
  });

  it("incorrect: what follows a colon is kept", () => {
    expect(run("That is the right answer to a different question: 7 x 10 is 70.", "incorrect")).toBe("That's not right yet. 7 x 10 is 70.");
  });

  it("correct: moving on to a new problem is not doubt", () => {
    expect(run("That's right! Now let's try again with 8 x 9.", "correct")).toBe("That's right! Now let's try again with 8 x 9.");
  });

  it("incorrect: no line is added when the reply has already said so", () => {
    expect(run("Not quite. You got it backwards. You are correct that 6 x 7 is 42.", "incorrect")).toBe("Not quite. You got it backwards.");
  });

  it("partly: whole praise goes, praise for a part stays", () => {
    expect(run("You got it! You correctly found the 3 full boxes.", "partly")).toBe("That's partly right. You correctly found the 3 full boxes.");
    expect(run("You're right that 5 x 3 is 15, but check the remainder.", "partly")).toBe("You're right that 5 x 3 is 15, but check the remainder.");
  });

  it("correct: doubt is taken out; the answer's own working stays", () => {
    expect(run("Not quite. 6 x 8 is 48.", "correct")).toBe("That's right. 6 x 8 is 48.");
    expect(run("Hmm, that's not right. Try again.", "correct")).toBe("That's right.");
    expect(run("Close, but you need to check your work.", "correct")).toBe("That's right.");
    expect(run("That's right! It is wrong to think 6 x 8 is 46, though.", "correct")).toBe("That's right! It is wrong to think 6 x 8 is 46, though.");
  });

  it("unsure: neither praise nor doubt, and no line is added", () => {
    expect(run("That is correct! Not quite, though. Can you show me how you got it?", "unsure")).toBe("Can you show me how you got it?");
  });

  it("a claim split across the stream is taken out whole, at every split", () => {
    const text = "That is correct! Great job, you got it. Now try 7 x 8.";
    for (const out of streamed(text, opts("incorrect"))) expect(out).toBe("That's not right yet. Now try 7 x 8.");
    for (const out of streamed("Not quite! 6 x 8 is 48.", opts("correct"))) expect(out).toBe("That's right. 6 x 8 is 48.");
  });

  it("nothing in a code fence or `code` is read", () => {
    const text = "Not quite. Run this:\n\n```\nprint(\"That is correct!\")\n```\nIt prints `Correct!`.";
    expect(run(text, "incorrect")).toBe(text);
  });

  it("reads claims the way the kernel's rules mean them", () => {
    expect(praises("That is exactly right.")).toBe(true);
    expect(praises("You're right!")).toBe(true);
    expect(praises("That's not quite right.")).toBe(false);
    expect(praises("You're on the right track.")).toBe(false);
    expect(praises("The correct answer is 48.")).toBe(false);
    expect(praises("Is that right?")).toBe(false);
    expect(praises("You correctly found the radius.")).toBe(false);
    expect(praises("You correctly found the radius.", true)).toBe(true);
    expect(rejects("That's not right.")).toBe(true);
    expect(rejects("That is incorrect.")).toBe(true);
    expect(rejects("Nice try!")).toBe(true);
    expect(rejects("That is correct.")).toBe(false);
    expect(rejects("Is that wrong?")).toBe(false);
  });
});

// ── Gaps a review of the first version found (2026-11-14). The replies are a reviewer's hand-written
// probes and replies made up for this file; none comes from an eval set. Each is checked both ways:
// the claim is taken out, and a true or teaching sentence worded close to it stays.

/** A wrong answer of 72 to a question whose key is 63, as TutorEngine sets the filter up. */
const wrong72: ClaimFilterOptions = { verdict: "incorrect", masteryWritten: () => false, answer: { student: "72", key: "63" } };
const right48: ClaimFilterOptions = { verdict: "correct", masteryWritten: () => false, answer: { student: "48", key: "48" } };
const each = (text: string, o: ClaimFilterOptions) => {
  const outs = streamed(text, o);
  for (const out of outs) expect(out, "every way it streams").toBe(outs[0]);
  return outs[0];
};

describe("praise of a wrong answer the first version let through", () => {
  it.each([
    // The statement before a question in the same sentence.
    ["Great job, can you tell me how you got 72?", "That's not right yet. Can you tell me how you got 72?"],
    ["That's correct, so what is 8 x 9?", "That's not right yet. What is 8 x 9?"],
    ["Well, that's correct, so what's next?", "That's not right yet. What's next?"],
    ["That's correct — ready for the next one?", "That's not right yet. Ready for the next one?"],
    ["You've got it, haven't you?", "That's not right yet. Haven't you?"],
    // The student's answer, or "that answer", as the subject.
    ["72 is correct!", "That's not right yet."],
    ["Your answer of 72 is correct.", "That's not right yet."],
    ["Yes 72 is right", "That's not right yet."],
    ["**72** is correct, well done.", "That's not right yet."],
    ["That answer is correct.", "That's not right yet."],
    ["This answer is right!", "That's not right yet."],
    // Leading emoji and marks.
    ["🎉 Correct!", "That's not right yet."],
    ["✅ Correct", "That's not right yet."],
    ["💯 Now try 7 x 8.", "That's not right yet. Now try 7 x 8."],
    ["Correct! 🎉 Now try 7 x 8.", "That's not right yet. Now try 7 x 8."],
    ["Correct! 🎉", "That's not right yet."],
    // Common praise.
    ...["Great answer!", "Good answer!", "Awesome work!", "Amazing work!", "Super job!", "You did it!", "You solved it!", "You figured it out!",
      "That's great!", "Very good!", "Correct answer!", "That's spot-on!", "That's it!", "Exactly!", "Nailed it!", "Perfect!",
      "What a great answer!", "That's a great answer."].map((p) => [p, "That's not right yet."]),
    ["That's perfect, now try 7 x 8.", "That's not right yet. Now try 7 x 8."],
    // Spanish and French.
    ...["¡Muy bien!", "¡Correcto!", "¡Excelente!", "¡Bien hecho!", "Très bien !", "Bravo !", "C'est correct !"].map((p) => [p, "That's not right yet."]),
    ["¡Muy bien! Ahora intenta 7 x 8.", "That's not right yet. Ahora intenta 7 x 8."],
  ])("%j", (text, out) => {
    expect(each(text, wrong72)).toBe(out);
  });

  it("partly right: the wrong part's value is not praised, the right part's may be", () => {
    const o: ClaimFilterOptions = { verdict: "partly", masteryWritten: () => false, answer: { student: "62 and 72", key: "63; 72" } };
    expect(each("62 is correct. Now look at the first one again.", o)).toBe("That's partly right. Now look at the first one again.");
    expect(each("72 is correct, but check the first one.", o)).toBe("72 is correct, but check the first one.");
  });
});

describe("true and teaching sentences close to praise stay, on a wrong answer", () => {
  it.each([
    // About another of several answers.
    "You got the first one right, but the second one is wrong.",
    "Your first answer was correct, but the second is not.",
    "Great job on the first one, but the second one needs another look.",
    // Instructions and rules.
    "Let's make sure we multiply correctly.",
    "Make sure you multiply correctly.",
    "Make sure you did it right.",
    "You need to line the digits up correctly.",
    "A good answer shows the steps.",
    "It's great to check your work.",
    "Correct answer: 63.",
    "The correct answer is 63.",
    "63 is the right answer.",
    "Page 72 is correct: it has the table of 9s.",
    // The key, or another fact, named with a value.
    "8 x 9 = 72 is correct, but this question is 7 x 9.",
    "72 is 8 x 9, not 7 x 9.",
    "If 72 were right, 7 x 10 would be 81.",
    // Questions, and statements before them that claim nothing.
    "Good question! 6 x 8 is 48.",
    "Great question! Let's look at 7 x 9.",
    "Can you tell me how you got 72?",
    "Is 72 right? Let's check: 7 x 9 is 63.",
    "So, what did you do first?",
    "When you're ready, what is 7 x 9?",
    "Exactly how did you get 72?",
    "Exactly how did you get 72, and why?",
    "Right now, what is 7 x 9?",
    "That's it for this question: 7 x 9 is 63.",
    "You did it the long way, so let's try a shorter one.",
    "Bien, ahora intenta 7 x 9.",
    "Remember: 7 x 9 is 63. ⭐",
    "Not quite. Try again with 7 x 9 = 63 in mind.",
  ])("%j", (text) => {
    // Kept whole; a reply that has not said the verdict yet gets the line before it.
    expect([text, `${VERDICT_LINE.incorrect} ${text}`]).toContain(each(text, wrong72));
  });
});

describe("doubt of a right answer", () => {
  it.each([
    ["48 is wrong.", "That's right."],
    ["Not quite, can you try again?", "That's right."],
    ["That's right! Want to try again?", "That's right!"],
    ["¡Casi!", "That's right."],
    ["Pas tout à fait. 6 x 8 = 48.", "That's right. 6 x 8 = 48."],
  ])("%j is taken out", (text, out) => {
    expect(each(text, right48)).toBe(out);
  });

  it.each([
    "That's right! Now let's try again with 8 x 9.",
    "Great! Let's try it again with 8 x 9.",
    "That's right! Let's try again using a number line.",
    "That's right! Make sure you check your work next time.",
    "That's right! 46 is wrong because it is 2 short.",
  ])("%j stays", (text) => {
    expect(each(text, right48)).toBe(text);
  });
});

describe("mastery claims the first version let through", () => {
  it.each([
    "I can see you've mastered this!",
    "Let's mark it as mastered.",
    "You've got mastery of this.",
    "Now you can say you've mastered it!",
    "You've mastered this, haven't you?",
  ])("%j is taken out when nothing was saved", (claim) => {
    expect(run(`Nice thinking. ${claim} Want another one?`)).toBe("Nice thinking. Want another one?");
  });

  it.each([
    "Let's see how well you've mastered this.",
    "We'll see if you have mastered it in the quiz.",
    "Once you've mastered this, we'll move on.",
    "Do you think you've mastered it?",
  ])("%j stays", (text) => {
    expect(run(text)).toBe(text);
  });
});

describe("an ask_user.question card", () => {
  const choices = (...labels: string[]) => labels.map((label, i) => ({ label, value: `v${i}` }));

  it("its question is read like the reply, and the first claim taken out becomes the verdict line", () => {
    const f = new ReplyClaimFilter(wrong72);
    expect(f.card({ question: "Correct! Ready for the next one?", choices: choices("Yes!", "Not yet") }))
      .toEqual({ question: "That's not right yet. Ready for the next one?", choices: choices("Yes!", "Not yet") });
    expect(f.removed).toEqual([{ kind: "verdict", text: "Correct!" }]);
  });

  it("a label's claim is taken out with no line put in; the student's own short replies stay; an emptied label drops its choice", () => {
    const f = new ReplyClaimFilter(wrong72);
    const out = f.card({ question: "What next?", choices: [...choices("Great job, next one", "Correct ✅", "No"), { label: "Well done!", value: "w" }] }) as { choices: unknown };
    expect(out.choices).toEqual([{ label: "Next one", value: "v0" }, { label: "Correct ✅", value: "v1" }, { label: "No", value: "v2" }]);
  });

  it("shares the reply's state: no second verdict line, and a card left with no question is no card", () => {
    const f = new ReplyClaimFilter(wrong72);
    expect(f.push("Correct!") + f.flush()).toBe("That's not right yet.");
    expect(f.card({ question: "Well done! Next?", choices: choices("Yes", "No") })).toEqual({ question: "Next?", choices: choices("Yes", "No") });
    expect(f.card({ question: "Well done!", choices: choices("Yes", "No") })).toBeNull();
    expect(f.card({ question: "Which one next?", choices: choices("Great job!", "No") })).toBeNull();
  });

  it("a mastery claim in it is taken out on the check's opening turn too", () => {
    const f = new ReplyClaimFilter({ verdict: null, masteryWritten: () => false });
    expect(f.card({ question: "You've mastered this! Which topic next?", choices: choices("Sharing", "Times tables") }))
      .toEqual({ question: "Which topic next?", choices: choices("Sharing", "Times tables") });
  });

  it("outside a mastery check, or not shaped like a card, it is returned as it is", () => {
    const args = { question: "Correct! Ready?", choices: choices("Yes", "No") };
    expect(new ReplyClaimFilter({ verdict: null, masteryWritten: () => false, checkMastery: false }).card(args)).toBe(args);
    expect(new ReplyClaimFilter(wrong72).card({ question: 5 })).toEqual({ question: 5 });
  });
});

// ── A wrong answer the reply never calls wrong (B9 rerun 2, gemma4:e2b, 2026-11-14) ────────────────
// The app's verdict was right, but the reply re-explained, moved on, or answered another question, and
// after a tutor line that was often praise, silence reads as "fine". The first three replies are
// excerpts from that run; the rest are made up.

describe("on a wrong answer the reply does not call wrong, the child sees the verdict first", () => {
  const LINE = VERDICT_LINE.incorrect;

  it.each([
    "I see you are thinking about how to share things equally. If you have 12 cookies and 3 friends, how many does each friend get?",
    "You said a proton has no charge. Let's look at the parts of an atom again.",
    "The answer is 16.",
  ])("%j", (text) => {
    expect(each(text, wrong72)).toBe(`${LINE} ${text}`);
  });

  it("not when its first sentence says it, or the line already took a claim's place", () => {
    for (const text of ["That is not correct. 7 x 9 is 63.", "Not quite! Let's count by 9s.", "72 is wrong. Try 7 x 9 again.", "Can you try again?"]) {
      expect(each(text, wrong72), text).toBe(text);
    }
    expect(each("Great! Let's look at it again. Correct answers show the steps.", wrong72)).toBe(`${LINE} Let's look at it again. Correct answers show the steps.`);
  });

  it("decided at the first sentence shown: a reply that says it only later still opens with it", () => {
    expect(each("Let's look at 7 x 9 again. That is not correct.", wrong72)).toBe(`${LINE} Let's look at 7 x 9 again. That is not correct.`);
  });

  it("a first sentence taken out for a mastery claim does not count: the line leads what is shown", () => {
    expect(each("You have mastered this. Let's look at 7 x 9 again.", wrong72)).toBe(`${LINE} Let's look at 7 x 9 again.`);
  });

  it("before a heading, a list or a code fence, as its own paragraph", () => {
    expect(each("### Let's look again\n\nWhat is 7 x 9?", wrong72)).toBe(`${LINE}\n\n### Let's look again\n\nWhat is 7 x 9?`);
    expect(each("- 7 x 9 is 7 nines.\n- Count by 9s.", wrong72)).toBe(`${LINE}\n\n- 7 x 9 is 7 nines.\n- Count by 9s.`);
    expect(each("```\n7 x 9\n```\nWhat is it?", wrong72)).toBe(`${LINE}\n\n\`\`\`\n7 x 9\n\`\`\`\nWhat is it?`);
  });

  it("once per turn, across model calls", () => {
    const f = new ReplyClaimFilter(wrong72);
    const first = f.push("Let me check my notes.") + f.flush();
    const second = f.push(" Here is how 7 x 9 works.") + f.flush();
    expect(first + second).toBe(`${LINE} Let me check my notes. Here is how 7 x 9 works.`);
  });

  it("not on a right, partly right or unsure answer", () => {
    const text = "I see you are thinking about how to share things equally.";
    for (const verdict of ["correct", "partly", "unsure"] as const) expect(run(text, verdict)).toBe(text);
  });

  it("a reply with nothing in it shows nothing (the kernel's VERDICT_FALLBACK answers for it)", () => {
    expect(run("", "incorrect")).toBe("");
    expect(run("  \n", "incorrect")).toBe("  \n");
  });

  it("an ask_user.question card the child sees first leads with it; one after the reply's text does not, and labels never do", () => {
    const choices = [{ label: "56", value: "a" }, { label: "54", value: "b" }];
    const first = new ReplyClaimFilter(wrong72);
    expect(first.card({ question: "What is 7 x 8?", choices })).toEqual({ question: `${LINE} What is 7 x 8?`, choices });
    expect(first.push("Let's see.") + first.flush()).toBe("Let's see.");
    const after = new ReplyClaimFilter(wrong72);
    expect(after.push("Let's see.") + after.flush()).toBe(`${LINE} Let's see.`);
    expect(after.card({ question: "What is 7 x 8?", choices })).toEqual({ question: "What is 7 x 8?", choices });
  });

  it("a card that is not shown does not use the line up", () => {
    const f = new ReplyClaimFilter(wrong72);
    expect(f.card({ question: "What is 7 x 8?", choices: [{ label: "Great job!", value: "a" }, { label: "56", value: "b" }] })).toBeNull();
    expect(f.push("Let's see.") + f.flush()).toBe(`${LINE} Let's see.`);
  });
});

describe("the readers' gaps on B9 rerun 2", () => {
  it("praise for some of the answer is praise for a part: taken out on a wrong answer, kept on a partly right one", () => {
    expect(praises("You got some of the notes correct.")).toBe(false);
    expect(praises("You got some of the notes correct.", true)).toBe(true);
    expect(praises("Some of your answer is right.")).toBe(false);
    expect(praises("Some of your answer is right.", true)).toBe(true);
    expect(praises("Most of your steps were right.", true)).toBe(true);
    expect(praises("Some of the notes are not correct.", true)).toBe(false);
    expect(praises("Most of the time the right steps are the short ones.", true)).toBe(false);
    expect(each("You got some of the notes correct. Look at the last two again.", wrong72)).toBe(`${VERDICT_LINE.incorrect} Look at the last two again.`);
    expect(each("Some of your answer is right.", wrong72)).toBe(VERDICT_LINE.incorrect);
    const partly: ClaimFilterOptions = { verdict: "partly", masteryWritten: () => false };
    expect(each("Some of your answer is right. Look at the last two notes again.", partly)).toBe("Some of your answer is right. Look at the last two notes again.");
  });

  describe("one answer of two in one reply, on a wrong verdict", () => {
    // Two questions in one message are keyed together, "63; 72". The verdict is on both answers, so
    // "your first answer" is part of the answer being checked.
    const two: ClaimFilterOptions = { verdict: "incorrect", masteryWritten: () => false, answer: { student: "62 and 71", key: "63; 72" } };
    it.each([
      ["Your first answer is correct.", VERDICT_LINE.incorrect],
      ["The second one was right!", VERDICT_LINE.incorrect],
      ["You got the first one right, but the second one is wrong.", `${VERDICT_LINE.incorrect} The second one is wrong.`],
      ["Great job on the first one! Now look at 8 x 9.", `${VERDICT_LINE.incorrect} Now look at 8 x 9.`],
    ])("%j is praise", (text, out) => {
      expect(each(text, two)).toBe(out);
    });

    it("praises reads it so only when told the answer had several parts", () => {
      expect(praises("Your first answer is correct.")).toBe(false);
      expect(praises("Your first answer is correct.", true, null, true)).toBe(true);
      expect(praises("Your first answer is not correct.", true, null, true)).toBe(false);
      expect(praises("Make sure your first answer is correct.", true, null, true)).toBe(false);
    });

    it("one answer (\"first\" is an earlier question's) keeps it; with no key to tell, it is praise", () => {
      expect(each("Your first answer was correct, but this one is not.", wrong72)).toBe(`${VERDICT_LINE.incorrect} Your first answer was correct, but this one is not.`);
      expect(run("Your first answer is correct.", "incorrect")).toBe(VERDICT_LINE.incorrect);
    });

    it("on a partly right verdict it stays", () => {
      const o: ClaimFilterOptions = { ...two, verdict: "partly" };
      expect(each("Your first answer is correct, but look again at 8 x 9.", o)).toBe("Your first answer is correct, but look again at 8 x 9.");
    });
  });

  it.each([
    "Those notes are not correct.",
    "These answers aren't right.",
    "That is not the verb in that sentence.",
    "That is not the best description of a mammal.",
    "That's not a mammal.",
    "The word for 'cat' in Spanish is different.",
    "The answer is a little different.",
  ])("%j says the answer is wrong: no line is added", (text) => {
    expect(rejects(text)).toBe(true);
    expect(each(text, wrong72)).toBe(text);
  });

  it.each([
    "That's not the only way to do it.",
    "That's not a problem!",
    "That's not a bad start.",
    "These steps are not right for every number.",
    "The area of a square is different from the area of a rectangle.",
    "If the word is different, look it up.",
  ])("%j is not doubt: it stays on a right answer", (text) => {
    expect(rejects(text)).toBe(false);
    expect(each(`That's right! ${text}`, right48)).toBe(`That's right! ${text}`);
  });
});
