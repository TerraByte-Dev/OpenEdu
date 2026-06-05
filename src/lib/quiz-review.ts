// Pure helpers for retrieval-practice interleaving (slice A2). A study quiz mixes freshly-generated
// questions with a smaller pool of previously-missed ones (the testing effect — Roediger & Karpicke
// 2006). Kept Tauri-free so it's unit-tested next to itself; the DB fetch lives in db.ts and the
// generator (quiz.ts) is handed the pool.

import type { QuizQuestion } from "../types";

// The generation-time question shape (mirrors quiz.ts) — no DB/runtime fields.
export type GenQuestion = Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">;

// Decide how many of `total` quiz questions should be re-posed review items vs. freshly generated.
// ~`ratio` review by default, capped by how many review items are actually available and never more
// than `total`. Degrades to all-fresh (review = 0) when there's no history — so a brand-new course
// behaves exactly as before. Pure.
export function splitNewVsReview(
  total: number,
  availableReview: number,
  ratio = 0.2,
): { fresh: number; review: number } {
  if (total <= 0) return { fresh: 0, review: 0 };
  const want = Math.round(total * ratio);
  const review = Math.max(0, Math.min(want, availableReview, total));
  return { fresh: total - review, review };
}

// Strip the DB/runtime fields off a stored question so it can be re-posed as a fresh prompt. The old
// self-explanation is not carried over (this is a new attempt). Pure.
export function storedToGenQuestion(q: QuizQuestion): GenQuestion {
  return {
    question_text: q.question_text,
    question_type: q.question_type,
    options: q.options ?? null,
    correct_answer: q.correct_answer,
    difficulty_level: q.difficulty_level,
    explanation: q.explanation,
    subtopic_id: q.subtopic_id ?? null,
    matching_pairs: q.matching_pairs ?? null,
    blank_position: q.blank_position ?? null,
    self_explanation: null,
  };
}

// Take the first `n` review items (caller supplies them newest-first, already deduped). Pure.
export function pickReview(pool: GenQuestion[], n: number): GenQuestion[] {
  return n <= 0 ? [] : pool.slice(0, n);
}

// Spread review items at roughly even positions through the fresh ones (so review questions aren't
// clustered at the front or back). Deterministic — no RNG — so it's testable. Length is preserved
// exactly: |fresh| + |review|. Pure.
export function interleaveReview(fresh: GenQuestion[], review: GenQuestion[]): GenQuestion[] {
  if (review.length === 0) return fresh.slice();
  if (fresh.length === 0) return review.slice();

  const total = fresh.length + review.length;
  const reviewPos = new Set<number>();
  for (let k = 0; k < review.length; k++) {
    let p = Math.round(((k + 1) * total) / (review.length + 1));
    if (p >= total) p = total - 1;
    while (reviewPos.has(p)) p = (p + 1) % total; // resolve the rare collision
    reviewPos.add(p);
  }

  const out: GenQuestion[] = [];
  let ri = 0;
  let fi = 0;
  for (let i = 0; i < total; i++) {
    if (reviewPos.has(i) && ri < review.length) out.push(review[ri++]);
    else if (fi < fresh.length) out.push(fresh[fi++]);
    else if (ri < review.length) out.push(review[ri++]);
  }
  return out;
}
