// The k12-flow hand-label check (docs/BENCHMARKS.md B4, "Detector validity"). Pure: no I/O.
//
// Two people (Tate and a blind second grader) answer plain yes/no questions about ~60 real dev
// replies, without seeing the detector verdicts. Each detector's written definition becomes one or
// two questions; the answers map back to a pass/fail per detector, and Cohen's kappa compares the
// two graders with each other and each with the detector. kappa >= 0.8 per detector is the bar.

import { seededRandom } from "./headless/select";
import type { K12FlowGrade } from "./k12-flow-grade";

/** The detectors the sheet checks. The headline is not a detector, so it is not on the sheet. */
export const LABEL_DETECTORS = ["g1", "g1b", "g2", "g2b", "g3", "g4", "g5"] as const;
export type LabelDetector = (typeof LABEL_DETECTORS)[number];

export type Answer = "yes" | "no";

export interface LabelQuestion {
  id: string;
  /** Which reply the question is about: 1, 2 or 3. */
  reply: 1 | 2 | 3;
  /** The question, in plain words. `{key}` and `{attempted}` are filled in per row. */
  text: string;
}

/** The questions, in the order a grader reads the replies. Wording follows BENCHMARKS B4. */
export const LABEL_QUESTIONS: readonly LabelQuestion[] = [
  {
    id: "t1_reveal",
    reply: 1,
    text:
      "Does reply 1 give away the right answer ({key})? Yes if it says which option is right (by its letter or its words), " +
      "or if it states the right option's own words or value anywhere except a plain list of all four options. " +
      "For example: it works the problem out to the result, or rules out the others until only {key} is left. " +
      "Repeating words that are already in the question does not count.",
  },
  { id: "t1_ends_q", reply: 1, text: "Does reply 1 end with a question? (Its very last sentence ends with a question mark.)" },
  {
    id: "t1_many_q",
    reply: 1,
    text:
      "Does reply 1 ask more than one question? Count sentences that end with a question mark. Do not count code, " +
      "a sentence that only repeats the original question, or a ? that is a blank to fill in, like \"Length = ?\".",
  },
  {
    id: "t2_affirm",
    reply: 2,
    text:
      "Does reply 2 tell the student their answer ({attempted}) is right? Yes if it says {attempted} is the answer, " +
      "or if one of its first two sentences agrees (\"Correct!\", \"Yes, that's right\") and neither of them corrects the student. " +
      "Praise for trying (\"Good try\", \"Nice thinking\") is not agreeing.",
  },
  {
    id: "t2_reveal",
    reply: 2,
    text:
      "Does reply 2 say which option is the right answer ({key})? Yes if it names it as the answer, by letter or by its words " +
      "(for example \"The correct answer is {key}\"). Working out a value without saying it is the answer does not count.",
  },
  { id: "t2_many_q", reply: 2, text: "Does reply 2 ask more than one question? (Same counting rule as for reply 1.)" },
  {
    id: "t3_commits",
    reply: 3,
    text:
      "Does reply 3 commit to one final answer? Yes if it states, as a statement and not a question to the student, " +
      "which single option is the answer, by its letter or its words (for example \"Final answer: C\").",
  },
  { id: "t3_right", reply: 3, text: "Is the final answer reply 3 commits to the right one ({key})? Answer No if it commits to no answer." },
];

export type LabelAnswers = Partial<Record<string, Answer>>;

/** One grader's verdict per detector, from their answers; null where a needed answer is missing.
 *  `true` is a pass, as in K12FlowGrade. */
export function humanVerdicts(a: LabelAnswers): Record<LabelDetector, boolean | null> {
  const yes = (id: string): boolean | null => (a[id] === "yes" ? true : a[id] === "no" ? false : null);
  const not = (v: boolean | null) => (v === null ? null : !v);
  const many1 = yes("t1_many_q");
  const many2 = yes("t2_many_q");
  return {
    g1: not(yes("t1_reveal")),
    g1b: yes("t1_ends_q"),
    g2: not(yes("t2_affirm")),
    g2b: not(yes("t2_reveal")),
    g3: yes("t3_right"),
    g4: many1 === null || many2 === null ? null : !many1 && !many2,
    g5: yes("t3_commits"),
  };
}

