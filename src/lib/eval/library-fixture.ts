// A pure, model-free measuring device for LIBRARY retrieval.
//
// Why this exists, and why rag-fixture.ts could not do the job:
//
// `rag-fixture.ts` measures NOTE grounding using nonce facts ("Verrin solution", "Ashcombe Ridge")
// so a model cannot answer from parametric memory. The Library holds REAL facts, so no nonce is
// possible and the same trick can't be reused. The result is that a library-ranker regression is
// currently invisible to every test in this repo — `matchResourcesScored` is the function that
// decides what the tutor is handed on every single turn, and nothing measures it.
//
// This fixture scores the REAL bundled manifest (public/library/index.json), so it measures the
// corpus that actually ships rather than a hand-built sample.
//
// ── The one distinction that matters ────────────────────────────────────────────────────────────
// A retrieval miss has two completely different causes, and blending them produces a number nobody
// can act on:
//
//   RANKER MISS  the right card exists and we failed to rank it       → fix the ranker
//   CORPUS GAP   nothing in the library covers this at all            → write a card
//
// So `gap: true` marks a query the corpus genuinely cannot answer, and the CORRECT behaviour is to
// return nothing above the floor. Counting those as retrieval failures would understate the ranker
// and invite someone to "fix" it by loosening the floor, which is precisely the wrong move.
//
// ── What it is calibrated to catch ──────────────────────────────────────────────────────────────
// `forbid` entries are measured, not hypothetical. Against the shipped 154-card manifest today:
//
//   "IR spectroscopy"          → french/regular-verb-endings   scores 8   (floor is 6)
//                                spanish/regular-verb-endings  scores 8
//   "boiling point of ethanol" → ela/point-of-view             scores 8
//
// Both clear MIN_LIBRARY_SCORE comfortably and are injected into the tutor's context. The cause is
// not that bodies are unindexed — it is that no term is weighted by how common it is. `tokenize`
// splits "IR spectroscopy" into ["ir", "spectroscopy"], and the romance-language verb cards carry
// "-ir" in BOTH aliases (weight 3) and tags (weight 2). A one-token accident outranks the topic.

import type { LibraryEntry } from "../../types";
import { matchResourcesScored } from "../library-rank";

/** Mirrors `MIN_LIBRARY_SCORE` in kernel/ground.ts — the floor for automatic grounding. */
export const LIBRARY_FLOOR = 6;

export interface LibQuery {
  /** The query, phrased the way a student actually types it. */
  ask: string;
  /** Card ids that SHOULD rank in the top 3. Omitted for `gap` queries. */
  expect?: string[];
  /** Card ids that must NEVER reach `LIBRARY_FLOOR` for this query. */
  forbid?: string[];
  /** Nothing in the corpus covers this. Correct behaviour is NO hit at or above the floor. */
  gap?: true;
  /** Why this query is here, when that isn't obvious. */
  note?: string;
}

// ── The queries ─────────────────────────────────────────────────────────────────────────────────
// Seeded from the shipped manifest and from COVERAGE.md's own record of what it does not cover.

