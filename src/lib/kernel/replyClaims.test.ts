import { describe, it, expect } from "vitest";
import { ReplyClaimFilter, filterReplyClaims, praises, rejects, claimsMastery, type ClaimFilterOptions } from "./replyClaims";
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
    for (const verdict of [null, "correct", "incorrect", "partly", "unsure"] as const) {
      for (const out of streamed(text, opts(verdict))) expect(out, String(verdict)).toBe(text);
    }
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
