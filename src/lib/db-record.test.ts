import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The learning record's reads (#258), run for real: the migrations parsed out of lib.rs and the real
// db.ts and progress.ts functions against an in-memory SQLite (node:sqlite), through the same stand-in
// for tauri-plugin-sql that db-record-capture.test.ts uses.

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
vi.mock("./llm", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import {
  setActiveLearnerId, createLearner, createCourse, ensureCourse, createNote, createFlashcard, updateFlashcardAfterReview,
  createQuizAttempt, saveQuizQuestion, completeQuizAttempt, saveChatMessage, createLesson, markLessonRead, recordActiveMinute,
  recordSubtopicEvents, saveSyllabus, getSyllabus, getRecordSource, getLearnerRecordSource, setLearnerRecordVoice, setCourseSubject,
} from "./db";
import { updateSubtopicMastery } from "./progress";
import { replaySubtopics, skillKey } from "./record/replay";
import { learningRecord } from "./record/build";
import { DEFAULT_LEARNER_ID } from "./learners";
import { expectLineAddsUp } from "./record/test-rows";
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
  sqlite.exec("PRAGMA foreign_keys = ON;"); // sqlx enables FKs; match it
  const all = migrations();
  for (let v = 1; v <= all.size; v++) sqlite.exec(all.get(v)!);
}

const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });

async function addSyllabus(courseId: string, level: number, subtopics: Subtopic[]): Promise<void> {
  await saveSyllabus({
    course_id: courseId, level, title: `Level ${level}`, description: "", learning_objectives: [], subtopics,
    assessment_criteria: [], estimated_hours: 1,
  });
}

/** One learner's worth of every kind of row the record reads. */
async function seedLearner(prefix: string): Promise<string> {
  const c = await createCourse(`${prefix} course`, "topic");
  await addSyllabus(c.id, 1, [sub("1.1", "Skill one")]);
  await saveChatMessage(c.id, "user", "hello", 1, `${prefix}-thread`);
  const a = await createQuizAttempt(c.id, "quiz", 1, 1);
  await saveQuizQuestion({
    attempt_id: a.id, question_text: `${prefix} question`, question_type: "multiple_choice" as const, options: null, correct_answer: "A",
    user_answer: "A", is_correct: true, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
  }, "key");
  await completeQuizAttempt(a.id, 100, 1, 30);
  const lesson = await createLesson(c.id, 1, "t", "body", "1.1");
  await markLessonRead(lesson.id);
  const card = await createFlashcard({ courseId: c.id, front: `${prefix} f`, back: "b", level: 1, source: "manual" });
  await updateFlashcardAfterReview(card.id, { ease: 2.5, interval_days: 1, reps: 1, lapses: 0, due_at: "2026-11-12 00:00:00" }, "good");
  await createNote(c.id, `${prefix} note`, "my words", 1, null, "learner");
  await recordSubtopicEvents(c.id, 1, [{ subtopic_id: "1.1", event: "mastered", source: "tutor" }]);
  return c.id;
}

