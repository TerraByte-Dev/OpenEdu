import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// What a finished quiz or level test saves (finish-effects.ts saveFinishEffects), and the same brought into
// line when a hand mark changes an answer later (recountAfterMarks, run by markAgain and settleLevelTest).
// Through the real migrations and db.ts writes, on the in-memory SQLite stand-in the level test checks use:
// each attempt is saved the way the screens save it, then marked again the way the results screen does.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;

const bind = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string, params: unknown[] = []) => sqlite.prepare(bind(sql)).all(...params),
      execute: async (sql: string, params: unknown[] = []) => { sqlite.prepare(bind(sql)).run(...params); },
    }),
  },
}));

import {
  setActiveLearnerId, createPromotionAttempt, createQuizAttempt, saveQuizQuestion, updateQuizQuestionGrade,
  completeQuizAttempt, getQuizAttempt, getTutorInstructions, saveTutorInstruction,
} from "./db";
import { saveLevelTestResult, settleLevelTest } from "./level-test-checks";
import { markAgain } from "./written-answer-checks";
import { saveFinishEffects } from "./finish-effects";
import { addStudyPlanToLog } from "./knowledge";
import { DEFAULT_LEARNER_ID } from "./learners";
import type { TestAnswer } from "./level-test";
import type { GradedBy } from "./quiz-grading";
import type { Subtopic } from "../types";

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const all = migrations();
  for (let v = 1; v <= 20; v++) sqlite.exec(all.get(v)!);
  setActiveLearnerId(null);
  sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2, '${DEFAULT_LEARNER_ID}');`);
  const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });
  sqlite.prepare("INSERT INTO syllabuses (id, course_id, level, title, subtopics) VALUES ('s2', 'c1', 2, 'Level 2', ?1)")
    .run(JSON.stringify([sub("2.1", "Fractions"), sub("2.2", "Decimals")]));
}

const rows = <T,>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];

// One answer: its skill, right or wrong, and how it was marked. Written answers ('model', 'fallback') are
// graded at finish; the others by the key as they are given.
type Spec = { skill: string; correct: boolean; by: GradedBy };
const R = (skill: string): Spec => ({ skill, correct: true, by: "key" });
const W = (skill: string): Spec => ({ skill, correct: false, by: "key" });
const M = (skill: string): Spec => ({ skill, correct: false, by: "model" }); // the model marked it wrong
const U = (skill: string): Spec => ({ skill, correct: true, by: "fallback" }); // no model checked it
const many = (k: number, s: Spec) => Array.from({ length: k }, () => s);

type Taken = { attemptId: string; ids: string[]; entry: string };

async function saveRows(attemptId: string, name: string, specs: Spec[]): Promise<{ ids: string[]; answered: Array<{ question_text: string; correct_answer: string; explanation: string; subtopic_id: string; is_correct: boolean }> }> {
  const ids: string[] = [];
  const answered = [];
  for (const [i, s] of specs.entries()) {
    const written = s.by !== "key";
    const q = { question_text: `${name} Q${i}`, correct_answer: `key ${i}`, explanation: `why ${i}`, subtopic_id: s.skill };
    const id = await saveQuizQuestion({
      attempt_id: attemptId, ...q, question_type: written ? "short_answer" : "multiple_choice",
      options: null, user_answer: `answer ${i}`, is_correct: written ? null : s.correct, difficulty_level: 1,
    }, written ? null : "key", "current");
    if (written) await updateQuizQuestionGrade(id, s.correct, s.by);
    ids.push(id);
    answered.push({ ...q, is_correct: s.correct });
  }
  return { ids, answered };
}

/** A level test finished the way PromotionTestFullScreen finishes it. */
async function takeTest(name: string, specs: Spec[]): Promise<Taken> {
  const attempt = await createPromotionAttempt("c1", 2, specs.length, 2700);
  const { ids, answered } = await saveRows(attempt.id, name, specs);
  const result = await saveLevelTestResult(attempt.id, specs.map((s): TestAnswer => ({ section: "current", is_correct: s.correct, graded_by: s.by })), 600);
  const entry = await saveFinishEffects("c1", 2, attempt.id, true, answered, result.overall);
  return { attemptId: attempt.id, ids, entry };
}

/** A quiz finished the way QuizFullScreen finishes it, at a given time so the order of attempts is known. */
async function takeQuiz(name: string, specs: Spec[], at: string): Promise<Taken> {
  const attempt = await createQuizAttempt("c1", "quiz", 2, specs.length);
  const { ids, answered } = await saveRows(attempt.id, name, specs);
  const correct = specs.filter((s) => s.correct).length;
  const pct = (correct / specs.length) * 100;
  await completeQuizAttempt(attempt.id, pct, correct, 300);
  sqlite.prepare("UPDATE quiz_attempts SET started_at = ?1, completed_at = ?1 WHERE id = ?2").run(at, attempt.id);
  const entry = await saveFinishEffects("c1", 2, attempt.id, false, answered, pct);
  return { attemptId: attempt.id, ids, entry };
}

const skills = () => Object.fromEntries((JSON.parse(rows<{ subtopics: string }>("SELECT subtopics FROM syllabuses WHERE id = 's2'")[0].subtopics) as Subtopic[])
  .map((s) => [s.id, { mastered: !!s.mastered, practiced: !!s.practiced, review_needed: !!s.review_needed }]));
const cards = () => rows<{ front: string }>("SELECT front FROM flashcards WHERE course_id = 'c1' ORDER BY front").map((c) => c.front);
const knowledge = async () => { const k = await getTutorInstructions("c1"); return { log: k.study_log ?? "", map: k.knowledge_map ?? "", context: k.progress_context ?? "" }; };
const gaps = () => JSON.parse(rows<{ knowledge_gaps: string }>("SELECT knowledge_gaps FROM user_progress WHERE course_id = 'c1'")[0].knowledge_gaps) as string[];

/** Everything the finish saves, to compare a marked attempt with one that had the mark from the start. */
async function saved() {
  return { skills: skills(), cards: cards(), ...(await knowledge()), gaps: gaps() };
}

describe("a hand mark brings what the finish saved into line", () => {
  beforeEach(openDb);

  it("a level test the mark passes: mastery, flashcards, progress and the study log as if the mark had been there at the finish", async () => {
    // Fractions 4 right + 1 the model marked wrong (80%, not mastered); Decimals 12 right + 3 wrong.
    // 16 of 20 = 80%, failed; marked right, 17 of 20 = 85%, passed, and Fractions is 5 of 5.
    const t = await takeTest("T", [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    expect(skills()["2.1"]).toEqual({ mastered: false, practiced: true, review_needed: false });
    expect(cards()).toHaveLength(4);
    expect((await knowledge()).log).toContain("Level test: 80% (20 questions). Weak areas: 2.1, 2.2, 2.2, 2.2.");

    const done = await markAgain(t.attemptId, new Map([[t.ids[4], true]]), "self");
    expect(done).toMatchObject({ status: "passed", score: 85 });
    const marked = await saved();
    expect(marked.skills["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: false });
    expect(marked.cards).not.toContain("T Q4");
    expect(marked.cards).toHaveLength(3);
    expect(marked.log).toMatch(/Level test: 85% \(20 questions\)\. Weak areas: 2\.2, 2\.2, 2\.2\.$/);
    expect(marked.map).toBe("Needs review: 2.2, 2.2, 2.2");
    expect(marked.gaps).toEqual(["2.2"]);
    expect(marked.context).toContain("Mastered subtopics: Fractions");

    // The same test with that answer right from the start saves exactly this.
    await openDb();
    await takeTest("T", [...many(5, R("2.1")), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    expect(await saved()).toEqual(marked);
  });

  it("an earlier quiz marked again keeps the review flag a later quiz set", async () => {
    // Quiz 1: Fractions 4 of 5 (practiced). Quiz 2: 5 of 5 (mastered). Quiz 3: 4 of 5 (flagged for review).
    const q1 = await takeQuiz("A", [...many(4, R("2.1")), M("2.1")], "2026-11-01 10:00:00");
    await takeQuiz("B", many(5, R("2.1")), "2026-11-02 10:00:00");
    await takeQuiz("C", [...many(4, R("2.1")), W("2.1")], "2026-11-03 10:00:00");
    expect(skills()["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: true });
    // Quiz 1 marked right is 5 of 5, but quiz 3 still came after it and slipped.
    await markAgain(q1.attemptId, new Map([[q1.ids[4], true]]), "self");
    expect(skills()["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: true });
    // A quiz makes no flashcards, at the finish or after a mark.
    expect(cards()).toEqual([]);
  });

  it("the latest quiz marked again clears the review flag it set", async () => {
    await takeQuiz("A", many(5, R("2.1")), "2026-11-01 10:00:00");
    const q2 = await takeQuiz("B", [...many(4, R("2.1")), M("2.1")], "2026-11-02 10:00:00");
    expect(skills()["2.1"].review_needed).toBe(true);
    await markAgain(q2.attemptId, new Map([[q2.ids[4], true]]), "self");
    expect(skills()["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: false });
  });

  it("an answer no model checked, marked Not yet: the finish counted it right, so the skill is flagged and gets its card", async () => {
    // Fractions 4 right + 1 unchecked, counted right at the finish (5 of 5, mastered). Decimals 12 + 3 wrong.
    // Unchecked wrong: 16 of 20 fails, right: 17 of 20 passes, so the test waits for it.
    const t = await takeTest("T", [...many(4, R("2.1")), U("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    expect(skills()["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: false });
    expect(cards()).not.toContain("T Q4");

    const settled = await settleLevelTest(t.attemptId, new Map([[t.ids[4], false]]), "self");
    expect(settled).toMatchObject({ status: "failed", overall: 80 });
    // Mastery is never taken away (mastery.ts): 4 of 5 now flags it for review.
    expect(skills()["2.1"]).toEqual({ mastered: true, practiced: true, review_needed: true });
    expect(cards()).toContain("T Q4");
    const k = await knowledge();
    expect(k.log).toMatch(/Level test: 80% \(20 questions\)\. Weak areas: 2\.1, 2\.2, 2\.2, 2\.2\.$/);
    expect(k.map).toBe("Needs review: 2.1, 2.2, 2.2, 2.2");
  });

  it("an answer no model checked, marked Right: the score on the log line changes and nothing else", async () => {
    const t = await takeTest("T", [...many(4, R("2.1")), U("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    const before = await saved();
    await addStudyPlanToLog("c1", t.entry, "Review decimals.");
    await settleLevelTest(t.attemptId, new Map([[t.ids[4], true]]), "self");
    const after = await saved();
    expect(after.skills).toEqual(before.skills);
    expect(after.cards).toEqual(before.cards);
    expect(after.map).toBe(before.map);
    // 16 of 20 (80%, the unchecked one not counted) at the finish; 17 of 20 (85%) marked. The wrong answers did not
    // change, so the plan written for them stays.
    expect(before.log).toContain("Level test: 80% (20 questions)");
    expect(after.log).toMatch(/Level test: 85% \(20 questions\)\. Weak areas: 2\.2, 2\.2, 2\.2\. Study plan: Review decimals\.$/);
  });

  it("a study plan written for the old wrong answers is dropped, and one that arrives after the mark is not added", async () => {
    const specs = [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))];
    const t = await takeTest("T", specs);
    await addStudyPlanToLog("c1", t.entry, "Review fractions.");
    expect((await knowledge()).log).toContain("Study plan: Review fractions.");
    await markAgain(t.attemptId, new Map([[t.ids[4], true]]), "self");
    expect((await knowledge()).log).not.toContain("Study plan");

    await openDb();
    const late = await takeTest("T", specs);
    await markAgain(late.attemptId, new Map([[late.ids[4], true]]), "self");
    await addStudyPlanToLog("c1", late.entry, "Review fractions.");
    expect((await knowledge()).log).not.toContain("Study plan");
  });

  it("keeps a card while another attempt still has the question wrong, and never touches a card the learner made", async () => {
    const specs = [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))];
    const first = await takeTest("T", specs);
    sqlite.prepare("UPDATE quiz_attempts SET completed_at = '2026-11-01 10:00:00'").run();
    const again = await takeTest("T", specs);
    sqlite.exec("INSERT INTO flashcards (id, course_id, front, back, source) VALUES ('mine', 'c1', 'T Q4', 'my note', 'manual')");
    await markAgain(again.attemptId, new Map([[again.ids[4], true]]), "self");
    expect(rows("SELECT id FROM flashcards WHERE front = 'T Q4' AND source = 'quiz_miss'")).toHaveLength(1);
    // Marked right on the first test too: no attempt has it wrong now, so the app's card goes, the learner's stays.
    await markAgain(first.attemptId, new Map([[first.ids[4], true]]), "self");
    expect(rows<{ id: string }>("SELECT id FROM flashcards WHERE front = 'T Q4'").map((c) => c.id)).toEqual(["mine"]);
  });

  it("the study log names a level test and a quiz, and a mark finds the level test's line by its name", async () => {
    // Same day, same score: the level test's line first, then the quiz's. A mark on the test changes only its own line.
    const t = await takeTest("T", [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    await takeQuiz("A", [...many(4, R("2.1")), W("2.1")], now);
    const [testLine, quizLine] = (await knowledge()).log.split("\n");
    expect(testLine).toMatch(/^\[.+\] Level test: 80% \(20 questions\)\. Weak areas: 2\.1, 2\.2, 2\.2, 2\.2\.$/);
    expect(quizLine).toMatch(/^\[.+\] Quiz: 80% \(5 questions\)\. Weak areas: 2\.1\.$/);

    await markAgain(t.attemptId, new Map([[t.ids[4], true]]), "self");
    const log = (await knowledge()).log.split("\n");
    expect(log[0]).toMatch(/^\[.+\] Level test: 85% \(20 questions\)\. Weak areas: 2\.2, 2\.2, 2\.2\.$/);
    expect(log[1]).toBe(quizLine);
  });

  it("a level test's line saved as a quiz before level tests had their own name is still found by a mark, and keeps its text but the score", async () => {
    const t = await takeTest("T", [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    const written = (await knowledge()).log;
    await saveTutorInstruction("c1", "study_log", written.replace("] Level test: ", "] Quiz: "));
    expect((await knowledge()).log).toMatch(/Quiz: 80% \(20 questions\)\. Weak areas: 2\.1, 2\.2, 2\.2, 2\.2\.$/);

    await markAgain(t.attemptId, new Map([[t.ids[4], true]]), "self");
    const log = (await knowledge()).log;
    expect(log).toMatch(/Quiz: 85% \(20 questions\)\. Weak areas: 2\.2, 2\.2, 2\.2\.$/);
    expect(log).not.toContain("Level test");
  });

  it("Not yet on a model's wrong mark changes nothing the finish saved", async () => {
    const t = await takeTest("T", [...many(4, R("2.1")), M("2.1"), ...many(12, R("2.2")), ...many(3, W("2.2"))]);
    const before = await saved();
    await markAgain(t.attemptId, new Map([[t.ids[4], false]]), "self");
    expect(await saved()).toEqual(before);
    expect((await getQuizAttempt(t.attemptId))?.score).toBe(80);
  });
});
