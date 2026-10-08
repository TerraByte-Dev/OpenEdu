// Model-free gate for the K-12 benchmark. Runs in CI; nothing here reaches a model.
//
// Three jobs: keep the item set to its blueprint (counts, key balance, no give-away options), pin the
// grader and the statistics the result is computed with, and pin the pre-registered bar by value so
// it cannot be moved quietly after the freeze.

import { describe, it, expect } from "vitest";
import type { LibraryEntry } from "../../types";
import { K12_ITEMS, K12_PILOT, type K12Band, type K12Item, type K12Key, type K12Subject } from "./k12-items";
import { K12_BAR, K12_FORMAT_LINE, extractChoice, formatK12Prompt, mcnemarExact, scoreK12, tally, wilson95 } from "./k12-fixture";
import { matchResourcesScored, normalizeManifest } from "../library-rank";
import { MIN_LIBRARY_SCORE } from "../kernel/ground";

// Imported, not read off disk, and scored through normalizeManifest — see library-fixture.test.ts
// for why both of those matter.
import manifestJson from "../../../public/library/index.json";

/**
 * `groundable` is the number of scored items whose full prompt clears the library grounding floor
 * on the shipped manifest — the prediction the results file compares the observed card count to.
 * MEASURED AFTER AUTHORING and written down here; 0 is the placeholder until the 240 items exist.
 * Items are never edited to move it.
 */
export const K12_BASELINE = { items: 240, groundable: 0 } as const;

const manifest: LibraryEntry[] = normalizeManifest(manifestJson);

const SUBJECTS: Array<[K12Subject, string]> = [["math", "math"], ["science", "science"], ["ela", "ela"], ["social-studies", "social"]];
const BANDS: Array<[K12Band, string]> = [["K-5", "k5"], ["6-8", "68"], ["9-12", "912"]];
const KEYS: K12Key[] = ["A", "B", "C", "D"];
const ALL = [...K12_ITEMS, ...K12_PILOT];

const cellOf = (x: K12Item) => `${x.subject}/${x.band}`;
const count = <T,>(xs: T[], key: (x: T) => string): Record<string, number> =>
  xs.reduce<Record<string, number>>((acc, x) => {
    acc[key(x)] = (acc[key(x)] ?? 0) + 1;
    return acc;
  }, {});
const perCell = (n: number): Record<string, number> =>
  Object.fromEntries(SUBJECTS.flatMap(([s]) => BANDS.map(([b]) => [`${s}/${b}`, n])));

/** The top library card for a query, and whether groundFromLibrary would admit it. */
function topCard(query: string): { id: string | null; grounds: boolean } {
  const [top] = matchResourcesScored(query, manifest, 1);
  return { id: top?.entry.id ?? null, grounds: !!top && top.score >= MIN_LIBRARY_SCORE };
}

