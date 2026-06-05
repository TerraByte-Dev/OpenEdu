import { describe, it, expect } from "vitest";
import { applySubtopicScore } from "./mastery";
import type { Subtopic } from "../types";

const base = (over: Partial<Subtopic> = {}): Subtopic => ({
  id: "1.1",
  title: "Variables",
  key_concepts: [],
  practice_type: "recall",
  mastered: false,
  ...over,
});

describe("applySubtopicScore", () => {
  it("is a no-op (same reference) when no questions were seen", () => {
    const sub = base();
    expect(applySubtopicScore(sub, 0, 0)).toBe(sub);
  });

  it("marks practiced after at least one question", () => {
    expect(applySubtopicScore(base(), 0, 3).practiced).toBe(true);
  });

  it("marks mastered at >=90% and stays sticky", () => {
    expect(applySubtopicScore(base(), 9, 10).mastered).toBe(true);
    expect(applySubtopicScore(base(), 10, 10).mastered).toBe(true);
    expect(applySubtopicScore(base(), 8, 10).mastered).toBe(false);
  });

  it("never demotes a mastered subtopic, but flags it for review on a slip", () => {
    const mastered = base({ mastered: true, practiced: true });
    const next = applySubtopicScore(mastered, 2, 4); // 50% — a slip
    expect(next.mastered).toBe(true);
    expect(next.review_needed).toBe(true);
  });

  it("clears review_needed once solid again", () => {
    const flagged = base({ mastered: true, practiced: true, review_needed: true });
    const next = applySubtopicScore(flagged, 3, 3); // 100%
    expect(next.review_needed).toBe(false);
    expect(next.mastered).toBe(true);
  });

  it("does not flag a freshly-mastered subtopic for review", () => {
    const next = applySubtopicScore(base(), 10, 10);
    expect(next.mastered).toBe(true);
    expect(next.review_needed).toBeFalsy();
  });

  it("returns a new object only when something changed", () => {
    const solid = base({ mastered: true, practiced: true });
    expect(applySubtopicScore(solid, 10, 10)).toBe(solid); // already mastered, full marks → no change
  });
});
