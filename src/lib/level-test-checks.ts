// Saving a level test's result, and deciding it later when its written answers are marked by hand.
// The rule itself is level-test.ts (pure); this is the database side, run by PromotionTestFullScreen and
// tested against the real migrations in level-test-checks.test.ts.

import {
  completeQuizAttempt, setPromotionResult, updateQuizQuestionGrade, updateLevelTestScore, getQuizAttempt,
  getLevelTestRows, getLastPromotionAttempt, advanceCourseAfterPass, completeHandedInLevelTest, markLevelTestHandedIn,
  saveQuizQuestion, type LevelTestRow,
} from "./db";
import { levelTestResult, type LevelTestResult, type TestAnswer, type TestSection } from "./level-test";
import { recountAfterMarks } from "./finish-effects";
import { questionWithSentence, type GradeOutcome } from "./quiz-grading";
import type { AnswerToGrade } from "./quiz";
import type { QuizAttempt, QuizQuestion } from "../types";

/** Who marked an unchecked answer by hand. OpenEdu has one learner, so only the learner. */
export type HandChecker = "self";

const asAnswer = (r: LevelTestRow): TestAnswer => ({ section: r.test_section ?? "current", is_correct: r.is_correct, graded_by: r.graded_by });

// The stored answers as the pass rule reads them. A question with no stored row (a timed-out test's
// unanswered row that failed to save) counts as wrong, as the app scored it.
export function answersOf(attempt: QuizAttempt, rows: ReadonlyArray<LevelTestRow>): TestAnswer[] {
  const missing = Math.max(0, attempt.total_questions - rows.length);
  return [...rows.map(asAnswer), ...Array.from({ length: missing }, (): TestAnswer => ({ section: "current", is_correct: false, graded_by: "unanswered" }))];
}

/** A question a timed-out test never answered, as the screen holds it. */
export type UnansweredQuestion = Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct"> & { section: TestSection };

/**
 * Hand a level test in at Finish, before its written answers are graded. A timed-out test's unanswered
 * questions are stored first, as wrong ('unanswered') with their section, so a test graded later from
 * the database (finishHandedInLevelTest, after the app closed on "Grading your test") scores them as the
 * finish does: a missing review question counted as a current one could pass the review bar. Then the
 * time taken, which marks it handed in (db.ts markLevelTestHandedIn). A row that fails to save is logged
 * and the hand-in goes on (answersOf counts it as wrong); a failed hand-in write throws.
 */
export async function handInLevelTest(attemptId: string, timeTakenSeconds: number, unanswered: ReadonlyArray<UnansweredQuestion>): Promise<void> {
  await Promise.all(unanswered.map((q) => saveQuizQuestion({
    attempt_id: attemptId,
    question_text: q.question_text,
    question_type: q.question_type,
    options: q.options,
    correct_answer: q.correct_answer,
    user_answer: null,
    is_correct: false,
    difficulty_level: q.difficulty_level,
    explanation: q.explanation,
    subtopic_id: q.subtopic_id,
    matching_pairs: q.matching_pairs,
    blank_position: q.blank_position,
  }, "unanswered", q.section).catch((e) => console.error("saving an unanswered question failed", e))));
  await markLevelTestHandedIn(attemptId, timeTakenSeconds);
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

/** Grades written answers the way the finish does: quiz.ts gradeAnswersBatch on a local model, or none. */
export type WrittenAnswerGrader = (items: AnswerToGrade[]) => Promise<Map<number, GradeOutcome>>;

/**
 * Finish a level test that was handed in but whose grading never ended (db.ts markLevelTestHandedIn: the
 * app was closed or lost power on "Grading your test"), from what is on disk. The written answers still
 * unmarked are graded as at the finish (an outcome missing from the grader is 'fallback', as there), then
 * the result is saved as saveLevelTestResult saves it, dated when it was handed in (completeHandedInLevelTest),
 * and a pass moves the course up. Its other saves (mastery, cards, the study log) are the screen's, as at the finish. Counts once: an attempt that has
 * completed_at, or was never handed in, returns null and changes nothing. completed_at is written before
 * anything is counted, only while it is still unset (completeHandedInLevelTest), so of two finishes running
 * at once (React StrictMode runs the screen's mount twice in dev) the second returns null; both may grade the
 * answers, which writes the same marks again. A failure to write it throws, so the next open tries again.
 */
export async function finishHandedInLevelTest(attemptId: string, grade: WrittenAnswerGrader): Promise<SettledLevelTest | null> {
  const attempt = await getQuizAttempt(attemptId);
  if (!attempt || attempt.quiz_type !== "promotion" || attempt.completed_at !== null || attempt.time_taken_seconds == null) return null;
  const rows = await getLevelTestRows(attemptId);
  const open = rows.filter((r) => r.user_answer !== null && r.is_correct === null);
  if (open.length > 0) {
    const outcomes = await grade(open.map((r, index) => ({
      index, question: questionWithSentence(r), expected: r.correct_answer, student: r.user_answer ?? "", type: r.question_type,
    })));
    for (const [i, r] of open.entries()) {
      const o = outcomes.get(i) ?? { isCorrect: true, feedback: "", by: "fallback" as const };
      await updateQuizQuestionGrade(r.id, o.isCorrect, o.by);
      r.is_correct = o.isCorrect;
      r.graded_by = o.by;
    }
  }
  const result = levelTestResult(answersOf(attempt, rows));
  if (!(await completeHandedInLevelTest(attemptId, result.overall, result.correct))) return null;
  let nextLevel: number | null = null;
  if (result.status !== "pending") {
    await setPromotionResult(attemptId, result.status === "passed", result.reviewPct);
    if (result.status === "passed") nextLevel = await advanceCourseAfterPass(attempt.course_id, attempt.level);
  }
  return { ...result, attemptId, courseId: attempt.course_id, level: attempt.level, nextLevel, rows };
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

  const rowsBefore = rows.map((r) => ({ ...r }));
  for (const r of rows) {
    const right = marks.get(r.id);
    if (r.graded_by !== "fallback" || right === undefined) continue;
    await updateQuizQuestionGrade(r.id, right, by);
    r.is_correct = right;
    r.graded_by = by;
  }
  const result = levelTestResult(answersOf(attempt, rows));
  let nextLevel: number | null = null;
  if (result.status !== "pending") {
    await updateLevelTestScore(attemptId, result.overall, result.correct);
    await setPromotionResult(attemptId, result.status === "passed", result.reviewPct);
    if (result.status === "passed") nextLevel = await advanceCourseAfterPass(attempt.course_id, attempt.level);
  }
  // The finish counted an unchecked answer as right for mastery and the study log; a Not yet changes that.
  await recountAfterMarks(attempt, rowsBefore).catch((e) => console.error("recount after the marks failed", e));
  return { ...result, ...base, nextLevel };
}
