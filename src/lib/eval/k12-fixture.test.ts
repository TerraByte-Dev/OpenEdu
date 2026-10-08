// Model-free gate for the K-12 benchmark. Runs in CI; nothing here reaches a model.
//
// Three jobs: keep the item set to its blueprint (counts, key balance, no give-away options), pin the
// grader and the statistics the result is computed with, and pin the pre-registered bar by value so
// it cannot be moved quietly after the freeze.

import { describe, it, expect } from "vitest";
import type { LibraryEntry } from "../../types";
import { K12_ITEMS, K12_PILOT, type K12Band, type K12Item, type K12Key, type K12Subject } from "./k12-items";
import { K12_BAR, K12_FORMAT_LINE, contrastK12, extractChoice, formatK12Prompt, judgeK12, mcnemarExact, scoreK12, tally, wilson95, type K12Outcome, type K12Tally } from "./k12-fixture";
import { matchResourcesScored, normalizeManifest } from "../library-rank";
import { MIN_LIBRARY_SCORE } from "../kernel/ground";

// Imported, not read off disk, and scored through normalizeManifest — see library-fixture.test.ts
// for why both of those matter.
import manifestJson from "../../../public/library/index.json";

/**
 * `groundable` is the number of scored items whose full prompt clears the library grounding floor
 * on the shipped manifest — the prediction the results file compares the observed card count to.
 * Measured after authoring (2026-10-08) and written down here. Items are never edited to move it.
 *
 * `lostToFormatLine` / `swappedByFormatLine` are what the ANSWER instruction costs the retriever. No
 * wording is free: the ranker scales a card's score by how much of the query it covers, so ANY added
 * words dilute it — the bare "ANSWER: <letter>" still moved three items. The line that was kept adds
 * no card anywhere; it drops four that the question alone would have grounded and changes which
 * card wins on three. Pinned so the cost is a recorded number rather than a footnote.
 */
