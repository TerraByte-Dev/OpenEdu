// Regression gate for LIBRARY retrieval. Pure, model-free, runs in milliseconds.
//
// It scores the real bundled manifest, so it measures the corpus that actually ships. The baseline
// below was measured on the 154-card manifest at the commit that introduced this file. When you
// change the ranker, these numbers must move in the right direction and the detail dump tells you
// which queries moved.
//
// READ THIS BEFORE TRUSTING THE HEADLINE NUMBERS.
//
// P@1 and R@3 are somewhat flattering: most queries here are the happy path, where a phrase bonus
// against a curated title or alias does the work. They are pinned because that is exactly what a
// careless ranker change would break — but they are NOT the number that says retrieval is healthy.
//
// GAP PURITY is. It measures whether questions the corpus provably cannot answer correctly return
// silence, rather than the least-bad card in the library. It was 0.545 when this fixture was
// written: five of eleven unanswerable questions returned a card above the grounding floor, so the
// tutor was handed a confidently irrelevant passage and invited to use it.
//
//   "what are the rules for derivatives"  -> chemistry/oxidation-rules@7, ela/comma-rules@7,
//                                            math/logarithm-rules@7      (the token "rules")
//   "types of chemical bonding"           -> chemistry/reaction-types@9  ("types" + "chemical")
//
// #112 fixed it — rarity damping, query coverage, length normalisation, apostrophe elision and body
// terms — and gap purity is now 1.0 with zero floor violations. The bar below is therefore a
// RATCHET: it must never fall back.

import { describe, it, expect } from "vitest";
import type { LibraryEntry } from "../../types";
import { evaluateLibraryRetrieval, LIBRARY_QUERIES, LIBRARY_FLOOR } from "./library-fixture";
import { BODY_BUDGET, tokenize, parseBodyTerms } from "../library-rank";

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
  p1: 0.973,        // was 0.892 before #112
  r3: 0.973,        // was 0.919
  floorViolations: 0, // was 4
  gapPurity: 1,     // was 0.545 — the one that mattered
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

describe("library retrieval — the three defects #112 fixed, pinned so they cannot come back", () => {
  it("apostrophe elision no longer breaks an alias: 'boyles law' reaches chemistry/gas-laws", () => {
    // The card's alias is "boyle's law". Splitting on non-alphanumerics gave [boyle, law], so a
    // student typing "boyles" produced [boyles, law] and never matched. "ohms law" worked only
    // because that card's alias happens to be written without an apostrophe. Both sides now elide.
    const r = evaluateLibraryRetrieval(manifest, [
      { ask: "boyles law", expect: ["chemistry/gas-laws"] },
    ]);
    expect(r.r3).toBe(1);
  });

  it("body-only terms are reachable: 'what is a lanthanide' finds the periodic table", () => {
    // "lanthanides" appears once in the periodic-table body and nowhere in its metadata. Ranking
    // still never reads a body at runtime — build-index.mjs distils each one into weighted terms,
    // and plural folding closes the singular/plural gap on both sides.
    const r = evaluateLibraryRetrieval(manifest, [
      { ask: "what is a lanthanide", expect: ["chemistry/periodic-table"] },
    ]);
    expect(r.r3).toBe(1);
  });

  it("a common token no longer outranks a topic term: 'rules' pulls nothing above the floor", () => {
    // Rarity damping makes "rules" cheap; query coverage then scales the whole token score by the
    // share of the query's information actually matched, so a card answering "rules" while ignoring
    // "derivatives" cannot clear the floor.
    const r = evaluateLibraryRetrieval(manifest, [
      { ask: "what are the rules for derivatives", gap: true },
    ]);
    const above = r.detail[0].top.filter((t) => t.score >= LIBRARY_FLOOR);
    expect(above).toEqual([]);
  });

  it("body evidence can lift a card across the floor but never admit one alone", () => {
    // BODY_BUDGET (5) sits below MIN_LIBRARY_SCORE (6) on purpose. This is the invariant that lets
    // bodies be indexed for coverage without body noise becoming a new source of false positives.
    expect(BODY_BUDGET).toBeLessThan(LIBRARY_FLOOR);
  });
});

describe("library retrieval — builder/app tokenizer parity", () => {
  // The single most likely way this feature silently stops working: openedu-library's
  // build-index.mjs carries its own copy of the tokenizer, and if the two drift, terms emitted
  // there can never be matched here and body indexing quietly becomes a no-op that still passes
  // every other test. Rather than import the builder, assert the invariant its output must satisfy.

  it("every emitted body term is a fixed point of the app's own tokenizer", () => {
    const bad: string[] = [];
    for (const entry of manifest) {
      for (const [term] of parseBodyTerms(entry)) {
        const round = tokenize(term);
        if (round.length !== 1 || round[0] !== term) bad.push(`${entry.id}: "${term}" -> [${round}]`);
      }
    }
    // A failure here means the builder lowercases, splits, folds plurals, elides apostrophes or
    // filters stopwords differently from the app. Fix build-index.mjs, do not relax this.
    expect(bad).toEqual([]);
  });

  it("body terms actually reach the corpus — not silently empty", () => {
    const withTerms = manifest.filter((e) => parseBodyTerms(e).length > 0);
    expect(withTerms.length).toBe(manifest.length);
  });
});
