// blind-19's changed list (docs/BENCHMARKS.md row 19, R4): for each item, whether the shown entry
// differs between S (stored order) and R (ranked), computed by code from the items and the bundled
// dictionary through the kernel's own functions, and committed before any reply exists. Also the two
// descriptive counts of R5: S's first shown sense absent under R, and the ranked top sense's score.
// The script is headless/blind19-changed.ts.

import type { DictionaryEntry } from "../dictionary";
import { askedWord, dictionaryNote, scoringSentence, selectSenses } from "../kernel/defineWord";
import { contentStems, excludedStems, senseOverlap } from "../kernel/senseRank";
import type { ChangedList } from "./blind19-grade";

const entryOf = (note: string | null) => (note === null ? null : note.slice(0, note.indexOf("<tutor_note>")));

/** One item's row of the changed list, as the kernel would build its note in each arm. */
export async function changedEntry(ask: string, lookup: (w: string) => Promise<DictionaryEntry[]>): Promise<ChangedList["items"][string]> {
  const asked = askedWord(ask);
  if (!asked) throw new Error(`askedWord does not fire on: ${ask}`);
  const entries = await lookup(asked.word);
  const sentence = await scoringSentence(asked.word, asked.context, entries, lookup);
  const s = entryOf(dictionaryNote(asked.word, entries));
  const r = entryOf(dictionaryNote(asked.word, entries, sentence));
  const firstS = selectSenses(entries, asked.word)[0]?.senses[0];
  const pickedR = selectSenses(entries, asked.word, true, sentence);
  // The note's token cut drops senses from the end only, so the first shown sense is the selection's first.
  const shownR = pickedR.flatMap((p) => p.senses);
  const sFirstAbsentUnderR = !!firstS && !shownR.some((x) => x.pos === firstS.pos && x.definition === firstS.definition);
  const top = pickedR[0];
  const ex = top ? excludedStems(asked.word, top.entry.headword) : new Set<string>();
  const topScore = sentence && top ? senseOverlap(contentStems(sentence, ex), top.senses[0], ex) : 0;
  return { changed: s !== r, sFirstAbsentUnderR, topScore };
}
