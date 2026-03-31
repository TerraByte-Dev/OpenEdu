import { getSyllabus, getQuizAttempts, upsertUserProgress, getUserProgress, updateSyllabusSubtopics, saveTutorInstruction } from "./db";
import { log } from "./llm";
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

  // Mark subtopic as mastered if >= 80% correct on its questions (min 1 question)
  let changed = false;
  const updatedSubtopics = syllabus.subtopics.map((sub) => {
    const s = scores.get(sub.id);
    if (s && s.total >= 1) {
      const pct = s.correct / s.total;
      if (pct >= 0.8 && !sub.mastered) {
        changed = true;
        return { ...sub, mastered: true };
      }
    }
    return sub;
  });

  if (changed) {
    await updateSyllabusSubtopics(courseId, syllabus.level, JSON.stringify(updatedSubtopics));
    log.info("progress", `Updated subtopic mastery for course ${courseId} level ${syllabus.level}`);
  }
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

  // Collect knowledge gaps from all syllabuses: subtopics still not mastered
  // We load syllabuses lazily via db — check common levels 0.0-5.0
  const knownLevels = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const gaps: string[] = [];
  for (const level of knownLevels) {
    const syl = await getSyllabus(courseId, level);
    if (!syl) continue;
    for (const sub of syl.subtopics) {
      if (!sub.mastered) gaps.push(sub.id);
    }
  }

  await upsertUserProgress(courseId, { knowledge_gaps: gaps, total_quiz_score_avg: avg });
  log.info("progress", `User progress updated: avg=${avg?.toFixed(1)} gaps=${gaps.length}`);
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
