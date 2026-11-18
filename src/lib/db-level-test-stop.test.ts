import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// "Stop the test" on a begun level test (PromotionTestFullScreen) leaves the attempt as it is: created,
// some answers saved, never completed. The confirm tells the learner what that means (level-test.ts
// stopTestBody): not scored, the level does not change, no retake wait, and the answers given are kept,
// a missed one able to come back in a quiz. This checks each claim through the real migrations and the
// real db.ts and progress.ts code on an in-memory SQLite, the same stand-in for tauri-plugin-sql that
// level-test-checks.test.ts uses. Port of TerraTutor PR #178 (OpenEdu has no learning record).

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
vi.mock("./llm", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  setActiveLearnerId, createCourse, createPromotionAttempt, saveQuizQuestion, getLastPromotionAttempt,
  getCourse, getQuizAttempts, getReviewPoolQuestions, getLevelTestRows,
} from "./db";
import { keyShown } from "./quiz-grading";
import { quizAverage } from "./progress";
import { DEFAULT_LEARNER_ID } from "./learners";
import { stopTestBody } from "./level-test";

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
  for (const v of [...all.keys()].sort((a, b) => a - b)) sqlite.exec(all.get(v)!);
}

let courseId = "";

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Animals", "animal homes")).id;
});

// The learner pressed Begin Test, answered `answers` questions (all wrong), then stopped.
async function beginAndStop(answers: number): Promise<void> {
  const attempt = await createPromotionAttempt(courseId, 1, 45, 45 * 60);
  for (let i = 0; i < answers; i++) {
    await saveQuizQuestion({
      attempt_id: attempt.id, question_text: `Which animal builds home number ${i}?`, question_type: "multiple_choice",
      options: ["A) bird", "B) rock", "C) cloud", "D) river"], correct_answer: "A) bird", user_answer: "B) rock",
      is_correct: false, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
    }, "key", "current");
  }
}

describe("a level test stopped after it began", () => {
  it("sets no retake wait, though every answer so far was wrong", async () => {
    await beginAndStop(10);
    expect(await getLastPromotionAttempt(courseId, 1)).toBeNull();
  });

  it("is not scored and does not move the level", async () => {
    await beginAndStop(3);
    expect((await getCourse(courseId))!.current_level).toBe(1);
    const attempts = await getQuizAttempts(courseId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].score).toBeNull();
    expect(attempts[0].completed_at).toBeNull();
    expect(quizAverage(attempts)).toBeNull();
  });

  it("keeps the answers given, and a missed one can come back in a quiz, as the confirm says", async () => {
    await beginAndStop(3);
    expect((await getReviewPoolQuestions(courseId, 6)).length).toBeGreaterThan(0);
    expect(stopTestBody(3)).toMatch(/ones you missed may come back in a quiz/);
  });

  it("stopped before any answer, keeps nothing to come back, and the confirm does not claim it does", async () => {
    await beginAndStop(0);
    expect(await getReviewPoolQuestions(courseId, 6)).toEqual([]);
    expect(stopTestBody(0)).not.toMatch(/answers you gave/);
  });
});

// A level test decided after its answers were marked shows its results from the stored rows
// (PromotionTestFullScreen fromRow): a drag-to-match row carries its pairs, so the key shows as them.
describe("a stored level-test answer to a drag-to-match question", () => {
  it("comes back with its pairs, and its key shows as them", async () => {
    const attempt = await createPromotionAttempt(courseId, 1, 45, 45 * 60);
    const pairs = [{ left: "Frog", right: "Amphibian" }, { left: "Dog", right: "Mammal" }, { left: "Eagle", right: "Bird" }];
    await saveQuizQuestion({
      attempt_id: attempt.id, question_text: "Match each animal to its group.", question_type: "drag_to_match", options: [],
      correct_answer: "See matching_pairs", user_answer: JSON.stringify({ Frog: "Mammal", Dog: "Amphibian", Eagle: "Bird" }),
      is_correct: false, difficulty_level: 1, explanation: "", subtopic_id: "1.1", matching_pairs: pairs,
    }, "key", "current");
    const [row] = await getLevelTestRows(attempt.id);
    expect(row.matching_pairs).toEqual(pairs);
    expect(keyShown(row)).toBe("Frog → Amphibian, Dog → Mammal, Eagle → Bird");
  });
});
