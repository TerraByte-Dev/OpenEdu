import { describe, it, expect } from "vitest";
import { levelTestResult, testUncheckedSummary, selfCheckIntro, TEST_UNCHECKED_NOTE, stopTestBody, testMakingNote, MAKING, levelTestExpectLines, levelTestFailLine, fewerQuestionsLine, type TestAnswer } from "./level-test";
import { levelTestTarget } from "./quiz";
import testScreen from "../views/PromotionTestFullScreen.tsx?raw";

// A written answer no model checked must not count toward passing a level test until someone marks it.
// The result waits for the marks only when they could change it.

const right = (section: TestAnswer["section"] = "current"): TestAnswer => ({ section, is_correct: true, graded_by: "key" });
const wrong = (section: TestAnswer["section"] = "current"): TestAnswer => ({ section, is_correct: false, graded_by: "model" });
const unchecked = (section: TestAnswer["section"] = "current"): TestAnswer => ({ section, is_correct: true, graded_by: "fallback" });
const n = <T,>(k: number, f: () => T) => Array.from({ length: k }, f);

describe("levelTestResult", () => {
  it("passes when every answer was checked and the bar is met", () => {
    const r = levelTestResult([...n(17, () => right()), ...n(3, () => wrong())]);
    expect(r).toMatchObject({ status: "passed", overall: 85, correct: 17, total: 20, unchecked: 0, reviewPct: null });
  });

  it("an unchecked answer does not count as right in the score", () => {
    const r = levelTestResult([...n(16, () => right()), ...n(2, () => unchecked()), ...n(2, () => wrong())]);
    expect(r.overall).toBe(80);
    expect(r.correct).toBe(16);
    expect(r.unchecked).toBe(2);
  });

  it("waits when the unchecked answers could still pass or fail it", () => {
    // 16 right + 2 unchecked of 20: 80% if both are wrong, 90% if both are right.
    const r = levelTestResult([...n(16, () => right()), ...n(2, () => unchecked()), ...n(2, () => wrong())]);
    expect(r.status).toBe("pending");
  });

  it("passes at once when it passes even if every unchecked answer is wrong", () => {
    const r = levelTestResult([...n(18, () => right()), unchecked(), wrong()]);
    expect(r.status).toBe("passed");
    expect(r.overall).toBe(90);
  });

  it("fails at once when it fails even if every unchecked answer is right", () => {
    const r = levelTestResult([...n(10, () => right()), ...n(2, () => unchecked()), ...n(8, () => wrong())]);
    expect(r.status).toBe("failed");
    expect(r.overall).toBe(50);
  });

  it("the review section counts too: unchecked review answers can hold the result", () => {
    // Overall passes even if all unchecked are wrong (18/20 = 90%), but review is 1/2 = 50% then, and
    // 2/2 if the unchecked review answer is right.
    const r = levelTestResult([...n(17, () => right()), right("review"), unchecked("review"), wrong()]);
    expect(r.status).toBe("pending");
    expect(r.reviewPct).toBe(50);
  });

  it("fails on the review section even with a high overall score", () => {
    const r = levelTestResult([...n(18, () => right()), wrong("review"), wrong("review")]);
    expect(r).toMatchObject({ status: "failed", overall: 90, reviewPct: 0 });
  });

  it("a mark by the learner counts as checked", () => {
    const r = levelTestResult([...n(16, () => right()), { section: "current", is_correct: true, graded_by: "self" }, { section: "current", is_correct: false, graded_by: "self" }, ...n(2, () => wrong())]);
    expect(r).toMatchObject({ status: "passed", overall: 85, correct: 17, unchecked: 0 });
  });

  it("an empty test fails", () => {
    expect(levelTestResult([]).status).toBe("failed");
  });
});