export const LIBRARY_QUERIES: LibQuery[] = [
  // Clean hits — the ranker's happy path. A phrase bonus should carry most of these.
  { ask: "periodic table", expect: ["chemistry/periodic-table"] },
  { ask: "what is the quadratic formula", expect: ["math/quadratic-reference"] },
  { ask: "unit circle", expect: ["math/unit-circle"] },
  { ask: "order of operations", expect: ["math/order-of-operations"] },
  { ask: "laws of exponents", expect: ["math/laws-of-exponents"] },
  { ask: "ohms law", expect: ["physics/ohms-law-circuits"] },
  { ask: "newtons laws of motion", expect: ["physics/newtons-laws-forces"] },
  { ask: "kinematics equations", expect: ["physics/kinematics-equations"] },
  { ask: "the ph scale", expect: ["chemistry/ph-scale"] },
  { ask: "polyatomic ions", expect: ["chemistry/polyatomic-ions"] },
  { ask: "solubility rules", expect: ["chemistry/solubility-rules"] },
  { ask: "codon table", expect: ["biology/genetic-code-codons"] },
  { ask: "organelle functions", expect: ["biology/organelle-functions"] },
  { ask: "the water cycle", expect: ["earth-space/water-cycle"] },
  { ask: "layers of the atmosphere", expect: ["earth-space/layers-of-atmosphere"] },
  { ask: "mohs hardness scale", expect: ["earth-space/mohs-hardness-scale"] },
  { ask: "comma rules", expect: ["ela/comma-rules"] },
  { ask: "parts of speech", expect: ["ela/parts-of-speech"] },
  { ask: "mla citation format", expect: ["ela/mla-citation"] },
  { ask: "latitude and longitude", expect: ["geography/latitude-and-longitude"] },

  // Paraphrases — the student does not use the card's title. Aliases should carry these.
  { ask: "times tables", expect: ["math/multiplication-table"] },
  { ask: "pemdas", expect: ["math/order-of-operations"] },
  { ask: "how do I find the slope of a line", expect: ["math/linear-equation-forms"] },
  { ask: "difference of squares", expect: ["math/factoring-special-products"] },
  { ask: "perfect squares list", expect: ["math/squares-cubes-roots"] },
  { ask: "f equals ma", expect: ["physics/newtons-laws-forces"] },
  { ask: "speed of light constant", expect: ["physics/constants"] },
  { ask: "snells law", expect: ["physics/optics", "physics/index-of-refraction"] },
  { ask: "strong acid list", expect: ["chemistry/strong-acids-bases"] },
  { ask: "boyles law", expect: ["chemistry/gas-laws"] },
  { ask: "difference between an animal cell and a plant cell", expect: ["biology/animal-plant-cell"] },
  { ask: "freytag pyramid", expect: ["ela/plot-diagram"] },
  { ask: "what does simile mean", expect: ["ela/figurative-language"] },
  { ask: "capital of japan", expect: ["geography/countries-capitals"] },

  // Body-only — the answer is in the card body, the metadata never mentions it. These are the
  // COVERAGE half of the ranker problem and are expected to fail until body terms are indexed.
  {
    ask: "what is a noble gas",
    expect: ["chemistry/periodic-table"],
    note: "'noble gas' appears in the periodic-table body, not in its title/aliases/tags.",
  },
  {
    ask: "what is a lanthanide",
    expect: ["chemistry/periodic-table"],
    note: "Body-only term.",
  },
  {
    ask: "what does the discriminant tell you",
    expect: ["math/quadratic-reference"],
    note: "'discriminant' IS an alias here — a control for the two above.",
  },

  // Measured false positives. These are live today; see the header for scores.
  {
    ask: "IR spectroscopy",
    gap: true,
    forbid: ["french/regular-verb-endings", "spanish/regular-verb-endings"],
    note: "No spectroscopy card exists, so this is ALSO a corpus gap. The token 'ir' matches the "
      + "romance-verb cards in aliases AND tags -> 8, above the floor of 6.",
  },
  {
    ask: "boiling point of ethanol",
    gap: true,
    forbid: ["ela/point-of-view"],
    note: "The token 'point' matches a card about narrative point of view -> 8.",
  },
  {
    ask: "what is a point mutation",
    gap: true,
    forbid: ["ela/point-of-view", "math/coordinate-plane"],
    note: "Same 'point' collision, different topic.",
  },

  // Corpus gaps — named by COVERAGE.md as not covered, or absent from the 410-cluster map.
  // Correct behaviour is silence, not the least-bad card in the library.
  { ask: "how do I add fractions with different denominators", gap: true,
    note: "No fractions card. COVERAGE map: math clusters 6-7 untouched — the broken staircase." },
  { ask: "what is a punnett square", gap: true, note: "COVERAGE.md 'top remaining' for Biology." },
  { ask: "explain mitosis and meiosis", gap: true, note: "COVERAGE.md 'top remaining' for Biology." },
  { ask: "what are the rules for derivatives", gap: true,
    note: "Calculus is the only fully-uncovered row in COVERAGE.md." },
  { ask: "types of chemical bonding", gap: true, note: "COVERAGE.md 'top remaining' for Chemistry." },
  { ask: "what are plate boundaries", gap: true, note: "COVERAGE.md 'top remaining' for Earth Systems." },
  { ask: "how do I treat someone who is bleeding heavily", gap: true,
    note: "Tier B first aid: 0 of 16 clusters. The highest-stakes gap in the whole map." },
  { ask: "how do I make compost", gap: true, note: "Tier B agriculture: 0 of 14 clusters." },
];

