import { describe, it, expect } from "vitest";
import { mixedKey, notProof, proofFilter, replaySubtopics, skillKey } from "./replay";
import { emptySource, nov, question, quiz, sub } from "./test-rows";
import type { Subtopic } from "../../types";

const levels = (entries: Array<[number, Subtopic[]]>) => new Map(entries);
const L1 = levels([[1, [sub("1.1"), sub("1.2")]]]);

describe("replaySubtopics", () => {
  it("masters a skill at 9 of 10 and dates it by the attempt's finish", () => {
    const s = emptySource();
    quiz(s, "1.1", 9, 10, { completed_at: nov(4) });
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.state.get(skillKey(1, "1.1"))).toMatchObject({ practiced: true, mastered: true, review_needed: false });
    expect(r.checks).toEqual([expect.objectContaining({ skillId: "1.1", correct: 9, total: 10, at: nov(4), transitions: ["practiced", "mastered"] })]);
  });

  it("flags review again after a later 5 of 10, keeps it mastered, and clears it at 90% again", () => {
    const s = emptySource();
    quiz(s, "1.1", 10, 10, { completed_at: nov(4) });
    quiz(s, "1.1", 5, 10, { completed_at: nov(5) });
    let r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.state.get(skillKey(1, "1.1"))).toMatchObject({ mastered: true, review_needed: true });
    expect(r.checks[1].transitions).toEqual(["review_needed"]);
    quiz(s, "1.1", 9, 10, { completed_at: nov(6) });
    r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.state.get(skillKey(1, "1.1"))).toMatchObject({ mastered: true, review_needed: false });
    expect(r.checks[2].transitions).toEqual(["review_cleared"]);
  });

  it("applies attempts in the order they finished, not the order they are stored", () => {
    const s = emptySource();
    quiz(s, "1.1", 5, 10, { completed_at: nov(6) });
    quiz(s, "1.1", 10, 10, { completed_at: nov(4) });
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.checks.map((c) => c.transitions)).toEqual([["practiced", "mastered"], ["review_needed"]]);
  });

  it("counts a stored NULL grade as wrong, as the app does", () => {
    const s = emptySource();
    const a = quiz(s, "1.1", 9, 9, { completed_at: nov(4) });
    s.questions.push(question(a.id, "1.1", null, { question_type: "short_answer" }));
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.checks[0]).toMatchObject({ correct: 9, total: 10 });
    expect(r.checks[0].graders).toMatchObject({ key: 9, unknown: 1 });
  });

  it("ignores untagged questions and unfinished attempts", () => {
    const s = emptySource();
    quiz(s, null, 10, 10, { completed_at: nov(4) });
    quiz(s, "1.1", 10, 10, { completed_at: null });
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.checks).toEqual([]);
    expect(r.state.get(skillKey(1, "1.1"))).toMatchObject({ practiced: false, mastered: false });
  });

  it("keys a re-asked level-1 question by the level-3 attempt: ignored without a clash, credited to the level-3 skill with one", () => {
    const three = levels([[1, [sub("1.1")]], [3, [sub("3.1")]]]);
    const s = emptySource();
    quiz(s, "1.1", 3, 3, { level: 3, completed_at: nov(4) });
    let r = replaySubtopics(s.attempts, s.questions, three);
    expect(r.checks).toEqual([]);
    expect(r.state.get(skillKey(1, "1.1"))!.practiced).toBe(false);

    // The model reused "1.1" as a level-3 id: the app credits the level-3 skill, and so does the replay.
    const clash = levels([[1, [sub("1.1")]], [3, [sub("1.1", "A level-3 skill")]]]);
    r = replaySubtopics(s.attempts, s.questions, clash);
    expect(r.state.get(skillKey(3, "1.1"))!.mastered).toBe(true);
    expect(r.state.get(skillKey(1, "1.1"))!.mastered).toBe(false);
  });
});

describe("proofFilter", () => {
  it("never takes an answer the grader failed on as proof, even 1 of 1", () => {
    const s = emptySource();
    quiz(s, "1.1", 1, 1, { completed_at: nov(4) }, { question_type: "short_answer", graded_by: "fallback" });
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.checks[0].transitions).toContain("mastered");
    expect(notProof(r.checks[0])).toBe("fallback");
    expect(proofFilter(r.checks)).toEqual([]);
  });

  it("never takes a level test that stored fewer rows than its questions (timed out before migration 18) as proof", () => {
    const s = emptySource();
    const a = quiz(s, "1.1", 9, 9, { quiz_type: "promotion", completed_at: nov(4) });
    a.total_questions = 12;
    const r = replaySubtopics(s.attempts, s.questions, L1);
    expect(r.state.get(skillKey(1, "1.1"))!.mastered).toBe(true); // state is the app's; only proof is withheld
    expect(notProof(r.checks[0])).toBe("timed_out");
  });

  it("never takes a result the app also matched by keyword on the same attempt and skill as proof", () => {
    const s = emptySource();
    const a = quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
    const [check] = replaySubtopics(s.attempts, s.questions, L1).checks;
    expect(notProof(check, new Set([mixedKey(a.id, 1, "1.1")]))).toBe("mixed");
    expect(notProof(check, new Set([mixedKey(a.id, 1, "1.2")]))).toBeNull();
  });

  it("takes a full set of rows graded against the key as proof", () => {
    const s = emptySource();
    quiz(s, "1.1", 3, 3, { quiz_type: "promotion", completed_at: nov(4) }, { graded_by: "key" });
    expect(proofFilter(replaySubtopics(s.attempts, s.questions, L1).checks)).toHaveLength(1);
  });
});
