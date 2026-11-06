// The citation chip under a tutor answer: which state it is in, and what it claims.
//
// Kept pure and out of ChatTab.tsx so the claim the chip makes is pinned by a test against real model
// output rather than checked by eye in the dev app.
//
// What the chip can honestly claim is set by how it is computed. `groundedIn` (ground.ts) proves that
// the answer REUSED a passage's wording — six content words in a row. It does not, and without a
// language model cannot, prove the answer CAME FROM that passage. Those two differ exactly when the
// tutor is being most honest: on the held-out near-miss questions gemma4:e4b answered "I do not have
// information about how much rain fell. Your notes mention that the sediment index was lower than the
// team expected given the rainfall…" — a correct refusal that quotes the note to show what it does
// say. 12 of the 54 near-miss dev answers reused a note like that, and blind graders judged 11 of the
// 12 honest. Under the old "Grounded in: <note>" wording each of those showed a student "not in your
// notes" beside a chip naming the note as the source.
//
// So the chip says what was proven: the answer quotes from this passage. That is true for a grounded
// answer and for a refusal that quotes, in every language the app serves, with no refusal-phrase
// detection to get wrong.

import type { GroundingHit } from "./ground";

/**
 * quoted     — the answer demonstrably reused these passages' wording (n-gram overlap, not the model's
 *              word). Says nothing about whether they answered the question.
 * ungrounded — passages WERE retrieved and the answer reused none of them.
 */
export type CitationNote = { kind: "quoted"; titles: string[] } | { kind: "ungrounded" };

/** Null when nothing was retrieved: there is nothing to cite and nothing to have ignored. */
export function citationNote(hits: GroundingHit[], usedHits: GroundingHit[]): CitationNote | null {
  if (hits.length === 0) return null;
  return usedHits.length > 0
    ? { kind: "quoted", titles: [...new Set(usedHits.map((h) => h.title))] }
    : { kind: "ungrounded" };
}

export function quotedChipLabel(title: string): string {
  return `Quotes from: ${title}`;
}

export const QUOTED_CHIP_TOOLTIP =
  "This answer repeats wording from this passage. That shows what it quoted — not that the passage answers your question.";
