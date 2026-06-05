import { describe, it, expect } from "vitest";
import { splitNewVsReview, storedToGenQuestion, pickReview, interleaveReview, type GenQuestion } from "./quiz-review";
import type { QuizQuestion } from "../types";

const gen = (text: string): GenQuestion => ({
  question_text: text,
  question_type: "multiple_choice",
  options: ["A) 1", "B) 2", "C) 3", "D) 4"],
  correct_answer: "A) 1",
  difficulty_level: 1,
  explanation: "because",
  subtopic_id: "1.1",
  matching_pairs: null,
  blank_position: null,
});

describe("splitNewVsReview", () => {
  it("reserves ~20% for review by default", () => {
    expect(splitNewVsReview(20, 100)).toEqual({ fresh: 16, review: 4 });
    expect(splitNewVsReview(10, 100)).toEqual({ fresh: 8, review: 2 });
  });

  it("caps review at what's actually available (graceful degrade)", () => {
    expect(splitNewVsReview(20, 1)).toEqual({ fresh: 19, review: 1 });
    expect(splitNewVsReview(20, 0)).toEqual({ fresh: 20, review: 0 }); // brand-new course
  });

  it("never exceeds total and handles zero/negative", () => {
    expect(splitNewVsReview(0, 50)).toEqual({ fresh: 0, review: 0 });
    expect(splitNewVsReview(-5, 50)).toEqual({ fresh: 0, review: 0 });
    const r = splitNewVsReview(3, 100);
    expect(r.fresh + r.review).toBe(3);
  });

  it("respects a custom ratio", () => {
    expect(splitNewVsReview(10, 100, 0.5)).toEqual({ fresh: 5, review: 5 });
  });
});

describe("storedToGenQuestion", () => {
  it("strips DB/runtime fields and drops the old self-explanation", () => {
    const stored: QuizQuestion = {
      id: "q1",
      attempt_id: "a1",
      question_text: "What is 2+2?",
      question_type: "multiple_choice",
      options: ["A) 4", "B) 5"],
      correct_answer: "A) 4",
      user_answer: "B) 5",
      is_correct: false,
      difficulty_level: 2,
      explanation: "addition",
      subtopic_id: "1.2",
      matching_pairs: null,
      blank_position: null,
      self_explanation: "I guessed",
    };
    const g = storedToGenQuestion(stored);
    expect(g).not.toHaveProperty("id");
    expect(g).not.toHaveProperty("attempt_id");
    expect(g).not.toHaveProperty("user_answer");
    expect(g).not.toHaveProperty("is_correct");
    expect(g.question_text).toBe("What is 2+2?");
    expect(g.self_explanation).toBeNull();
  });
});

describe("pickReview", () => {
  it("takes the first n, newest-first", () => {
    const pool = [gen("a"), gen("b"), gen("c")];
    expect(pickReview(pool, 2).map((q) => q.question_text)).toEqual(["a", "b"]);
    expect(pickReview(pool, 0)).toEqual([]);
    expect(pickReview(pool, 99)).toHaveLength(3);
  });
});

describe("interleaveReview", () => {
  it("preserves every item exactly once (length = fresh + review)", () => {
    const fresh = [gen("f1"), gen("f2"), gen("f3"), gen("f4")];
    const review = [gen("r1"), gen("r2")];
    const out = interleaveReview(fresh, review);
    expect(out).toHaveLength(6);
    const texts = out.map((q) => q.question_text).sort();
    expect(texts).toEqual(["f1", "f2", "f3", "f4", "r1", "r2"]);
  });

  it("spreads review items rather than clustering them", () => {
    const fresh = Array.from({ length: 8 }, (_, i) => gen(`f${i}`));
    const review = [gen("r1"), gen("r2")];
    const out = interleaveReview(fresh, review);
    const positions = out.map((q, i) => (q.question_text.startsWith("r") ? i : -1)).filter((i) => i >= 0);
    // The two review items should not be adjacent at the very start.
    expect(positions[1] - positions[0]).toBeGreaterThan(1);
  });

  it("returns a copy of the other list when one side is empty", () => {
    const fresh = [gen("f1")];
    expect(interleaveReview(fresh, [])).toEqual(fresh);
    expect(interleaveReview([], fresh)).toEqual(fresh);
  });
});
