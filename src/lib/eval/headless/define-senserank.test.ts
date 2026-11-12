import { describe, it, expect, beforeAll } from "vitest";

// Lever 19's ranker on the real bundled dictionary (docs/BENCHMARKS.md row 19), through the kernel's
// own path: askedWord on the student's message, then lookupDictionaryNote with askedWord's context (R,
// the ranker on) or without it (S, EVAL_SENSE_RANK=off), as TutorEngine calls it. Only hashes, counts
// and named senses are checked; B8's entries are hashed, not printed.

import { installAppOrigin } from "./origin";
import { fs } from "./node-io";
import { lookupWord } from "../../dictionary";
import { askedWord, dictionaryNote, lookupDictionaryNote, scoringSentence, selectSenses } from "../../kernel/defineWord";
import { DEFINE_ITEMS } from "../define-items";
import { capsBroken } from "../blind19-grade";
import { changedEntry } from "../blind19-changed";

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const entryOf = (note: string) => note.slice(0, note.indexOf("<tutor_note>"));

/** The note a turn would carry for this message, with the ranker on (R) or off (S). */
async function noteFor(ask: string, rank: boolean): Promise<string | null> {
  const asked = askedWord(ask);
  if (!asked) throw new Error(`no fire: ${ask}`);
  return lookupDictionaryNote(asked.word, lookupWord, 60_000, undefined, rank ? asked.context : undefined);
}
const lines = (note: string | null) => entryOf(note ?? "").split("\n").filter((l) => /^\d+\. /.test(l));

// lever 18's frozen hash of the 184 shown entries (define-entries.test.ts), here read through S's path.
const FROZEN_ENTRIES_SHA256 = "407656a10a9aff8a07453aa9388248f63ae22de8de10bc28dfc0ce86980f8241";
// B8's 32 sense items, ranked (R), entry blocks joined in item order. Pinned when senseRank.ts was
// committed; any change to the ranker, the sentence rule, the caps or the data moves it.
const RANKED_SENSE_ENTRIES_SHA256 = "66c01a14e7ac5f8945b6c9fd4bbc73f6746c4b42d33568692fb9c10de7a8dd29";

/** Messages whose context has no sentence containing the word (R3): frozen; R must equal S on each. */
export const NO_SENTENCE_MESSAGES = [
  "I'm in 5th grade. What does benevolent mean?",
  "What does ominous mean in the last stanza?",
  "We are reading a story in class. what does reluctant mean?",
  "My teacher used a hard word today. What does the word diligent mean?",
  "what does eerie mean in chapter 3",
  "I don't know what fragile means in this story",
  "Sorry, quick question. what does sparse mean?",
  "We have a quiz tomorrow! What does the word abundant mean?",
  "what does vivid mean in the poem we read",
  "I saw this on a sign at the zoo. What does nocturnal mean?",
  "My little brother asked me. What does enormous mean?",
  "what does meticulous mean in my science homework",
  "Grandma said it at dinner. what does frugal mean?",
  "I'm learning English. What does the word cautious mean?",
  "what does anxious mean in paragraph two",
  "This is for my essay. definition of resilient",
  "Hi! I'm Maya. Can you define tedious?",
  "We read about the Pilgrims today. What is the meaning of perseverance?",
  "what does gloomy mean in the second line",
  "I got a 90 on my test. What does exceptional mean?",
  "My mom keeps saying it. What does procrastinate mean?",
  "The water in the river was cold and the fish swam fast. What does current mean in the next paragraph?",
];

