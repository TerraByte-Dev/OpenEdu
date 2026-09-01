// Regression gate for LIBRARY retrieval. Pure, model-free, runs in milliseconds.
//
// It scores the real bundled manifest, so it measures the corpus that actually ships. The baseline
// below was measured on the 154-card manifest at the commit that introduced this file. When you
// change the ranker, these numbers must move in the right direction and the detail dump tells you
// which queries moved.
//
// READ THIS BEFORE TRUSTING THE HEADLINE NUMBERS.
//
// P@1 0.892 / R@3 0.919 look strong and are somewhat flattering: most queries here are the happy
// path, where a phrase bonus against a curated title or alias does the work. That is worth pinning
// precisely because it is what a careless ranker change would break — but it is NOT the number that
// says retrieval is healthy.
//
// The number that says retrieval is unhealthy is GAP PURITY: 0.545. Five of eleven questions the
// library provably cannot answer still return a card above the grounding floor, which means the
// tutor is handed a confidently irrelevant passage and invited to use it. Two examples, measured:
//
//   "what are the rules for derivatives"  -> chemistry/oxidation-rules@7, ela/comma-rules@7,
//                                            math/logarithm-rules@7      (the token "rules")
//   "types of chemical bonding"           -> chemistry/reaction-types@9  ("types" + "chemical")
//
// No card is weighted by how common its terms are, so a stopword-adjacent token like "rules",
// "types" or "point" scores exactly as much as "electronegativity". That is the defect to fix, and
// gapPurity is the metric that will show it being fixed.

import { describe, it, expect } from "vitest";
import type { LibraryEntry } from "../../types";
import { evaluateLibraryRetrieval, LIBRARY_QUERIES, LIBRARY_FLOOR } from "./library-fixture";

// The real bundled manifest, imported rather than read off disk. `npm run build` runs tsc over the
// whole of src/ including tests, and this project has no @types/node — so a node:fs read typechecks
// locally (where the types are hoisted) and fails in CI on a clean install. resolveJsonModule is
// already on, so the import is both portable and statically checked.
import manifestJson from "../../../public/library/index.json";

/**
 * Measured on the shipped 154-card manifest. Every ratio is a floor except `floorViolations`,
 * which is a ceiling. A ranker change that regresses any of these is a bug, not a trade-off —
 * if you believe otherwise, move the number in the same commit and say why.
 */
export const LIBRARY_BASELINE = {
  cards: 154,
  queries: 48,
  ranked: 37,
  p1: 0.892,
  r3: 0.919,
  floorViolations: 4,
  gapPurity: 0.545,
  gapQueries: 11,
} as const;

const manifest = manifestJson as unknown as LibraryEntry[];

describe("library retrieval — fixture integrity", () => {
  it("scores the real bundled manifest", () => {
    expect(manifest.length).toBe(LIBRARY_BASELINE.cards);
  });

  it("every expected and forbidden id exists in the manifest", () => {
    // A typo'd id would silently make a query unfalsifiable — it could never hit and never be
    // violated, which is the worst possible failure mode for a measuring device.
    const ids = new Set(manifest.map((e) => e.id));
    const missing: string[] = [];
    for (const q of LIBRARY_QUERIES) {
      for (const id of [...(q.expect ?? []), ...(q.forbid ?? [])]) {
        if (!ids.has(id)) missing.push(`${q.ask} -> ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("a gap query never carries expectations, and vice versa", () => {
    const bad = LIBRARY_QUERIES.filter((q) => q.gap && q.expect?.length).map((q) => q.ask);
    expect(bad).toEqual([]);
  });
});

describe("library retrieval — regression gate", () => {
  const r = evaluateLibraryRetrieval(manifest);

  it("does not regress precision at rank 1", () => {
    expect(r.p1).toBeGreaterThanOrEqual(LIBRARY_BASELINE.p1);
  });

  it("does not regress recall at rank 3", () => {
    expect(r.r3).toBeGreaterThanOrEqual(LIBRARY_BASELINE.r3);
  });

  it("does not admit more known-bad cards above the grounding floor", () => {
    // Currently 4: the `ir` collision on two romance-verb cards, and the `point` collision twice.
    expect(r.floorViolations).toBeLessThanOrEqual(LIBRARY_BASELINE.floorViolations);
  });

  it("does not regress gap purity — the metric that actually needs to move", () => {
    expect(r.gapPurity).toBeGreaterThanOrEqual(LIBRARY_BASELINE.gapPurity);
  });

  it("reports the current state for a human", () => {
    const misses = r.detail.filter((d) => d.hit === false);
    const leaks = r.detail.filter((d) => d.hit === null && d.top.some((t) => t.score >= LIBRARY_FLOOR));
    // Not an assertion — a deliberate console record so a diff in CI shows WHICH queries moved,
    // not just that a ratio changed.
    console.log(
      `\nlibrary retrieval: P@1 ${r.p1} · R@3 ${r.r3} · floor violations ${r.floorViolations}` +
        ` · gap purity ${r.gapPurity} (${r.gapQueries} gap queries)\n` +
        `  misses (${misses.length}): ${misses.map((m) => m.ask).join(" | ") || "none"}\n` +
        `  gap leaks (${leaks.length}): ${leaks.map((l) => l.ask).join(" | ") || "none"}`,
    );
    expect(r.total).toBe(LIBRARY_BASELINE.queries);
  });
});

describe("library retrieval — known defects, pinned so a fix is visible", () => {
  // These assert the BROKEN behaviour on purpose. When the ranker is fixed, each of these fails
  // and gets inverted in the same commit. That makes the fix impossible to land silently.

  it("apostrophe elision breaks an alias: 'boyles law' cannot reach chemistry/gas-laws", () => {
    // The card's alias is "boyle's law". normalizePhrase -> "boyle s law"; tokenize -> [boyle, law].
    // A student typing "boyles" produces [boyles, law], and "boyles" never matches "boyle".
    // "ohms law" works only because that card's alias happens to be written without an apostrophe.
    const hits = evaluateLibraryRetrieval(manifest, [
      { ask: "boyles law", expect: ["chemistry/gas-laws"] },
    ]);
    expect(hits.r3).toBe(0);
  });

  it("body-only terms are invisible: 'what is a lanthanide' returns nothing at all", () => {
    // "lanthanide" appears in the periodic-table body. Ranking never reads a body.
    const r = evaluateLibraryRetrieval(manifest, [
      { ask: "what is a lanthanide", expect: ["chemistry/periodic-table"] },
    ]);
    expect(r.detail[0].top).toEqual([]);
  });

  it("a common token outranks a topic term: 'rules' pulls three unrelated cards", () => {
    const r = evaluateLibraryRetrieval(manifest, [
      { ask: "what are the rules for derivatives", gap: true },
    ]);
    const above = r.detail[0].top.filter((t) => t.score >= LIBRARY_FLOOR).map((t) => t.id);
    expect(above).toContain("ela/comma-rules");
  });
});
