// The define suite's hand-label check (docs/BENCHMARKS.md B8 and lever 18, the validation gate). Pure:
// no I/O. The sheet and the scripts that use this are in headless/: define-label-sheet.ts builds the
// sheet, define-label-grader2.ts has the blind second grader answer it, define-kappa.ts scores it.
//
// Two graders (Tate, and a blind grader 2 from a different model family) answer plain yes/no questions
// about ~60 real dev replies, pooled across arms and models, shuffled, with the arm, the model and the
// lexical verdict hidden. The answers map to the grader's two readings (lenient: the reply gives a
// correct meaning; strict, for sense items: and presents no other meaning), and Cohen's kappa compares
// each grader with the lexical grader (define-grade.ts). The bar is kappa >= 0.8 per reading.
//
// Reused from the k12-flow check (k12-flow-label.ts): cohenKappa, the export file shape and the seeded
// shuffle (headless/select.ts). The k12 sheet's renderer and row draw are k12-shaped (three turns and
// four options per row), so the define sheet has its own, smaller ones.

import { cohenKappa, type Answer, type Kappa, type LabelAnswers, type LabelExport } from "./k12-flow-label";
import { seededRandom } from "./headless/select";
import type { DefineKind } from "./define-items";
import type { GradeBand } from "../grade";

export type { Answer, LabelAnswers, LabelExport, Kappa };

export interface DefineLabelQuestion {
  id: "meaning" | "other";
  /** "sense" questions are asked on sense items only. */
  kinds: readonly DefineKind[];
  /** `{word}` is the asked word; `{sense}` is filled in on sense items. */
  text: string;
}

export const DEFINE_LABEL_QUESTIONS: readonly DefineLabelQuestion[] = [
  {
    id: "meaning",
    kinds: ["plain", "sense"],
    text:
      'Does the reply give a correct meaning of "{word}"{sense}? Yes if a student who read only this reply would come away ' +
      "with a correct meaning, in any words. Extra meanings, examples or questions do not matter here. No if the meaning it " +
      "gives is wrong, or it gives none (for example, it only asks the student a question back).",
  },
  {
    id: "other",
    kinds: ["sense"],
    text:
      'Does the reply also present a different meaning of "{word}", one that does not fit the student\'s sentence? ' +
      'Yes even if it says that meaning does not apply here ("not the money kind of bank").',
  },
];
export const SENSE_CLAUSE = " as it is used in the student's sentence";

export function questionText(q: DefineLabelQuestion, word: string, kind: DefineKind): string {
  return q.text.split("{word}").join(word).split("{sense}").join(kind === "sense" ? SENSE_CLAUSE : "");
}

/** A grader's two readings from their answers; null where a needed answer is missing. Plain items have
 *  one reading, so strict = lenient for them, as in define-grade.ts. */
export function defineHumanVerdicts(a: LabelAnswers, kind: DefineKind): { lenient: boolean | null; strict: boolean | null } {
  const yes = (id: string): boolean | null => (a[id] === "yes" ? true : a[id] === "no" ? false : null);
  const lenient = yes("meaning");
  if (kind === "plain") return { lenient, strict: lenient };
  const other = yes("other");
  return { lenient, strict: lenient === null ? null : lenient ? (other === null ? null : !other) : false };
}

/** The hidden key: the lexical verdicts per sheet row and where each row came from. */
export interface DefineLabelVerdicts {
  sheet: string;
  /** The commits that last changed the lexical grader and the items when the sheet was built. */
  grader: string;
  /** True for a harm-adjudication sheet (every row of the named items), false for the kappa sheet. */
  adjudication: boolean;
  rows: Record<string, { source: string; model: string; arm: "B" | "D"; item: string; repeat: number; kind: DefineKind; band: GradeBand; lenient: boolean; strict: boolean }>;
}

export function checkDefineVerdicts(v: DefineLabelVerdicts): void {
  if (typeof v.grader !== "string" || !v.grader) throw new Error("The verdicts file does not name its grader commits; rebuild it with define-label-sheet.ts.");
  for (const [rid, r] of Object.entries(v.rows)) {
    if (r.arm !== "B" && r.arm !== "D") throw new Error(`Verdict row ${rid} has no arm.`);
    if (typeof r.lenient !== "boolean" || typeof r.strict !== "boolean") throw new Error(`Verdict row ${rid} has no lexical verdict.`);
  }
}

// ── Row selection (frozen with the gate) ─────────────────────────────────────

export const DEFINE_LABEL_SEED = 20261111;
export const DEFINE_LABEL_ROWS = 60;

export interface DefineLabelCandidate {
  /** `${model}|${arm}|${item}|${repeat}` */
  uid: string;
  model: string;
  arm: "B" | "D";
  item: string;
  repeat: number;
  kind: DefineKind;
  band: GradeBand;
  lenient: boolean;
  strict: boolean;
}

interface Need { why: string; min: number; test: (c: DefineLabelCandidate) => boolean }

const NEEDS: readonly Need[] = [
  { why: "arm B", min: 25, test: (c) => c.arm === "B" },
  { why: "arm D", min: 25, test: (c) => c.arm === "D" },
  { why: "sense items", min: 16, test: (c) => c.kind === "sense" },
  { why: "lexical fail", min: 12, test: (c) => !c.lenient },
  { why: "lexical pass", min: 12, test: (c) => c.lenient },
  { why: "sense, strict fail but lenient pass", min: 4, test: (c) => c.kind === "sense" && c.lenient && !c.strict },
];

