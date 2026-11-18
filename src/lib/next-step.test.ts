import { describe, it, expect } from "vitest";
import { rankNextSteps, continueStep, type NextStepInput } from "./next-step";
import type { Course, Syllabus, QuizAttempt, Subtopic } from "../types";

const course = (over: Partial<Course> = {}): Course => ({
  id: "c1", title: "Fractions", topic: "fractions", current_level: 1, status: "active",
  generation_state: "completed", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...over,
});

const sub = (id: string, over: Partial<Subtopic> = {}): Subtopic => ({
  id, title: `Topic ${id}`, key_concepts: [], practice_type: "problems", mastered: false, ...over,
});

const syllabus = (subtopics: Subtopic[]): Syllabus => ({
  id: "s1", course_id: "c1", level: 1, title: "Level 1", description: "", learning_objectives: [],
  subtopics, assessment_criteria: [], estimated_hours: 2, generated_at: "2026-06-01T00:00:00Z",
});

const attempt = (over: Partial<QuizAttempt> = {}): QuizAttempt => ({
  id: "a1", course_id: "c1", quiz_type: "quiz", level: 1, score: 90, total_questions: 5, correct_count: 4,
  time_limit_seconds: null, time_taken_seconds: 300, started_at: "2026-06-02T10:00:00Z", completed_at: "2026-06-02T10:05:00Z", ...over,
});

const base = (over: Partial<NextStepInput> = {}): NextStepInput => ({
  course: course(), level: 1, currentSyllabus: syllabus([sub("a"), sub("b"), sub("c")]),
  attempts: [], canRegenerate: false, canPromote: true, ...over,
});