describe("level-test wording", () => {
  it("says unchecked answers do not count toward the test, singular and plural", () => {
    expect(testUncheckedSummary(0)).toBeNull();
    expect(testUncheckedSummary(1)).toBe("1 written answer was not checked. It does not count toward this test.");
    expect(testUncheckedSummary(3)).toBe("3 written answers were not checked. They do not count toward this test.");
    expect(TEST_UNCHECKED_NOTE).toMatch(/does not count toward this test/);
    expect(TEST_UNCHECKED_NOTE).not.toMatch(/counts as right/);
  });
  it("asks the learner to mark each answer against the key", () => {
    expect(selfCheckIntro(1)).toMatch(/^No model on this computer could check 1 of your written answers\./);
    expect(selfCheckIntro(4)).toMatch(/4 of your written answers/);
    expect(selfCheckIntro(4)).toMatch(/once every one is marked/);
  });
  it("says what stopping a begun test does: not scored, no level change, no wait, and the kept answers only with an answer", () => {
    for (const n of [0, 1, 12]) {
      expect(stopTestBody(n)).toMatch(/will not be scored and will not change your level/);
      expect(stopTestBody(n)).toMatch(/There is no wait/);
    }
    expect(stopTestBody(0)).not.toMatch(/answers you gave/);
    expect(stopTestBody(1)).toMatch(/answers you gave are kept, and ones you missed may come back in a quiz/);
  });
  it("says making the test is slow on a slower computer and can be stopped, with no made-up timing", () => {
    expect(testMakingNote(45)).toMatch(/about 45 questions, one at a time/);
    expect(testMakingNote(45)).toMatch(/can stop/);
    expect(testMakingNote(45)).not.toMatch(/\d+\s*(min|hour|second)/);
    expect(MAKING.canStop).toMatch(/no wait/);
  });
});

// A Level 1 test (no earlier levels, so no review section) said "~25% previous level review",
// "60% on review questions", "~45" questions, and "fewer than usual" at 35 of 45, the most it can make.
// Port of TerraByte-Dev/TerraTutor#242.
describe("a level test's copy follows whether it has a review section", () => {
  it("with a review section: the parts and both bars", () => {
    const lines = levelTestExpectLines(true).join("\n");
    expect(lines).toMatch(/previous level review/);
    expect(lines).toMatch(/85% overall and 60% on review questions/);
  });
  it("with none (Level 1): no review section and no review bar", () => {
    const lines = levelTestExpectLines(false).join("\n");
    expect(lines).not.toMatch(/review questions|60%|25%/);
    expect(lines).toMatch(/All questions are on this level's material/);
    expect(lines).toMatch(/85% overall required to pass/);
  });
  it("a failed test names only the bars of the test that was taken", () => {
    expect(levelTestFailLine(true)).toBe("You need 85% overall and 60% on the review section. A 24-hour cooldown is now active.");
    expect(levelTestFailLine(false)).toBe("You need 85% overall. A 24-hour cooldown is now active.");
  });
  it("says fewer than usual only below the test's own target", () => {
    expect(fewerQuestionsLine(35, levelTestTarget(false))).toBeNull();
    expect(fewerQuestionsLine(34, levelTestTarget(false))).toBe("Generated 34 of 35 questions — your model produced fewer than usual this run.");
    expect(fewerQuestionsLine(35, levelTestTarget(true))).toBe("Generated 35 of 45 questions — your model produced fewer than usual this run.");
    expect(fewerQuestionsLine(45, levelTestTarget(true))).toBeNull();
  });
  it("PromotionTestFullScreen draws them from the level's own target, never a fixed 45 or fixed review lines", () => {
    const s = testScreen.replace(/\r\n?/g, "\n");
    expect(s).toContain("const hasReview = levelTestReviewLevels(previousSyllabuses).length > 0;");
    expect(s).toContain("const target = levelTestTarget(hasReview);");
    expect(s).toContain("levelTestExpectLines(hasReview)");
    expect(s).toContain("fewerQuestionsLine(questions.length, target)");
    expect(s).toContain("testMakingNote(target)");
    expect(s).toContain("(hasReview ? [1, 2] : [1])");
    expect(s).toContain("{levelTestFailLine(reviewScore !== null)}");
    expect(s).not.toMatch(/TEST_TOTAL_TARGET|~45|60% on (the )?review|85% overall/);
    // The result screen's review line reads the bar from PASS_REVIEW too.
    expect(s).not.toMatch(/reviewScore >= 60|need 60%/);
  });
});
