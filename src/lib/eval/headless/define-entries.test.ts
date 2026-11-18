import { describe, it, expect, beforeAll } from "vitest";

// The entries the define suite's D arm shows, read from the real bundled dictionary (public/ served as
// the app origin, as in the eval). Pins them: the caps, the entry format and the data are frozen for
// lever 18 (BENCHMARKS.md), so any change to them fails here and must be a deliberate, logged change.
// Only hashes are compared; no entry text is printed or committed here.

import { installAppOrigin } from "./origin";
import { lookupWord } from "../../dictionary";
import { askedWord, dictionaryNote, lookupDictionary, selectSenses, DRUG_SENSE } from "../../kernel/defineWord";
import { DEFINE_ITEMS } from "../define-items";

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const entryOf = (note: string) => note.slice(0, note.indexOf("<tutor_note>"));

// The SHA-256 of the 184 entry blocks (the note without its <tutor_note>), joined in item order, as
// frozen for lever 18 (caps 3/6/8, 360 estTokens, the form and capitalised-form rules of selectSenses).
// A note-wording change on dev does not move it; a cap, format, data or detector change does. It is
// the value pinned at 597bda9: review round 2 moved it once (the capitalised-form rule then also applied
// to longer words and dropped a sense from def-k2-09), and round 3 moved it back by limiting that rule
// to two-letter words. The sensitive-sense filter changed none of the 184 entries until 2026-11-18, when
// the violent-example screen (defineWord.ts VIOLENT_EXAMPLE) dropped one example from sense-35-05
// ("the murderer is present in this room", under "present"): 407656a1… -> d4ba0cfb…. Nothing else moved;
// the irregular-form rules of the same change touch no item.
const FROZEN_ENTRIES_SHA256 = "d4ba0cfb0f9b5733ea2aa399b14ff9dafd06e177c44b19ba4b862ac41d6245c1";
// The one item entry the child-safety filter changes, and the one example it drops there.
const FILTERED_ITEM = "sense-35-05";
const FILTERED_EXAMPLE = "the murderer is present in this room";

