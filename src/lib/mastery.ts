// Pure subtopic-mastery transition (slice A2). Given one subtopic's score on an attempt, return the
// next subtopic state: practiced (sticky), mastered (≥90%, sticky — Kulik et al. 1990), and the
// soft `review_needed` flag for spaced review. Kept Tauri-free so it's unit-tested; progress.ts
// imports it and persists the result.

import type { Subtopic } from "../types";

const MASTERY_THRESHOLD = 0.9;

// Returns a NEW object only when something changed (so callers can detect a no-op by reference).
// `review_needed` never demotes `mastered`: a previously-mastered subtopic that slips on review is
// flagged, and the flag clears once the student is solid again.
export function applySubtopicScore(sub: Subtopic, correct: number, total: number): Subtopic {
  if (total < 1) return sub;
  const pct = correct / total;
  let next = sub;

  if (!next.practiced) next = { ...next, practiced: true };
  if (pct >= MASTERY_THRESHOLD && !next.mastered) next = { ...next, mastered: true };

  // A previously-mastered subtopic that slipped this round → flag for review (mastered stays true).
  if (next.mastered && pct < MASTERY_THRESHOLD && !next.review_needed) {
    next = { ...next, review_needed: true };
  }
  // Cleared once they're solid again.
  if (next.review_needed && pct >= MASTERY_THRESHOLD) {
    next = { ...next, review_needed: false };
  }

  return next;
}
