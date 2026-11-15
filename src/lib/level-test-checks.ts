// Saving a level test's result, and deciding it later when its written answers are marked by hand.
// The rule itself is level-test.ts (pure); this is the database side, run by PromotionTestFullScreen and
// tested against the real migrations in level-test-checks.test.ts.

import {
  completeQuizAttempt, setPromotionResult, updateQuizQuestionGrade, updateLevelTestScore, getQuizAttempt,
  getLevelTestRows, getLastPromotionAttempt, advanceCourseAfterPass, type LevelTestRow,
} from "./db";
import { levelTestResult, type LevelTestResult, type TestAnswer } from "./level-test";
import type { QuizAttempt } from "../types";

/** Who marked an unchecked answer by hand. OpenEdu has one learner, so only the learner. */
export type HandChecker = "self";

const asAnswer = (r: LevelTestRow): TestAnswer => ({ section: r.test_section ?? "current", is_correct: r.is_correct, graded_by: r.graded_by });

// The stored answers as the pass rule reads them. A question with no stored row (a timed-out test's
// unanswered row that failed to save) counts as wrong, as the app scored it.
export function answersOf(attempt: QuizAttempt, rows: ReadonlyArray<LevelTestRow>): TestAnswer[] {
  const missing = Math.max(0, attempt.total_questions - rows.length);
  return [...rows.map(asAnswer), ...Array.from({ length: missing }, (): TestAnswer => ({ section: "current", is_correct: false, graded_by: "unanswered" }))];
}

/**
 * The finished test's result, saved: the score (checked answers only) always, and passed / not passed
 * unless it waits for unchecked answers to be marked. A failed write is logged, never thrown, so the
 * learner always reaches the results screen.
 */
export async function saveLevelTestResult(attemptId: string, answers: ReadonlyArray<TestAnswer>, timeTakenSeconds: number): Promise<LevelTestResult> {
  const r = levelTestResult(answers);
  try { await completeQuizAttempt(attemptId, r.overall, r.correct, timeTakenSeconds); }
  catch (e) { console.error("completeQuizAttempt failed", e); }
  if (r.status !== "pending") {
    try { await setPromotionResult(attemptId, r.status === "passed", r.reviewPct); }
    catch (e) { console.error("setPromotionResult failed", e); }
  }
  return r;
}

export interface PendingLevelTest {
  attempt: QuizAttempt;
  rows: LevelTestRow[];
  /** The answers waiting to be marked. */
  unchecked: LevelTestRow[];
}

/** A finished level test whose result still waits for its unchecked answers, or null. */
export async function pendingLevelTestFor(attempt: QuizAttempt | null): Promise<PendingLevelTest | null> {
  if (!attempt || attempt.quiz_type !== "promotion" || attempt.completed_at === null || attempt.passed != null) return null;
  const rows = await getLevelTestRows(attempt.id);
  const unchecked = rows.filter((r) => r.graded_by === "fallback");
  if (unchecked.length === 0 || levelTestResult(answersOf(attempt, rows)).status !== "pending") return null;
  return { attempt, rows, unchecked };
}

/** The course level's latest test, if it is waiting for its written answers to be marked. */
export async function pendingLevelTest(courseId: string, level: number): Promise<PendingLevelTest | null> {
  return pendingLevelTestFor(await getLastPromotionAttempt(courseId, level));
}

export interface SettledLevelTest extends LevelTestResult {
  attemptId: string;
  courseId: string;
  level: number;
  /** After a pass: the level the course moved to, or null when it finished (level 6) or did not move. */
  nextLevel: number | null;
  rows: LevelTestRow[];
}

/**
 * Mark a waiting test's unchecked answers (row id → right) and decide it if the marks are enough. Only
 * rows still unchecked take a mark, so a mark can never change what the key or a model decided. Returns
 * null when the attempt is not a finished level test, and the test as it stands when it was already
 * decided (a second save changes nothing).
 */
export async function settleLevelTest(attemptId: string, marks: ReadonlyMap<string, boolean>, by: HandChecker): Promise<SettledLevelTest | null> {
  const attempt = await getQuizAttempt(attemptId);
  if (!attempt || attempt.quiz_type !== "promotion" || attempt.completed_at === null) return null;
  const rows = await getLevelTestRows(attemptId);
  const base = { attemptId, courseId: attempt.course_id, level: attempt.level, nextLevel: null, rows };
  if (attempt.passed != null) {
    return { ...levelTestResult(answersOf(attempt, rows)), ...base, status: attempt.passed === 1 ? "passed" : "failed" };
  }

  for (const r of rows) {
    const right = marks.get(r.id);
    if (r.graded_by !== "fallback" || right === undefined) continue;
    await updateQuizQuestionGrade(r.id, right, by);
    r.is_correct = right;
    r.graded_by = by;
  }
  const result = levelTestResult(answersOf(attempt, rows));
  if (result.status === "pending") return { ...result, ...base };

  await updateLevelTestScore(attemptId, result.overall, result.correct);
  await setPromotionResult(attemptId, result.status === "passed", result.reviewPct);
  const nextLevel = result.status === "passed" ? await advanceCourseAfterPass(attempt.course_id, attempt.level) : null;
  return { ...result, ...base, nextLevel };
}
