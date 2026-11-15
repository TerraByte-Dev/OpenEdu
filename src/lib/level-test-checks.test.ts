import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// A level test whose written answers no model checked, through the real migrations (parsed out of
// lib.rs) and the real db.ts writes, on an in-memory SQLite behind the same stand-in for
// tauri-plugin-sql that db-capture.test.ts uses. This is the path PromotionTestFullScreen takes: save
// each answer with its section, save the result at finish, find the waiting test when the screen opens
// again (after a restart, from the database alone), mark the answers, settle it.

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

import { setActiveLearnerId, createPromotionAttempt, saveQuizQuestion, updateQuizQuestionGrade } from "./db";
import { saveLevelTestResult, pendingLevelTest, settleLevelTest } from "./level-test-checks";
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

describe("a level test with written answers no model checked", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(20);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2, '${DEFAULT_LEARNER_ID}');`);
  });

  it("migration 20 stores each answer's section and refuses anything else", async () => {
    const { attemptId } = await takeTest(2, [R, { ...R, section: "review" }]);
    expect(rows<{ test_section: string }>("SELECT test_section FROM quiz_questions WHERE attempt_id = ?1 ORDER BY rowid", attemptId).map((r) => r.test_section))
      .toEqual(["current", "review"]);
    expect(() => sqlite.exec(`UPDATE quiz_questions SET test_section = 'other'`)).toThrow();
  });

  it("waits: the score leaves the unchecked answers out, nothing is passed, the course stays", async () => {
    const { attemptId } = await takeTest(2, [...many(16, R), U, U, W, W]);
    const a = attemptRow(attemptId);
    expect(a.passed).toBeNull();
    expect(a.score).toBe(80);
    expect(a.correct_count).toBe(16);
    expect(a.completed_at).not.toBeNull();
    expect(courseRow().current_level).toBe(2);
  });

  it("is found again from the database alone, with the answers to mark", async () => {
    const { ids } = await takeTest(2, [...many(16, R), U, U, W, W]);
    const pending = await pendingLevelTest("c1", 2);
    expect(pending?.unchecked.map((r) => r.id)).toEqual([ids[16], ids[17]]);
    expect(pending?.unchecked[0]).toMatchObject({ question_text: "Q16", user_answer: "answer 16", correct_answer: "key 16" });
  });

  it("marked right, it passes, the record says who checked, and the course moves up once", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), U, U, W, W]);
    const settled = await settleLevelTest(attemptId, new Map([[ids[16], true], [ids[17], true]]), "self");
    expect(settled).toMatchObject({ status: "passed", overall: 90, correct: 18, unchecked: 0, nextLevel: 3 });
    expect(attemptRow(attemptId)).toMatchObject({ passed: 1, score: 90, correct_count: 18 });
    expect(rows<{ graded_by: string }>("SELECT graded_by FROM quiz_questions WHERE id IN (?1, ?2)", ids[16], ids[17]).map((r) => r.graded_by)).toEqual(["self", "self"]);
    expect(courseRow().current_level).toBe(3);
    expect(await pendingLevelTest("c1", 2)).toBeNull();

    // Saving again changes nothing and moves nothing.
    const again = await settleLevelTest(attemptId, new Map([[ids[16], false]]), "self");
    expect(again?.status).toBe("passed");
    expect(courseRow().current_level).toBe(3);
  });

  it("marked not yet, it fails and the course stays", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), U, U, W, W]);
    const settled = await settleLevelTest(attemptId, new Map([[ids[16], false], [ids[17], false]]), "self");
    expect(settled).toMatchObject({ status: "failed", overall: 80 });
    expect(attemptRow(attemptId).passed).toBe(0);
    expect(courseRow().current_level).toBe(2);
  });

  it("one mark that already decides it is enough", async () => {
    // 17 right of 20 is 85% whatever the third unchecked answer is.
    const { attemptId, ids } = await takeTest(2, [...many(16, R), U, U, U, W]);
    const settled = await settleLevelTest(attemptId, new Map([[ids[16], true]]), "self");
    expect(settled?.status).toBe("passed");
    expect(courseRow().current_level).toBe(3);
  });

  it("an unmarked answer leaves it waiting, and a mark never overrides a checked answer", async () => {
    const { attemptId, ids } = await takeTest(2, [...many(16, R), U, U, W, W]);
    const settled = await settleLevelTest(attemptId, new Map([[ids[16], false], [ids[18], true]]), "self");
    expect(settled?.status).toBe("pending");
    expect(attemptRow(attemptId).passed).toBeNull();
    expect(rows<{ is_correct: number; graded_by: string }>("SELECT is_correct, graded_by FROM quiz_questions WHERE id = ?1", ids[18])[0]).toEqual({ is_correct: 0, graded_by: "key" });
    expect((await pendingLevelTest("c1", 2))?.unchecked.map((r) => r.id)).toEqual([ids[17]]);
  });

  it("decides at once, with no wait, when the unchecked answers cannot change it", async () => {
    const passed = await takeTest(2, [...many(18, R), U, W]);
    expect(attemptRow(passed.attemptId)).toMatchObject({ passed: 1, score: 90 });
    expect(await pendingLevelTest("c1", 2)).toBeNull();

    const failed = await takeTest(2, [...many(10, R), U, U, ...many(8, W)]);
    expect(attemptRow(failed.attemptId)).toMatchObject({ passed: 0, score: 50 });
    expect(await pendingLevelTest("c1", 2)).toBeNull();
  });

  it("the level 6 test finishes the course when the marks pass it", async () => {
    sqlite.exec(`UPDATE courses SET current_level = 6 WHERE id = 'c1'`);
    const { attemptId, ids } = await takeTest(6, [...many(16, R), U, U, W, W]);
    const settled = await settleLevelTest(attemptId, new Map([[ids[16], true], [ids[17], true]]), "self");
    expect(settled).toMatchObject({ status: "passed", nextLevel: null });
    expect(courseRow()).toEqual({ current_level: 6, status: "completed" });
  });

  it("a test from before migration 20 or decided before this change is never waiting", async () => {
    const attempt = await createPromotionAttempt("c1", 2, 2, 2700);
    sqlite.exec(`UPDATE quiz_attempts SET completed_at = datetime('now'), score = 50, passed = 0 WHERE id = '${attempt.id}'`);
    await saveQuizQuestion({ attempt_id: attempt.id, question_text: "Q", question_type: "short_answer", options: null, correct_answer: "k", user_answer: "a", is_correct: true, difficulty_level: 1, explanation: "" }, "fallback");
    expect(await pendingLevelTest("c1", 2)).toBeNull();
  });
});
