// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { QuizQuestion, Syllabus } from "../types";

// The real practice quiz screen on the real db.ts (the in-memory SQLite stand-in the db tests use). Only the
// question maker is a stand-in. "Exit Quiz" with an answer in asks first, inline (quiz-grading.ts LEAVE_QUIZ),
// and each thing the confirm says leaving does is checked here: no score, a new quiz next time, the answers
// given still count as practice. With nothing answered it closes at once. Ported from TerraTutor #234
// (OpenEdu has no learning record, so the confirm says nothing about one).

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
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn() } }));
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getLLMConfig: vi.fn(async () => ({ provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" })),
  getReviewConfig: vi.fn(async () => null),
  getLocalVerifyConfig: vi.fn(async () => null),
}));
const made: Array<Omit<QuizQuestion, "id" | "attempt_id">> = [];
vi.mock("../lib/quiz", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/quiz")>(),
  generateQuizQuestions: vi.fn(async () => made),
}));

const { default: QuizFullScreen } = await import("./QuizFullScreen");
const { setActiveLearnerId, createCourse, getQuizAttempts, getSubtopicAccuracy, getReviewPoolQuestions } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { LEAVE_QUIZ, leaveQuizBody } = await import("../lib/quiz-grading");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

const tf = (i: number) => ({
  question_text: `Frogs are amphibians (${i}).`, question_type: "true_false" as const, options: ["True", "False"], correct_answer: "True",
  user_answer: null, is_correct: null, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
});

let root: Root;
let host: HTMLDivElement;
let courseId = "";
let onClose: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Animals", "animals")).id;
  made.length = 0;
  for (let i = 0; i < 3; i++) made.push(tf(i));
  onClose = vi.fn();
  const course = { id: courseId, title: "Animals", topic: "animals", current_level: 1, status: "active" as const, generation_state: null, created_at: "", updated_at: "" };
  const syllabus = { id: "s1", course_id: courseId, level: 1, title: "Level 1", description: "", learning_objectives: [], subtopics: [], assessment_criteria: [], estimated_hours: 1, generated_at: "" } as Syllabus;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(QuizFullScreen, { context: { courseId, course, level: 1, syllabus, allSyllabuses: [syllabus] }, onClose, grade: null }));
  });
  await vi.waitFor(() => { if (!button("Exit Quiz")) throw new Error("quiz not up yet"); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
const confirm = () => host.querySelector('[role="alertdialog"]');
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };

describe("Exit Quiz on a practice quiz", () => {
  it("with nothing answered, closes at once", async () => {
    await press("Exit Quiz");
    expect(confirm()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with an answer in, asks inline first; Keep going stays, Leave the quiz closes", async () => {
    await press("False");
    await press("Exit Quiz");
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm()?.textContent).toContain(LEAVE_QUIZ.title);
    expect(confirm()?.textContent).toContain(leaveQuizBody(1));
    await press(LEAVE_QUIZ.keep);
    expect(confirm()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await press("Exit Quiz");
    await press(LEAVE_QUIZ.leave);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says what leaving does, and each claim holds in the database", async () => {
    await press("False");
    await press("Next →");
    await press("False");
    await press("Exit Quiz");
    const body = confirm()!.textContent!;
    expect(body).toContain(leaveQuizBody(2));
    // No score: the attempt stays unfinished, so the Quiz tab makes a new quiz next time.
    expect(body).toMatch(/won't get a score, and next time the Quiz tab makes a new quiz/);
    const [attempt] = await getQuizAttempts(courseId);
    expect(attempt).toEqual(expect.objectContaining({ completed_at: null, score: null }));
    // The two answers given still count as practice: per-topic accuracy and the review pool.
    expect(body).toMatch(/The 2 answers you gave still count as practice/);
    expect(await getSubtopicAccuracy(courseId)).toEqual([{ subtopic_id: "1.1", correct: 0, total: 2 }]);
    expect((await getReviewPoolQuestions(courseId, 6)).map((q) => q.question_text).sort()).toEqual(["Frogs are amphibians (0).", "Frogs are amphibians (1)."]);
    expect(leaveQuizBody(1)).toMatch(/The answer you gave still counts as practice/);
  });
});
