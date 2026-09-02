// Verdict functions. Total, pure, `now`-free — and the model is never consulted.
//
// Reuses `normalizeAnswer` and `numericValueOf` from quiz-grading.ts verbatim. That code already
// refuses to scalarise percentages, fractions, ratios and ranges, and strips Unicode super/subscripts
// so "O₂" is not read as the number 2. Re-implementing any of it here would be a second source of
// truth for the same question.

import { normalizeAnswer, numericValueOf } from "../quiz-grading";
import type { Expected, Verdict } from "./types";

/**
 * `numericValueOf` deliberately returns null for percent, currency, fractions ("1/2"), ratios
 * ("3:4") and ranges ("6 to 9") rather than guessing at a misleading scalar.
 *
 * That must surface as ABSTAIN, never as incorrect. A learner who types "1/2" has not answered
 * wrongly — we have declined to judge. An abstention counts toward neither the numerator nor the
 * denominator of mastery; the caller re-prompts ("enter it as a decimal") and a persistent
 * abstention is recorded as exactly that.
 */
export function checkNumeric(exp: Extract<Expected, { kind: "numeric" }>, raw: string): Verdict {
  const got = numericValueOf(raw);
  if (got === null) return "abstain";
  const tol = Math.max(Math.abs(exp.value) * exp.tolRel, 1e-9);
  return Math.abs(got - exp.value) <= tol ? "correct" : "incorrect";
}

export function checkExactSet(exp: Extract<Expected, { kind: "exact_set" }>, raw: string): Verdict {
  const got = normalizeAnswer(raw);
  if (!got) return "abstain";
  return exp.any.some((a) => normalizeAnswer(a) === got) ? "correct" : "incorrect";
}

export function checkOrder(exp: Extract<Expected, { kind: "order" }>, raw: string): Verdict {
  // Accept any of the separators a learner might reach for.
  const got = raw
    .split(/[,;>\n]|->|→/)
    .map((s) => normalizeAnswer(s))
    .filter(Boolean);
  if (got.length === 0) return "abstain";
  if (got.length !== exp.items.length) return "incorrect";
  return got.every((g, i) => g === normalizeAnswer(exp.items[i])) ? "correct" : "incorrect";
}

/**
 * The soft underbelly, and the reason `ban` exists.
 *
 * A learner who NEGATES every required term scores correct on a naive keyword check: "entropy never
 * increases in an isolated system" contains "entropy", "increase" and "isolated system". So a keyset
 * item may only bear mastery when it carries a non-empty ban list, and `compileKeyset` populates one
 * from a negation set. Without a ban list the item is practice-only — enforced in `pool.ts`, not
 * left to a convention.
 */
export function checkKeyset(exp: Extract<Expected, { kind: "keyset" }>, raw: string): Verdict {
  const got = normalizeAnswer(raw);
  if (!got) return "abstain";
  const hay = ` ${got} `;
  for (const b of exp.ban) if (hay.includes(` ${normalizeAnswer(b)} `)) return "incorrect";
  const hits = exp.require.filter((r) => hay.includes(` ${normalizeAnswer(r)} `)).length;
  return hits >= exp.minHits ? "correct" : "incorrect";
}

/** Single entry point. Total: every (expected, response) pair yields a verdict. */
export function check(expected: Expected, raw: string): Verdict {
  switch (expected.kind) {
    case "numeric": return checkNumeric(expected, raw);
    case "exact_set": return checkExactSet(expected, raw);
    case "order": return checkOrder(expected, raw);
    case "keyset": return checkKeyset(expected, raw);
  }
}

/** Negations that flip a claim while preserving its keywords. Drives `compileKeyset`'s ban list. */
export const NEGATIONS = [
  "not", "never", "no", "cannot", "without", "unlike", "opposite",
  "fails to", "neither", "nor", "incorrect", "false", "decreases",
];

/**
 * Build a keyset item with a ban list derived from the source span, so it can bear mastery.
 * Negations that already appear in the span are excluded — banning a word the correct answer
 * legitimately contains would make the item unanswerable.
 */
export function compileKeyset(require: string[], span: string, minHits?: number): Extract<Expected, { kind: "keyset" }> {
  const inSpan = normalizeAnswer(span);
  return {
    kind: "keyset",
    require,
    minHits: minHits ?? Math.max(1, Math.ceil(require.length * 0.6)),
    ban: NEGATIONS.filter((n) => !inSpan.includes(n)),
  };
}