export const K12_BASELINE = { items: 240, groundable: 79, lostToFormatLine: 4, swappedByFormatLine: 3 } as const;

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
      // Exact, not case-folded: a capitalization item's options differ only by case, on purpose.
      const opts = x.options.map((o) => o.trim());
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

  // The grader reads a letter off an ANSWER line. A model that answers with the option TEXT, or
  // echoes the prompt, must never be handed a letter by accident ("D-Day", "A. Lincoln", "c. 1500").
  it("no option text and no prompt parses as a letter", () => {
    const bad: string[] = [];
    for (const x of ALL) {
      x.options.forEach((o, i) => {
        if (extractChoice(`ANSWER: ${o}`) !== null) bad.push(`${x.id}: option ${KEYS[i]}`);
      });
      if (extractChoice(formatK12Prompt(x)) !== null) bad.push(`${x.id}: prompt`);
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
      ["**Answer**: B", "B"],
      ["ANSWER: Option B", "B"],
      ["ANSWER: \\boxed{B}", "B"],
      ["ANSWER: $B$", "B"],
      ['ANSWER: "B"', "B"],
      ["ANSWER: 'B'", "B"],
      ["ANSWER: \u201cB\u201d", "B"],
      ["ANSWER\uff1a B", "B"],
    ];
    for (const [text, want] of cases) expect(extractChoice(`Some working.\n${text}`), text).toBe(want);
  });

  it("reads a letter followed by ITS OWN option text, and nothing else after a letter", () => {
    for (const text of ["ANSWER: B) 7/8", "ANSWER: B. 7/8", "ANSWER: B (7/8)", "ANSWER: Option B - 7/8", "ANSWER: **B) 7/8** ✅"]) {
      expect(extractChoice(text, item.options), text).toBe("B");
    }
    // Another option's text, a paraphrase, or no options to compare against: not credited.
    expect(extractChoice("ANSWER: B) 5/8", item.options)).toBeNull();
    expect(extractChoice("ANSWER: B - seven eighths", item.options)).toBeNull();
    expect(extractChoice("ANSWER: B) 7/8")).toBeNull();
  });

  it("reads LaTeX wrappers, a trailing mark, and a short lead-in before the label", () => {
    const cases: Array<[string, K12Key]> = [
      [String.raw`$\text{ANSWER: B}$`, "B"],
      [String.raw`ANSWER: $\boxed{B}$`, "B"],
      [String.raw`ANSWER: \(B\)`, "B"],
      ["ANSWER: B ✅", "B"],
      ["ANSWER: B!", "B"],
      ["ANSWER: B <end_of_turn>", "B"],
      ["The correct answer is: B", "B"],
      ["**The final answer is:** B", "B"],
      ["ANSWER: A\nWait, I made an error.\nCorrected ANSWER: C", "C"],
      ["ANSWER: A\nMy final answer: C", "C"],
    ];
    for (const [text, want] of cases) expect(extractChoice(text), text).toBe(want);
  });

  // The shapes an allow-list exists to refuse. Every one of these was once read as a letter.
  it("refuses enumerations, variables and words that start with a letter", () => {
    const cases = [
      "Answer: A) 5/8 B) 7/8 C) 4/12 D) 1", "ANSWER: A. 5/8  B. 7/8", "Answer: (A) is wrong; (B) is right", "ANSWER: A - no. B - yes.",
      "answer: a_n = 2n", "answer: a*b", "answer: d(x) = 2x", "Answer: C(5,2) = 10", "answer: b - a", "answer: c:d",
      "ANSWER: D-Day", "ANSWER: C-14", "ANSWER: A.D. 476", "ANSWER: D.C.", "ANSWER: A's",
      "ANSWER: **B** OR **C**", "ANSWER: **B** **C**", "ANSWER: (B)(C)", "ANSWER: $B$ or $C$",
      "ANSWER: B is correct", "ANSWER: B because 3 + 4 = 7", "RESPUESTA: B",
    ];
    for (const text of cases) expect(extractChoice(text, item.options), text).toBeNull();
  });

  it("takes the LAST answer when the model reconsiders", () => {
    expect(extractChoice("ANSWER: A\nWait, that is wrong.\nANSWER: C")).toBe("C");
  });

  // More than two words before the label is prose, not an ANSWER line, whatever letter follows
  // it — an enumeration starts at A, so reading it would hand out the A-keyed items.
  it("ignores \"answer:\" inside prose", () => {
    expect(extractChoice("Let's check each answer:\n\nA) 5/8 - no\nB) 7/8 - yes\n\nSo it is B.")).toBeNull();
    expect(extractChoice("ANSWER: B\n\nWhy not the other answer: C. It adds denominators.")).toBe("B");
    expect(extractChoice("ANSWER: B\n\nNote: the other answer: A) 5/8 is a common mistake.")).toBe("B");
    expect(extractChoice("Let's check each answer:\n\nA) 5/8\nB) 7/8\n\nANSWER: B (7/8)", item.options)).toBe("B");
    expect(extractChoice("ANSWER:\nB")).toBeNull();
  });

  // A hedge is not an answer. Reading "B or C" as B would hand a guessing model free credit.
  it("refuses a hedge, a word that merely starts with a letter, and a reply with no ANSWER line", () => {
    const cases = [
      "ANSWER: B or C", "ANSWER: B, C", "ANSWER: B/C",
      "ANSWER: **B** or **C**", "ANSWER: (B) or (C)", "ANSWER: B) 7/8 or C) 4/12", "ANSWER: B. or C.", "ANSWER: B) and D)",
      "ANSWER: A triangle", "The answer: a fraction", "ANSWER: Both",
      "It is 7/8, which is option B.",
    ];
    for (const text of cases) expect(extractChoice(text), text).toBeNull();
  });

  // A wrong letter is worse than a no-parse: the last ANSWER line is the answer, and if it hedges
  // the earlier clean line is not fallen back on.
  it("a hedged last ANSWER line is a no-parse even after a clean one", () => {
    expect(extractChoice("ANSWER: B\nANSWER: B or C")).toBeNull();
    expect(extractChoice("ANSWER: B\nActually.\nANSWER: **B** or **C**")).toBeNull();
    expect(extractChoice("ANSWER: B or C\nNo.\nANSWER: C")).toBe("C");
  });

  it("scores correct, wrong, no-parse and error", () => {
    expect(scoreK12(item, "ANSWER: B")).toEqual({ outcome: "correct", letter: "B" });
    expect(scoreK12(item, "ANSWER: C")).toEqual({ outcome: "wrong", letter: "C" });
    expect(scoreK12(item, "It is 7/8.")).toEqual({ outcome: "no-parse", letter: null });
    // A failed turn is an error even if the message happens to contain an ANSWER line...
    expect(scoreK12(item, "ERROR: stream failed\nANSWER: B", true)).toEqual({ outcome: "error", letter: null });
    // ...and it is the runner's flag that says so, not the text: a reply may open with "ERROR:".
    expect(scoreK12(item, "ERROR: the denominators differ.\nANSWER: B")).toEqual({ outcome: "correct", letter: "B" });
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
  // The format line rides in the user turn, and the grounding stage ranks the whole user turn. The
  // line must never ADD a card — that would be the shipping arm grounding on the instruction rather
  // than the question. What it removes or swaps by dilution is counted in K12_BASELINE.
  const drift = () => {
    let gained = 0, lost = 0, swapped = 0;
    for (const x of K12_ITEMS) {
      const full = formatK12Prompt(x);
      const a = topCard(full);
      const b = topCard(full.slice(0, -K12_FORMAT_LINE.length).trimEnd());
      if (a.grounds && !b.grounds) gained++;
      else if (!a.grounds && b.grounds) lost++;
      else if (a.grounds && b.grounds && a.id !== b.id) swapped++;
    }
    return { gained, lost, swapped };
  };

  it("the format line never adds a card", () => {
    expect(drift().gained).toBe(0);
  });

  it("groundable items and the format line's cost match the pinned baseline", () => {
    const groundable = K12_ITEMS.filter((x) => topCard(formatK12Prompt(x)).grounds).length;
    const { lost, swapped } = drift();
    expect({ items: K12_ITEMS.length, groundable, lostToFormatLine: lost, swappedByFormatLine: swapped }).toEqual(K12_BASELINE);
  });
});

