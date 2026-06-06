import { getSyllabuses, getQuizAttempts, upsertUserProgress, getUserProgress, updateSyllabusSubtopics, saveTutorInstruction } from "./db";
import { log } from "./llm";
import { applySubtopicScore } from "./mastery";
import { computeStreak } from "./analytics";
import type { Syllabus, QuizQuestion } from "../types";

// ─── Mastery Tracking ─────────────────────────────────────────────────────────

/**
 * After a quiz/promotion attempt, update which subtopics are mastered.
 * If questions have subtopic_id, uses exact mapping. Otherwise falls back to
 * keyword matching against subtopic titles and key_concepts.
 */
export async function updateSubtopicMastery(
  courseId: string,
  syllabus: Syllabus,
  answeredQuestions: Array<Pick<QuizQuestion, "question_text" | "is_correct" | "subtopic_id">>,
): Promise<void> {
  if (!syllabus.subtopics.length || !answeredQuestions.length) return;

  // Build a map: subtopicId -> { correct, total }
  const scores = new Map<string, { correct: number; total: number }>();
  for (const sub of syllabus.subtopics) {
    scores.set(sub.id, { correct: 0, total: 0 });
  }

  for (const q of answeredQuestions) {
    let matchedId: string | null = null;

    if (q.subtopic_id) {
      // Exact match via tagged subtopic_id
      if (scores.has(q.subtopic_id)) {
        matchedId = q.subtopic_id;
      }
    } else {
      // Keyword fallback: check if question text contains subtopic title or key concepts
      const qLower = q.question_text.toLowerCase();
      for (const sub of syllabus.subtopics) {
        const titleMatch = qLower.includes(sub.title.toLowerCase());
        const conceptMatch = sub.key_concepts.some((c) => qLower.includes(c.toLowerCase()));
        if (titleMatch || conceptMatch) {
          matchedId = sub.id;
          break;
        }
      }
    }

    if (matchedId && scores.has(matchedId)) {
      const s = scores.get(matchedId)!;
      s.total++;
      if (q.is_correct) s.correct++;
    }
  }

  // Per-subtopic transition (practiced / mastered / review_needed) lives in the pure mastery helper
  // so it's unit-tested. `applySubtopicScore` returns the same reference when nothing changed.
  let changed = false;
  const updatedSubtopics = syllabus.subtopics.map((sub) => {
    const s = scores.get(sub.id);
    if (!s || s.total < 1) return sub;
    const next = applySubtopicScore(sub, s.correct, s.total);
    if (next !== sub) changed = true;
    return next;
  });

  if (changed) {
    await updateSyllabusSubtopics(courseId, syllabus.level, JSON.stringify(updatedSubtopics));
    log.info("progress", `Updated subtopic mastery for course ${courseId} level ${syllabus.level}`);
  }
}

/**
 * Directly set one subtopic's mastery status by id OR title — the conversation-driven path the
 * tutor uses via the progress.mark_mastered tool (vs the quiz-driven updateSubtopicMastery above).
 * Small models naturally reference the human-readable title ("Introduction to Python and Basic
 * Output") rather than the internal id ("1.1"), so we resolve either. "mastered" implies
 * "practiced". Writes only when something changed. Returns whether a subtopic was found and its
 * title. Subtopic-level only — never touches course.current_level (integer levels 1–6 stay under
 * the promotion-test logic).
 */
