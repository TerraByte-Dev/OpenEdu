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
// pre-registration with a new dated results file; the old file stays. A reply counts only if its
// final ANSWER line is one letter alone, or one letter followed by that letter's own option text;
// anything else there is a `no-parse`, even if an earlier line named one letter.
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
// arm grounds zero items; a void run is discarded whole and logged with its counts. An ERROR row is
// a turn that threw, stalled, was aborted or outran the 10-minute watchdog. (3) No prompt,
// parser, system-prompt or item change after the freeze commit. Only `K12_PILOT` may be sent to the
// model before it. (4) A key changes only if objectively wrong, through an Errata section showing
// item ids and the number before and after. (5) Strata are descriptive.
//
// Expectation, stated up front: H will most likely be null. These are facts in the model's
// parametric memory, at most one card is injected, and the library is high-school-leaning. The
// quotable number is the absolute accuracy.
//
// KEY CHECK (2026-10-08). Items were drafted by Claude, one author per subject x band cell, with no
// access to this repo or the library. All 252 (240 + 12 pilot) were then answered blind — stem and
// options, no key — by a second Claude solver: 0 key disagreements. That solver is the same model
// family as the author, so agreement is weaker evidence than an independent solver would give. It
// flagged 1 item (ela-912-01, an off-grade near-duplicate of a 6-8 item); replaced, re-solved,
// agrees. 0 keys changed.
// HUMAN CHECK: PENDING — 48 items (4 random per cell) to be hand-checked by the maintainer before
// the freeze merges. This line is replaced with the counts when that is done.

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

// The grader accepts exactly two shapes after the ANSWER label and nothing else:
//   the letter alone             ANSWER: B     **Answer**: (B)     ANSWER: \boxed{B}
//   the letter + ITS OWN option  ANSWER: B) 7/8     ANSWER: Option B - 7/8
// Everything else is a no-parse: a hedge ("B or C", "**B** **C**"), an enumeration ("A) 5/8 B) 7/8"),
// a word or variable that merely starts with a letter ("A triangle", "D-Day", "a_n = 2n"), prose
// ("B because ..."). Earlier versions tried to list the bad shapes and kept missing one; a wrong
// letter is worse than none, so this lists the good shapes instead.

// The label, with at most two words before it on its line ("Corrected ANSWER: C", "The correct
// answer is: B") — more than that is prose that happens to contain it ("Why not the other answer:
// C."). Nothing crosses a newline. A label with nothing after it is not an answer line.
const LABEL_RE = /^(.*?)\banswer\b[ \t]*[*_]*(?:[ \t]+is)?[ \t]*[*_]*[ \t]*[:：][ \t]*(.*)$/gim;
const MAX_LEAD_WORDS = 2;
// Decoration that may wrap the letter: markdown, brackets, quotes, $ and the common LaTeX wrappers
// (\x5c is the backslash of "\(" and "\boxed{").
const OPENERS_RE = /^(?:(?:option|choice|letter)\b[ \t:]*)?(?:[\s*_`(\[{<"'“‘$]|\x5c\(|\x5c(?:boxed|text|mathbf|textbf|mathrm)\{)*/i;
const LETTER_RE = /^([A-Da-d])(?![A-Za-z0-9_])/;
// Letters and digits only, lower-cased: how a tail is compared with an option's text.
const norm = (s: string) => s.replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The letter on the LAST ANSWER line of a reply, or null. Last wins: a model that reconsiders
 *  mid-reply is graded on where it ended up, which is what a student would read as its answer.
 *  If that last line is not one of the two accepted shapes the reply is a no-parse — an earlier
 *  clean line is not fallen back on. `options` enables the letter-plus-own-option shape. */
export function extractChoice(text: string, options?: readonly string[]): K12Key | null {
  let last: K12Key | null = null;
  for (const line of text.matchAll(LABEL_RE)) {
    const rest = line[2].trim().replace(OPENERS_RE, "");
    if (!rest || (line[1].match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > MAX_LEAD_WORDS) continue;
    const m = LETTER_RE.exec(rest);
    const letter = m ? (m[1].toUpperCase() as K12Key) : null;
    const tail = norm(rest.slice(1));
    last = letter && (!tail || (options && tail === norm(options["ABCD".indexOf(letter)]))) ? letter : null;
  }
  return last;
}

export type K12Outcome = "correct" | "wrong" | "no-parse" | "error";

/**
 * Score one reply.
 *
 * Deliberately NOT scoreRagAnswer: no alternatives, no substring matching, no model judge. The
 * letter is right or it is not.
 *
 * `failed` is the runner saying the turn produced no reply to grade: it threw, stalled, was
 * aborted or outran the watchdog. It is a flag, not a text prefix, so a model reply that happens to
 * open with "ERROR:" is still graded. A reply cut at the output cap is NOT failed: it is graded on
 * its text, because that text is what a student would see.
 */
export function scoreK12(item: K12Item, text: string, failed = false): { outcome: K12Outcome; letter: K12Key | null } {
  if (failed) return { outcome: "error", letter: null };
  const letter = extractChoice(text, item.options);
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

// ── Verdict (pure) ───────────────────────────────────────────────────────────
// The pre-registered bar applied to a complete run. Here rather than in the runner so the
// comparisons that give K12_BAR its meaning are executed by the tests.

/** Paired contrast, first arm vs second: b = items only the first got right, c = only the second. */
export interface K12Contrast {
  b: number;
  c: number;
  p: number;
}

export interface K12Verdict {
  /** Non-null when rule 2 voids the run; the clauses below are then not a result. */
  void: string | null;
  V: boolean;
  A: boolean;
  H: "lift" | "reduces" | "no-difference";
  C: boolean;
}

type K12Scored = { id: string; outcome: K12Outcome };

export function contrastK12(first: K12Scored[], second: K12Scored[]): K12Contrast | null {
  if (!first.length || !second.length) return null;
  const secondRight = new Set(second.filter((r) => r.outcome === "correct").map((r) => r.id));
  let b = 0;
  let c = 0;
  for (const r of first) {
    const right = r.outcome === "correct";
    if (right && !secondRight.has(r.id)) b++;
    if (!right && secondRight.has(r.id)) c++;
  }
  return { b, c, p: mcnemarExact(b, c) };
}

/** `byArm` must hold `raw` and `shipping`; `shippingVsRaw` is contrastK12(shipping rows, raw rows). */
export function judgeK12(byArm: Record<string, K12Tally>, grounded: number, shippingVsRaw: K12Contrast): K12Verdict {
  const arms = Object.keys(byArm);
  const { raw, shipping } = byArm;
  const errored = arms.filter((a) => byArm[a].error / byArm[a].total > K12_BAR.maxErrorRate);
  return {
    void: errored.length
      ? `ERROR rows over the limit in ${errored.join(", ")}`
      : grounded === 0 ? "the shipping arm grounded zero items" : null,
    V: arms.every((a) => byArm[a].noParse / byArm[a].total <= K12_BAR.maxNoParseRate),
    A: wilson95(shipping.correct, shipping.total)[0] >= K12_BAR.shippingWilsonLowerBound,
    H: shippingVsRaw.p < K12_BAR.alpha ? (shippingVsRaw.b > shippingVsRaw.c ? "lift" : "reduces") : "no-difference",
    C: raw.correct / raw.total >= K12_BAR.ceiling,
  };
}
