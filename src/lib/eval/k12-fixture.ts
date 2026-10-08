// The K-12 multiple-choice benchmark — prompt format, grader, statistics and the pre-committed bar.
//
// Pure data + pure scoring. No Tauri, no DB, no model — unit-testable, and the same scorer runs in
// the live eval (k12-runner.ts) and in vitest. The items themselves are in k12-items.ts.
//
// ── PRE-REGISTRATION ─────────────────────────────────────────────────────────
// Written and merged BEFORE any scored item reaches a model. The constants are K12_BAR below.
//
// Primary endpoint. Accuracy of the `shipping` arm over all 240 items, one sample each, with its 95%
// Wilson interval.
//
// A (headline). MEETS if the Wilson lower bound is >= 0.75. Met or not, the number is recorded and
// may be quoted with its interval; failing A means the resume states the number and nothing stronger.
//
// V (format validity). `no-parse` <= 5% in every arm. If V fails the result is recorded as
// FORMAT-INVALID and is not quoted as an accuracy figure. A changed format line is a new
// pre-registration with a new dated results file; the old file stays.
//
// H (harness contribution). Exact two-sided McNemar, shipping vs raw, alpha 0.05. Positive and
// p < 0.05: a harness lift may be claimed, quoting both numbers. Negative and p < 0.05: recorded as
// "the harness reduces accuracy on this format" and that is the headline finding. Otherwise: "no
// measurable difference at n=240", both numbers reported, nothing attributed to the harness.
//
// C (ceiling). If the raw arm is >= 95%, the write-up must say the set is near ceiling for this
// model and cannot discriminate a harness effect.
//
// Rules. (1) The first complete run is the result: all items, all arms, no repeats, no per-item
// retries. (2) A run is void only if ERROR rows reach 5 in any arm, a guard trips, or the shipping
// arm grounds zero items; a void run is discarded whole and logged with its counts. (3) No prompt,
// parser, system-prompt or item change after the freeze commit. Only `K12_PILOT` may be sent to the
// model before it. (4) A key changes only if objectively wrong, through an Errata section showing
// item ids and the number before and after. (5) Strata are descriptive.
//
// Expectation, stated up front: H will most likely be null. These are facts in the model's
// parametric memory, at most one card is injected, and the library is high-school-leaning. The
// quotable number is the absolute accuracy.
//
// KEY CHECK: <filled at freeze>

import type { K12Item, K12Key } from "./k12-items";

export const K12_BAR = {
  items: 240,
  shippingWilsonLowerBound: 0.75, // => at least 194/240 correct
  maxNoParseRate: 0.05,           // at most 12/240 per arm
  maxErrorRate: 0.02,             // 5 or more ERROR rows in any arm voids the run
  ceiling: 0.95,                  // raw arm at or above 228/240
  alpha: 0.05,
} as const;

// ── Prompt ───────────────────────────────────────────────────────────────────
// The format line rides in the USER turn, byte-identical in every arm: the raw arm has no system
// prompt to carry it, and the kernel prepends the grounding block ahead of the user content, which
// leaves this instruction last — where a small model follows it most reliably.

export const K12_FORMAT_LINE =
  "You may explain briefly. End your reply with one final line in exactly this form: ANSWER: <letter>";

export function formatK12Prompt(item: K12Item): string {
  const [a, b, c, d] = item.options;
  return `${item.stem}\n\nA) ${a}\nB) ${b}\nC) ${c}\nD) ${d}\n\n${K12_FORMAT_LINE}`;
}

// ── Grading (pure) ───────────────────────────────────────────────────────────

// "ANSWER:" then optional markdown/bracket decoration, then ONE letter that must be closed by
// decoration, a dash, or the end of the line. The lookahead is what makes a hedge ("B or C",
// "B, C", "B/C") and a word that merely starts with a letter ("A triangle", "Both") a no-parse
// instead of a lucky guess.
const ANSWER_RE = /answer\s*:\s*[\s*_`(\[<]*([A-D])(?=[*_`)\]}>.:]|\s*[-–—]|\s*$)/gim;

/** The LAST well-formed ANSWER letter in a reply, or null. Last wins: a model that reconsiders
 *  mid-reply is graded on where it ended up, which is what a student would read as its answer. */
export function extractChoice(text: string): K12Key | null {
  let last: K12Key | null = null;
  for (const m of text.matchAll(ANSWER_RE)) last = m[1].toUpperCase() as K12Key;
  return last;
}

export type K12Outcome = "correct" | "wrong" | "no-parse" | "error";

/**
 * Score one reply.
 *
 * Deliberately NOT scoreRagAnswer: no alternatives, no substring matching, no model judge. The
 * letter is right or it is not.
 *
 * `text` starting "ERROR:" is a turn that threw (the runner writes it that way). `stopReason` is
 * not an input: a reply cut at the output cap is graded on its text, because that text is what a
 * student would see.
 */
export function scoreK12(item: K12Item, text: string): { outcome: K12Outcome; letter: K12Key | null } {
  if (text.startsWith("ERROR:")) return { outcome: "error", letter: null };
  const letter = extractChoice(text);
  if (!letter) return { outcome: "no-parse", letter: null };
  return { outcome: letter === item.key ? "correct" : "wrong", letter };
}

export interface K12Tally {
  total: number;
  correct: number;
  wrong: number;
  noParse: number;
  error: number;
}

/** Intention-to-treat: accuracy is correct / total. `no-parse` and `error` count against the
 *  headline and are reported separately so a format failure cannot hide inside "wrong". */
export function tally(rows: Array<{ outcome: K12Outcome }>): K12Tally {
  const out: K12Tally = { total: rows.length, correct: 0, wrong: 0, noParse: 0, error: 0 };
  for (const { outcome } of rows) {
    if (outcome === "correct") out.correct++;
    else if (outcome === "wrong") out.wrong++;
    else if (outcome === "no-parse") out.noParse++;
    else out.error++;
  }
  return out;
}

// ── Statistics (pure) ────────────────────────────────────────────────────────
// The unit of analysis is the item. There are no repeats, so each item contributes one Bernoulli
// draw and the interval covers item sampling and generation noise jointly.

const Z95 = 1.959964;

/** 95% Wilson score interval for k successes in n trials, as [lo, hi] proportions. */
export function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Exact two-sided McNemar p-value on the discordant pairs: b items only the first arm got right,
 *  c items only the second did. No discordant pairs means no evidence either way, so p = 1. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  let term = 1; // C(n, 0)
  let sum = 0;
  for (let i = 0; i <= Math.min(b, c); i++) {
    sum += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * sum) / 2 ** n);
}
