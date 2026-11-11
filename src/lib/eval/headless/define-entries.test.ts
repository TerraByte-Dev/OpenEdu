import { describe, it, expect, beforeAll } from "vitest";

// The entries the define suite's D arm shows, read from the real bundled dictionary (public/ served as
// the app origin, as in the eval). Pins them: the caps, the entry format and the data are frozen for
// lever 18 (BENCHMARKS.md), so any change to them fails here and must be a deliberate, logged change.
// Only hashes are compared; no entry text is printed or committed here.

import { installAppOrigin } from "./origin";
import { lookupWord } from "../../dictionary";
import { askedWord, dictionaryNote } from "../../kernel/defineWord";
import { DEFINE_ITEMS } from "../define-items";

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const entryOf = (note: string) => note.slice(0, note.indexOf("<tutor_note>"));

// The SHA-256 of the 184 entry blocks (the note without its <tutor_note>), joined in item order, as
// frozen for lever 18 (revision r2 of the items, caps 3/6/8, 360 estTokens). A note-wording change on
// dev does not move it; a cap, format, data or detector change does.
const FROZEN_ENTRIES_SHA256 = "407656a10a9aff8a07453aa9388248f63ae22de8de10bc28dfc0ce86980f8241";

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

  it("drops two-letter suffix-rule forms: gas does not show ga; vs and 'tis get no note", async () => {
    const gas = dictionaryNote("gas", await lookupWord("gas"));
    expect(gas).not.toBeNull();
    expect(gas).not.toContain('is a form of "ga"');
    expect(dictionaryNote("vs", await lookupWord("vs"))).toBeNull();
    expect(dictionaryNote("'tis", await lookupWord("'tis"))).toBeNull();
  });
});