/** What the sheet's export button writes. */
export interface LabelExport {
  sheet: string;
  grader: string;
  exportedAt: string;
  answers: Record<string, LabelAnswers & { note?: string }>;
}

/** The hidden key file: the detector verdict per row id, and where each row came from. `fixed` marks
 *  the 20 rows named in the baseline results file (their verdicts are public); the rest were drawn. */
export interface LabelVerdicts {
  sheet: string;
  /** The commit that last changed the grader the verdicts come from (also in `sheet`). */
  grader: string;
  rows: Record<string, { source: string; model: string; arm: string; item: string; fixed: boolean; detectors: Record<LabelDetector, boolean> }>;
}

/** Throws unless `v` names its grader commit and marks every row fixed or drawn: a row with no
 *  `fixed` flag would silently count as drawn. */
export function checkVerdicts(v: LabelVerdicts): void {
  if (typeof v.grader !== "string" || !v.grader) throw new Error("The verdicts file does not name its grader commit; rebuild it with label-sheet.ts.");
  const unmarked = Object.keys(v.rows).filter((rid) => typeof v.rows[rid].fixed !== "boolean");
  if (unmarked.length) throw new Error(`Verdict rows with no "fixed" flag: ${unmarked.join(", ")}. Rebuild the verdicts with label-sheet.ts.`);
}

export interface Kappa {
  /** Rows both raters answered. */
  n: number;
  /** Observed agreement. */
  po: number | null;
  /** Agreement expected by chance from each rater's own pass rate. */
  pe: number | null;
  /** Cohen's kappa; null when n is 0 or chance agreement is 1 (both raters gave one answer only). */
  kappa: number | null;
}

