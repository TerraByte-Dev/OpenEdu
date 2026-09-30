import { describe, it, expect } from "vitest";
import { applySubtopicScore, resolveSubtopic } from "./mastery";
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

describe("resolveSubtopic", () => {
  const subs = [
    base({ id: "1.1", title: "Loops" }),
    base({ id: "1.2", title: "Nested Loops" }),
    base({ id: "1.3", title: "List Comprehensions" }),
    base({ id: "1.4", title: "Dict Comprehensions" }),
  ];
  const ids = (r: ReturnType<typeof resolveSubtopic>) =>
    r.kind === "match" ? [r.sub.id] : r.kind === "ambiguous" ? r.candidates.map((s) => s.id) : [];

  it.each([
    ["blank", "", "none", []],
    ["whitespace", "   ", "none", []],
    ["exact id", "1.3", "match", ["1.3"]],
    ["padded id", " 1.1 ", "match", ["1.1"]],
    ["exact title, mixed case", "lIsT cOmPrEhEnSiOnS", "match", ["1.3"]],
    ["exact title wins before containment", "loops", "match", ["1.1"]],
    ["unique fragment", "dict", "match", ["1.4"]],
    ["fragment shared by two titles", "comprehensions", "ambiguous", ["1.3", "1.4"]],
    ["sentence containing exactly one title", "the student has clearly got list comprehensions down", "match", ["1.3"]],
    ["no match", "recursion", "none", []],
  ])("%s", (_label, ref, kind, expected) => {
    const r = resolveSubtopic(subs, ref);
    expect(r.kind).toBe(kind);
    expect(ids(r)).toEqual(expected);
  });

  it("treats two identical titles as ambiguous", () => {
    const dupes = [base({ id: "2.1", title: "Recursion" }), base({ id: "2.2", title: "recursion" })];
    expect(ids(resolveSubtopic(dupes, "Recursion"))).toEqual(["2.1", "2.2"]);
  });

  it("treats a sentence containing two titles as ambiguous", () => {
    expect(resolveSubtopic(subs, "they know dict comprehensions and list comprehensions").kind).toBe("ambiguous");
  });
});
