// The topic picker that opens a mastery check, made by the app (docs/ARCHITECTURE.md, "Question cards").
//
// assess.md tells the tutor to let the student choose which subtopic to be checked on with
// ask_user.question when more than one still needs checking. gemma4:e2b, the default below 16 GB, made
// that call in 2 of 20 turns (TerraTutor B9 readiness run, 2026-11-13) and 3 of 20 (rerun 2, 2026-11-14),
// and in none of 6 tries in TerraTutor's click test of 2026-11-19, so a learner almost never saw the card.
// The choices are the level's unmastered subtopics, which the syllabus already holds: code knows them, so
// code asks. The card goes through ask_user.question's own dispatch in place of the turn's first model
// call (the model reads it back as its own call, then the learner's answer), so a pick, a typed answer and
// a safety disclosure typed into it are handled exactly as on a card the model made. No model call.
// Ported from TerraTutor #244.

import type { Subtopic, Syllabus } from "../../types";
import { ANSWER_ECHO_WORDS, afterAnsweredCard, type AskCard } from "./askCard";
import { asksForMasteryCheck, openCheck, questionInMessage } from "./answerCheck";
import { VERDICT_FALLBACK } from "./replyClaims";

/** The picker card's question. */
export const PICKER_QUESTION = "Which one should we check first?";
/** The question of the picker the app shows once the check's skill is mastered (nextPickerCard). */
export const NEXT_PICKER_QUESTION = "Which one should we check next?";
/** ask_user.question's own bound on choices. */
const MAX_CHOICES = 5;

/**
 * The picker card for this turn, or null when there is none: the turn runs in assess mode, the student's
 * newest message opens the check (asksForMasteryCheck; in the chat only the assess chip runs in assess
 * mode, chatSkills.ts chatTurnMode), and at least two of the level's subtopics are not mastered. The
 * choices are their titles in syllabus order, the first five when there are more.
 */
export function assessPickerCard(newest: string, activeSkill: string | null | undefined, syllabus: Syllabus | null): AskCard | null {
  if (activeSkill !== "assess" || !syllabus || !asksForMasteryCheck(newest)) return null;
  const titles = [...new Set(syllabus.subtopics.filter((s) => !s.mastered).map((s) => s.title.trim()).filter(Boolean))];
  if (titles.length < 2) return null;
  return { question: PICKER_QUESTION, choices: titles.slice(0, MAX_CHOICES).map((t) => ({ label: t, value: t })) };
}