describe("rankNextSteps", () => {
  it("with no plan for the level, offers to build it only when the caller can", () => {
    expect(rankNextSteps(base({ currentSyllabus: null, canRegenerate: true }))).toEqual([
      expect.objectContaining({ key: "generate", action: { kind: "regenerate" } }),
    ]);
    const [only] = rankNextSteps(base({ currentSyllabus: null }));
    expect(only.key).toBe("no-syllabus");
    expect(only.action).toBeUndefined();
  });

  it("a brand-new level: quiz first, then a lesson on the first untouched topic, then the tutor", () => {
    const keys = rankNextSteps(base()).map((s) => s.key);
    expect(keys).toEqual(["first-quiz", "lesson-a", "chat-a"]);
  });

  it("an unfinished course leads with 'finish building' in plain words, never the state id", () => {
    const steps = rankNextSteps(base({ course: course({ generation_state: "syllabus_L3" }) }));
    expect(steps[0].key).toBe("resume");
    expect(steps[0].blurb).toContain("Level 3");
    expect(steps[0].blurb).not.toContain("syllabus_L3");
  });

  it("offers the level test once nearly everything is learned and the last quiz was strong", () => {
    const steps = rankNextSteps(base({
      currentSyllabus: syllabus([sub("a", { mastered: true }), sub("b", { mastered: true }), sub("c", { practiced: true })]),
      attempts: [attempt({ score: 85 })],
    }));
    expect(steps[0]).toEqual(expect.objectContaining({ key: "promotion", action: { kind: "promotion" } }));
  });

  it("does not offer the level test when the caller is not on the current level", () => {
    const steps = rankNextSteps(base({
      currentSyllabus: syllabus([sub("a", { mastered: true }), sub("b", { mastered: true })]),
      attempts: [attempt({ score: 95 })],
      canPromote: false,
    }));
    expect(steps.map((s) => s.key)).not.toContain("promotion");
  });

  it("never offers the level test on a finished course, even when the caller says it can", () => {
    for (const status of ["completed", "archived"] as const) {
      const steps = rankNextSteps(base({
        course: course({ status, current_level: 6 }), level: 6,
        currentSyllabus: syllabus([sub("a", { mastered: true }), sub("b", { mastered: true })]),
        attempts: [attempt({ level: 6, score: 95 })],
      }));
      expect(steps.map((s) => s.key)).not.toContain("promotion");
    }
  });

  // Ported from TerraTutor #234: after a failed level test the step never says "ready to move up" while
  // the retake wait runs (the test screen would only show the wait).
  describe("after a level test at this level", () => {
    const ready = syllabus([sub("a", { mastered: true, review_needed: true }), sub("b", { mastered: true }), sub("c", { practiced: true })]);
    // Stored as SQLite's datetime('now'): UTC with no zone.
    const test = (over: Partial<QuizAttempt> = {}) => attempt({
      id: "t1", quiz_type: "promotion", score: 70, started_at: "2026-06-03 09:00:00", completed_at: "2026-06-03 09:30:00", passed: 0, ...over,
    });
    const at = (iso: string) => new Date(iso).getTime();

    it("failed and inside the retake wait: no 'ready to move up', but when it opens again and a practice quiz", () => {
      const steps = rankNextSteps(base({ currentSyllabus: ready, attempts: [test(), attempt({ score: 90 })], now: at("2026-06-03T14:00:00Z") }));
      const keys = steps.map((s) => s.key);
      expect(keys).not.toContain("promotion");
      expect(steps.some((s) => /ready to move up/i.test(s.title))).toBe(false);
      expect(steps[0]).toEqual(expect.objectContaining({ key: "retake-wait", action: { kind: "tab", tab: "quiz" } }));
      expect(steps[0].blurb).toContain("19h 30m");
      expect(keys).toContain("review-a");
      // Home's Continue takes the same step.
      expect(continueStep(steps)?.key).toBe("retake-wait");
    });

    it("failed, once the wait is over: ready again", () => {
      const steps = rankNextSteps(base({ currentSyllabus: ready, attempts: [test(), attempt({ score: 90 })], now: at("2026-06-04T09:31:00Z") }));
      expect(steps[0].key).toBe("promotion");
    });

    it("from before migration 18 (passed NULL): under the bar starts the wait, as the test screen reads it", () => {
      const now = at("2026-06-03T14:00:00Z");
      expect(rankNextSteps(base({ currentSyllabus: ready, attempts: [test({ passed: null, score: 70 }), attempt()], now }))[0].key).toBe("retake-wait");
      expect(rankNextSteps(base({ currentSyllabus: ready, attempts: [test({ passed: null, score: 90 }), attempt()], now }))[0].key).toBe("promotion");
    });

    it("waiting for its written answers to be marked: says so, never 'ready to move up'", () => {
      const steps = rankNextSteps(base({
        currentSyllabus: ready, attempts: [test({ passed: null }), attempt({ score: 90 })], testWaitingForMarks: true, now: at("2026-06-03T14:00:00Z"),
      }));
      expect(steps[0]).toEqual(expect.objectContaining({ key: "test-marking", action: { kind: "promotion" } }));
      expect(steps.map((s) => s.key)).not.toContain("promotion");
      expect(steps.map((s) => s.key)).not.toContain("retake-wait");
    });

    it("a stopped test (never finished) or one at another level changes nothing", () => {
      const now = at("2026-06-03T14:00:00Z");
      expect(rankNextSteps(base({ currentSyllabus: ready, attempts: [test({ completed_at: null, passed: null }), attempt()], now }))[0].key).toBe("promotion");
      expect(rankNextSteps(base({ currentSyllabus: ready, attempts: [test({ level: 2 }), attempt()], now }))[0].key).toBe("promotion");
    });
  });

  it("a topic flagged for review points at the tutor with that topic seeded", () => {
    const steps = rankNextSteps(base({
      currentSyllabus: syllabus([sub("a", { mastered: true, review_needed: true }), sub("b", { practiced: true })]),
      attempts: [attempt({ score: 60 })],
    }));
    const review = steps.find((s) => s.key === "review-a");
    expect(review?.action).toEqual({ kind: "tab", tab: "chat", opts: { seedTopic: "Topic a" } });
  });

  it("only counts completed quizzes at this level as attempts", () => {
    const steps = rankNextSteps(base({
      attempts: [attempt({ level: 2 }), attempt({ completed_at: null, score: null }), attempt({ quiz_type: "promotion" })],
    }));
    expect(steps[0].key).toBe("first-quiz");
  });

  it("never returns more than three", () => {
    expect(rankNextSteps(base({ course: course({ generation_state: "researching" }) })).length).toBeLessThanOrEqual(3);
  });
});

describe("continueStep", () => {
  it("skips the actionless 'finish building' row for the Continue button", () => {
    const steps = rankNextSteps(base({ course: course({ generation_state: "syllabus_L2" }) }));
    expect(continueStep(steps)?.key).toBe("first-quiz");
  });

  it("falls back to the first row when nothing is actionable, and null when empty", () => {
    expect(continueStep(rankNextSteps(base({ currentSyllabus: null })))?.key).toBe("no-syllabus");
    expect(continueStep([])).toBeNull();
  });
});
