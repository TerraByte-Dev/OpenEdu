// Row builders for the learning-record tests (test-only; nothing in the app imports this). Times are
// built from LOCAL dates and stored the way SQLite's datetime('now') writes them (UTC), so every test
// holds in any time zone.

import { expect } from "vitest";
import type { Subtopic } from "../../types";
import type { LearningRecord } from "./build";
import type { RecordAttempt, RecordCourse, RecordQuestion, RecordSource, RecordSyllabus } from "./sources";

export const utc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
export const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min);
/** A stored time in November 2026 (month 10), local. */
export const nov = (day: number, h = 12, min = 0) => utc(local(2026, 10, day, h, min));
export const dec = (day: number, h = 12, min = 0) => utc(local(2026, 11, day, h, min));
export const oct = (day: number, h = 12, min = 0) => utc(local(2026, 9, day, h, min));

export const emptySource = (): RecordSource => ({
  learner: { id: "L", name: "Maya", grade: 3, record_voice: null, record_year_start: null },
  captureSince: null, courses: [], syllabuses: [], attempts: [], questions: [], chats: [], lessons: [],
  flashcards: [], flashcardReviews: [], notes: [], subtopicEvents: [], learnerDays: [],
});

export const course = (over: Partial<RecordCourse> = {}): RecordCourse => ({
  id: "c", title: "Spanish I", current_level: 1, status: "active", subject: "Foreign language", created_at: oct(1), ...over,
});

export const sub = (id: string, title = `Skill ${id}`, flags: Partial<Subtopic> = {}): Subtopic => ({
  id, title, key_concepts: [], practice_type: "recall", mastered: false, ...flags,
});

export const syllabus = (level: number, subtopics: Subtopic[], courseId = "c"): RecordSyllabus => ({
  course_id: courseId, level, title: `Level ${level} title`, learning_objectives: [`Objective ${level}`], subtopics,
});

let seq = 0;

export const attempt = (over: Partial<RecordAttempt> = {}): RecordAttempt => {
  const id = over.id ?? `a${++seq}`;
  return {
    id, course_id: "c", quiz_type: "quiz", level: 1, score: null, total_questions: 0, correct_count: 0,
    time_taken_seconds: null, started_at: over.completed_at ?? nov(3), completed_at: nov(3), passed: null, ...over,
  };
};

export const question = (attemptId: string, subtopicId: string | null, isCorrect: 0 | 1 | null, over: Partial<RecordQuestion> = {}): RecordQuestion => ({
  id: `q${++seq}`, attempt_id: attemptId, question_text: `Question ${seq}`, question_type: "multiple_choice", correct_answer: "A",
  user_answer: isCorrect === 1 ? "A" : "B", is_correct: isCorrect, explanation: "", subtopic_id: subtopicId, self_explanation: null,
  graded_by: null, ...over,
});

/** One finished attempt with `right` of `total` questions on one skill; fills total_questions and the score. */
export function quiz(
  source: RecordSource, skillId: string | null, right: number, total: number,
  over: Partial<RecordAttempt> = {}, q: Partial<RecordQuestion> = {},
): RecordAttempt {
  const a = attempt({ total_questions: total, correct_count: right, score: total ? (right / total) * 100 : 0, ...over });
  source.attempts.push(a);
  for (let i = 0; i < total; i++) source.questions.push(question(a.id, skillId, i < right ? 1 : 0, q));
  return a;
}

/**
 * The B1 reconciliation line adds up, and its "without proof" count is exactly the A2 rows listed for
 * skills the app shows as mastered.
 */
export function expectLineAddsUp(source: RecordSource, record: LearningRecord): void {
  const flagged = new Set(source.syllabuses.flatMap((s) => s.subtopics.filter((x) => x.mastered).map((x) => `${s.course_id}|${s.level}|${x.id}`)));
  for (const c of record.courses) {
    if (!c.reconciliation) continue;
    const { shown, checked, early, without } = c.reconciliation;
    expect(checked + early + without).toBe(shown);
    const listed = record.withoutProof.filter((w) => w.courseId === c.courseId && flagged.has(`${w.courseId}|${w.level}|${w.skillId}`));
    expect(listed.length).toBe(without);
  }
}