describe("lever 19 on the bundled dictionary", () => {
  beforeAll(() => installAppOrigin());

  it("trunk with an elephant: the snout is shown first; in stored order it is not shown at all", async () => {
    const ask = "what does trunk mean in 'the elephant lifted water with its trunk'";
    expect(lines(await noteFor(ask, true))[0]).toMatch(/^1\. trunk \(noun\): a long flexible snout as of an elephant$/);
    expect(lines(await noteFor(ask, false)).some((l) => /snout/.test(l))).toBe(false);
  });

  it("bank: a sentence about water keeps the river bank first; one about money puts the financial sense first, ties in stored order", async () => {
    const stored = lines(await noteFor("what does bank mean?", false));
    expect(stored[0]).toMatch(/^1\. bank \(noun\): sloping land/);
    expect(lines(await noteFor("what does bank mean in 'the bank of the river was under water'", true))).toEqual(stored);
    const money = lines(await noteFor("what does bank mean in 'she put her money in the bank'", true));
    // Three senses share "money" (score 1 each) and keep their stored order among themselves (2nd, 8th,
    // 16th stored); the senses that score 0 follow in stored order.
    expect(money.map((l) => l.replace(/^\d+\. /, "").slice(0, 40))).toEqual([
      "bank (noun): a financial institution tha", "bank (noun): a container (usually with a", "bank (verb): put into a bank account. Ex",
      "bank (noun): sloping land (especially th", "bank (verb): tip laterally. Example: \"th", "bank (verb): enclose with a bank. Exampl",
    ]);
  });

  it("crane looking for fish: no word of the sentence is in a crane gloss, so the order is stored (the bird is 2nd); a sentence that uses the gloss's words ranks the bird first", async () => {
    const fish = "what does crane mean in 'a crane stood in the shallow water looking for fish'";
    expect(await noteFor(fish, true)).toBe(await noteFor(fish, false));
    expect(lines(await noteFor(fish, true))[1]).toMatch(/^2\. crane \(noun\): large long-necked wading bird/);
    expect(lines(await noteFor("what does crane mean in 'the crane is a wading bird of the marshes'", true))[0]).toMatch(/^1\. crane \(noun\): large long-necked wading bird/);
  });

  it("B8's 152 plain items: the note is byte-identical with the ranker on and off", async () => {
    const plain = DEFINE_ITEMS.filter((i) => i.kind === "plain");
    expect(plain).toHaveLength(152);
    for (const item of plain) expect(await noteFor(item.ask, true), item.id).toBe(await noteFor(item.ask, false));
  }, 60_000);

  it("the frozen no-sentence messages (20 or more): each fires, gets a note, has no sentence, and is byte-identical on and off", async () => {
    expect(NO_SENTENCE_MESSAGES.length).toBeGreaterThanOrEqual(20);
    for (const ask of NO_SENTENCE_MESSAGES) {
      const asked = askedWord(ask);
      expect(asked, ask).not.toBeNull();
      expect(await scoringSentence(asked!.word, asked!.context, await lookupWord(asked!.word), lookupWord), ask).toBeNull();
      const on = await noteFor(ask, true);
      expect(on, ask).not.toBeNull();
      expect(on, ask).toBe(await noteFor(ask, false));
    }
    // Most carry a context the old rule would have ranked by.
    expect(NO_SENTENCE_MESSAGES.filter((m) => askedWord(m)!.context).length).toBeGreaterThanOrEqual(15);
  }, 60_000);

  it("with the ranker off, lever 18's frozen hash of the 184 shown entries still holds", async () => {
    const joined: string[] = [];
    for (const item of DEFINE_ITEMS) joined.push(entryOf((await noteFor(item.ask, false))!));
    expect(await sha256(joined.join("\u0000"))).toBe(FROZEN_ENTRIES_SHA256);
  }, 60_000);

  it("B8's 32 sense items, ranked: pinned hash, every note within the caps, and the ranker's time per lookup", async () => {
    const sense = DEFINE_ITEMS.filter((i) => i.kind === "sense");
    expect(sense).toHaveLength(32);
    const joined: string[] = [];
    const broken: string[] = [];
    let changed = 0;
    for (const item of sense) {
      const note = (await noteFor(item.ask, true))!;
      joined.push(entryOf(note));
      if (capsBroken(note)) broken.push(`${item.id}: ${capsBroken(note)}`);
      if (note !== (await noteFor(item.ask, false))) changed++;
    }
    expect(broken).toEqual([]);
    const hash = await sha256(joined.join("\u0000"));
    console.log(`[lever 19] B8 sense items whose entry the ranker changes: ${changed} of 32; ranked hash ${hash}`);
    expect(hash).toBe(RANKED_SENSE_ENTRIES_SHA256);
    // Time: the ranked selection (stems, scores, sort, caps) per lookup, the entries already loaded.
    const loaded = await Promise.all(sense.map(async (i) => {
      const a = askedWord(i.ask)!;
      const entries = await lookupWord(a.word);
      return { word: a.word, entries, sentence: await scoringSentence(a.word, a.context, entries, lookupWord) };
    }));
    const reps = 50;
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) for (const x of loaded) dictionaryNote(x.word, x.entries, x.sentence);
    const ranked = (performance.now() - t0) / (reps * loaded.length);
    const t1 = performance.now();
    for (let r = 0; r < reps; r++) for (const x of loaded) dictionaryNote(x.word, x.entries);
    const stored = (performance.now() - t1) / (reps * loaded.length);
    console.log(`[lever 19] note per lookup over B8's 32 sense items: ranked ${(1000 * ranked).toFixed(0)} µs, stored ${(1000 * stored).toFixed(0)} µs`);
    expect(ranked).toBeLessThan(20);
  }, 60_000);

  it("the changed list's row for an item matches the notes the two arms build", async () => {
    for (const item of DEFINE_ITEMS.filter((i) => i.kind === "sense")) {
      const row = await changedEntry(item.ask, lookupWord);
      expect(row.changed, item.id).toBe((await noteFor(item.ask, true)) !== (await noteFor(item.ask, false)));
    }
    const trunk = await changedEntry("what does trunk mean in 'the elephant lifted water with its trunk'", lookupWord);
    expect(trunk).toMatchObject({ changed: true, sFirstAbsentUnderR: false });
    expect(trunk.topScore).toBeGreaterThanOrEqual(1);
    expect(await changedEntry("I'm in 5th grade. What does benevolent mean?", lookupWord)).toEqual({ changed: false, sFirstAbsentUnderR: false, topScore: 0 });
  }, 60_000);

  it("the caps hold on ranked notes whatever the sentence (the whole entry as the sentence, for each sense)", async () => {
    for (const w of ["run", "set", "go", "take", "line", "break", "play", "light", "bank", "trunk"]) {
      const entries = await lookupWord(w);
      for (const e of entries) for (const s of e.senses) {
        const note = dictionaryNote(w, entries, `${s.definition} ${s.example}`);
        expect(note && capsBroken(note), `${w}: ${s.definition}`).toBeFalsy();
        expect(selectSenses(entries, w, true, `${s.definition} ${s.example}`).reduce((k, p) => k + p.senses.length, 0)).toBeLessThanOrEqual(8);
      }
    }
  }, 60_000);
});

describe("senseRank.ts is the file whose SHA-256 is recorded (BENCHMARKS.md row 19)", () => {
  // Hashed with LF line endings, as git stores it. Between this hash and the test tag, src/lib/kernel and
  // src/lib/dictionary.ts must not change.
  const RECORDED = "6c21097b17517489a769bc3aa24bf37bbbdfb69748656b9148210a05cecdcfb2";
  it("matches", async () => {
    const text = (await (await fs()).readFile("src/lib/kernel/senseRank.ts", "utf8")).replace(/\r\n/g, "\n");
    expect(await sha256(text)).toBe(RECORDED);
  });
});
