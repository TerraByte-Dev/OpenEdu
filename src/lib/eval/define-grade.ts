// The "define" suite's grader and arm comparison (docs/BENCHMARKS.md B8 and lever 18). Pure: no model,
// no I/O. Items: define-items.ts. Runner: define-runner.ts.
//
// A reply passes when every `expect` group matches. A group is "|"-separated alternatives, each matched
// as whole words, case-insensitive: without "*" exactly as rag-dev-v2.ts containsAlternative matches; a
// word ending in "*" also takes any letters after it ("laugh*" finds "laughing", "talk* into" finds
// "talked into"). Sense items have two readings: `pass` (lenient, expect matched) and `passStrict`
// (expect matched and no `wrongSense` term anywhere). Plain items have one; passStrict = pass.
//
// The comparison is per item, paired across two arms run at one commit (B: EVAL_DICTIONARY=off, D:
// unset). An item's verdict in an arm is the majority of its repeats; an ERROR row counts as a fail, and
// a tie (an even number of repeats split evenly) counts as a fail.

import { containsAlternative } from "./rag-dev-v2";
import { mcnemarExact, wilson95 } from "./k12-fixture";
import type { DefineItem, DefineSplit } from "./define-items";
import type { GradeBand } from "../grade";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The reply as the matcher reads it: lower case, straight apostrophes, single spaces. */
export function normalizeReply(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
}

/** The first alternative of `alternatives` found in `text`, or null. */
export function matchTerm(text: string, alternatives: string): string | null {
  const t = normalizeReply(text);
  for (const raw of alternatives.split("|")) {
    const alt = raw.trim().toLowerCase();
    if (!alt) continue;
    if (!alt.includes("*")) {
      if (containsAlternative(t, alt)) return alt;
      continue;
    }
    const body = alt.split(/\s+/).map((w) => (w.endsWith("*") ? `${esc(w.slice(0, -1))}[\\p{L}'-]*` : esc(w))).join("\\s+");
    const tail = alt.endsWith("*") ? "" : "(?![\\p{L}\\p{N}])";
    if (new RegExp(`(?<![\\p{L}\\p{N}])${body}${tail}`, "u").test(t)) return alt;
  }
  return null;
}

export interface DefineGrade {
  /** Per expect group, the alternative found, or null. */
  expectHits: Array<string | null>;
  /** The wrongSense term found, or null (always null for plain items). */
  wrongSenseHit: string | null;
  pass: boolean;
  passStrict: boolean;
}

export function gradeDefine(item: DefineItem, reply: string): DefineGrade {
  const expectHits = item.expect.map((g) => matchTerm(reply, g));
  const pass = expectHits.every((h) => h !== null);
  const wrongSenseHit = item.wrongSense ? matchTerm(reply, item.wrongSense) : null;
  return { expectHits, wrongSenseHit, pass, passStrict: pass && wrongSenseHit === null };
}

/** One saved row, as the runner writes it. */
export interface DefineRowLike {
  id: string;
  repeat: number;
  /** null for an ERROR row. */
  grade: DefineGrade | null;
}

/** Item -> majority verdict over its repeats, for one reading. Ties and ERROR rows are fails. */
export function itemMajority(rows: readonly DefineRowLike[], strict = false): Map<string, boolean> {
  const tally = new Map<string, { pass: number; n: number }>();
  for (const r of rows) {
    const t = tally.get(r.id) ?? { pass: 0, n: 0 };
    t.n++;
    if (r.grade && (strict ? r.grade.passStrict : r.grade.pass)) t.pass++;
    tally.set(r.id, t);
  }
  return new Map([...tally].map(([id, t]) => [id, t.pass * 2 > t.n]));
}

/** The pre-registered item groups (BENCHMARKS.md lever 18). */
export type DefineGroup = "common" | "plain-6-8" | "rare" | "sense" | "sense-strict" | "target" | "target-strict" | "plain-all";

const COMMON_BANDS: GradeBand[] = ["K-2", "3-5"];

export function inGroup(item: DefineItem, group: DefineGroup): boolean {
  switch (group) {
    case "common": return item.kind === "plain" && COMMON_BANDS.includes(item.band);
    case "plain-6-8": return item.kind === "plain" && item.band === "6-8";
    case "rare": return item.kind === "plain" && item.band === "9-12";
    case "sense": case "sense-strict": return item.kind === "sense";
    case "target": case "target-strict": return item.kind === "sense" || (item.kind === "plain" && item.band === "9-12");
    case "plain-all": return item.kind === "plain";
  }
}
const isStrict = (g: DefineGroup) => g.endsWith("-strict");

export const DEFINE_GROUPS: readonly DefineGroup[] = ["common", "plain-6-8", "rare", "sense", "sense-strict", "target", "target-strict", "plain-all"];

export interface ArmContrast {
  group: DefineGroup;
  n: number;
  /** Items passing (item-majority) in each arm, with a 95% Wilson interval. */
  b: { k: number; wilson: [number, number] };
  d: { k: number; wilson: [number, number] };
  /** Discordant items: only B passed (lost), only D passed (gained). */
  lost: string[];
  gained: string[];
  /** Exact two-sided McNemar p. */
  p: number;
}

/**
 * Paired contrast of arm B (baseline) and arm D (dictionary note) on the items of `split`, per group.
 * Items missing from either arm's rows are left out (a partial run is not a result; the caller says so).
 */
export function compareDefineArms(
  items: readonly DefineItem[],
  split: DefineSplit,
  splitOf: Readonly<Record<string, DefineSplit>>,
  rowsB: readonly DefineRowLike[],
  rowsD: readonly DefineRowLike[],
): ArmContrast[] {
  const majority = { b: itemMajority(rowsB), d: itemMajority(rowsD), bs: itemMajority(rowsB, true), ds: itemMajority(rowsD, true) };
  return DEFINE_GROUPS.map((group) => {
    const strict = isStrict(group);
    const B = strict ? majority.bs : majority.b;
    const D = strict ? majority.ds : majority.d;
    const ids = items.filter((i) => splitOf[i.id] === split && inGroup(i, group) && B.has(i.id) && D.has(i.id)).map((i) => i.id);
    const kb = ids.filter((id) => B.get(id)).length;
    const kd = ids.filter((id) => D.get(id)).length;
    const lost = ids.filter((id) => B.get(id) && !D.get(id));
    const gained = ids.filter((id) => !B.get(id) && D.get(id));
    return {
      group,
      n: ids.length,
      b: { k: kb, wilson: wilson95(kb, ids.length) },
      d: { k: kd, wilson: wilson95(kd, ids.length) },
      lost,
      gained,
      p: mcnemarExact(lost.length, gained.length),
    };
  });
}