export async function setSubtopicStatus(
  courseId: string,
  syllabus: Syllabus,
  idOrTitle: string,
  status: "mastered" | "practiced",
): Promise<{ found: boolean; changed: boolean; title?: string }> {
  // Resolve by exact id, then exact title, then a loose title contains-match.
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(idOrTitle);
  const match =
    syllabus.subtopics.find((s) => s.id === idOrTitle) ??
    syllabus.subtopics.find((s) => norm(s.title) === target) ??
    syllabus.subtopics.find((s) => norm(s.title).includes(target) || target.includes(norm(s.title)));

  if (!match) return { found: false, changed: false };

  let changed = false;
  const updated = syllabus.subtopics.map((sub) => {
    if (sub.id !== match.id) return sub;
    let next = sub;
    if (!next.practiced) { next = { ...next, practiced: true }; changed = true; }
    if (status === "mastered" && !next.mastered) { next = { ...next, mastered: true }; changed = true; }
    return next;
  });

  if (changed) {
    await updateSyllabusSubtopics(courseId, syllabus.level, JSON.stringify(updated));
    log.info("progress", `Set subtopic ${match.id} (${match.title}) → ${status} (course ${courseId} L${syllabus.level})`);
  }
  return { found: true, changed, title: match.title };
}

// ─── User Progress ────────────────────────────────────────────────────────────

/**
 * Recompute user_progress from all quiz attempts for a course.
 * Identifies knowledge gaps as subtopics where mastery is still false.
 */
export async function updateUserProgress(courseId: string): Promise<void> {
  const attempts = await getQuizAttempts(courseId);
  const completed = attempts.filter((a) => a.score !== null && a.completed_at !== null);

  let totalScore = 0;
  for (const a of completed) totalScore += a.score ?? 0;
  const avg = completed.length > 0 ? totalScore / completed.length : null;

  // Collect knowledge gaps from all syllabuses: subtopics still not mastered. One query for the whole
  // course instead of six sequential getSyllabus round-trips (issue #83 — slims the finish cascade).
  const gaps: string[] = [];
  for (const syl of await getSyllabuses(courseId)) {
    for (const sub of syl.subtopics) {
      if (!sub.mastered) gaps.push(sub.id);
    }
  }

  // Activity streak: consecutive days with any quiz attempt (formerly a never-written zombie column).
  const streak = computeStreak(attempts.map((a) => a.started_at), new Date());

  await upsertUserProgress(courseId, { knowledge_gaps: gaps, total_quiz_score_avg: avg, streak_days: streak });
  log.info("progress", `User progress updated: avg=${avg?.toFixed(1)} gaps=${gaps.length} streak=${streak}`);
}

// ─── Progress Context ─────────────────────────────────────────────────────────

/**
 * Build a concise progress summary and save it as the progress_context tutor instruction.
 * This activates the dead progress_context slot in buildSystemPrompt.
 */
export async function refreshProgressContext(
  courseId: string,
  syllabus: Syllabus | null,
): Promise<void> {
  const progress = await getUserProgress(courseId);
  if (!progress) return;

  const lines: string[] = [];

  if (progress.total_quiz_score_avg !== null) {
    lines.push(`Quiz average: ${Math.round(progress.total_quiz_score_avg)}%`);
  }

  if (syllabus) {
    const mastered = syllabus.subtopics.filter((s) => s.mastered).map((s) => s.title);
    const unmastered = syllabus.subtopics.filter((s) => !s.mastered).map((s) => s.title);

    if (mastered.length) {
      lines.push(`Mastered subtopics: ${mastered.join(", ")}`);
    }
    if (unmastered.length) {
      lines.push(`Still learning: ${unmastered.join(", ")} — revisit these areas when the student seems unsure`);
    }
  }

  if (progress.knowledge_gaps.length > 0 && syllabus) {
    // Map gap IDs back to readable titles
    const gapTitles = progress.knowledge_gaps
      .slice(0, 5) // keep concise
      .map((gapId) => {
        const sub = syllabus.subtopics.find((s) => s.id === gapId);
        return sub ? sub.title : gapId;
      });
    if (gapTitles.length) {
      lines.push(`Known weak areas: ${gapTitles.join(", ")}`);
    }
  }

  if (!lines.length) return; // nothing meaningful to save yet

  const context = lines.join("\n");
  await saveTutorInstruction(courseId, "progress_context", context);
  log.info("progress", "Progress context saved");
}
