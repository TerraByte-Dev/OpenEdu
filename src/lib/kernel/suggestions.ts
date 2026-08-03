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
import type { TutorModeId } from "../tutor-modes";
import type { GroundingHit } from "./ground";

export interface Suggestion {
  /** Short text on the chip. */
  label: string;
  /**
   * What gets sent when tapped. IMPERATIVE AND BARE — this is not politeness scaffolding, and the
   * padding it used to carry was actively harmful rather than merely verbose.
   *
   * "I don't know how to start. Can you walk me through it?" instructs a restart. "I'm not sure —
   * can you give me a hint?" announces confusion, which invites reassurance and re-explanation. Both
   * made the tutor circle back over ground already covered instead of advancing, which is exactly
   * what the chips exist to prevent.
   *
   * A chip that carries a `mode` also does not need to describe the behaviour it wants: socratic's
   * prompt suffix already says "do not give direct answers", so the message only has to name the
   * subject. Say the thing; let the mode say how.
   *
   * The label should be a truthful preview of this — tapping "Give me a hint" should send "Give me a
   * hint", not a paragraph the student never saw.
   */
  message: string;
  /**
   * The teaching mode this chip carries, applied to the turn it starts.
   *
   * This is what lets the mode bar be deleted rather than merely hidden. A mode is not a label — it
   * is `tools_required` plus a promptSuffix, and the suffix is what makes the behaviour reliable on a
   * 4B model ("ONLY brief nudges — one sentence maximum" is why hint mode produces a hint). A chip
   * that only sent text would trade a UI win for a reliability loss; a chip that carries the mode
   * keeps the pedagogy and drops the control.
   *
   * Omitted means "explain" — the neutral default, which is also what plain typing does.
   */
  mode?: TutorModeId;
}

/** Three is the cap. A fourth chip reads as a menu, and a menu is something to read rather than act on. */
const MAX_SUGGESTIONS = 3;

/**
 * At most this many context-derived chips, so at least one mode chip always survives.
 *
 * Without it, a turn with rich context (an unused note, a cited reference, an unmastered subtopic)
 * fills all three slots and the modes that replaced the deleted bar — socratic, quiz — become
 * unreachable. Contextual chips are more specific and deserve to win, but not to shut the door.
 */
const MAX_CONTEXTUAL = 2;

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
    push({ label: "Continue", message: "Continue." });
  }

  if (endsWithQuestion(answer)) {
    // The tutor asked something. Competing with its question would be rude, so the chips become ways
    // to ANSWER it — specifically the two a stuck student needs and is least likely to type, because
    // both amount to admitting they are stuck.
    push({ label: "Give me a hint", message: "Give me a hint.", mode: "hint" });
    push({ label: "Walk me through it", message: "Walk me through it." });
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
      message: `What do my notes say about ${unusedNote.title}?`,
    });
  }

  // A curated card was cited — offering the rest of it is a real next step, not filler.
  const usedReference = input.usedHits.find((h) => h.source === "library");
  if (usedReference) {
    push({
      label: `More on ${short(usedReference.title, 18)}`,
      message: `More on ${usedReference.title}.`,
    });
  }

  // The next unmastered subtopic at this level: the thing the course itself says comes next.
  const nextSubtopic = input.syllabus?.subtopics.find((s) => !s.mastered);
  if (nextSubtopic) {
    push({
      label: short(nextSubtopic.title),
      message: `Explain ${nextSubtopic.title}.`,
    });
  }

  if ((input.dueFlashcards ?? 0) > 0) {
    push({ label: "Review due cards", message: "Review my due flashcards.", mode: "review" });
  }

  // Everything above is contextual. Trim to leave room for a mode chip — see MAX_CONTEXTUAL.
  const contextual = out.splice(MAX_CONTEXTUAL);
  void contextual;

  // The mode chips. These ARE the deleted mode bar: each carries the pedagogy that used to require
  // the student to classify their own intent before asking. Ordered by how often a stuck student
  // actually wants them.
  push({ label: "Worked example", message: "Show me a worked example." });
  push({ label: "Make me figure it out", message: "Let me work it out.", mode: "socratic" });
  push({ label: "Quiz me on this", message: "Quiz me on this.", mode: "quiz" });
  push({ label: "Check if I've got this", message: "Check if I've got this.", mode: "assess" });

  return out;
}

/** Chips live in a single row; long titles turn the row into a paragraph. */
function short(title: string, max = 22): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
