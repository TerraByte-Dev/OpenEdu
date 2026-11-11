import { describe, it, expect } from "vitest";
import { DEFINE_ITEMS, DEFINE_SPLIT, DEFINE_BAND_GRADE } from "./define-items";
import { matchTerm, gradeDefine } from "./define-grade";
import { askedWord } from "../kernel/defineWord";

const GRADE_BANDS_FOR_TEST = ["K-2", "3-5", "6-8", "9-12"] as const;

describe("define items", () => {
  it("has unique ids and the frozen counts per band, kind and split", () => {
    expect(new Set(DEFINE_ITEMS.map((i) => i.id)).size).toBe(DEFINE_ITEMS.length);
    const count = (f: (i: (typeof DEFINE_ITEMS)[number]) => boolean) => DEFINE_ITEMS.filter(f).length;
    for (const band of GRADE_BANDS_FOR_TEST) {
      expect(count((i) => i.band === band && i.kind === "plain"), band).toBe(38);
      expect(count((i) => i.band === band && i.kind === "sense"), band).toBe(8);
      expect(count((i) => i.band === band && i.kind === "plain" && DEFINE_SPLIT[i.id] === "dev"), band).toBe(13);
      expect(count((i) => i.band === band && i.kind === "sense" && DEFINE_SPLIT[i.id] === "dev"), band).toBe(3);
    }
    expect(DEFINE_ITEMS.length).toBe(184);
    expect(count((i) => DEFINE_SPLIT[i.id] === "dev")).toBe(64);
    expect(count((i) => DEFINE_SPLIT[i.id] === "test")).toBe(120);
    expect(Object.keys(DEFINE_BAND_GRADE).sort()).toEqual([...GRADE_BANDS_FOR_TEST].sort());
  });

  it("every item's message fires the detector and names the item's word", () => {
    for (const item of DEFINE_ITEMS) expect(askedWord(item.ask)?.word.toLowerCase(), item.id).toBe(item.word);
  });

  it("sense items carry wrongSense terms; plain items do not", () => {
    for (const item of DEFINE_ITEMS) expect(!!item.wrongSense, item.id).toBe(item.kind === "sense");
  });

  it("echoing the question passes nothing: no expect or wrongSense term matches the word or the message", () => {
    for (const item of DEFINE_ITEMS) {
      for (const g of item.expect) {
        expect(matchTerm(item.ask, g), `${item.id} expect in ask`).toBeNull();
        expect(matchTerm(item.word, g), `${item.id} expect in word`).toBeNull();
      }
      if (item.wrongSense) expect(matchTerm(item.ask, item.wrongSense), `${item.id} wrongSense in ask`).toBeNull();
      expect(gradeDefine(item, item.ask).pass, item.id).toBe(false);
    }
  });
});