describe("k12 — fixture integrity", () => {
  it("has 240 scored items, 20 in every subject x band cell", () => {
    expect(K12_ITEMS.length).toBe(K12_BAR.items);
    expect(count(K12_ITEMS, cellOf)).toEqual(perCell(20));
  });

  it("has a 12-item pilot, one per cell", () => {
    expect(K12_PILOT.length).toBe(12);
    expect(count(K12_PILOT, cellOf)).toEqual(perCell(1));
  });

  it("ids are unique, follow the scheme, and the pilot is disjoint from the scored set", () => {
    expect(new Set(ALL.map((x) => x.id)).size).toBe(ALL.length);
    const bad: string[] = [];
    for (const x of K12_ITEMS) {
      const s = SUBJECTS.find(([subject]) => subject === x.subject)![1];
      const b = BANDS.find(([band]) => band === x.band)![1];
      if (!new RegExp(`^${s}-${b}-(0[1-9]|1\\d|20)$`).test(x.id)) bad.push(x.id);
    }
    for (const x of K12_PILOT) if (!/^pilot-(0[1-9]|1[0-2])$/.test(x.id)) bad.push(x.id);
    expect(bad).toEqual([]);
  });

  it("every item has four distinct non-empty options, a key in A-D and a basis", () => {
    const bad: string[] = [];
    for (const x of ALL) {
      const opts = x.options.map((o) => o.trim().toLowerCase());
      if (opts.length !== 4 || opts.some((o) => !o) || new Set(opts).size !== 4) bad.push(`${x.id}: options`);
      if (!KEYS.includes(x.key)) bad.push(`${x.id}: key`);
      if (!x.basis.trim()) bad.push(`${x.id}: basis`);
      if (!x.stem.trim()) bad.push(`${x.id}: stem`);
    }
    expect(bad).toEqual([]);
  });

  it("no two items share a stem", () => {
    const stems = count(ALL, (x) => x.stem.trim().toLowerCase());
    expect(Object.entries(stems).filter(([, n]) => n > 1).map(([s]) => s)).toEqual([]);
  });

  // A position bias in the model must not be able to move the score: every letter is the key
  // equally often, overall and inside every cell.
  it("keys are balanced: 60 per letter overall and 5 per letter in every cell", () => {
    expect(count(K12_ITEMS, (x) => x.key)).toEqual({ A: 60, B: 60, C: 60, D: 60 });
    const byCellKey = count(K12_ITEMS, (x) => `${cellOf(x)}/${x.key}`);
    const want = Object.fromEntries(Object.keys(perCell(0)).flatMap((c) => KEYS.map((k) => [`${c}/${k}`, 5])));
    expect(byCellKey).toEqual(want);
  });

  it("no item gives its key away in the stem, and none uses all/none of the above", () => {
    const bad: string[] = [];
    for (const x of ALL) {
      const keyed = x.options[KEYS.indexOf(x.key)].trim().toLowerCase();
      if (x.stem.toLowerCase().includes(keyed)) bad.push(`${x.id}: key text is in the stem`);
      if (x.options.some((o) => /\b(all|none) of the above\b/i.test(o))) bad.push(`${x.id}: all/none of the above`);
    }
    expect(bad).toEqual([]);
  });

  it("demand mix: every math item is apply, and at least 120 items are apply overall", () => {
    expect(K12_ITEMS.filter((x) => x.subject === "math" && x.demand !== "apply").map((x) => x.id)).toEqual([]);
    expect(K12_ITEMS.filter((x) => x.demand === "apply").length).toBeGreaterThanOrEqual(120);
  });
});

describe("k12 — the grader", () => {
  const item: K12Item = {
    id: "t", subject: "math", band: "K-5", demand: "apply",
    stem: "What is 3/4 + 1/8?", options: ["5/8", "7/8", "4/12", "1"], key: "B", basis: "computed: 6/8 + 1/8 = 7/8",
  };

  it("formats the user turn with the options A-D and the format line last", () => {
    expect(formatK12Prompt(item)).toBe(`What is 3/4 + 1/8?\n\nA) 5/8\nB) 7/8\nC) 4/12\nD) 1\n\n${K12_FORMAT_LINE}`);
  });

  it("reads a plain or decorated ANSWER line", () => {
    const cases: Array<[string, K12Key]> = [
      ["ANSWER: B", "B"],
      ["**ANSWER: B**", "B"],
      ["ANSWER: **B**", "B"],
      ["Answer: (C)", "C"],
      ["ANSWER:B", "B"],
      ["answer: d", "D"],
      ["ANSWER: <B>", "B"],
    ];
    for (const [text, want] of cases) expect(extractChoice(`Some working.\n${text}`), text).toBe(want);
  });

  it("reads a letter that is followed by its option text or wrapped in LaTeX", () => {
    for (const text of ["ANSWER: B) 7/8", "ANSWER: B. 7/8", "ANSWER: B - seven", "$\\text{ANSWER: B}$"]) {
      expect(extractChoice(text), text).toBe("B");
    }
  });

  it("takes the LAST answer when the model reconsiders", () => {
    expect(extractChoice("ANSWER: A\nWait, that is wrong.\nANSWER: C")).toBe("C");
  });

  // A hedge is not an answer. Reading "B or C" as B would hand a guessing model free credit.
  it("refuses a hedge, a word that merely starts with a letter, and a reply with no ANSWER line", () => {
    const cases = [
      "ANSWER: B or C", "ANSWER: B, C", "ANSWER: B/C",
      "ANSWER: A triangle", "The answer: a fraction", "ANSWER: Both",
      "It is 7/8, which is option B.",
    ];
    for (const text of cases) expect(extractChoice(text), text).toBeNull();
  });

  it("scores correct, wrong, no-parse and error", () => {
    expect(scoreK12(item, "ANSWER: B")).toEqual({ outcome: "correct", letter: "B" });
    expect(scoreK12(item, "ANSWER: C")).toEqual({ outcome: "wrong", letter: "C" });
    expect(scoreK12(item, "It is 7/8.")).toEqual({ outcome: "no-parse", letter: null });
    // A thrown turn is an error even if the message happens to contain an ANSWER line.
    expect(scoreK12(item, "ERROR: stream failed after ANSWER: B")).toEqual({ outcome: "error", letter: null });
  });

  it("tallies intention-to-treat: no-parse and error stay in the total", () => {
    const rows = (["correct", "correct", "wrong", "no-parse", "error"] as const).map((outcome) => ({ outcome }));
    expect(tally(rows)).toEqual({ total: 5, correct: 2, wrong: 1, noParse: 1, error: 1 });
  });
});

