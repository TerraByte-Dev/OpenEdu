import { describe, it, expect } from "vitest";
import { DEFINE_ITEMS, DEFINE_SPLIT, DEFINE_BAND_GRADE } from "./define-items";
import { matchTerm, gradeDefine } from "./define-grade";
import { askedWord, DICTIONARY_NOTE } from "../kernel/defineWord";
import { POS_NAMES } from "../dictionary";

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

  // A reply's opener says nothing about the meaning, so it must not pass or fail an item on its own
  // (review round 2, ruling b): "Nice question! Here, kind means a type" must not fail strict on "nice".
  it("no expect or wrongSense term matches a conventional reply opener", () => {
    const OPENERS = [
      "Great question!", "Good question!", "Nice question!", "Excellent question!", "Nice!", "Okay!", "Okay,", "OK,", "Ok!",
      "Alright,", "All right,", "Sure!", "Of course!", "Absolutely!", "Yes!", "Hi!", "Hello!", "Well,", "So,", "Fair question!",
    ];
    for (const item of DEFINE_ITEMS) {
      for (const group of [...item.expect, ...(item.wrongSense ? [item.wrongSense] : [])]) {
        for (const o of OPENERS) expect(matchTerm(o, group), `${item.id}: "${o}"`).toBeNull();
      }
    }
  });

  // Only the D arm sees the note and the entry's fixed text, so a term they contain would pass a reply
  // that echoes them. Re-checked at every note wording: this test reads DICTIONARY_NOTE as it is.
  it("no expect or wrongSense term matches the note or the entry's fixed format text", () => {
    const format = [
      '<dictionary_entry source="Open English WordNet">', "</dictionary_entry>", '"x" is a form of "y".',
      ...Object.values(POS_NAMES).map((pos) => `1. x (${pos}): . Example: ""`),
    ];
    for (const item of DEFINE_ITEMS) {
      const texts = [DICTIONARY_NOTE.replace("{word}", item.word), ...format];
      for (const group of [...item.expect, ...(item.wrongSense ? [item.wrongSense] : [])]) {
        for (const alt of group.split("|")) {
          for (const t of texts) expect(matchTerm(t, alt), `${item.id}: "${alt}" in ${t.slice(0, 30)}`).toBeNull();
        }
      }
    }
  });
});
