import { describe, it, expect } from "vitest";
import quizScreen from "../views/QuizFullScreen.tsx?raw";
import testScreen from "../views/PromotionTestFullScreen.tsx?raw";
import { answerMark, uncheckedSummary, UNCHECKED_NOTE } from "./quiz-grading";

// A written answer no model checked (graded_by 'fallback': no local model, or the grader failed) still
// counts as right, so a grader hiccup never fails a learner. It must not look like an answer that was
// checked and found right: on the results screens it used to get the same green tick, with nothing to
// say it was never checked.

describe("answerMark", () => {
  it("is 'unchecked' for an answer passed without a check, whatever is_correct says", () => {
    expect(answerMark({ is_correct: true, graded_by: "fallback" })).toBe("unchecked");
  });
  it("is 'right' or 'wrong' for every answer something checked", () => {
    for (const by of ["key", "exact", "model", undefined, null] as const) {
      expect(answerMark({ is_correct: true, graded_by: by })).toBe("right");
      expect(answerMark({ is_correct: false, graded_by: by })).toBe("wrong");
    }
    expect(answerMark({ is_correct: false, graded_by: "unanswered" })).toBe("wrong");
  });
});

describe("uncheckedSummary", () => {
  it("says nothing when every answer was checked", () => {
    expect(uncheckedSummary(0)).toBeNull();
  });
  it("counts the unchecked answers and says they count as right", () => {
    expect(uncheckedSummary(1)).toBe("1 written answer was not checked. It counts as right.");
    expect(uncheckedSummary(3)).toBe("3 written answers were not checked. They count as right.");
  });
  it("the per-answer note says the same", () => {
    expect(UNCHECKED_NOTE).toMatch(/not checked/i);
    expect(UNCHECKED_NOTE).toMatch(/counts as right/i);
  });
});

describe("the results screens mark unchecked answers apart", () => {
  for (const [name, raw] of [["QuizFullScreen", quizScreen], ["PromotionTestFullScreen", testScreen]] as const) {
    const s = raw.replace(/\r\n?/g, "\n");
    it(`${name} keeps how each answer was graded and draws each row from answerMark`, () => {
      expect(s).toMatch(/graded_by: o\.by/);
      expect(s).toMatch(/answerMark\(q\)/);
      expect(s).toContain("UNCHECKED_NOTE");
      expect(s).toContain("uncheckedSummary(");
      // No row picks its tick from is_correct alone any more.
      expect(s).not.toMatch(/\{q\.is_correct \? "✓" : "✗"\}/);
    });
  }
});
