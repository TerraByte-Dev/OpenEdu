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
import { replyFromPersisted } from "./persistedReply";

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
  /** The student has tried the question the tutor has open (see `hasTriedOpenQuestion`). */
  studentAttempted?: boolean;
}

// What the stuck chips send. A tap on one of these is a request for help, not a try at the problem.
const HINT_MESSAGE = "Give me a hint.";
const WALK_MESSAGE = "Walk me through it.";
// Measured on 2026-11-06 after a wrong first try: this wording got the worked answer from gemma4:e4b
// in 8 of 8 runs, and "Walk me through it." in 5 of 8 (the tutor often kept asking instead).
export const SHOW_ANSWER_MESSAGE = "Show me the full worked answer.";

// A message that asks for something rather than trying the problem: the chips, the deep-link prefill
// ("Help me with Decimals."), and the ways students say they are stuck. Matched at the start so a chip
// the student edited ("Give me a hint please") is still a request.
const REQUEST = /^(give me a hint|walk me through|show me|help me|explain|tell me|continue|more on|quiz me|review my|check if|let me work|what do my notes|i don'?t know|idk|no idea)\b/i;

/**
 * True when the student has had a go at the question the tutor currently has open.
 *
 * This is what gates the "Show me the answer" chip. Trying before seeing the answer, then getting
 * the answer as feedback, helps memory more than reading the answer straight away (retrieval
 * practice; the pretesting effect). But a tutor that only ever asks back leaves a stuck student with
 * nothing, which is what the k12-mc benchmark caught both gemma4 models doing. So the answer is one
 * tap away, but only after one try. Decided by code, not by the model: neither gemma4 model reliably
 * followed a prompt rule to hide its answer.
 *
 * `history` ends with the student's newest message. Walking back from it:
 *   - a help request (hint, walk-through) keeps the try that came before it, so asking for a hint
 *     after a try does not take the answer away again;
 *   - "Show me the full worked answer." means the answer was given, so the question is closed;
 *   - a tutor reply that asked nothing closed the question;
 *   - any other student message is a try if the tutor's message before it asked a question.
 *
 * Known limit: code cannot tell "Correct! Now what is 12 + 9?" from a re-ask of the same question,
 * so after a correct answer the chip is offered for the tutor's next question too.
 */
export function hasTriedOpenQuestion(history: ReadonlyArray<{ role: string; content: string }>): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "user") {
      if (!endsWithQuestion(m.content)) return false;
      continue;
    }
    const text = m.content.trim().replace(/^["'\s]+/, "");
    if (!text || text === SHOW_ANSWER_MESSAGE) return false;
    if (REQUEST.test(text)) continue;
    for (let k = i - 1; k >= 0; k--) {
      if (history[k].role === "assistant") return endsWithQuestion(history[k].content);
    }
    return false;
  }
  return false;
}

/** A reply shorter than this, trimmed, gets no chips: nothing substantive to follow up on. */
const MIN_ANSWER_CHARS = 40;

/**
 * The one rule for whether "Show me the answer" is offered under a reply: the reply was not
 * abandoned, has at least MIN_ANSWER_CHARS, ends on a question, and the student had tried the open
 * question when they sent the message it answers (`studentAttempted`, from hasTriedOpenQuestion).
 *
 * suggestFollowUps calls it to build ChatTab's chips, and the kernel calls it (through
 * showAnswerOfferedAfter) to decide the worked-answer turn, so the chip and the rules swap cannot
 * disagree about when the student has earned the answer.
 */
export function offersShowAnswer(input: Pick<SuggestionInput, "answer" | "abandoned" | "studentAttempted">): boolean {
  if (input.abandoned) return false;
  const answer = input.answer.trim();
  return answer.length >= MIN_ANSWER_CHARS && endsWithQuestion(answer) && !!input.studentAttempted;
}

/**
 * True when ChatTab offered "Show me the answer" under the last message of `history`.
 *
 * `history` is the conversation as saved (persistedReply), user and assistant messages only, ending
 * with the tutor's reply the chip would sit under. It rebuilds what ChatTab passed when it built that
 * reply's chips: `studentAttempted` is hasTriedOpenQuestion over the history up to the student message
 * the reply answers, and the reply is the model's text without persistedReply's marker (a stopped or
 * stalled reply offers no chips; one cut at the length limit still does). Anything other than a tutor
 * reply at the end means there was no chip.
 */
export function showAnswerOfferedAfter(history: ReadonlyArray<{ role: string; content: string }>): boolean {
  const reply = history[history.length - 1];
  if (!reply || reply.role !== "assistant") return false;
  const { text, stopReason } = replyFromPersisted(reply.content);
  return offersShowAnswer({
    answer: text,
    abandoned: stopReason === "aborted" || stopReason === "stalled",
    studentAttempted: hasTriedOpenQuestion(history.slice(0, -1)),
  });
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
  if (answer.length < MIN_ANSWER_CHARS) return []; // nothing substantive to follow up on

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
    // After a try, the student has earned the answer, so it leads.
    if (offersShowAnswer(input)) push({ label: "Show me the answer", message: SHOW_ANSWER_MESSAGE });
    push({ label: "Give me a hint", message: HINT_MESSAGE, mode: "hint" });
    push({ label: "Walk me through it", message: WALK_MESSAGE });
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
  //
  // Except when every subtopic at this level is mastered: then the next real step is the mastery
  // check, so it leads. Without this the assess chip was always fourth in a list capped at three,
  // and Assess mode was unreachable from the UI (#146).
  const allMastered = !!input.syllabus?.subtopics.length && input.syllabus.subtopics.every((s) => s.mastered);
  if (allMastered) push({ label: "Check if I've got this", message: "Check if I've got this.", mode: "assess" });
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