// A card's picked answer as answeredCard saves it ("*You picked: Equal Groups*"), with its escapes undone.
const PICKED_LINE = new RegExp(String.raw`^\*${ANSWER_ECHO_WORDS.picked}: ([^\n]*)\*[ \t]*\r?$`, "gm");
// Any card's answer as answeredCard saves it, a pick or typed words.
const ANSWERED_LINE = new RegExp(String.raw`^\*(${ANSWER_ECHO_WORDS.typed}|${ANSWER_ECHO_WORDS.picked}): ([^\n]*)\*[ \t]*\r?$`, "gm");
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const unescaped = (label: string) => norm(label.replace(/\\([*_`])/g, "$1"));
/** The picks saved in `text`, in order, as normalised labels. */
const picksIn = (text: string) => [...text.matchAll(PICKED_LINE)].map((m) => unescaped(m[1]));
/** The one subtopic whose title is `label`, or null (none, or two with the same title). */
function titled(label: string, syllabus: Syllabus): Subtopic | null {
  const hit = syllabus.subtopics.filter((s) => norm(s.title) === label);
  return hit.length === 1 ? hit[0] : null;
}

/** The index of the student's request that opened the check the newest message is in (the newest itself
 *  when it opens one), or -1 when it is in none (openCheck). */
function checkStart(conversation: ReadonlyArray<{ role: string; content: string }>): number {
  const newest = conversation.length - 1;
  const opens = conversation[newest]?.role === "user" && asksForMasteryCheck(conversation[newest].content);
  if (!opens && openCheck(conversation) === null) return -1;
  let start = newest;
  while (!opens && start >= 0 && !(conversation[start].role === "user" && asksForMasteryCheck(conversation[start].content))) start--;
  return start;
}

/**
 * The subtopic the mastery check is on, as code knows it, or null (TutorEngine's mark after a correct check
 * answer). The newest pick whose label is one of the level's subtopic titles (the app's topic picker, or a
 * card the model made the same way, assess.md), made before the answer that was graded: in `before`, then in
 * the tutor's messages since the request that opened the check. A pick after the graded answer is about the
 * next question, not this one (a "Which one should we check next?" card after a right answer marked the
 * skill picked there, in review). With no such pick, the level's one subtopic not mastered, when there is
 * exactly one: the picker is not shown then, and assess.md checks only subtopics not mastered. Null when
 * the turn is in no check (the newest message opens none and none is open, openCheck), or when two or more
 * are not mastered and none was picked: code does not guess which one the question was about.
 * `conversation` is the user and assistant messages, ending with the student's newest; `before` is what
 * this turn showed before the graded answer ("" for a typed answer: it was graded before the reply).
 */
export function checkedSubtopic(conversation: ReadonlyArray<{ role: string; content: string }>, before: string, syllabus: Syllabus | null): Subtopic | null {
  const start = checkStart(conversation);
  if (!syllabus || start < 0) return null;
  const said = [before, ...conversation.slice(start + 1).filter((m) => m.role === "assistant").map((m) => m.content).reverse()];
  for (const text of said) {
    for (const label of picksIn(text).reverse()) {
      const hit = titled(label, syllabus);
      if (hit) return hit;
    }
  }
  const open = syllabus.subtopics.filter((s) => !s.mastered);
  return open.length === 1 ? open[0] : null;
}

// The pick line right under the app's "which next?" card's question, as answeredCard saves it.
const APP_NEXT_PICK = new RegExp(String.raw`^[ \t]*\r?\n[ \t]*\r?\n\*${ANSWER_ECHO_WORDS.picked}: ([^\n]*)\*[ \t]*\r?(?:\n|$)`);

/**
 * The label picked on the app's own "which next?" card in the tutor's message `text`, as saved (escaped), or
 * null when the message holds no such pick. The app's card takes the turn's first model call, so its question
 * opens the saved reply, or follows only code's verdict line ("That's right.", shown before it: TutorEngine
 * respond), with the pick line right under it (askCard.ts answeredCard). The same words anywhere else are the
 * model's, a card or prose: inbox 2026-11-21-0017 item 2 (after a hint, "Which one should we check next?" and
 * a pick line inside the model's reply marked the skill named there) and TerraTutor live test 2026-11-21 part 14, issue
 * 1. A saved message keeps only its text (chat_messages has no column for a call's origin), so this shape is
 * the marker: a model card that is the first thing in its reply, with the same question, still reads as the
 * app's.
 */
export function appNextPick(text: string): string | null {
  let rest = text.replace(/^\s+/, "");
  if (rest.startsWith(VERDICT_FALLBACK.correct)) rest = rest.slice(VERDICT_FALLBACK.correct.length).replace(/^\s+/, "");
  if (!rest.startsWith(NEXT_PICKER_QUESTION)) return null;
  return APP_NEXT_PICK.exec(rest.slice(NEXT_PICKER_QUESTION.length))?.[1] ?? null;
}

const wordsOf = (s: string) => s.toLowerCase().replace(/[*_`#>]/g, "").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
/** True when `text` is only one of the titles a picker card offers (the level's subtopics not mastered), give or
 *  take case and punctuation. A mastered skill's title is on no card, so an answer equal to it is left alone. */
const namesSkill = (text: string, saved: Syllabus) => !!wordsOf(text) && saved.subtopics.some((s) => !s.mastered && wordsOf(s.title) === wordsOf(text));

/**
 * True when a typed answer graded right answered which skill to check, not a question about one (TerraTutor live test
 * 2026-11-21 part 14, issue 1): after the app's "which next?" card, gemma4:e2b wrote the card's question and
 * both titles again as prose, the learner typed the title picked, code keyed the copy with that title and
 * found it right, and a skill nothing had been asked about was offered as learned. So no mark when the
 * question graded is a picker card's own (every word of it in PICKER_QUESTION or NEXT_PICKER_QUESTION, give or
 * take one in five: a copy, or "Which topic should we check next?"), when its key is one of the titles a card
 * offers (`saved`, the level's not mastered), or when the learner's answer is only one of them. The titles are the saved syllabus's; no
 * word list is read.
 */
export function answersSkillChoice(graded: { question: string; key: string }, answer: string, saved: Syllabus | null): boolean {
  if ([PICKER_QUESTION, NEXT_PICKER_QUESTION].some((card) => questionInMessage(graded.question, card))) return true;
  return !!saved && (namesSkill(graded.key, saved) || namesSkill(answer, saved));
}

/**
 * The next skill of a check, as code knows it, or null (TutorEngine appMark, for a typed answer that is not
 * the learner's first message in the check: live test part 13, issue 6, a second skill in one check was
 * never saved). It is the subtopic picked on the app's own "which next?" card (appNextPick: its question opens
 * the tutor's message just before the newest, and no other card was answered in that message), so nothing was
 * asked, answered or typed between that pick and the answer, of exactly one of the level's titles (`saved`,
 * the saved syllabus), not mastered, in a check still open, and a new skill for that check: an earlier pick in
 * it was of another subtopic, and none was of this one. The question graded (`graded`, as its key call copied
 * it) was asked after the pick (TerraTutor live test part 14, issue 1; appMark refuses a picker's own question too,
 * answersSkillChoice). The app shows that card only on a turn the learner answered right (TutorEngine
 * nextAsk), so the pick is never on a turn that was helped or wrong; a pick on the model's own card is not
 * trusted, because code cannot tell from the saved text whether that turn was (review 2026-11-20: a hint, a
 * wrong try or "I don't know", then the model's card, then the answer just given away). A skill already tried
 * in the check, a check with no pick before (one subtopic left, no picker), words typed into the card and a
 * pick of anything else give null. The skill is never read from the tutor's prose.
 */
export function pickedNextSkill(conversation: ReadonlyArray<{ role: string; content: string }>, saved: Syllabus | null, graded: { question: string }): Subtopic | null {
  const newest = conversation.length - 1;
  const asked = conversation[newest - 1];
  if (!saved || conversation[newest]?.role !== "user" || asked?.role !== "assistant") return null;
  const start = checkStart(conversation);
  if (start < 0 || start >= newest) return null;
  const label = appNextPick(asked.content);
  // The app's pick is the one card answered in the message: a card after it asked something else.
  if (label === null || [...asked.content.matchAll(ANSWERED_LINE)].length !== 1) return null;
  const sub = titled(unescaped(label), saved);
  if (!sub || sub.mastered) return null;
  if (!questionInMessage(graded.question, afterAnsweredCard(asked.content))) return null;
  const earlier = conversation.slice(start + 1, newest).filter((m) => m.role === "assistant").flatMap((m) => picksIn(m.content));
  earlier.pop(); // the pick itself
  const tried = earlier.map((label) => titled(label, saved)).filter((s): s is Subtopic => !!s);
  return tried.length && !tried.some((s) => s.id === sub.id) ? sub : null;
}

/**
 * The picker the app shows once the check's skill is mastered and the check goes on, or null (live test
 * part 13, issue 6: after the mark, gemma4:e2b named the next subtopic in prose and showed no card, so no
 * answer after it could be tied to a skill). Like the first picker, it takes the turn's first model call.
 * Shown when the turn runs in assess mode, the newest message opens no check, the check is open and is
 * still open for the answer after this turn, the skill it is on (checkedSubtopic) is mastered in the saved
 * syllabus (`saved`), two or more subtopics are not, and no "which next?" card was shown since that skill
 * was picked. The choices are those subtopics' titles in syllabus order, the first five when there are more.
 */
export function nextPickerCard(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill: string | null | undefined, saved: Syllabus | null): AskCard | null {
  const newest = conversation.length - 1;
  if (activeSkill !== "assess" || !saved || conversation[newest]?.role !== "user" || asksForMasteryCheck(conversation[newest].content)) return null;
  if (!checkedSubtopic(conversation, "", saved)?.mastered) return null;
  // The answer to the next skill's question comes two messages on: the check must still be open for it.
  if (openCheck([...conversation, { role: "assistant", content: "" }, { role: "user", content: "" }]) === null) return null;
  const said = conversation.slice(checkStart(conversation) + 1, newest).filter((m) => m.role === "assistant").map((m) => m.content);
  const pickedIn = said.map((text) => picksIn(text).some((label) => titled(label, saved))).lastIndexOf(true);
  if (said.slice(pickedIn + 1).some((text) => text.includes(NEXT_PICKER_QUESTION))) return null;
  const pickedText = said[pickedIn] ?? "";
  if (pickedText.lastIndexOf(NEXT_PICKER_QUESTION) > pickedText.lastIndexOf(`*${ANSWER_ECHO_WORDS.picked}:`)) return null;
  const titles = [...new Set(saved.subtopics.filter((s) => !s.mastered).map((s) => s.title.trim()).filter(Boolean))];
  if (titles.length < 2) return null;
  return { question: NEXT_PICKER_QUESTION, choices: titles.slice(0, MAX_CHOICES).map((t) => ({ label: t, value: t })) };
}
