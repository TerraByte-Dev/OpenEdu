// What a finished quiz or level test saves beside its own rows, and the same brought into line when a
// hand mark changes its answers later.
//
// At finish (QuizFullScreen, PromotionTestFullScreen): skill mastery, the course's progress and the tutor's
// progress context, a level test's flashcards from its missed questions, and the study log line with the
// "Needs review" note. saveFinishEffects is that sequence.
//
// After a mark ("I think I was right", written-answer-checks.ts markAgain; the answers no model checked,
// level-test-checks.ts settleLevelTest): recountAfterMarks redoes each of them from the stored answers,
// through the same functions. What it cannot redo honestly it leaves, and says so below.

import {
  getSyllabus, getQuizAttempt, getQuizAttempts, getQuizQuestions, getLevelTestRows, deleteMissCardsNoLongerMissed,
  type LevelTestRow,
} from "./db";
import { updateSubtopicMastery, updateUserProgress, refreshProgressContext } from "./progress";
import { mintCardsFromMisses } from "./flashcards";
import { updateKnowledgeAfterQuiz, reviseQuizLog } from "./knowledge";
import type { QuizAttempt, QuizQuestion } from "../types";

type FinishedAnswer = Pick<QuizQuestion, "question_text" | "correct_answer" | "explanation" | "subtopic_id"> & { is_correct: boolean | null };

/** The subtopic of every wrong answer, in answer order, as the study log takes them. */
const missedTopics = (answers: ReadonlyArray<FinishedAnswer>): string[] =>
  answers.filter((q) => !q.is_correct && q.subtopic_id).map((q) => q.subtopic_id!);

/**
 * Everything a finished attempt saves beside its rows, in the order the screens always ran it. Only a level
 * test makes flashcards. Returns the study log line, so a failed test's study plan can be added to it when
 * the plan is ready (knowledge.ts addStudyPlanToLog).
 */
export async function saveFinishEffects(
  courseId: string,
  level: number,
  attemptId: string | null,
  levelTest: boolean,
  answered: FinishedAnswer[],
  score: number,
): Promise<string> {
  const syllabus = await getSyllabus(courseId, level);
  if (syllabus) {
    await updateSubtopicMastery(courseId, syllabus, answered, attemptId);
    await updateUserProgress(courseId);
    // Read again: the context names the skills mastered, this attempt's included (it was one update behind).
    await refreshProgressContext(courseId, await getSyllabus(courseId, level));
  }
  if (levelTest) await mintCardsFromMisses(courseId, answered.filter((q) => !q.is_correct), level);
  return updateKnowledgeAfterQuiz(courseId, score, answered.length, missedTopics(answered), null);
}

/** The local date an attempt finished, as the study log wrote it then. completed_at is SQLite UTC. */
export function finishedOn(completedAt: string): string {
  return new Date(`${completedAt.replace(" ", "T")}Z`).toLocaleDateString();
}

/** Finished attempts in the order the app applied them to mastery (the learning record's order too). */
function finishingOrder(attempts: ReadonlyArray<QuizAttempt>): QuizAttempt[] {
  return attempts
    .filter((a) => a.completed_at !== null && (a.quiz_type === "quiz" || a.quiz_type === "promotion"))
    .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!) || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
}

/**
 * After hand marks on a finished attempt (`before` and `rowsBefore` are the attempt and its answers as they
 * stood before the marks): bring what its finish saved into line with the answers as they are now.
 *
 * - Mastery: each skill whose right answers on this attempt changed gets this attempt's new score again,
 *   then every later attempt's score on it at the same level, in the order they finished, through
 *   updateSubtopicMastery. That is the state the marks would have left had they been there at the finish.
 *   One exception, by the app's own rule: mastery is never taken away, so a skill a mark leaves under 90%
 *   keeps "mastered" and is flagged for review instead. Answers with no skill id (the keyword path) are left.
 * - Progress (average, gaps, streak) and the tutor's progress context are worked out again.
 * - Flashcards (level tests make them): a question marked right loses the card made from missing it,
 *   unless the course still has it wrong somewhere. One marked wrong gets its card, as at the finish.
 * - The study log line and "Needs review" note are written again (knowledge.ts reviseQuizLog). A study
 *   plan on the line is dropped when the wrong answers changed: a model wrote it for the old ones, and
 *   no model is asked again.
 */
export async function recountAfterMarks(before: QuizAttempt, rowsBefore: ReadonlyArray<LevelTestRow>): Promise<void> {
  const attempt = await getQuizAttempt(before.id);
  if (!attempt || attempt.completed_at === null) return;
  const rows = await getLevelTestRows(attempt.id);
  const was = new Map(rowsBefore.map((r) => [r.id, !!r.is_correct]));
  const flipped = rows.filter((r) => was.has(r.id) && was.get(r.id) !== !!r.is_correct);
  if (flipped.length === 0 && attempt.score === before.score) return;
  const { course_id: courseId, level } = attempt;

  const rightOn = (rs: ReadonlyArray<Pick<LevelTestRow, "subtopic_id" | "is_correct">>, skill: string) =>
    rs.filter((r) => r.subtopic_id === skill && r.is_correct).length;
  const skills = new Set(flipped.flatMap((r) => (r.subtopic_id ? [r.subtopic_id] : [])));
  for (const s of skills) if (rightOn(rowsBefore, s) === rightOn(rows, s)) skills.delete(s);
  if (skills.size > 0) {
    const ordered = finishingOrder(await getQuizAttempts(courseId));
    const at = ordered.findIndex((a) => a.id === attempt.id);
    const after = at < 0 ? [] : ordered.slice(at + 1).filter((a) => a.level === level);
    const replays: Array<{ id: string; answers: FinishedAnswer[] }> = [{ id: attempt.id, answers: rows }];
    for (const a of after) replays.push({ id: a.id, answers: await getQuizQuestions(a.id) });
    for (const { id, answers } of replays) {
      const onSkills = answers.filter((q) => q.subtopic_id && skills.has(q.subtopic_id));
      const syllabus = await getSyllabus(courseId, level);
      if (syllabus && onSkills.length > 0) await updateSubtopicMastery(courseId, syllabus, onSkills, id);
    }
  }
  await updateUserProgress(courseId);
  await refreshProgressContext(courseId, await getSyllabus(courseId, level));

  if (attempt.quiz_type === "promotion") {
    for (const r of flipped.filter((f) => f.is_correct)) await deleteMissCardsNoLongerMissed(courseId, r.question_text.trim());
    await mintCardsFromMisses(courseId, flipped.filter((f) => !f.is_correct), level);
  }

  if (before.score !== null && attempt.score !== null) {
    await reviseQuizLog(
      courseId,
      finishedOn(attempt.completed_at),
      { score: before.score, missedTopics: missedTopics(rowsBefore) },
      { score: attempt.score, missedTopics: missedTopics(rows) },
      flipped.length === 0,
    );
  }
}