describe("k12 — the pre-registered bar", () => {
  it("the format line is pinned by value", () => {
    expect(K12_FORMAT_LINE).toBe("You may explain briefly. End your reply with one final line in exactly this form: ANSWER: <letter>");
  });

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

// The comparisons that give the bar its meaning, each at its boundary. The runner calls these same
// two functions; nothing about the verdict is computed anywhere else.
describe("k12 — the verdict", () => {
  const N = K12_BAR.items;
  const arm = (correct: number, over: Partial<K12Tally> = {}): K12Tally => {
    const t = { total: N, correct, noParse: 0, error: 0, ...over };
    return { ...t, wrong: N - t.correct - t.noParse - t.error };
  };
  const clean = () => ({ raw: arm(200), "prompt-only": arm(200), shipping: arm(200) });
  const noDiff = { b: 0, c: 0, p: 1 };

  /** Paired rows with b items only the first arm got right and c only the second. */
  const paired = (b: number, c: number) => {
    const rows = (right: (i: number) => boolean) =>
      Array.from({ length: b + c + 10 }, (_, i) => ({ id: `i${i}`, outcome: (right(i) ? "correct" : "wrong") as K12Outcome }));
    return contrastK12(rows((i) => i < b || i >= b + c), rows((i) => i >= b))!;
  };

  it("a clean run is not void and passes V", () => {
    expect(judgeK12(clean(), 79, noDiff)).toEqual({ void: null, V: true, A: true, H: "no-difference", C: false });
  });

  it("void: 5 ERROR rows in any one arm, not 4", () => {
    expect(judgeK12({ ...clean(), "prompt-only": arm(200, { error: 4 }) }, 79, noDiff).void).toBeNull();
    expect(judgeK12({ ...clean(), "prompt-only": arm(200, { error: 5 }) }, 79, noDiff).void).toBe("ERROR rows over the limit in prompt-only");
  });

  it("void: the shipping arm grounded 0 items, not 1", () => {
    expect(judgeK12(clean(), 1, noDiff).void).toBeNull();
    expect(judgeK12(clean(), 0, noDiff).void).toBe("the shipping arm grounded zero items");
  });

  it("V: 13 no-parse rows in any one arm fail it, 12 do not", () => {
    expect(judgeK12({ ...clean(), raw: arm(200, { noParse: 12 }) }, 79, noDiff).V).toBe(true);
    expect(judgeK12({ ...clean(), raw: arm(200, { noParse: 13 }) }, 79, noDiff).V).toBe(false);
  });

  it("A: shipping 194 meets the headline bar, 193 does not", () => {
    expect(judgeK12({ ...clean(), shipping: arm(193) }, 79, noDiff).A).toBe(false);
    expect(judgeK12({ ...clean(), shipping: arm(194) }, 79, noDiff).A).toBe(true);
  });

  it("C: raw 228 is at ceiling, 227 is not", () => {
    expect(judgeK12({ ...clean(), raw: arm(227) }, 79, noDiff).C).toBe(false);
    expect(judgeK12({ ...clean(), raw: arm(228) }, 79, noDiff).C).toBe(true);
  });

  it("contrastK12 counts b for the first arm and c for the second", () => {
    expect(paired(15, 5)).toEqual({ b: 15, c: 5, p: mcnemarExact(15, 5) });
    expect(contrastK12([], [])).toBeNull();
  });

  it("H: (15,5) is a lift, (5,15) reduces, (1,7) is no difference", () => {
    expect(judgeK12(clean(), 79, paired(15, 5)).H).toBe("lift");
    expect(judgeK12(clean(), 79, paired(5, 15)).H).toBe("reduces");
    expect(judgeK12(clean(), 79, paired(1, 7)).H).toBe("no-difference");
  });
});
