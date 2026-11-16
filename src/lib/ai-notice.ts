// What the app tells the learner about its AI, in one place: the line that says the tutor is an AI and
// not a person, the words of the break reminder (break-reminder.ts decides when it shows), and whether a
// lesson was checked (the grown-up note and the lesson's status line, at the end of this file). Plain
// copy, chosen by code, with no model call. docs/ARCHITECTURE.md, "AI disclosure and the break reminder".

import { APP_NAME } from "./product";
import { isEarlyReader, type Grade } from "./grade";
import { isLocalModel } from "./privacy";
import type { LLMProvider } from "../types";

/** Always on screen in a course chat: in its header, next to the tutor's name, from the first message on. */
export const AI_DISCLOSURE = `${APP_NAME}'s tutor is an AI, not a person.`;

/**
 * The break reminder, after `hours` of learning. For K-2 (grade.ts isEarlyReader) it is three short
 * sentences in everyday words, which read aloud well (speech.ts leaves them as they are); for everyone
 * else it says how long they have been learning.
 */
export function breakReminder(hours: number, grade: Grade | null): string {
  if (isEarlyReader(grade)) return "Time for a break! Your tutor is an AI, not a person. Go stretch, play, or get a drink.";
  return `You've been learning for ${hours} hours. Remember, ${APP_NAME}'s tutor is an AI, not a person. It's a good time to take a break.`;
}

// ─── Whether a lesson was checked (from TerraTutor #144, Fable's decision 2026-11-16) ──────────────────
// Two places, keyed on whether a cloud Checking model actually read the lesson, not on the machine: one
// standing note for the grown-up ("About the lessons", above the Checking model picker in Settings ›
// Models) and one quiet status line at the foot of every lesson in the lesson reader. Plain copy chosen by
// code; no model names, tiers, RAM, figures, price or upgrade. docs/ARCHITECTURE.md, "Whether a lesson was
// checked".

/** The grown-up note's title, in every state. */
export const LESSONS_NOTE_TITLE = "About the lessons";

/**
 * No cloud Checking model resolves for lessons. No number: TerraTutor's "about 1 lesson in 7" was measured
 * on TerraTutor's lesson code, whose prompt and rewrite differ from OpenEdu's, so it is not OpenEdu's figure.
 */
export const LESSONS_NOTE_UNCHECKED =
  `${APP_NAME}'s AI writes each lesson on this computer, and nothing checks it. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons with your child, and trust your own judgment over the app's.`;

/** A cloud Checking model resolves for lessons. OpenEdu has no course approval, so every new lesson is read. */
export const LESSONS_NOTE_CHECKED =
  "A second AI reads each new lesson before your child sees it. It catches many mistakes, not all of them. It is still worth reading new lessons with your child.";

export interface LessonsNote {
  /** A cloud Checking model reads new lessons. */
  checked: boolean;
  title: string;
  body: string;
}

/**
 * The grown-up note for what lesson checking resolves to (store.ts getLessonConfigs().review, null when
 * off). Checked only for a cloud model (privacy.ts isLocalModel): a Checking model on this computer, even a
 * big one, is "not checked".
 */
export function lessonsNote(lessonChecker: { provider: LLMProvider; model: string } | null): LessonsNote {
  const checked = lessonChecker !== null && !isLocalModel(lessonChecker);
  return { checked, title: LESSONS_NOTE_TITLE, body: checked ? LESSONS_NOTE_CHECKED : LESSONS_NOTE_UNCHECKED };
}

// The lesson reader's status line. OpenEdu is TerraTutor's "Just me": no grown-up is set up to ask, so each
// line ends "If something looks wrong, look it up." (Fable's Just me wording).
/** For grade 3 and up, or no grade. */
export const LESSON_STATUS_UNCHECKED = "The AI wrote this lesson. Nothing has checked it. If something looks wrong, look it up.";
export const LESSON_STATUS_CHECKED = "The AI wrote this lesson, and a second AI checked it. It can still be wrong. If something looks wrong, look it up.";
/** For K-2 (grade.ts isEarlyReader). */
export const LESSON_STATUS_UNCHECKED_EARLY = "The AI wrote this. No one checked it. If something looks wrong, look it up.";
export const LESSON_STATUS_CHECKED_EARLY = "The AI wrote this. A second AI checked it. It can still be wrong. If something looks wrong, look it up.";

/**
 * The status line under one lesson. `checked` is what was stored when the lesson was written
 * (db.ts lessonWasChecked: a cloud Checking model reviewed it then), never a setting.
 */
export function lessonStatusLine(o: { checked: boolean; grade: Grade | null }): string {
  const early = isEarlyReader(o.grade);
  return o.checked
    ? (early ? LESSON_STATUS_CHECKED_EARLY : LESSON_STATUS_CHECKED)
    : (early ? LESSON_STATUS_UNCHECKED_EARLY : LESSON_STATUS_UNCHECKED);
}
