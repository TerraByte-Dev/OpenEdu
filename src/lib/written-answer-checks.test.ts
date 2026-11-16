import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// "I think I was right" (written-answer-checks.ts) through the real migrations and db.ts writes, on the
// in-memory SQLite stand-in level-test-checks.test.ts uses: a quiz or level test is taken and saved the
// way the screens save it, then a written answer the model marked wrong is marked again by hand.

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

import { setActiveLearnerId, createPromotionAttempt, saveQuizQuestion, updateQuizQuestionGrade, createQuizAttempt, completeQuizAttempt } from "./db";
import { saveLevelTestResult, pendingLevelTest } from "./level-test-checks";
import { markAgain, canMarkAgain } from "./written-answer-checks";
import { DEFAULT_LEARNER_ID } from "./learners";
import type { TestAnswer, TestSection } from "./level-test";
import type { GradedBy } from "./quiz-grading";

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
}

function migrate(upTo: number, from = 1): void {
  const all = migrations();
  for (let v = from; v <= upTo; v++) {
    const sql = all.get(v);
    if (!sql) throw new Error(`migration ${v} not found in lib.rs`);
    sqlite.exec(sql);
  }
}

const rows = <T,>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];

type Spec = { section: TestSection; correct: boolean; by: GradedBy };
const R: Spec = { section: "current", correct: true, by: "key" };
const W: Spec = { section: "current", correct: false, by: "key" };
const U: Spec = { section: "current", correct: true, by: "fallback" };
// A written answer the model marked wrong.
const M: Spec = { section: "current", correct: false, by: "model" };
// A written answer code marked wrong: a number and unit whose amount differs from the key's.
const C: Spec = { section: "current", correct: false, by: "exact" };

/** Take a level test the way the screen does: each answer saved with its section, written answers graded at finish. */
async function takeTest(level: number, specs: Spec[]): Promise<{ attemptId: string; ids: string[] }> {
  const attempt = await createPromotionAttempt("c1", level, specs.length, 2700);
  const ids: string[] = [];
  for (const [i, s] of specs.entries()) {
    const written = s.by !== "key";
    const id = await saveQuizQuestion({
      attempt_id: attempt.id, question_text: `Q${i}`, question_type: written ? "short_answer" : "multiple_choice",
      options: null, correct_answer: `key ${i}`, user_answer: `answer ${i}`, is_correct: written ? null : s.correct,
      difficulty_level: 1, explanation: "", subtopic_id: "1.1",
    }, written ? null : "key", s.section);
    if (written) await updateQuizQuestionGrade(id, s.correct, s.by);
    ids.push(id);
  }
  const answers: TestAnswer[] = specs.map((s) => ({ section: s.section, is_correct: s.correct, graded_by: s.by }));
  await saveLevelTestResult(attempt.id, answers, 600);
  return { attemptId: attempt.id, ids };
}

const attemptRow = (id: string) => rows<{ score: number; correct_count: number; passed: number | null; review_score: number | null; completed_at: string | null }>(
  "SELECT score, correct_count, passed, review_score, completed_at FROM quiz_attempts WHERE id = ?1", id)[0];
const courseRow = () => rows<{ current_level: number; status: string }>("SELECT current_level, status FROM courses WHERE id = 'c1'")[0];
const many = (k: number, s: Spec) => Array.from({ length: k }, () => s);

const graded = (id: string) => rows<{ is_correct: number; graded_by: string }>("SELECT is_correct, graded_by FROM quiz_questions WHERE id = ?1", id)[0];

