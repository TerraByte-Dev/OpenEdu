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

export type SubtopicResolution =
  | { kind: "match"; sub: Subtopic }
  | { kind: "ambiguous"; candidates: Subtopic[] }
  | { kind: "none" };

// Resolve a model-supplied subtopic ref (id or title) without guessing. Small models pass blank,
// padded or partial refs; a blank ref used to contain-match every title and mark subtopic 1, and a
// shared fragment silently took the first hit. Exact id, then exact title, then containment in
// either direction — each title step accepts only a single hit, otherwise it's ambiguous.
export function resolveSubtopic(subtopics: Subtopic[], ref: string): SubtopicResolution {
  const trimmed = ref.trim();
  if (!trimmed) return { kind: "none" };

  const byId = subtopics.find((s) => s.id === trimmed);
  if (byId) return { kind: "match", sub: byId };

  const target = trimmed.toLowerCase();
  const norm = (s: string) => s.trim().toLowerCase();
  const pick = (hits: Subtopic[]): SubtopicResolution | null =>
    hits.length === 1 ? { kind: "match", sub: hits[0] } : hits.length > 1 ? { kind: "ambiguous", candidates: hits } : null;

  return (
    pick(subtopics.filter((s) => norm(s.title) === target)) ??
    pick(subtopics.filter((s) => norm(s.title).includes(target) || target.includes(norm(s.title)))) ??
    { kind: "none" }
  );
}