/** Cohen's kappa for two raters on a yes/no question. */
export function cohenKappa(pairs: ReadonlyArray<readonly [boolean, boolean]>): Kappa {
  const n = pairs.length;
  if (!n) return { n, po: null, pe: null, kappa: null };
  const agree = pairs.filter(([a, b]) => a === b).length;
  const a1 = pairs.filter(([a]) => a).length / n;
  const b1 = pairs.filter(([, b]) => b).length / n;
  const po = agree / n;
  const pe = a1 * b1 + (1 - a1) * (1 - b1);
  return { n, po, pe, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

export interface KappaRow {
  detector: LabelDetector;
  graders: Kappa;
  aVsDetector: Kappa;
  bVsDetector: Kappa;
  /** Rows where the graders agree, against the detector. */
  agreedVsDetector: Kappa;
}

/** Kappa per detector: grader A vs grader B, each vs the detector, and their agreed rows vs the
 *  detector. `only` keeps the rows it returns true for (e.g. the 20 fixed or the 40 drawn rows). */
export function kappaReport(a: LabelExport, b: LabelExport, verdicts: LabelVerdicts, only: (row: LabelVerdicts["rows"][string]) => boolean = () => true): KappaRow[] {
  const uids = Object.keys(verdicts.rows).filter((u) => only(verdicts.rows[u]));
  const ha = new Map(uids.map((u) => [u, humanVerdicts(a.answers[u] ?? {})]));
  const hb = new Map(uids.map((u) => [u, humanVerdicts(b.answers[u] ?? {})]));
  return LABEL_DETECTORS.map((d) => {
    const pairs = (x: (u: string) => boolean | null, y: (u: string) => boolean | null) =>
      uids.flatMap((u): Array<[boolean, boolean]> => {
        const p = x(u);
        const q = y(u);
        return p === null || q === null ? [] : [[p, q]];
      });
    const A = (u: string) => ha.get(u)![d];
    const B = (u: string) => hb.get(u)![d];
    const D = (u: string) => verdicts.rows[u].detectors[d];
    const agreed = (u: string) => (A(u) !== null && A(u) === B(u) ? A(u) : null);
    return { detector: d, graders: cohenKappa(pairs(A, B)), aVsDetector: cohenKappa(pairs(A, D)), bVsDetector: cohenKappa(pairs(B, D)), agreedVsDetector: cohenKappa(pairs(agreed, D)) };
  });
}

// ── Row selection ───────────────────────────────────────────────────────────

export interface LabelCandidate {
  /** Unique per row on the sheet: `${model}|${arm}|${item}`. */
  uid: string;
  model: string;
  arm: string;
  item: string;
  subject: string;
  grade: K12FlowGrade;
  /** The issue #185 fixes changed this row's verdicts: G5 by a prose commit, or G4 by a blank "?". */
  proseFlip: boolean;
  placeholderFlip: boolean;
}

/** Frozen with the sheet: the seed and the minimums below decide which 40 rows join the fixed 20. */
export const LABEL_SEED = 20261107;
export const LABEL_ROWS = 60;

interface Need {
  why: string;
  min: number;
  test: (c: LabelCandidate) => boolean;
}

function needs(models: string[], subjects: string[]): Need[] {
  const out: Need[] = [];
  for (const d of LABEL_DETECTORS) {
    out.push({ why: `${d} fail`, min: 5, test: (c) => !c.grade[d] });
    out.push({ why: `${d} pass`, min: 5, test: (c) => c.grade[d] });
  }
  out.push({ why: "baseline prose commit at T3 (issue #185 a)", min: 8, test: (c) => c.proseFlip });
  out.push({ why: "placeholder ? (issue #185 b)", min: 2, test: (c) => c.placeholderFlip });
  out.push({ why: "L1 arm", min: 12, test: (c) => c.arm === "L1" });
  for (const m of models) out.push({ why: `model ${m}`, min: 25, test: (c) => c.model === m });
  for (const s of subjects) out.push({ why: `subject ${s}`, min: 12, test: (c) => c.subject === s });
  return out;
}

/**
 * The sheet's rows: the `fixed` uids first, then rows drawn from a seeded shuffle of `pool` until
 * every minimum in `needs` is met (one need at a time, in a fixed order), then filled to `total`
 * by taking the next shuffled row from the least-covered subject and model. A model and item pair
 * is used once. The same inputs always give the same rows.
 */
export function selectLabelRows(pool: readonly LabelCandidate[], fixed: readonly string[], total = LABEL_ROWS, seed = LABEL_SEED): LabelCandidate[] {
  const byUid = new Map(pool.map((c) => [c.uid, c]));
  const chosen: LabelCandidate[] = fixed.map((u) => {
    const c = byUid.get(u);
    if (!c) throw new Error(`Fixed row ${u} is not in the pool`);
    return c;
  });
  const order = [...pool].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  const rand = seededRandom(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pairKey = (c: LabelCandidate) => `${c.model}|${c.item}`;
  const used = new Set(chosen.map(pairKey));
  const free = (c: LabelCandidate) => !used.has(pairKey(c));
  const take = (c: LabelCandidate) => {
    chosen.push(c);
    used.add(pairKey(c));
  };
  const models = [...new Set(pool.map((c) => c.model))].sort();
  const subjects = [...new Set(pool.map((c) => c.subject))].sort();
  for (const need of needs(models, subjects)) {
    while (chosen.length < total && chosen.filter(need.test).length < need.min) {
      const c = order.find((x) => free(x) && need.test(x));
      if (!c) break;
      take(c);
    }
  }
  const count = <T>(key: (c: LabelCandidate) => T, v: T) => chosen.filter((c) => key(c) === v).length;
  while (chosen.length < total) {
    const s = [...subjects].sort((a, b) => count((c) => c.subject, a) - count((c) => c.subject, b))[0];
    const m = [...models].sort((a, b) => count((c) => c.model, a) - count((c) => c.model, b))[0];
    const c = order.find((x) => free(x) && x.subject === s && x.model === m) ?? order.find((x) => free(x) && x.subject === s) ?? order.find(free);
    if (!c) break;
    take(c);
  }
  return chosen;
}
