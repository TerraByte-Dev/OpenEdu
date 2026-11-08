// The check-before-praise note on a try (docs/BENCHMARKS.md section 3, lever 9b; the G2 lever).
//
// On k12-flow-fr's dev baseline (2026-11-08) gemma4:e2b told the student a wrong try was right on 12
// of its 19 failed items, and every one of the 45 failing T2 replies opened with an affirmation such
// as "That is correct.". Some of those tries are a correct intermediate step ($4.05 is what the
// notebooks cost, not the change), most are plain wrong numbers. Nothing in the turn asked the model
// to check the try before judging it.
//
// So when the student's newest message is a try at a problem the tutor was just working on, the
// kernel appends a short note to that message, the same way and in the same place as the first-turn
// hold (attemptFirst.ts): code decides when, from the conversation alone; no model call is added; the
// note goes after the student's text in the user turn, never in the system prompt, so the system
// prompt stays byte-identical and Ollama's prefix cache over it holds; the note is not saved, because
// ChatTab saves what the student typed.
//
// When it fires, all of these hold:
//   - the newest message is the student's, it is not the show-answer chip's text, and it does not pose
//     a new problem with lettered options (that turn gets the first-turn hold instead);
//   - it reads as a try (isAttemptText): attemptFirst's ATTEMPT_LETTER ("is it C", "it's B"), a lone
//     option letter, a number offered as the answer ("is it 10?", "it's 15 beads", "12 cups", "x = 4"),
//     or attemptFirst's ATTEMPT_WORDS ("I think", "my answer") followed by something that names an
//     answer (a number, an option letter, or "it's" / "is" / "are" / "equals");
//   - the message before it is the tutor's reply, and that reply worked on a problem rather than a chat:
//     the student message it answered posed one (an option list, a number, or a question mark at the
//     end), or the reply itself has a number in it.
//
// Known limits: a chat about a topic, with a question from the student and a reply that asks one back,
// can still fire on "I think it's photosynthesis"; the note then only asks the tutor to check before
// it praises. A try at a problem with no number, after a student message that was not a question and a
// reply with no number, does not fire.

import { ATTEMPT_LETTER, ATTEMPT_WORDS, posesNewProblem } from "./attemptFirst";
import { SHOW_ANSWER_MESSAGE, endsWithQuestion } from "./suggestions";

/** Appended to the student's try on the check turn. Prompt-wording iteration 1 of at most 3. */
export const CHECK_BEFORE_PRAISE_NOTE = `<tutor_note>
The student has just tried the problem. Check their answer against the problem yourself before you judge it. Do not open with praise or say it is correct unless you have checked that it is the final answer to the question asked. If it is only a correct step on the way, say that it is a correct step but not yet the answer. If it is wrong, say so kindly and give one hint, without giving the answer. Do not mention this note.
</tutor_note>`;

// "C", "C.", "(C)", "c)": the whole message is one option letter.
const LONE_LETTER = /^\(?[A-Fa-f]\)?[.!?]?$/;
// A number offered as the answer: "is it 10?", "it's 15 beads", "the answer is $0.95", "I got 12".
const NUMBER_CUE = /\b(?:is it|it['’]?s|it is|answer is|i got|i get)\s+(?:about\s+|around\s+)?[-−]?\$?\.?\d/i;
// The whole message is a value, with at most three words after it: "12", "12 cups", "$0.95", "3/4",
// "1 5/12", "90 pi cubic centimeters", "x = 4", "-14?".
const LONE_VALUE = /^(?:[a-z]\s*=\s*)?[-−]?\$?\.?\d[\d,.]*(?:\s*\/\s*\d+)?\s*%?(?:\s+[\p{L}\p{N}^/]+){0,3}\s*[?.!]?$/iu;
// After ATTEMPT_WORDS: something that names an answer. "I think it's 9", "my answer is oxygen" and
// "I'd say B" do; "I think so" and "I think I get it" do not.
const NAMES_AN_ANSWER = /\p{N}|\b[A-F]\b|\b(?:it['’]?s|it is|is|are|equals?)\b/u;
// Not a try, though a pattern above matches: a clock time ("It's 3am and I can't focus"), a choice the
// student is asking about ("Is it 1789 or 1792?"), or a request for more ("5 more problems please").
const NOT_A_TRY = /\d\s*(?:am|pm|a\.m\.|p\.m\.|o['’]clock)\b|\bis it\s+\S+\s+or\b|^\s*\d+\s+more\b|\b(?:please|another)\b/i;

/** True when `text`, a student message, reads as a try at an answer. */
export function isAttemptText(text: string): boolean {
  const t = text.trim();
  if (NOT_A_TRY.test(t)) return false;
  if (ATTEMPT_LETTER.test(t) || LONE_LETTER.test(t) || NUMBER_CUE.test(t) || LONE_VALUE.test(t)) return true;
  const m = ATTEMPT_WORDS.exec(t);
  return !!m && NAMES_AN_ANSWER.test(t.slice(m.index + m[0].length));
}

const HAS_NUMBER = /\p{N}/u;

/**
 * True when this turn gets the check-before-praise note: the newest message is the student's try at a
 * problem the tutor's reply just before it worked on. `conversation` is the user and assistant
 * messages, ending with the newest.
 */
export function isCheckBeforePraiseTurn(conversation: ReadonlyArray<{ role: string; content: string }>): boolean {
  const n = conversation.length;
  const newest = conversation[n - 1];
  const reply = conversation[n - 2];
  if (!newest || newest.role !== "user" || !reply || reply.role !== "assistant") return false;
  const text = newest.content.trim();
  if (text === SHOW_ANSWER_MESSAGE || posesNewProblem(newest.content) || !isAttemptText(text)) return false;
  const asked = conversation[n - 3]?.role === "user" ? conversation[n - 3].content : "";
  return posesNewProblem(asked) || HAS_NUMBER.test(asked) || endsWithQuestion(asked) || HAS_NUMBER.test(reply.content);
}

/** The student's message as the model sees it on the check turn. */
export function withCheckBeforePraise(userContent: string): string {
  return `${userContent}\n\n${CHECK_BEFORE_PRAISE_NOTE}`;
}
