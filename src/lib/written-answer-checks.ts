// "I think I was right": a written answer the grader model marked wrong, marked again by hand against
// the answer key. A small model fails some right answers written in other words (answer-match.ts settles
// the ones code can see), so a model's "wrong" must not be the last word. In OpenEdu the learner marks
// it (graded_by 'self'), as for the answers no model checked (level-test-checks.ts).
//
// The quiz's score is counted again. A level test is decided again the way settleLevelTest decides a
// waiting one: a failed test the mark now passes is passed and the course moves up; one that now
// depends on answers no model checked waits for those; one whose result cannot change stays decided.
// Mastery, flashcards and the study log were saved when the test ended and are not redone.

import {
  getQuizAttempt, getLevelTestRows, updateQuizQuestionGrade, updateLevelTestScore, setPromotionResult,
  reopenLevelTest, advanceCourseAfterPass, type LevelTestRow,
} from "./db";
import { levelTestResult, type LevelTestStatus } from "./level-test";
import { answersOf, type HandChecker } from "./level-test-checks";
import type { GradedBy } from "./quiz-grading";

/** A written answer the grader model marked wrong, which a person may mark again. */
export function canMarkAgain(q: { graded_by?: GradedBy | null; is_correct: boolean | null }): boolean {
  return q.graded_by === "model" && q.is_correct === false;
}

export interface RemarkedAttempt {
  attemptId: string;
  courseId: string;
  level: number;
  rows: LevelTestRow[];
  /** Right answers and the score, counted again. */
  correct: number;
  score: number;
  /** A level test's result after the mark; null for a quiz. */
  status: LevelTestStatus | null;
  reviewPct: number | null;
  unchecked: number;
  /** After a level test the mark passed: the level the course moved to, or null. */
  nextLevel: number | null;
}

/**
 * Mark written answers the model marked wrong (row id → right) and count the attempt again. Only rows
 * canMarkAgain allows take a mark, so nothing the key, an exact match or an earlier hand mark decided
 * can change. Null when the attempt is not a finished quiz or level test.
 */
export async function markAgain(attemptId: string, marks: ReadonlyMap<string, boolean>, by: HandChecker): Promise<RemarkedAttempt | null> {
  const attempt = await getQuizAttempt(attemptId);
  if (!attempt || attempt.completed_at === null) return null;
  const rows = await getLevelTestRows(attemptId);
  for (const r of rows) {
    const right = marks.get(r.id);
    if (right === undefined || !canMarkAgain(r)) continue;
    await updateQuizQuestionGrade(r.id, right, by);
    r.is_correct = right;
    r.graded_by = by;
  }
  const base = { attemptId, courseId: attempt.course_id, level: attempt.level, rows, nextLevel: null };

  if (attempt.quiz_type !== "promotion") {
    // A quiz counts every answer marked right, an unchecked one included (QuizFullScreen).
    const correct = rows.filter((r) => r.is_correct).length;
    const total = Math.max(attempt.total_questions, rows.length);
    const score = total > 0 ? (correct / total) * 100 : 0;
    await updateLevelTestScore(attemptId, score, correct);
    return { ...base, correct, score, status: null, reviewPct: null, unchecked: 0 };
  }

  const result = levelTestResult(answersOf(attempt, rows));
  await updateLevelTestScore(attemptId, result.overall, result.correct);
  const out = { ...base, correct: result.correct, score: result.overall, reviewPct: result.reviewPct, unchecked: result.unchecked };
  // Passed stays passed: a mark can only add right answers.
  if (attempt.passed === 1) return { ...out, status: "passed" };
  if (result.status === "pending") {
    if (attempt.passed === 0) await reopenLevelTest(attemptId);
    return { ...out, status: "pending" };
  }
  await setPromotionResult(attemptId, result.status === "passed", result.reviewPct);
  const nextLevel = result.status === "passed" ? await advanceCourseAfterPass(attempt.course_id, attempt.level) : null;
  return { ...out, status: result.status, nextLevel };
}
