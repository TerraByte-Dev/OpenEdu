import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// What a new study quiz is told the last quizzes on its level asked (db.ts getRecentQuizQuestions, which
// QuizFullScreen passes to generateQuizQuestions), through the real migrations and the real db.ts on an
// in-memory SQLite, the stand-in for tauri-plugin-sql that db-level-test-stop.test.ts uses. Port of
// TerraTutor PR #251.

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

import { setActiveLearnerId, createCourse, createQuizAttempt, createPromotionAttempt, saveQuizQuestion, getRecentQuizQuestions } from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import quizScreenSource from "../views/QuizFullScreen.tsx?raw";

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

async function answered(attemptId: string, text: string): Promise<void> {
  await saveQuizQuestion({
    attempt_id: attemptId, question_text: text, question_type: "fill_in_blank", options: null,
    correct_answer: "key", user_answer: "x", is_correct: false, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
    blank_position: `${text}: the ___ part.`, matching_pairs: [{ left: "a", right: "b" }],
  });
}

let courseId = "";
let otherCourse = "";

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "fractions")).id;
  otherCourse = (await createCourse("Plants", "plants")).id;
});

describe("getRecentQuizQuestions", () => {
  it("returns this course's study-quiz questions on the level, newest quiz first", async () => {
    const first = await createQuizAttempt(courseId, "quiz", 1, 2);
    await answered(first.id, "First quiz, question 1");
    await answered(first.id, "First quiz, question 2");
    sqlite.exec(`UPDATE quiz_attempts SET started_at = datetime('now', '-1 day') WHERE id = '${first.id}'`);
    const second = await createQuizAttempt(courseId, "quiz", 1, 1);
    await answered(second.id, "Second quiz, question 1");
    // Not counted: another level, a level test, another course.
    await answered((await createQuizAttempt(courseId, "quiz", 2, 1)).id, "Level 2 quiz question");
    await answered((await createPromotionAttempt(courseId, 1, 45, 45 * 60)).id, "Level test question");
    await answered((await createQuizAttempt(otherCourse, "quiz", 1, 1)).id, "Plants quiz question");

    const got = await getRecentQuizQuestions(courseId, 1, 40);
    expect(got.map((q) => q.question_text)).toEqual(["Second quiz, question 1", "First quiz, question 2", "First quiz, question 1"]);
    // What quiz.ts askedText needs to tell two "Fill in the blank." questions apart.
    expect(got[0]).toMatchObject({
      correct_answer: "key", subtopic_id: "1.1", question_type: "fill_in_blank",
      blank_position: "Second quiz, question 1: the ___ part.", matching_pairs: [{ left: "a", right: "b" }],
    });
    // Which quiz asked each, so the generator can tell the last quiz's questions (quiz.ts repeatsLastQuiz).
    expect(got.map((q) => q.attempt_id)).toEqual([second.id, first.id, first.id]);
    expect((await getRecentQuizQuestions(courseId, 1, 1)).map((q) => q.question_text)).toEqual(["Second quiz, question 1"]);
  });

  it("is what the quiz screen hands the generator", () => {
    expect(quizScreenSource).toContain("getRecentQuizQuestions(courseId, syllabus.level, RECENT_QUESTIONS)");
    expect(quizScreenSource).toMatch(/stop\.signal, earlier\)/);
  });
});