// ── Scoring ─────────────────────────────────────────────────────────────────────────────────────

export interface LibraryEvalResult {
  total: number;
  /** Queries carrying `expect`. */
  ranked: number;
  /** Top-1 is an expected id, over `ranked`. */
  p1: number;
  /** Some expected id is in the top 3, over `ranked`. */
  r3: number;
  /** (query, forbidden id) pairs where the forbidden id reached the floor. Lower is better. */
  floorViolations: number;
  /** `gap` queries that correctly returned nothing at or above the floor, over all gap queries. */
  gapPurity: number;
  /**
   * The metric that decides what the TUTOR actually sees.
   *
   * P@1 says we ranked the right card first; gap purity says we stayed quiet when we should.
   * Neither says the right card cleared `LIBRARY_FLOOR` — and a correct hit scoring 4 is invisible
   * to `groundFromLibrary`, so the student is answered from parametric memory instead. Over the
   * ranked queries, the fraction whose expected card is BOTH in the top 3 AND at or above the floor.
   */
  groundableRate: number;
  gapQueries: number;
  /** Per-query detail, for eyeballing a regression rather than just seeing a number move. */
  detail: Array<{
    ask: string;
    top: Array<{ id: string; score: number }>;
    hit: boolean | null;
    violations: string[];
  }>;
}

/** Round to 3 dp so a baseline comparison isn't defeated by float noise. */
const r3dp = (n: number) => Math.round(n * 1000) / 1000;

export function evaluateLibraryRetrieval(
  manifest: LibraryEntry[],
  queries: LibQuery[] = LIBRARY_QUERIES,
): LibraryEvalResult {
  let ranked = 0, p1 = 0, r3 = 0, floorViolations = 0, gapQueries = 0, gapClean = 0, groundable = 0;
  const detail: LibraryEvalResult["detail"] = [];

  for (const q of queries) {
    const hits = matchResourcesScored(q.ask, manifest, 3);
    const top = hits.map((h) => ({ id: h.entry.id, score: h.score }));

    // A forbidden id counts as a violation only if it actually reaches the grounding floor —
    // scoring 3 on a bad match is harmless, because nothing consumes it.
    const violations: string[] = [];
    if (q.forbid?.length) {
      const scored = matchResourcesScored(q.ask, manifest, manifest.length);
      for (const bad of q.forbid) {
        const found = scored.find((h) => h.entry.id === bad);
        if (found && found.score >= LIBRARY_FLOOR) violations.push(`${bad}@${found.score}`);
      }
    }
    floorViolations += violations.length;

    let hit: boolean | null = null;
    if (q.expect?.length) {
      ranked++;
      const ids = top.map((t) => t.id);
      hit = q.expect.some((e) => ids.includes(e));
      if (hit) r3++;
      if (ids[0] && q.expect.includes(ids[0])) p1++;
      const best = top.find((t) => q.expect!.includes(t.id));
      if (best && best.score >= LIBRARY_FLOOR) groundable++;
    }
    if (q.gap) {
      gapQueries++;
      if (!top.some((t) => t.score >= LIBRARY_FLOOR)) gapClean++;
    }

    detail.push({ ask: q.ask, top, hit, violations });
  }

  return {
    total: queries.length,
    ranked,
    p1: ranked ? r3dp(p1 / ranked) : 0,
    r3: ranked ? r3dp(r3 / ranked) : 0,
    floorViolations,
    gapPurity: gapQueries ? r3dp(gapClean / gapQueries) : 1,
    groundableRate: ranked ? r3dp(groundable / ranked) : 0,
    gapQueries,
    detail,
  };
}