describe("marking again a written answer the model marked wrong", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(20);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2, '${DEFAULT_LEARNER_ID}');`);
  });

  it("only a model's or code's wrong mark can be marked again", () => {
    expect(canMarkAgain({ graded_by: "model", is_correct: false })).toBe(true);
    expect(canMarkAgain({ graded_by: "exact", is_correct: false })).toBe(true);
    expect(canMarkAgain({ graded_by: "model", is_correct: true })).toBe(false);
    expect(canMarkAgain({ graded_by: "key", is_correct: false })).toBe(false);
    expect(canMarkAgain({ graded_by: "exact", is_correct: true })).toBe(false);
    expect(canMarkAgain({ graded_by: "self", is_correct: false })).toBe(false);
    expect(canMarkAgain({ graded_by: "unanswered", is_correct: false })).toBe(false);
  });

  it("a failed test the mark passes is passed, and the course moves up once", async () => {
    // 16 right + 1 model-wrong + 3 wrong = 80%; marked right, 17 of 20 = 85%.
    const { attemptId, ids } = await takeTest(2, [...many(16, R), M, ...many(3, W)]);
    expect(attemptRow(attemptId).passed).toBe(0);
    const done = await markAgain(attemptId, new Map([[ids[16], true]]), "self");
    expect(done).toMatchObject({ status: "passed", score: 85, correct: 17, nextLevel: 3 });
    expect(attemptRow(attemptId)).toMatchObject({ passed: 1, score: 85, correct_count: 17 });
    expect(graded(ids[16])).toEqual({ is_correct: 1, graded_by: "self" });
    expect(courseRow().current_level).toBe(3);
    // A second mark changes nothing: it is no longer the model's mark.
    await markAgain(attemptId, new Map([[ids[16], false]]), "self");
    expect(graded(ids[16])).toEqual({ is_correct: 1, graded_by: "self" });
    expect(courseRow().current_level).toBe(3);
  });

  it("an answer code marked wrong is marked again like the model's: the test is passed and the course moves up", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), C, ...many(3, W)]);
    expect(attemptRow(attemptId).passed).toBe(0);
    const done = await markAgain(attemptId, new Map([[ids[16], true]]), "self");
    expect(done).toMatchObject({ status: "passed", score: 85, correct: 17, nextLevel: 3 });
    expect(graded(ids[16])).toEqual({ is_correct: 1, graded_by: "self" });
    expect(courseRow().current_level).toBe(3);
  });

  it("a test whose result cannot change stays decided, with the score counted again", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(11, R), M, ...many(8, W)]);
    const done = await markAgain(attemptId, new Map([[ids[11], true]]), "self");
    expect(done).toMatchObject({ status: "failed", score: 60, nextLevel: null });
    expect(attemptRow(attemptId)).toMatchObject({ passed: 0, score: 60, correct_count: 12 });
    expect(courseRow().current_level).toBe(2);

    const passed = await takeTest(2, [...many(18, R), M, W]);
    const kept = await markAgain(passed.attemptId, new Map([[passed.ids[18], true]]), "self");
    expect(kept).toMatchObject({ status: "passed", score: 95, nextLevel: null });
    expect(attemptRow(passed.attemptId).passed).toBe(1);
  });

  it("Not yet keeps the answer wrong, marked by hand, and the test as it was", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), M, ...many(3, W)]);
    const done = await markAgain(attemptId, new Map([[ids[16], false]]), "self");
    expect(done?.status).toBe("failed");
    expect(graded(ids[16])).toEqual({ is_correct: 0, graded_by: "self" });
    expect(attemptRow(attemptId)).toMatchObject({ passed: 0, score: 80 });
  });

  it("a failed test that now depends on answers no model checked waits for them", async () => {
    // 15 right, 1 unchecked, 1 model-wrong, 3 wrong: failed even with the unchecked one right (80%).
    // The model-wrong one marked right makes 16, and 17 with the unchecked one (85%): it waits for that.
    const { attemptId, ids } = await takeTest(2, [...many(15, R), U, M, ...many(3, W)]);
    expect(attemptRow(attemptId).passed).toBe(0);
    const done = await markAgain(attemptId, new Map([[ids[16], true]]), "self");
    expect(done?.status).toBe("pending");
    expect(attemptRow(attemptId).passed).toBeNull();
    expect((await pendingLevelTest("c1", 2))?.unchecked.map((r) => r.id)).toEqual([ids[15]]);
  });

  it("never changes an answer the key decided", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), M, ...many(3, W)]);
    await markAgain(attemptId, new Map([[ids[17], true]]), "self");
    expect(graded(ids[17])).toEqual({ is_correct: 0, graded_by: "key" });
    expect(attemptRow(attemptId).passed).toBe(0);
  });

  it("a quiz's score is counted again", async () => {
    const attempt = await createQuizAttempt("c1", "quiz", 2, 4);
    const ids: string[] = [];
    for (const [i, s] of [R, R, M, W].entries()) {
      const written = s.by !== "key";
      const id = await saveQuizQuestion({
        attempt_id: attempt.id, question_text: `Q${i}`, question_type: written ? "short_answer" : "multiple_choice",
        options: null, correct_answer: `key ${i}`, user_answer: `answer ${i}`, is_correct: written ? null : s.correct,
        difficulty_level: 1, explanation: "", subtopic_id: "1.1",
      }, written ? null : "key");
      if (written) await updateQuizQuestionGrade(id, s.correct, s.by);
      ids.push(id);
    }
    await completeQuizAttempt(attempt.id, 50, 2, 300);
    const done = await markAgain(attempt.id, new Map([[ids[2], true]]), "self");
    expect(done).toMatchObject({ status: null, correct: 3, score: 75 });
    expect(attemptRow(attempt.id)).toMatchObject({ score: 75, correct_count: 3, passed: null });
  });

  it("does nothing before the attempt is finished", async () => {
    const attempt = await createQuizAttempt("c1", "quiz", 2, 1);
    expect(await markAgain(attempt.id, new Map(), "self")).toBeNull();
  });
});