describe("k12 — statistics", () => {
  const r = (x: number, dp = 4) => Number(x.toFixed(dp));

  it("wilson95 matches the hand-computed anchors", () => {
    expect(wilson95(80, 100).map((x) => r(x))).toEqual([0.7112, 0.8666]);
    expect(wilson95(192, 240).map((x) => r(x))).toEqual([0.7448, 0.8457]);
    expect(wilson95(0, 20).map((x) => r(x))).toEqual([0, 0.1611]);
    expect(r(wilson95(20, 20)[0])).toBe(0.8389);
  });

  // The bar's own comment: a 0.75 lower bound means at least 194 of 240.
  it("194/240 is the smallest count whose lower bound clears the bar", () => {
    expect(r(wilson95(194, 240)[0])).toBe(0.7538);
    expect(wilson95(194, 240)[0]).toBeGreaterThanOrEqual(K12_BAR.shippingWilsonLowerBound);
    expect(wilson95(193, 240)[0]).toBeLessThan(K12_BAR.shippingWilsonLowerBound);
  });

  it("mcnemarExact matches the hand-computed anchors", () => {
    expect(r(mcnemarExact(5, 15), 5)).toBe(0.04139);
    expect(r(mcnemarExact(0, 6), 5)).toBe(0.03125);
    expect(r(mcnemarExact(1, 7), 5)).toBe(0.07031);
    expect(mcnemarExact(10, 10)).toBe(1);
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(15, 5)).toBe(mcnemarExact(5, 15));
  });
});

describe("k12 — retrieval against the shipped manifest", () => {
  // The format line rides in the user turn, and the grounding stage ranks the whole user turn. If
  // the line itself could pull a card or change which one wins, the shipping arm would be measuring
  // the instruction rather than the question. A failure here means reword the line BEFORE the freeze.
  it("the format line never changes the top card or the grounding decision", () => {
    const moved: string[] = [];
    for (const x of ALL) {
      const full = formatK12Prompt(x);
      const bare = full.slice(0, -K12_FORMAT_LINE.length).trimEnd();
      const a = topCard(full);
      const b = topCard(bare);
      if (a.id !== b.id || a.grounds !== b.grounds) moved.push(`${x.id}: ${b.id}/${b.grounds} -> ${a.id}/${a.grounds}`);
    }
    expect(moved).toEqual([]);
  });

  it("the number of groundable items matches the pinned baseline", () => {
    const groundable = K12_ITEMS.filter((x) => topCard(formatK12Prompt(x)).grounds).length;
    expect({ items: K12_ITEMS.length, groundable }).toEqual(K12_BASELINE);
  });
});

describe("k12 — the pre-registered bar", () => {
  it("is pinned by value", () => {
    expect(K12_BAR).toEqual({
      items: 240,
      shippingWilsonLowerBound: 0.75,
      maxNoParseRate: 0.05,
      maxErrorRate: 0.02,
      ceiling: 0.95,
      alpha: 0.05,
    });
  });
});
