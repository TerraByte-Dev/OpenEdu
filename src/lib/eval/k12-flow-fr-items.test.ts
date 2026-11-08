import { describe, it, expect } from "vitest";
import { K12_FR_ITEMS } from "./k12-flow-fr-items";
import { K12_ITEMS } from "./k12-items";
import { scriptedWrongLetter } from "./k12-flow";
import { equalsKey, frKey, keyInAsk, prepareText, readNumbers } from "./k12-flow-fr-grade";

const LETTERS = ["A", "B", "C", "D"] as const;
const source = (id: string) => K12_ITEMS.find((x) => x.id === id)!;
const values = (s: string) => readNumbers(prepareText(s)).map((n) => n.value);
const has = (xs: number[], v: number) => xs.some((x) => Math.abs(x - v) < 1e-9);

// The k12-mc items with a digit in the key that were left out, and why (k12-flow-fr-items.ts header).
const DROPPED = {
  "math-k5-07": "needs its options (which fraction is greater)",
  "math-k5-09": "needs its options (which decimal is greatest)",
  "math-k5-13": "a clock time",
  "math-68-09": "an expression in x",
  "math-68-13": "an inequality",
  "math-912-03": "an expression in x and y",
  "science-912-11": "two values",
  "science-912-18": "a sentence",
};

describe("K12_FR_ITEMS", () => {
  it("has 81 items, one per kept source item, all DEV k12-mc items, with ids fr-<source>", () => {
    expect(K12_FR_ITEMS).toHaveLength(81);
    expect(new Set(K12_FR_ITEMS.map((x) => x.id)).size).toBe(81);
    for (const x of K12_FR_ITEMS) {
      expect(source(x.source)).toBeDefined();
      expect(x.id).toBe(`fr-${x.source}`);
      expect(x.subject).toBe(source(x.source).subject);
      expect(x.band).toBe(source(x.source).band);
    }
    const bySubject = K12_FR_ITEMS.reduce<Record<string, number>>((m, x) => ({ ...m, [x.subject]: (m[x.subject] ?? 0) + 1 }), {});
    expect(bySubject).toEqual({ math: 53, science: 23, "social-studies": 5 });
  });

  it("keeps every source item whose key has a number, except the ones dropped for a stated reason", () => {
    const numeric = K12_ITEMS.filter((x) => /\d/.test(x.options[LETTERS.indexOf(x.key)])).map((x) => x.id);
    expect(numeric.filter((id) => !(id in DROPPED))).toEqual(K12_FR_ITEMS.map((x) => x.source));
    for (const id of Object.keys(DROPPED)) expect(numeric).toContain(id);
  });

  it("takes the key from the source's keyed option and the T2 try from k12-flow's frozen distractor letter", () => {
    for (const x of K12_FR_ITEMS) {
      const s = source(x.source);
      expect(x.key).toBe(s.options[LETTERS.indexOf(s.key)]);
      expect(x.attempt).toBe(s.options[LETTERS.indexOf(scriptedWrongLetter(s.key))]);
    }
  });

  it("has keys and tries that are one number each, and a try that is never the key", () => {
    for (const x of K12_FR_ITEMS) {
      const key = frKey(x);
      const attempt = frKey({ key: x.attempt });
      expect(equalsKey(attempt.num, key), x.id).toBe(false);
    }
  });

  it("asks carry every number of the source stem and no other, so no ask leaks its key", () => {
    for (const x of K12_FR_ITEMS) {
      const ask = values(x.ask);
      const stem = values(source(x.source).stem);
      expect(ask.filter((v) => !has(stem, v)), x.id).toEqual([]);
      expect(stem.filter((v) => !has(ask, v)), x.id).toEqual([]);
    }
  });

  it("has the key among the problem's own numbers in exactly two items (G1 reads only commits there)", () => {
    expect(K12_FR_ITEMS.filter(keyInAsk).map((x) => x.id)).toEqual(["fr-science-912-15", "fr-science-912-17"]);
  });

  it("asks are typed problems: no option list, rewritten from the stem, in varied form", () => {
    for (const x of K12_FR_ITEMS) {
      expect(x.ask, x.id).not.toMatch(/(^|\s)[A-D]\)\s/);
      expect(x.ask, x.id).not.toMatch(/which one is right/i);
      // An option's text may be in the ask only where the stem has it too ("50 grams" is a given).
      for (const o of source(x.source).options) if (!source(x.source).stem.includes(o)) expect(x.ask, x.id).not.toContain(o);
      expect(x.ask).not.toBe(source(x.source).stem);
    }
    expect(K12_FR_ITEMS.filter((x) => /^[a-z]/.test(x.ask)).length).toBeGreaterThanOrEqual(20);
    expect(K12_FR_ITEMS.filter((x) => !x.ask.trim().endsWith("?")).length).toBeGreaterThanOrEqual(15);
    for (const typo of ["perimiter", "seperate", "probabilty", "concentraton"]) expect(K12_FR_ITEMS.some((x) => x.ask.includes(typo))).toBe(true);
  });

  it("sets a tolerance only on the stem that asks for a rounded value", () => {
    expect(K12_FR_ITEMS.filter((x) => x.tolerance !== undefined).map((x) => [x.id, x.tolerance])).toEqual([["fr-math-912-15", 0.05]]);
    expect(source("math-912-15").stem).toMatch(/nearest tenth/);
  });
});
