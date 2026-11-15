import { describe, it, expect } from "vitest";
import { levelTestResult, testUncheckedSummary, selfCheckIntro, TEST_UNCHECKED_NOTE, type TestAnswer } from "./level-test";

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
});
