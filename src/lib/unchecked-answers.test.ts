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
      // A quiz says an unchecked answer counts as right; a level test says it does not count toward the test.
      expect(s).toContain(name === "QuizFullScreen" ? "{UNCHECKED_NOTE}" : "{TEST_UNCHECKED_NOTE}");
      expect(s).toMatch(name === "QuizFullScreen" ? /[^t]uncheckedSummary\(/ : /testUncheckedSummary\(/);
      // No row picks its tick from is_correct alone any more.
      expect(s).not.toMatch(/\{q\.is_correct \? "✓" : "✗"\}/);
    });
  }
});

describe("the level test decides with level-test.ts, never on its own", () => {
  const s = testScreen.replace(/\r\n?/g, "\n");
  it("saves the result through saveLevelTestResult and has no pass rule of its own", () => {
    expect(s).toContain("await saveLevelTestResult(aid, answered, timeTaken)");
    expect(s).not.toMatch(/>= 85 &&/);
    expect(s).not.toContain("completeQuizAttempt(");
    expect(s).not.toContain("setPromotionResult(");
  });
  it("stores each answer's section, and opens on the marking screen when the last test is waiting", () => {
    expect(s).toMatch(/"key", question\.section\)/);
    expect(s).toMatch(/"unanswered", q\.section\)/);
    expect(s).toContain("pendingLevelTestFor(last)");
    expect(s).toContain("settleLevelTest(pendingTest.attempt.id, marks, \"self\")");
  });
});
