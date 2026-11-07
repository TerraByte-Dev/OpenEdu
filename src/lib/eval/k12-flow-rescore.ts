// Re-apply the k12-flow detectors to saved rows, with no model call. Pure: the caller loads the
// results JSON and the items. Used by headless/rescore.ts to publish old-vs-new verdicts when a
// detector changes, and by the hand-label sheet for the verdicts it hides from the graders.

import { finalAnswer, gradeK12Flow, parseCommits, type K12FlowGrade } from "./k12-flow-grade";
import { formatK12FlowT1 } from "./k12-flow";
import { wilson95 } from "./k12-fixture";
import type { K12Item, K12Key } from "./k12-items";

/** The fields of a saved results-file row the rescore reads. */
export interface SavedK12FlowRow {
  id: string;
  key: K12Key;
  attempted: K12Key;
  turns: Array<{ user: string; text: string }>;
  grade: (Omit<K12FlowGrade, "g2b"> & { g2b?: boolean }) | null;
}

/** The verdicts compared old vs new. `pass` is the headline (G1 and G2 and G3). */
export const RESCORE_DETECTORS = ["pass", "g1", "g1b", "g2", "g2b", "g3", "g4", "g5"] as const;
export type RescoreDetector = (typeof RESCORE_DETECTORS)[number];

export interface RescoredRow {
  id: string;
  old: SavedK12FlowRow["grade"];
  next: K12FlowGrade | null;
  /** Detectors whose verdict changed. A detector the old grade did not have (G2b) never flips. */
  flips: RescoreDetector[];
}

export interface RescoreResult {
  rows: RescoredRow[];
  /** Rows whose T1 text is not what formatK12FlowT1 builds for the item today: the item drifted. */
  drifted: string[];
}

/** Re-grade every row with the current detectors. ERROR rows (no grade) stay ungraded. */
export function rescoreRows(rows: readonly SavedK12FlowRow[], items: readonly K12Item[]): RescoreResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const drifted: string[] = [];
  const out = rows.map((r): RescoredRow => {
    const item = byId.get(r.id);
    if (!item) throw new Error(`No item with id ${r.id}`);
    if (r.turns[0]?.user !== formatK12FlowT1(item) || r.key !== item.key) drifted.push(r.id);
    if (!r.grade) return { id: r.id, old: null, next: null, flips: [] };
    const [t1, t2, t3] = r.turns.map((t) => t.text);
    const next = gradeK12Flow(item, { t1, t2, t3 }, r.attempted);
    const flips = RESCORE_DETECTORS.filter((d) => r.grade![d] !== undefined && r.grade![d] !== next[d]);
    return { id: r.id, old: r.grade, next, flips };
  });
  return { rows: out, drifted };
}

export interface DetectorCount {
  detector: RescoreDetector;
  /** Null when the old grade did not have this detector. */
  old: { k: number; n: number; wilson: [number, number] } | null;
  next: { k: number; n: number; wilson: [number, number] };
  passToFail: number;
  failToPass: number;
}

/** Per detector, old and new pass counts. The headline is over all rows (ERROR = fail); every
 *  other detector is over graded rows only, as in summarizeK12Flow. */
export function countDetectors(res: RescoreResult): DetectorCount[] {
  const graded = res.rows.filter((r) => r.old && r.next);
  return RESCORE_DETECTORS.map((d) => {
    const n = d === "pass" ? res.rows.length : graded.length;
    const hasOld = graded.every((r) => r.old![d] !== undefined);
    const k = (pick: (r: RescoredRow) => boolean | undefined) => graded.filter((r) => pick(r) === true).length;
    const oldK = k((r) => r.old![d]);
    const newK = k((r) => r.next![d]);
    return {
      detector: d,
      old: hasOld ? { k: oldK, n, wilson: wilson95(oldK, n) } : null,
      next: { k: newK, n, wilson: wilson95(newK, n) },
      passToFail: graded.filter((r) => r.flips.includes(d) && r.old![d] === true).length,
      failToPass: graded.filter((r) => r.flips.includes(d) && r.old![d] === false).length,
    };
  });
}

/** The last sentence or line of `text` that commits to `letter` (by default, its final answer) on
 *  its own, with prose matches read. For showing why a verdict flipped. Null when none does. */
export function commitQuote(text: string, options: readonly string[], letter?: K12Key): string | null {
  const want = letter ?? finalAnswer(text, options, { prose: true })?.letter;
  if (!want) return null;
  const parts = text.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parseCommits(parts[i], options, { prose: true }).some((c) => c.letter === want)) return parts[i];
  }
  return null;
}
