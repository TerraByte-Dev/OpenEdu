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

import type { Syllabus } from "../../types";
import type { AskCard } from "./askCard";
import { asksForMasteryCheck } from "./answerCheck";

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
