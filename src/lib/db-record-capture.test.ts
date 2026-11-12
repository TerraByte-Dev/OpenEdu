import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Migration 18 (learning-record capture, #258) and its writes, run for real: the migrations parsed out
// of lib.rs and the real db.ts functions against an in-memory SQLite (node:sqlite), through the same
// stand-in for tauri-plugin-sql that db-learners.test.ts uses.

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
  setActiveLearnerId, createLearner, deleteLearner, createCourse, deleteCourse, createNote, createFlashcard,
  updateFlashcardAfterReview, createQuizAttempt, saveQuizQuestion, updateQuizQuestionGrade, setPromotionResult,
  recordActiveMinute, recordSubtopicEvents,
} from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import type { QuizQuestion } from "../types";

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
  sqlite.exec("PRAGMA foreign_keys = ON;"); // sqlx enables FKs; match it
}

function migrate(upTo: number, from = 1): void {
  const all = migrations();
  for (let v = from; v <= upTo; v++) {
    const sql = all.get(v);
    if (!sql) throw new Error(`migration ${v} not found in lib.rs`);
    sqlite.exec(sql);
  }
}

const rows = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];
const count = (sql: string, ...p: unknown[]) => rows<{ n: number }>(sql, ...p)[0].n;

const question = (attemptId: string, over: Partial<QuizQuestion> = {}): Omit<QuizQuestion, "id"> => ({
  attempt_id: attemptId, question_text: "2 + 2?", question_type: "short_answer", options: null,
  correct_answer: "4", user_answer: "4", is_correct: null, difficulty_level: 1, explanation: "",
  subtopic_id: "1.1", ...over,
});

