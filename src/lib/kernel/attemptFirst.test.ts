import { describe, it, expect } from "vitest";
import { FIRST_TURN_HOLD_NOTE, posesNewProblem, isFirstTurnHold, withFirstTurnHold } from "./attemptFirst";

// Made-up problems. Nothing here comes from an eval item.
const STEM = "A pond has 14 frogs. 5 hop away and 3 more arrive. How many frogs are in the pond?";
const LISTED = `${STEM}\n\nA) 12\nB) 22\nC) 6\nD) 11\n\nWhich one is right?`;

describe("posesNewProblem", () => {
  it("sees a problem with a lettered option list and no try", () => {
    for (const text of [
      LISTED,
      `${STEM}\nA. 12\nB. 22\nC. 6\nD. 11`,
      `${STEM}\n(A) 12\n(B) 22\n(C) 6\n(D) 11\nWhich is it?`,
      `${STEM}\n- A: 12\n- B: 22\n- C: 6`,
      `${STEM}\n**A)** 12\n**B)** 22\n**C)** 6\n**D)** 11`,
      `${STEM} A) 12 B) 22 C) 6 D) 11`,
      `${STEM}\nA) 12\nB) 22\nC) 6\nD) 11\nI don't get it. Which one?`,
      // Words a try would use, but inside the problem or the options, not after them.
      `I think this one is hard. ${STEM}\nA) 12\nB) 22\nC) 6\nD) I think 11`,
      `${STEM}\nA) 12\nB) 22\nC) 6\nD) 11\nIs option A or B closer?`,
    ]) {
      expect(posesNewProblem(text), text).toBe(true);
    }
  });

  it("does not see a try written after the options", () => {
    for (const tail of ["I think it's B.", "Is it C?", "My answer is 12.", "I got 22", "It's D", "I'd say A", "I picked B, is that right?", "I’m going with C"]) {
      expect(posesNewProblem(`${LISTED}\n${tail}`), tail).toBe(false);
    }
  });

  it("does not see a problem without a lettered list of at least A, B and C in order", () => {
    for (const text of [
      STEM,
      "What is 36 × 7?",
      "I think it's C.",
      "Show me the full worked answer.",
      `${STEM}\nA) 12\nB) 22`, // two options
      `${STEM}\nB) 22\nC) 6\nD) 11`, // does not start at A
      `${STEM}\nA) 12\nC) 6\nD) 11`, // not in order
      "Plan B. Then plan C. A. Lincoln wrote it.",
      "The answer is A. Then B. Then C.",
      "",
    ]) {
      expect(posesNewProblem(text), text).toBe(false);
    }
  });
});

describe("isFirstTurnHold", () => {
  const tutor = (content: string) => ({ role: "assistant", content });
  const student = (content: string) => ({ role: "user", content });

  it("holds when the newest message is the student's and poses a new problem, whatever came before", () => {
    expect(isFirstTurnHold([student(LISTED)])).toBe(true);
    expect(isFirstTurnHold([student("What is 2 + 2?"), tutor("What do you get when you count on 2 from 2?"), student(LISTED)])).toBe(true);
  });

  it("does not hold on a try, a request, or when the newest message is not the student's", () => {
    expect(isFirstTurnHold([student(LISTED), tutor("Start with the frogs that left. How many are left?"), student("I think it's A.")])).toBe(false);
    expect(isFirstTurnHold([student(LISTED), tutor("How many are left?"), student("Give me a hint.")])).toBe(false);
    expect(isFirstTurnHold([student(LISTED), tutor("How many are left?")])).toBe(false);
    expect(isFirstTurnHold([])).toBe(false);
  });
});

describe("the hold note", () => {
  it("goes after the student's text, separated by a blank line", () => {
    expect(withFirstTurnHold(LISTED)).toBe(`${LISTED}\n\n${FIRST_TURN_HOLD_NOTE}`);
  });

  it("is plain LF text, so a Windows checkout sends the model the same bytes as Linux", () => {
    expect(FIRST_TURN_HOLD_NOTE).not.toContain("\r");
    expect(FIRST_TURN_HOLD_NOTE.startsWith("<tutor_note>\n")).toBe(true);
    expect(FIRST_TURN_HOLD_NOTE.endsWith("\n</tutor_note>")).toBe(true);
  });

  it("says to hold the answer, overrides answer-first, and asks for one question that invites a try", () => {
    expect(FIRST_TURN_HOLD_NOTE).toContain("has not tried it yet");
    expect(FIRST_TURN_HOLD_NOTE).toContain("do not say which option is right");
    expect(FIRST_TURN_HOLD_NOTE).toContain("do not work it out to its result");
    expect(FIRST_TURN_HOLD_NOTE).toContain("do not rule options in or out");
    expect(FIRST_TURN_HOLD_NOTE).toContain("This replaces any rule to answer the student's question first.");
    expect(FIRST_TURN_HOLD_NOTE).toContain("end with one question that asks the student to try");
  });
});