/** A seeded Fisher-Yates shuffle (the k12 sheet's, headless/select.ts seededRandom). */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The kappa sheet's rows: from a seeded shuffle of `pool` (non-ERROR dev rows), at most one row per
 * model, arm and item; first the minimums in NEEDS, one need at a time, then filled to `total` from the
 * less-covered arm. Then shuffled again for display. The same inputs give the same rows.
 */
export function selectDefineLabelRows(pool: readonly DefineLabelCandidate[], total = DEFINE_LABEL_ROWS, seed = DEFINE_LABEL_SEED): DefineLabelCandidate[] {
  const order = shuffled([...pool].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)), seed);
  const chosen: DefineLabelCandidate[] = [];
  const key = (c: DefineLabelCandidate) => `${c.model}|${c.arm}|${c.item}`;
  const used = new Set<string>();
  const free = (c: DefineLabelCandidate) => !used.has(key(c));
  const take = (c: DefineLabelCandidate) => { chosen.push(c); used.add(key(c)); };
  for (const need of NEEDS) {
    while (chosen.length < total && chosen.filter(need.test).length < need.min) {
      const c = order.find((x) => free(x) && need.test(x));
      if (!c) break;
      take(c);
    }
  }
  while (chosen.length < total) {
    const arm = chosen.filter((c) => c.arm === "B").length <= chosen.filter((c) => c.arm === "D").length ? "B" : "D";
    const c = order.find((x) => free(x) && x.arm === arm) ?? order.find(free);
    if (!c) break;
    take(c);
  }
  return shuffled(chosen, seed + 1);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export type Reading = "lenient" | "strict";

export interface DefineKappaRow {
  reading: Reading;
  graders: Kappa;
  aVsLexical: Kappa;
  bVsLexical: Kappa;
  agreedVsLexical: Kappa;
  /** Per arm, on rows where the graders agree: the lexical grader's false passes (lexical pass, human
   *  fail) of the human fails, and false fails (lexical fail, human pass) of the human passes. */
  byArm: Record<"B" | "D", { falsePass: number; humanFail: number; falseFail: number; humanPass: number }>;
  /** Both graders against the lexical grader at kappa >= 0.8. */
  meetsBar: boolean;
}

export const DEFINE_KAPPA_BAR = 0.8;

/** Kappa per reading. Strict is read on sense rows only (on plain rows it is the lenient reading). */
export function defineKappaReport(a: LabelExport, b: LabelExport, v: DefineLabelVerdicts): DefineKappaRow[] {
  return (["lenient", "strict"] as const).map((reading) => {
    const rids = Object.keys(v.rows).filter((rid) => reading === "lenient" || v.rows[rid].kind === "sense");
    const human = (e: LabelExport, rid: string) => defineHumanVerdicts(e.answers[rid] ?? {}, v.rows[rid].kind)[reading];
    const lex = (rid: string) => v.rows[rid][reading];
    const pairs = (x: (rid: string) => boolean | null, y: (rid: string) => boolean | null) =>
      rids.flatMap((rid): Array<[boolean, boolean]> => {
        const p = x(rid);
        const q = y(rid);
        return p === null || q === null ? [] : [[p, q]];
      });
    const A = (rid: string) => human(a, rid);
    const B = (rid: string) => human(b, rid);
    const agreed = (rid: string) => (A(rid) !== null && A(rid) === B(rid) ? A(rid) : null);
    const byArm = { B: { falsePass: 0, humanFail: 0, falseFail: 0, humanPass: 0 }, D: { falsePass: 0, humanFail: 0, falseFail: 0, humanPass: 0 } };
    for (const rid of rids) {
      const h = agreed(rid);
      if (h === null) continue;
      const t = byArm[v.rows[rid].arm];
      if (h) { t.humanPass++; if (!lex(rid)) t.falseFail++; }
      else { t.humanFail++; if (lex(rid)) t.falsePass++; }
    }
    const aVsLexical = cohenKappa(pairs(A, lex));
    const bVsLexical = cohenKappa(pairs(B, lex));
    return {
      reading, graders: cohenKappa(pairs(A, B)), aVsLexical, bVsLexical, agreedVsLexical: cohenKappa(pairs(agreed, lex)), byArm,
      meetsBar: [aVsLexical, bVsLexical].every((k) => k.kappa !== null && k.kappa >= DEFINE_KAPPA_BAR),
    };
  });
}

/**
 * Harm adjudication (lever 18): the verdict per adjudicated row is the graders' when they agree and the
 * lexical one when they do not. Returns, per item and arm, the adjudicated majority over its repeats
 * (ties fail), to replace the lexical item verdicts of the items a harm clause named.
 */
export function adjudicatedMajority(a: LabelExport, b: LabelExport, v: DefineLabelVerdicts): Map<string, { B: boolean | null; D: boolean | null }> {
  const tally = new Map<string, { B: [number, number]; D: [number, number] }>();
  for (const [rid, r] of Object.entries(v.rows)) {
    const ha = defineHumanVerdicts(a.answers[rid] ?? {}, r.kind).lenient;
    const hb = defineHumanVerdicts(b.answers[rid] ?? {}, r.kind).lenient;
    const pass = ha !== null && ha === hb ? ha : r.lenient;
    const t = tally.get(r.item) ?? { B: [0, 0], D: [0, 0] };
    t[r.arm][1]++;
    if (pass) t[r.arm][0]++;
    tally.set(r.item, t);
  }
  return new Map([...tally].map(([item, t]) => [item, {
    B: t.B[1] ? t.B[0] * 2 > t.B[1] : null,
    D: t.D[1] ? t.D[0] * 2 > t.D[1] : null,
  }]));
}