describe("migration 18 on an existing install", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(17);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2.0, '${DEFAULT_LEARNER_ID}');`);
    sqlite.exec(`INSERT INTO quiz_attempts (id, course_id, quiz_type, level, total_questions) VALUES ('a1', 'c1', 'quiz', 1, 1);`);
    sqlite.exec(`INSERT INTO notes (id, course_id, title, content) VALUES ('n1', 'c1', 'Old note', 'x');`);
    migrate(18, 18);
  });

  it("keeps existing rows, leaves the new columns NULL, and stamps when capture began", () => {
    expect(rows<{ passed: number | null }>("SELECT passed FROM quiz_attempts WHERE id = 'a1'")[0].passed).toBeNull();
    expect(rows<{ origin: string | null }>("SELECT origin FROM notes WHERE id = 'n1'")[0].origin).toBeNull();
    expect(rows<{ subject: string | null }>("SELECT subject FROM courses WHERE id = 'c1'")[0].subject).toBeNull();
    expect(count("SELECT COUNT(*) AS n FROM app_config WHERE key = 'record_capture_since' AND value IS NOT NULL")).toBe(1);
  });

  it("refuses a reader voice outside the two it knows", () => {
    expect(() => sqlite.exec(`UPDATE learners SET record_voice = 'teacher' WHERE id = '${DEFAULT_LEARNER_ID}'`)).toThrow();
    sqlite.exec(`UPDATE learners SET record_voice = 'guided' WHERE id = '${DEFAULT_LEARNER_ID}'`);
  });
});

describe("learning-record writes", () => {
  beforeEach(async () => {
    await openDb();
    migrate(18);
    setActiveLearnerId(DEFAULT_LEARNER_ID);
  });

  it("counts one active minute per tick, and a second tick within 55 s adds nothing", async () => {
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-11");
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-11");
    const minutes = () => rows<{ minutes: number }>("SELECT minutes FROM learner_days WHERE learner_id = ? AND day = ?", DEFAULT_LEARNER_ID, "2026-11-11")[0].minutes;
    expect(minutes()).toBe(1);
    sqlite.exec("UPDATE learner_days SET last_tick_at = datetime('now', '-60 seconds')");
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-11");
    expect(minutes()).toBe(2);
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-12");
    expect(count("SELECT COUNT(*) AS n FROM learner_days")).toBe(2);
  });

  it("stores how each answer was marked, and the level test's outcome", async () => {
    const course = await createCourse("Algebra", "algebra");
    const attempt = await createQuizAttempt(course.id, "promotion", 1, 3);
    await saveQuizQuestion(question(attempt.id, { question_type: "multiple_choice", is_correct: true }), "key");
    const freeText = await saveQuizQuestion(question(attempt.id));
    await saveQuizQuestion(question(attempt.id, { user_answer: null, is_correct: false }), "unanswered");
    expect(rows<{ graded_by: string | null }>("SELECT graded_by FROM quiz_questions WHERE id = ?", freeText)[0].graded_by).toBeNull();
    await updateQuizQuestionGrade(freeText, true, "fallback");
    const graded = rows<{ graded_by: string; is_correct: number }>("SELECT graded_by, is_correct FROM quiz_questions WHERE id = ?", freeText)[0];
    expect(graded).toEqual({ graded_by: "fallback", is_correct: 1 });
    expect(rows<{ graded_by: string }>("SELECT graded_by FROM quiz_questions ORDER BY rowid").map((r) => r.graded_by)).toEqual(["key", "fallback", "unanswered"]);

    await setPromotionResult(attempt.id, false, null);
    expect(rows("SELECT passed, review_score FROM quiz_attempts WHERE id = ?", attempt.id)[0]).toEqual({ passed: 0, review_score: null });
    await setPromotionResult(attempt.id, true, 70);
    expect(rows("SELECT passed, review_score FROM quiz_attempts WHERE id = ?", attempt.id)[0]).toEqual({ passed: 1, review_score: 70 });
  });

  it("logs every flashcard review with its course, though last_reviewed_at is overwritten", async () => {
    const course = await createCourse("Algebra", "algebra");
    const card = await createFlashcard({ courseId: course.id, front: "f", back: "b", level: 1, source: "manual" });
    const sched = { ease: 2.5, interval_days: 1, reps: 1, lapses: 0, due_at: "2026-11-12 00:00:00" };
    await updateFlashcardAfterReview(card.id, sched, "good");
    await updateFlashcardAfterReview(card.id, sched, "again");
    expect(rows<{ course_id: string; grade: string }>("SELECT course_id, grade FROM flashcard_reviews ORDER BY id")).toEqual([
      { course_id: course.id, grade: "good" },
      { course_id: course.id, grade: "again" },
    ]);
  });

  it("records who made a note", async () => {
    const course = await createCourse("Algebra", "algebra");
    await createNote(course.id, "Mine", "", 1, null, "learner");
    await createNote(course.id, "Untagged", "", 1);
    expect(rows<{ origin: string | null }>("SELECT origin FROM notes ORDER BY title").map((r) => r.origin)).toEqual(["learner", null]);
  });

  it("deleting a course removes its skill events and flashcard reviews", async () => {
    const course = await createCourse("Algebra", "algebra");
    const card = await createFlashcard({ courseId: course.id, front: "f", back: "b", level: 1, source: "manual" });
    await updateFlashcardAfterReview(card.id, { ease: 2.5, interval_days: 1, reps: 1, lapses: 0, due_at: "2026-11-12 00:00:00" }, "good");
    await recordSubtopicEvents(course.id, 1, [{ subtopic_id: "1.1", event: "mastered", source: "tutor" }]);
    expect(count("SELECT COUNT(*) AS n FROM subtopic_events")).toBe(1);
    await deleteCourse(course.id);
    expect(count("SELECT COUNT(*) AS n FROM subtopic_events")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM flashcard_reviews")).toBe(0);
  });

  it("deleting a learner removes their counted minutes, and nobody else's", async () => {
    const b = await createLearner("Bilal");
    await recordActiveMinute(b.id, "2026-11-11");
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-11");
    await deleteLearner(b.id);
    expect(rows<{ learner_id: string }>("SELECT learner_id FROM learner_days").map((r) => r.learner_id)).toEqual([DEFAULT_LEARNER_ID]);
  });
});
