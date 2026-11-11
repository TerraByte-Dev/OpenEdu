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
// frozen for lever 18 (caps 3/6/8, 360 estTokens, the form and capitalised-form rules of selectSenses).
// A note-wording change on dev does not move it; a cap, format, data or detector change does. Review
// round 2 moved it once, before any run: the capitalised-form rule drops one sense from one item
// (def-k2-09, "delicious": a capitalised proper-name sense); no other item's entry changed.
const FROZEN_ENTRIES_SHA256 = "0853c13108bdc543b41aef3b629104fbc13875abf9a36dcbc3cfa9520a307f85";

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
});
