// Flashcard helpers that touch the DB (slice B1). The pure scheduling math lives in srs.ts; this is
// the app-level glue (auto-mint). Kept out of db.ts so the auto-mint policy is in one obvious place.

import { createFlashcard, flashcardExists } from "./db";
import type { QuizQuestion } from "../types";

type MissedQuestion = Pick<QuizQuestion, "question_text" | "correct_answer" | "explanation" | "subtopic_id">;

// Mint review cards from missed questions, deduped by front and capped so the review queue can't be
// flooded by one big test. Conservative on purpose — only the questions the student got wrong. The
// card front is the question; the back is the correct answer plus its explanation. Returns the count
// minted. Best-effort: a single failure doesn't abort the batch.
export async function mintCardsFromMisses(
  courseId: string,
  missed: MissedQuestion[],
  level: number | null,
  cap = 10,
): Promise<number> {
  let minted = 0;
  for (const q of missed.slice(0, cap)) {
    const front = q.question_text.trim();
    const back = [q.correct_answer, q.explanation].map((s) => (s ?? "").trim()).filter(Boolean).join(" — ");
    if (!front || !back) continue;
    try {
      if (await flashcardExists(courseId, front)) continue;
      await createFlashcard({ courseId, front, back, subtopicId: q.subtopic_id ?? null, level, source: "quiz_miss" });
      minted++;
    } catch {
      /* best-effort — skip this card */
    }
  }
  return minted;
}
