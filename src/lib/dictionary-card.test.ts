import { describe, it, expect } from "vitest";
import { dictionaryCard, cardStartsOpen, cardToggleLabel, cardSpeech, CARD_SOURCE } from "./dictionary-card";
import { shownEntry, noteFor, DICTIONARY_MAX_SENSES, type DictionaryShown } from "./kernel/defineWord";
import { GRADES, type Grade } from "./grade";
import type { DictionaryEntry, Pos } from "./dictionary";

const sense = (form: string, pos: Pos, definition: string, example = "") => ({ form, pos, definition, example, synonyms: [] });

describe("dictionaryCard: what the card shows from the tutor's entry", () => {
  const shown: DictionaryShown = {
    word: "saw",
    entries: [
      { headword: "saw", via: "exact", senses: [
        { form: "saw", pos: "n", definition: "a hand tool for cutting wood", example: "" },
        { form: "saw", pos: "n", definition: "a short saying", example: "an old saw" },
        { form: "saw", pos: "v", definition: "cut with a saw", example: "saw wood" },
      ] },
      { headword: "see", via: "form", senses: [
        { form: "see", pos: "v", definition: "perceive with the eyes", example: "I saw a bird" },
      ] },
    ],
  };

  it("keeps every sense, in order, numbered across headwords as the note numbers them", () => {
    const card = dictionaryCard(shown);
    expect(card.word).toBe("saw");
    expect(card.headwords.map((h) => h.headword)).toEqual(["saw", "see"]);
    expect(card.headwords[0].groups).toEqual([
      { partOfSpeech: "noun", senses: [
        { n: 1, form: null, definition: "a hand tool for cutting wood", example: "" },
        { n: 2, form: null, definition: "a short saying", example: "an old saw" },
      ] },
      { partOfSpeech: "verb", senses: [{ n: 3, form: null, definition: "cut with a saw", example: "saw wood" }] },
    ]);
    expect(card.headwords[1].groups[0].senses[0].n).toBe(4);
    // The note gives the tutor the same numbers.
    expect(noteFor(shown)).toContain("4. see (verb): perceive with the eyes");
  });

  it("says when the word is a form of the headword, as the note does", () => {
    const card = dictionaryCard(shown);
    expect(card.headwords[0].formOf).toBeNull();
    expect(card.headwords[1].formOf).toBe('"saw" is a form of "see".');
    expect(noteFor(shown)).toContain(card.headwords[1].formOf!);
  });

  it("shows a sense's own spelling only when it differs from the headword", () => {
    const card = dictionaryCard({ word: "may", entries: [{ headword: "may", via: "exact", senses: [
      { form: "May", pos: "n", definition: "the month following April", example: "" },
      { form: "may", pos: "n", definition: "a shrub", example: "" },
    ] }] });
    expect(card.headwords[0].groups[0].senses.map((s) => s.form)).toEqual(["May", null]);
  });

  it("shows nothing the filter or the caps left out: only what shownEntry kept", () => {
    const many = Array.from({ length: 12 }, (_, i) => sense("blip", "n", `made-up sense ${i + 1}`));
    const entries: DictionaryEntry[] = [{ headword: "blip", via: "exact", senses: [
      sense("blip", "n", "vulgar slang for a made-up thing"),
      ...many,
    ] }];
    const kept = shownEntry("blip", entries)!;
    const card = dictionaryCard(kept);
    const defs = card.headwords.flatMap((h) => h.groups.flatMap((g) => g.senses.map((s) => s.definition)));
    expect(defs).toEqual(kept.entries.flatMap((e) => e.senses.map((s) => s.definition)));
    expect(defs).not.toContain("vulgar slang for a made-up thing");
    expect(defs.length).toBeLessThanOrEqual(DICTIONARY_MAX_SENSES);
    expect(defs.length).toBeLessThan(many.length);
  });
});

describe("cardStartsOpen: the grade rule", () => {
  it("is closed for K-2 and open for grade 3 and up", () => {
    const open = (g: Grade) => cardStartsOpen(g);
    expect(GRADES.filter((g) => !open(g))).toEqual([0, 1, 2]);
    expect(GRADES.filter(open)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("is open when no grade is set", () => {
    expect(cardStartsOpen(null)).toBe(true);
  });

  it("labels the toggle in plain words", () => {
    expect(cardToggleLabel(false)).toBe("Show the dictionary entry");
    expect(cardToggleLabel(true)).toBe("Hide the dictionary entry");
    expect(CARD_SOURCE).toBe("From Open English WordNet");
  });
});

describe("cardSpeech: what the speaker button reads", () => {
  it("reads the headword, the part of speech, each sense and its example as sentences", () => {
    const card = dictionaryCard({ word: "went", entries: [{ headword: "go", via: "form", senses: [
      { form: "go", pos: "v", definition: "move from one place to another", example: "we went to the park" },
      { form: "go", pos: "v", definition: "be ended or lost.", example: "" },
    ] }] });
    expect(cardSpeech(card)).toBe(
      'go. "went" is a form of "go". Verb. 1. move from one place to another. For example: we went to the park. 2. be ended or lost.',
    );
  });
});
