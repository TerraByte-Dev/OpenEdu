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
import { ANSWER_ECHO_WORDS, type AskCard } from "./askCard";
import { asksForMasteryCheck, openCheck } from "./answerCheck";

/** The picker card's question. */
export const PICKER_QUESTION = "Which one should we check first?";
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
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

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
  const newest = conversation.length - 1;
  const opens = conversation[newest]?.role === "user" && asksForMasteryCheck(conversation[newest].content);
  if (!syllabus || (!opens && openCheck(conversation) === null)) return null;
  let start = newest;
  while (!opens && start >= 0 && !(conversation[start].role === "user" && asksForMasteryCheck(conversation[start].content))) start--;
  const said = [before, ...conversation.slice(start + 1).filter((m) => m.role === "assistant").map((m) => m.content).reverse()];
  for (const text of said) {
    const picks = [...text.matchAll(PICKED_LINE)].map((m) => norm(m[1].replace(/\\([*_`])/g, "$1")));
    for (const label of picks.reverse()) {
      const hit = syllabus.subtopics.filter((s) => norm(s.title) === label);
      if (hit.length === 1) return hit[0];
    }
  }
  const open = syllabus.subtopics.filter((s) => !s.mastered);
  return open.length === 1 ? open[0] : null;
}
