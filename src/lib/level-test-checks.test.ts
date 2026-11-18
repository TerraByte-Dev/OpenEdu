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
      execute: async (sql: string, params: unknown[] = []) => {
        const r = sqlite.prepare(bind(sql)).run(...params) as { changes: number | bigint };
        return { rowsAffected: Number(r.changes) };
      },
    }),
  },
}));

import {
  setActiveLearnerId, createPromotionAttempt, saveQuizQuestion, updateQuizQuestionGrade, markLevelTestHandedIn,
  getHandedInLevelTest, getLastPromotionAttempt,
} from "./db";
import { saveLevelTestResult, pendingLevelTest, settleLevelTest, finishHandedInLevelTest, type WrittenAnswerGrader } from "./level-test-checks";
import { DEFAULT_LEARNER_ID } from "./learners";
import type { TestAnswer, TestSection } from "./level-test";
import type { GradedBy, GradeOutcome } from "./quiz-grading";

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

// Closing the app or a power cut on "Grading your test" (audit 7 #3). The screen saves each answer as it
// is given, then at Finish marks the test handed in (markLevelTestHandedIn) before grading. Here the
// grading never ends: nothing else is written, as after a power cut. Opened again, the screen finds the
// test from the database alone and finishes it through finishHandedInLevelTest, with the same grader.
describe("a level test handed in while the app closed during grading", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(20);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2, '${DEFAULT_LEARNER_ID}');`);
  });

  /** Answer `right` key questions right and `written` questions in words (not graded yet), then hand it in. */
  async function handIn(right: number, written: number, total = right + written, handed = true) {
    const attempt = await createPromotionAttempt("c1", 2, total, 2700);
    for (let i = 0; i < right; i++) {
      await saveQuizQuestion({
        attempt_id: attempt.id, question_text: `Q${i}`, question_type: "multiple_choice", options: null, correct_answer: `key ${i}`,
        user_answer: `key ${i}`, is_correct: true, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
      }, "key", "current");
    }
    for (let i = 0; i < written; i++) {
      await saveQuizQuestion({
        attempt_id: attempt.id, question_text: `W${i}`, question_type: "fill_in_blank", options: null, correct_answer: `word ${i}`,
        user_answer: `my words ${i}`, is_correct: null, difficulty_level: 1, explanation: "", subtopic_id: "1.1", blank_position: `The ___ ${i}.`,
      }, null, "current");
    }
    if (handed) await markLevelTestHandedIn(attempt.id, 1234);
    return attempt.id;
  }

  const grader = (mark: (question: string) => boolean | undefined) => {
    const asked: string[][] = [];
    const grade: WrittenAnswerGrader = async (items) => {
      asked.push(items.map((it) => it.question));
      const out = new Map<number, GradeOutcome>();
      for (const it of items) {
        const right = mark(it.question);
        if (right !== undefined) out.set(it.index, { isCorrect: right, feedback: "", by: "model" });
      }
      return out;
    };
    return { grade, asked };
  };

  it("is found again from the database alone, graded, passed once, and the course moves up once", async () => {
    const id = await handIn(16, 4);
    // Before it is finished it is neither a finished test nor one that blocks with a wait.
    expect(await getLastPromotionAttempt("c1", 2)).toBeNull();
    expect((await getHandedInLevelTest("c1", 2))?.id).toBe(id);

    const { grade, asked } = grader(() => true);
    const settled = await finishHandedInLevelTest(id, grade);
    expect(settled).toMatchObject({ status: "passed", overall: 100, correct: 20, nextLevel: 3 });
    // The fill-in-the-blank sentence is graded with its question, as at the finish.
    expect(asked[0][0]).toBe("W0\nSentence: The ___ 0.");
    expect(attemptRow(id)).toMatchObject({ passed: 1, score: 100, correct_count: 20 });
    expect(rows<{ time_taken_seconds: number }>("SELECT time_taken_seconds FROM quiz_attempts WHERE id = ?1", id)[0].time_taken_seconds).toBe(1234);
    expect(rows<{ graded_by: string }>("SELECT graded_by FROM quiz_questions WHERE question_text LIKE 'W%'").map((r) => r.graded_by)).toEqual(["model", "model", "model", "model"]);
    expect(courseRow().current_level).toBe(3);
    expect(await getHandedInLevelTest("c1", 2)).toBeNull();

    // Opened again (or a second screen): nothing is graded or counted twice.
    expect(await finishHandedInLevelTest(id, grade)).toBeNull();
    expect(asked).toHaveLength(1);
    expect(courseRow().current_level).toBe(3);
  });

  it("two opens at once (React StrictMode runs the mount twice) count it once", async () => {
    const id = await handIn(16, 4);
    const { grade } = grader(() => true);
    const both = await Promise.all([finishHandedInLevelTest(id, grade), finishHandedInLevelTest(id, grade)]);
    expect(both.filter((s) => s !== null)).toHaveLength(1);
    expect(both.find((s) => s !== null)).toMatchObject({ status: "passed", nextLevel: 3 });
    expect(attemptRow(id)).toMatchObject({ passed: 1, score: 100, correct_count: 20 });
    expect(courseRow().current_level).toBe(3);
  });

  it("a fail starts the retake wait like any finished test", async () => {
    const id = await handIn(12, 8);
    const settled = await finishHandedInLevelTest(id, grader(() => false).grade);
    expect(settled).toMatchObject({ status: "failed", overall: 60 });
    const last = await getLastPromotionAttempt("c1", 2);
    expect(last?.id).toBe(id);
    expect(last?.passed).toBe(0);
    expect(last?.completed_at).not.toBeNull();
    expect(courseRow().current_level).toBe(2);
  });

  it("answers graded before the power went keep their marks; only the rest are graded", async () => {
    const id = await handIn(16, 4);
    const w0 = rows<{ id: string }>("SELECT id FROM quiz_questions WHERE question_text = 'W0'")[0].id;
    await updateQuizQuestionGrade(w0, false, "model");
    const { grade, asked } = grader(() => true);
    const settled = await finishHandedInLevelTest(id, grade);
    expect(asked[0].map((q) => q.split("\n")[0])).toEqual(["W1", "W2", "W3"]);
    expect(settled).toMatchObject({ status: "passed", overall: 95 });
  });

  it("no local model: the written answers are not checked and the test waits for them to be marked", async () => {
    const id = await handIn(16, 4);
    const settled = await finishHandedInLevelTest(id, grader(() => undefined).grade);
    expect(settled).toMatchObject({ status: "pending", overall: 80, unchecked: 4, nextLevel: null });
    expect(attemptRow(id).passed).toBeNull();
    expect(attemptRow(id).completed_at).not.toBeNull();
    expect((await pendingLevelTest("c1", 2))?.unchecked.map((r) => r.question_text)).toEqual(["W0", "W1", "W2", "W3"]);
    expect(courseRow().current_level).toBe(2);
  });

  it("a question with no stored answer counts as wrong, as the finish scored it", async () => {
    const id = await handIn(16, 0, 20);
    const settled = await finishHandedInLevelTest(id, grader(() => true).grade);
    expect(settled).toMatchObject({ status: "failed", overall: 80, correct: 16, total: 20 });
  });

  it("a test the learner stopped (or a window closed mid-test) is never handed in or graded", async () => {
    const id = await handIn(16, 4, 20, false);
    expect(await getHandedInLevelTest("c1", 2)).toBeNull();
    const { grade, asked } = grader(() => true);
    expect(await finishHandedInLevelTest(id, grade)).toBeNull();
    expect(asked).toHaveLength(0);
    expect(attemptRow(id).completed_at).toBeNull();
  });

  it("a test that finished normally is not handed in again", async () => {
    const { attemptId } = await takeTest(2, [...many(18, R), W, W]);
    await markLevelTestHandedIn(attemptId, 99);
    expect(await getHandedInLevelTest("c1", 2)).toBeNull();
    expect(await finishHandedInLevelTest(attemptId, grader(() => true).grade)).toBeNull();
  });
});