describe("getRecordSource scoping", () => {
  let bId: string;
  let aCourse: string;
  let bCourse: string;

  beforeEach(async () => {
    await openDb();
    const b = await createLearner("Bilal");
    bId = b.id;
    setActiveLearnerId(bId);
    bCourse = await seedLearner("B");
    await recordActiveMinute(bId, "2026-11-11");
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    aCourse = await seedLearner("A");
    await recordActiveMinute(DEFAULT_LEARNER_ID, "2026-11-11");
    await ensureCourse("__eval_tooluse__", "Eval", "eval");
    await saveChatMessage("__eval_tooluse__", "user", "probe", 1, "eval-thread");
  });

  it("never returns another learner's courses, chats, quizzes, questions or other rows", async () => {
    const src = (await getRecordSource())!;
    expect(src.learner.id).toBe(DEFAULT_LEARNER_ID);
    expect(src.courses.map((c) => c.id)).toEqual([aCourse]);
    const courseIds = [
      ...src.syllabuses, ...src.attempts, ...src.chats, ...src.lessons, ...src.flashcards, ...src.flashcardReviews, ...src.notes, ...src.subtopicEvents,
    ].map((r) => r.course_id);
    expect(courseIds.length).toBe(8);
    expect(new Set(courseIds)).toEqual(new Set([aCourse]));
    // Questions have no course of their own; they reach it through their attempt.
    expect(src.questions.map((q) => q.question_text)).toEqual(["A question"]);
    expect(src.questions[0].attempt_id).toBe(src.attempts[0].id);
    expect(src.learnerDays).toEqual([{ day: "2026-11-11", minutes: 1 }]);
    // The event log names a lesson by its topic and level.
    expect(src.lessons).toEqual([{ course_id: aCourse, level: 1, topic: "t", read_at: expect.any(String) }]);
    expect(src.captureSince).not.toBeNull();
  });

  it("leaves eval courses out, though they belong to the learner", async () => {
    expect(sqlite.prepare("SELECT learner_id FROM courses WHERE id = '__eval_tooluse__'").all()).toEqual([{ learner_id: DEFAULT_LEARNER_ID }]);
    const src = (await getRecordSource())!;
    expect(src.courses.some((c) => c.id.startsWith("__eval"))).toBe(false);
    expect(src.chats.some((m) => m.course_id.startsWith("__eval"))).toBe(false);
  });

  it("does not take a LIKE wildcard for a course id that merely resembles an eval id", async () => {
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('x_evalish', 'Real', 'real', 1.0, '${DEFAULT_LEARNER_ID}')`);
    expect((await getRecordSource())!.courses.map((c) => c.id)).toContain("x_evalish");
  });

  it("follows the active learner, and reads nothing with none", async () => {
    setActiveLearnerId(bId);
    const src = (await getRecordSource())!;
    expect(src.learner.name).toBe("Bilal");
    expect(src.courses.map((c) => c.id)).toEqual([bCourse]);
    expect(src.questions.map((q) => q.question_text)).toEqual(["B question"]);
    setActiveLearnerId(null);
    expect(await getRecordSource()).toBeNull();
  });

  it("lets the teacher read one named learner whoever is active", async () => {
    const src = (await getLearnerRecordSource(bId))!;
    expect(src.courses.map((c) => c.id)).toEqual([bCourse]);
    expect(await getLearnerRecordSource("nobody")).toBeNull();
  });

  it("stores who reads a learner's record, for that learner only, and refuses anything else", async () => {
    await setLearnerRecordVoice(DEFAULT_LEARNER_ID, "self");
    expect((await getRecordSource())!.learner.record_voice).toBe("self");
    expect((await getLearnerRecordSource(bId))!.learner.record_voice).toBeNull();
    await setLearnerRecordVoice(DEFAULT_LEARNER_ID, "guided");
    expect((await getRecordSource())!.learner.record_voice).toBe("guided");
    await setLearnerRecordVoice(DEFAULT_LEARNER_ID, null);
    expect((await getRecordSource())!.learner.record_voice).toBeNull();
    await expect(setLearnerRecordVoice(DEFAULT_LEARNER_ID, "parent" as never)).rejects.toThrow();
  });

  it("labels a course with a subject from the list, only on that learner's own course", async () => {
    await setCourseSubject(DEFAULT_LEARNER_ID, aCourse, "Foreign language");
    expect((await getRecordSource())!.courses[0].subject).toBe("Foreign language");
    // Another learner's course is untouched, even given its id.
    await setCourseSubject(DEFAULT_LEARNER_ID, bCourse, "Math");
    expect((await getLearnerRecordSource(bId))!.courses[0].subject).toBeNull();
    await expect(setCourseSubject(DEFAULT_LEARNER_ID, aCourse, "Underwater basket weaving")).rejects.toThrow();
    expect((await getRecordSource())!.courses[0].subject).toBe("Foreign language");
    await setCourseSubject(DEFAULT_LEARNER_ID, aCourse, null);
    expect((await getRecordSource())!.courses[0].subject).toBeNull();
  });

  it("reads only notes the learner started and wrote in, so older notes never count as days with learning", async () => {
    await createNote(aCourse, "Imported", "file text", 1, null, "import");
    await createNote(aCourse, "Before migration 18", "old text", 1);
    await createNote(aCourse, "Empty", "   ", 1, null, "learner");
    const src = (await getRecordSource())!;
    expect(src.notes.map((n) => n.title)).toEqual(["A note"]);
  });
});

describe("replay parity with the app", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(DEFAULT_LEARNER_ID);
  });

  it("matches the stored mastered, practiced and review_needed flags after every tagged quiz the app scored", async () => {
    const c = await createCourse("Spanish", "spanish");
    // Level 3 reuses id "1.1", as small models do: the app credits it to the level-3 skill.
    const syl: Record<number, Subtopic[]> = {
      1: [sub("1.1", "Greetings"), sub("1.2", "Numbers"), sub("1.3", "Colours")],
      2: [sub("2.1", "Food"), sub("2.2", "Family")],
      3: [sub("3.1", "Weather"), sub("1.1", "Travel")],
    };
    for (const level of [1, 2, 3]) await addSyllabus(c.id, level, syl[level]);
    const ids = ["1.1", "1.2", "1.3", "2.1", "2.2", "3.1", "9.9"];

    // After every attempt, the replay of the stored rows must land where the app's flags are.
    const transitions = new Set<string>();
    const expectParity = async (n: number) => {
      const src = (await getRecordSource())!;
      const replay = replaySubtopics(src.attempts, src.questions, new Map(src.syllabuses.map((s) => [s.level, s.subtopics])));
      for (const t of replay.checks.flatMap((x) => x.transitions)) transitions.add(t);
      for (const s of src.syllabuses) {
        for (const stored of s.subtopics) {
          const replayed = replay.state.get(skillKey(s.level, stored.id))!;
          expect([n, s.level, stored.id, !!replayed.mastered, !!replayed.practiced, !!replayed.review_needed])
            .toEqual([n, s.level, stored.id, !!stored.mastered, !!stored.practiced, !!stored.review_needed]);
        }
      }
      return src;
    };

    let seed = 7;
    let unansweredRows = 0;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 60; n++) {
      const level = 1 + Math.floor(rand() * 3);
      const count = 1 + Math.floor(rand() * 6);
      const promotion = rand() < 0.2;
      // Half the level tests time out on their last question, stored as PromotionTestFullScreen does.
      const timedOut = promotion && rand() < 0.5;
      const a = await createQuizAttempt(c.id, promotion ? "promotion" : "quiz", level, count);
      const answered = [];
      for (let i = 0; i < count; i++) {
        const r = rand();
        const unanswered = timedOut && i === count - 1;
        const q = {
          attempt_id: a.id, question_text: `q${n}-${i}`, question_type: "multiple_choice" as const, options: null, correct_answer: "A",
          user_answer: unanswered ? null : "A", is_correct: unanswered ? false : r < 0.75 ? true : r < 0.9 ? false : null,
          difficulty_level: 1, explanation: "", subtopic_id: ids[Math.floor(rand() * ids.length)],
        };
        await saveQuizQuestion(q, unanswered ? "unanswered" : q.is_correct === null ? null : "key");
        if (unanswered) unansweredRows++;
        answered.push(q);
      }
      await completeQuizAttempt(a.id, 0, 0, 10);
      // Attempts finish in order; datetime('now') would give them all the same second.
      sqlite.prepare("UPDATE quiz_attempts SET completed_at = ? WHERE id = ?").run(`2026-11-01 10:00:${String(n).padStart(2, "0")}`, a.id);
      await updateSubtopicMastery(c.id, (await getSyllabus(c.id, level))!, answered, a.id);
      await expectParity(n);
    }
    expect([...transitions]).toEqual(expect.arrayContaining(["mastered", "review_needed", "review_cleared"]));
    expect(unansweredRows).toBeGreaterThan(0);

    const src = await expectParity(60);
    // And the record built from the same rows tells the same story for the current month.
    const record = learningRecord(src, { kind: "month", year: 2026, month: 10 }, new Date(2026, 10, 20));
    const shown = src.syllabuses.flatMap((s) => s.subtopics).filter((x) => x.mastered).length;
    expect(record.courses[0].reconciliation!.shown).toBe(shown);
    expectLineAddsUp(src, record);
  });
});