describe("define entries from the bundled dictionary", () => {
  const notes = new Map<string, string | null>();
  beforeAll(async () => {
    installAppOrigin();
    for (const item of DEFINE_ITEMS) {
      const word = askedWord(item.ask)!.word;
      notes.set(item.id, dictionaryNote(word, await lookupWord(word)));
    }
  }, 60_000);

  it("every item gets a note", () => {
    expect([...notes].filter(([, n]) => !n).map(([id]) => id)).toEqual([]);
  });

  it("the shown entries are the frozen ones", async () => {
    const joined = DEFINE_ITEMS.map((i) => entryOf(notes.get(i.id)!)).join("\u0000");
    expect(await sha256(joined)).toBe(FROZEN_ENTRIES_SHA256);
  });

  const note = async (w: string) => dictionaryNote(w, await lookupWord(w));

  it("keeps two-letter forms without an exact entry (went, goes, doing, ads, ups, ids), drops them beside one (gas), and drops one-letter forms (vs)", async () => {
    expect(await note("went")).toContain('"went" is a form of "go".');
    for (const w of ["goes", "doing", "ads", "ups", "ids"]) expect(await note(w), w).not.toBeNull();
    const gas = await note("gas");
    expect(gas).not.toBeNull();
    expect(gas).not.toContain('is a form of "ga"');
    expect(await note("vs")).toBeNull();
  });

  it("keeps lower-case abbreviations (km, cm, kg, ml, pm, tv) and gives none for those stored only with capitals (ac, mx, dy, xy)", async () => {
    for (const w of ["km", "cm", "kg", "ml", "pm", "tv"]) expect(await note(w), w).not.toBeNull();
    for (const w of ["ac", "mx", "dy", "xy"]) expect(await note(w), w).toBeNull();
  });

  it("keeps capitalised senses for words longer than two letters typed in lower case (welsh, thanksgiving, may)", async () => {
    for (const w of ["welsh", "thanksgiving", "may"]) {
      const shown = selectSenses(await lookupWord(w), w).flatMap((p) => p.senses);
      expect(shown.some((s) => s.form !== s.form.toLowerCase()), w).toBe(true);
    }
  });

  it("never shows a drug street name, a slur or an obscene sense (went, goes, snow, fairy)", async () => {
    for (const w of ["went", "goes"]) {
      expect(await note(w), w).not.toMatch(/methylenedioxymethamphetamine|street names? for/i);
      expect(await note(w), w).toContain('is a form of "go"');
    }
    expect(await note("snow")).not.toMatch(/cocaine|street names? for/i);
    expect(await note("snow")).not.toBeNull();
    expect(await note("fairy")).not.toMatch(/offensive/i);
    expect(await note("fairy")).not.toBeNull();
  });

  it("the child-safety filter changes one of the 184 item entries, by one example: with it and without it, the same senses", async () => {
    for (const item of DEFINE_ITEMS) {
      const word = askedWord(item.ask)!.word;
      const entries = await lookupWord(word);
      const without = selectSenses(entries, word, false);
      const expected = item.id !== FILTERED_ITEM ? without : without.map((p) => ({
        ...p, senses: p.senses.map((s) => (s.example === FILTERED_EXAMPLE ? { ...s, example: "" } : s)),
      }));
      if (item.id === FILTERED_ITEM) expect(JSON.stringify(without)).toContain(FILTERED_EXAMPLE);
      expect(selectSenses(entries, word, true), item.id).toEqual(expected);
    }
  });

  // 2026-11-18 audit: an irregular past tense was explained as the wrong word ("lay" as the noun "lie",
  // "a statement that deviates from or perverts the truth"), or its base's verb senses never fit in.
  it("irregular past tenses: the base headword shows only its verb senses, with room for them beside the word's own", async () => {
    const shown = async (ask: string) => {
      const a = askedWord(ask)!;
      return (await lookupDictionary(a.word, lookupWord, 60_000, undefined, a.context))!.shown.entries;
    };
    const base = async (ask: string, head: string) => (await shown(ask)).find((e) => e.headword === head);
    for (const [ask, head] of [
      ["what does fell mean?", "fall"], ["what does fell mean in 'Jack fell down the hill'?", "fall"],
      ["what does lay mean?", "lie"], ["what does lay mean in 'the cat lay on the mat'?", "lie"],
      ["what does ground mean?", "grind"], ["what does left mean?", "leave"], ["what does wound mean?", "wind"],
    ] as const) {
      const e = await base(ask, head);
      expect(e?.via, ask).toBe("form");
      expect(e!.senses.length, ask).toBeGreaterThanOrEqual(2);
      expect(e!.senses.every((s) => s.pos === "v"), ask).toBe(true);
    }
    expect((await base("what does fell mean?", "fall"))!.senses.map((s) => s.definition)).toContain("descend in free fall under the influence of gravity");
    expect((await base("what does lay mean in 'the cat lay on the mat'?", "lie"))!.senses.map((s) => s.definition))
      .toContain("be lying, be prostrate; be in a horizontal position");
    const lay = JSON.stringify(await shown("what does lay mean in 'the cat lay on the mat'?"));
    expect(lay).not.toContain("perverts the truth");
    expect(JSON.stringify(await shown("what does ground mean?"))).not.toContain("insignificant student");
    // "lay" keeps its own meaning too ("put into a certain place"): both are offered, plainly.
    expect((await shown("what does lay mean?"))[0]).toMatchObject({ headword: "lay", via: "exact" });
    // A plural reached through the noun list shows only noun senses: "geese" is never the verb "goose".
    const geese = await shown("what does geese mean?");
    expect(geese.map((e) => e.headword)).toEqual(["goose"]);
    expect(geese[0].senses.every((s) => s.pos === "n")).toBe(true);
    // "went" is the verb "go", never the board game.
    expect((await shown("what does went mean?"))[0].senses.every((s) => s.pos === "v")).toBe(true);
  });

  it("drops sexual, slur and insult senses (come, hoe, john, tramp, honky, whitey, relation, intercourse, safe)", async () => {
    const SEXUAL = /semen|sperm|ejacul|prostitut|whore|promiscu|copulat|coitus|sexual|condom|contracepti|offensive|disparag|derogat|insult/i;
    for (const w of ["came", "comes", "come", "hoe", "john", "tramp", "honky", "whitey", "relation", "intercourse", "safe"]) {
      expect(await note(w) ?? "", w).not.toMatch(SEXUAL);
    }
    // The words keep their ordinary senses where they have them.
    for (const w of ["came", "come", "hoe", "john", "tramp", "relation", "intercourse", "safe"]) expect(await note(w), w).not.toBeNull();
  });

  it("drops drug slang on ordinary words, and keeps the drug words' own entries", async () => {
    for (const w of ["chalk", "crank", "tornado", "roach", "dab", "fix"]) {
      const n = await note(w);
      expect(n, w).not.toBeNull();
      expect(n, w).not.toMatch(DRUG_SENSE);
    }
    for (const w of ["cocaine", "heroin", "marijuana"]) expect(await note(w), w).toMatch(DRUG_SENSE);
  });

  it("gives no note at all for blocked profanity, inflections included", async () => {
    for (const w of ["bitch", "bitches", "shit", "shitty", "fuck", "fucking", "retard", "retarded", "twat", "cunt"]) expect(await note(w), w).toBeNull();
  });

  it("does not over-block: slang, sensationalism, std, chaste, expletive, censor and poop keep their senses", async () => {
    for (const w of ["slang", "sensationalism", "std", "chaste", "expletive", "censor", "poop"]) expect(await note(w), w).not.toBeNull();
  });

  it("does not read Object.prototype for a word such as constructor", async () => {
    await expect(lookupWord("constructor")).resolves.toBeInstanceOf(Array);
    await expect(lookupWord("__proto__")).resolves.toBeInstanceOf(Array);
    await expect(lookupWord("hasownproperty")).resolves.toEqual([]);
  });
});
