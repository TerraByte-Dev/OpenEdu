// Which Library cards a course's Resources tab recommends (ResourcesTab.tsx). Pure: code picks them.
//
// It used to score the whole syllabus joined into one query and keep anything above zero. The joined text
// repeats its words ("part" fifteen times in a fractions level), every repeat counted again, so Parts of
// Speech led a fractions course and Music, Physics and Spanish filled the rest (TerraTutor click test 2026-11-19).
// Port of TerraTutor #249.
//
// Now each text is scored on its own: the course topic, each subtopic title (the anchors) and each key
// concept. A card is recommended when it reaches the grounding floor (kernel/ground.ts MIN_LIBRARY_SCORE)
// from an anchor, or from a key concept while also sharing a word with an anchor. A key concept is a long
// sentence, and one word in it can name an unrelated card ("Chromatin Remodeling Dynamics" reached the
// music card "Dynamics"). With no card about the course, the list is empty, never the least-bad cards.

import { matchResourcesScored } from "./library-rank";
import { MIN_LIBRARY_SCORE } from "./kernel/ground";
import type { LibraryEntry, Subtopic } from "../types";

export function courseResources(
  topic: string,
  subtopics: ReadonlyArray<Pick<Subtopic, "title" | "key_concepts">>,
  manifest: LibraryEntry[],
  topN = 36,
): LibraryEntry[] {
  const best = (texts: string[]) => {
    const out = new Map<LibraryEntry, number>();
    for (const text of texts) {
      for (const { entry, score } of matchResourcesScored(text, manifest, manifest.length)) {
        out.set(entry, Math.max(out.get(entry) ?? 0, score));
      }
    }
    return out;
  };
  const anchors = best([topic, ...subtopics.map((s) => s.title)]);
  const concepts = best(subtopics.flatMap((s) => s.key_concepts));
  const kept = new Map<LibraryEntry, number>();
  for (const [entry, a] of anchors) if (a >= MIN_LIBRARY_SCORE) kept.set(entry, a);
  for (const [entry, c] of concepts) {
    if (c >= MIN_LIBRARY_SCORE && anchors.has(entry)) kept.set(entry, Math.max(kept.get(entry) ?? 0, c));
  }
  return [...kept]
    .sort((x, y) => y[1] - x[1] || x[0].title.localeCompare(y[0].title))
    .slice(0, topN)
    .map(([entry]) => entry);
}
