// Lever 19's newly reachable senses (docs/BENCHMARKS.md row 19, R1 b): the senses the child-safety
// filter keeps but lever 18's caps never show, each headword typed as itself. Ranking can bring any of
// them into a note, so they are read once, blind, before any run. Used by define-safety.test.ts (which
// pins the count) and newly-reachable.ts (which writes the list).

import type { DictionaryEntry, Shard } from "../../dictionary";
import { blockedWord, childSafeExample, childSafeSense, selectSenses } from "../../kernel/defineWord";

export interface ReachableSense {
  headword: string;
  /** 1-based position in the headword's stored senses, with the part of speech: "14v". */
  ref: string;
  pos: string;
  definition: string;
  /** The example as it would be shown ("" when there is none or the filter drops it). */
  example: string;
}

/**
 * Every headword of the shards, typed as itself: its own (exact) senses that the filter keeps (and the
 * two-letter capitalised-form rule lets through) but selectSenses, in stored order, does not show.
 */
export async function newlyReachable(shards: readonly Shard[], lookup: (w: string) => Promise<DictionaryEntry[]>): Promise<ReachableSense[]> {
  const out: ReachableSense[] = [];
  for (const shard of shards) {
    for (const h of Object.keys(shard)) {
      if (blockedWord(h)) continue;
      const entries = await lookup(h);
      const own = entries.find((e) => e.headword === h && e.via === "exact");
      if (!own) continue;
      const shown = selectSenses(entries, h).find((p) => p.entry === own)?.senses ?? [];
      const left = [...shown];
      const lowerTwoLetter = h.length === 2 && h === h.toLowerCase();
      own.senses.forEach((s, i) => {
        if (!childSafeSense(h, s.definition)) return;
        if (lowerTwoLetter && s.form !== s.form.toLowerCase()) return;
        const at = left.findIndex((x) => x.pos === s.pos && x.definition === s.definition);
        if (at >= 0) { left.splice(at, 1); return; }
        out.push({ headword: h, ref: `${i + 1}${s.pos}`, pos: s.pos, definition: s.definition, example: s.example && childSafeExample(h, s.example) ? s.example : "" });
      });
    }
  }
  return out;
}

/** The list as tab-separated text, one sense per line, with a header. Tabs and line breaks in the
 *  text become spaces. */
export function reachableTsv(rows: readonly ReachableSense[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  return ["headword\tref\tpos\tdefinition\texample", ...rows.map((r) => [r.headword, `#${r.ref}`, r.pos, r.definition, r.example].map(clean).join("\t"))].join("\n") + "\n";
}
