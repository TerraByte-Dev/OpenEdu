// Follow-up suggestion chips — the "that was going to be my next question" surface.
//
// Derived DETERMINISTICALLY from state the turn already produced. No extra model call, deliberately:
// the review deleted a per-turn `updateKnowledgeFiles` call because on a CPU box an extra 4B
// generation is 3–8 seconds, and spending that on UI sugar would be a worse version of the same
// mistake. CLAUDE.md's own principle — code-assemble what does not need an LLM — applies exactly here.
//
// The signals available for free after a turn:
//   - whether the tutor ended by asking something (changes what a helpful chip even is)
//   - what retrieval surfaced, and which of it the answer did NOT use
//   - which subtopics at this level are still unmastered
//   - how many flashcards are due
//
// A chip is only worth showing if the student might plausibly have typed it themselves. Anything
// generic enough to fit every turn ("tell me more") is noise wearing a button, so the generic
// fallbacks sit last and get trimmed first.

import type { Syllabus } from "../../types";
import type { GroundingHit } from "./ground";

export interface Suggestion {
  /** Short text on the chip. */
  label: string;
  /** What actually gets sent when tapped — a full sentence, as the student would have typed it. */
  message: string;
}

/** Three is the cap. A fourth chip reads as a menu, and a menu is something to read rather than act on. */
const MAX_SUGGESTIONS = 3;

export interface SuggestionInput {
  /** The assistant's completed reply. */
  answer: string;
  syllabus: Syllabus | null;
  /** Passages retrieval surfaced this turn. */
  hits: GroundingHit[];
  /** The subset the answer demonstrably used (kernel `groundedIn`). */
  usedHits: GroundingHit[];
  dueFlashcards?: number;
  /** The student pressed Stop, or the stream died. No chips — they did not want more. */
  abandoned?: boolean;
  /** The reply was cut off by the length/context limit. Chips still show, led by "Continue". */
  truncated?: boolean;
}

/** True when the reply ends on a question, which changes what a useful chip is. */
export function endsWithQuestion(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) return false;
  // Strip a trailing markdown emphasis/quote marker so "…is it?**" still counts.
  return /\?["'*`)\]]*$/.test(trimmed);
}

export function suggestFollowUps(input: SuggestionInput): Suggestion[] {
  // Abandoned and truncated are NOT the same thing, and conflating them was a real bug: every
  // length-capped reply suppressed its own chips, so the turns most in need of an obvious next action
  // were the only ones that offered none.
  if (input.abandoned) return [];
  const answer = input.answer.trim();
  if (answer.length < 40) return []; // nothing substantive to follow up on

  const out: Suggestion[] = [];
  const push = (s: Suggestion) => {
    if (out.length < MAX_SUGGESTIONS && !out.some((x) => x.message === s.message)) out.push(s);
  };

  // A reply that stopped mid-sentence has exactly one obvious next move, and making the student type
  // it is the definition of a rough edge.
  if (input.truncated) {
    push({ label: "Continue", message: "Please continue from where you left off." });
  }

  if (endsWithQuestion(answer)) {
    // The tutor asked something. Competing with its question would be rude, so the chips become ways
    // to ANSWER it — specifically the two a stuck student needs and is least likely to type, because
    // both amount to admitting they are stuck.
    push({ label: "Give me a hint", message: "I'm not sure — can you give me a hint?" });
    push({ label: "Walk me through it", message: "I don't know how to start. Can you walk me through it?" });
    return out; // any Continue chip pushed above is kept — it was the more urgent signal

  }

  // Retrieval found something in the student's own material that the answer did NOT draw on. They
  // wrote it, so they half-remember it, and "what did I say about X" is a question people genuinely
  // ask. This is the chip most likely to earn the "I was about to ask that" reaction.
  const unusedNote = input.hits.find(
    (h) => h.source === "note" && !input.usedHits.some((u) => u.ref === h.ref),
  );
  if (unusedNote) {
    push({
      label: `My notes on ${short(unusedNote.title, 16)}`,
      message: `What do my notes on "${unusedNote.title}" say about this?`,
    });
  }

  // A curated card was cited — offering the rest of it is a real next step, not filler.
  const usedReference = input.usedHits.find((h) => h.source === "library");
  if (usedReference) {
    push({
      label: `More on ${short(usedReference.title, 18)}`,
      message: `Tell me more from the ${usedReference.title} reference.`,
    });
  }

  // The next unmastered subtopic at this level: the thing the course itself says comes next.
  const nextSubtopic = input.syllabus?.subtopics.find((s) => !s.mastered);
  if (nextSubtopic) {
    push({
      label: short(nextSubtopic.title),
      message: `Can you explain ${nextSubtopic.title}?`,
    });
  }

  if ((input.dueFlashcards ?? 0) > 0) {
    push({ label: "Review due cards", message: "Quiz me on the flashcards I have due." });
  }

  // Generic but genuinely useful, and last so they are the first to be trimmed. A worked example is
  // the single most common thing a stuck student wants and the least likely to be volunteered.
  push({ label: "Worked example", message: "Can you show me a worked example?" });
  push({ label: "Why does that work?", message: "Why does that work?" });

  return out;
}

/** Chips live in a single row; long titles turn the row into a paragraph. */
function short(title: string, max = 22): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
