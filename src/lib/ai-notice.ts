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

// ─── Whether a lesson was checked (Fable's decisions, 2026-11-16) ──────────────────────────────────────
// Two places, keyed on whether a cloud Checking model other than the writer actually read the lesson, not
// on the machine: one standing note for the grown-up ("About the lessons", above the Checking model picker
// in Settings › Models) and one quiet status line at the foot of every lesson in the lesson reader. Plain
// copy chosen by code; no model names, tiers, RAM, figures, price or upgrade. docs/ARCHITECTURE.md,
// "Whether a lesson was checked".

/** The grown-up note's title, in every state. */
export const LESSONS_NOTE_TITLE = "About the lessons";

/**
 * Unchecked, a course model on this computer (gemma4:e2b and every other local model). No number: the
 * measured false-lesson figure for gemma4:e2b was taken on a lesson path whose prompt and rewrite differ
 * from OpenEdu's, so it is not OpenEdu's figure until OpenEdu's own generateLesson has a held-out measure.
 */
export const LESSONS_NOTE_UNCHECKED =
  `${APP_NAME}'s AI writes each lesson on this computer, and nothing checks it. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons with your child, and trust your own judgment over the app's.`;

/**
 * Unchecked, a cloud course model (OpenAI, Anthropic, an Ollama model whose name ends in "cloud"). No
 * number: no cloud writer has a held-out false-lesson rate. No "on this computer": the lessons are not
 * written here.
 */
export const LESSONS_NOTE_UNCHECKED_CLOUD =
  `${APP_NAME}'s AI writes each lesson, and nothing checks it. We have not measured how often these lessons get a fact wrong, so expect that some do. The Raise hand help can be wrong too. Read new lessons with your child, and trust your own judgment over the app's.`;

/** Lesson checking resolves to the cloud course model itself: the writer reads its own work, which is not a second check. */
export const LESSONS_NOTE_SELF_REVIEW =
  `${APP_NAME}'s AI writes each lesson and then reads its own work over. That is not a second check, and we do not count it as one. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons with your child, and trust your own judgment over the app's.`;

/** A cloud Checking model other than the course model resolves for lessons (lessonCheckCounts). OpenEdu has no course approval, so every new lesson is read. */
export const LESSONS_NOTE_CHECKED =
  "A second AI reads each new lesson before your child sees it. It catches many mistakes, not all of them. It is still worth reading new lessons with your child.";

/**
 * The extra line when a cloud model writes the lessons and no different one checks them (self-review and
 * cloud-unchecked). The default Checking model, "Same as the course model", is the self-review, so it
 * points at a different one. What is sent is what the picker's help says: the course topic and the lesson
 * text, never anything about the learner. No link: the note already sits above the picker.
 */
export const LESSONS_NOTE_NUDGE_DIFFERENT =
  "A different cloud model can check new lessons. It is sent only the course topic and the lesson text, never anything about the learner.";

export interface LessonsNote {
  /** A cloud Checking model other than the course model reads new lessons. */
  checked: boolean;
  title: string;
  body: string;
  /** The extra line under the body, or null for none. */
  nudge: string | null;
}

type ModelRef = { provider: LLMProvider; model: string };

/** The same model: the same provider and the same model name, trimmed, case-insensitive. */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model.trim().toLowerCase() === b.model.trim().toLowerCase();
}

/**
 * Whether a review by `checker` of what `writer` wrote earns the word "checked": a cloud model
 * (privacy.ts isLocalModel: one on this computer, even a big one, is not), and not the model that wrote
 * it (a self-review is not a second check). Another model from the same company counts. The one rule for
 * each lesson (content-review.ts cloudCheckedBy) and for the grown-up note.
 */
export function lessonCheckCounts(checker: ModelRef | null, writer: ModelRef): boolean {
  return checker !== null && !isLocalModel(checker) && !sameModel(checker, writer);
}

/**
 * The grown-up note for the lesson's models (store.ts getLessonConfigs: `config` writes, `review` checks,
 * null when off), the first that holds: checked (lessonCheckCounts); self-review (lesson checking resolves
 * to the cloud course model itself); unchecked with a cloud course model; unchecked on a local course
 * model (gemma4:e2b and the rest share one body: OpenEdu has no measured figure to print for e2b).
 */
export function lessonsNote(courseModel: ModelRef, lessonChecker: ModelRef | null): LessonsNote {
  const base = { title: LESSONS_NOTE_TITLE };
  if (lessonCheckCounts(lessonChecker, courseModel)) return { ...base, checked: true, body: LESSONS_NOTE_CHECKED, nudge: null };
  const self = lessonChecker !== null && !isLocalModel(lessonChecker) && sameModel(lessonChecker, courseModel);
  if (self) return { ...base, checked: false, body: LESSONS_NOTE_SELF_REVIEW, nudge: LESSONS_NOTE_NUDGE_DIFFERENT };
  if (!isLocalModel(courseModel)) return { ...base, checked: false, body: LESSONS_NOTE_UNCHECKED_CLOUD, nudge: LESSONS_NOTE_NUDGE_DIFFERENT };
  return { ...base, checked: false, body: LESSONS_NOTE_UNCHECKED, nudge: null };
}

// The lesson reader's status line. OpenEdu is for one learner with no grown-up set up to ask, so each line
// ends "If something looks wrong, look it up." (Fable's wording for a learner on their own).
/** For grade 3 and up, or no grade. */
export const LESSON_STATUS_UNCHECKED = "The AI wrote this lesson. Nothing has checked it. If something looks wrong, look it up.";
export const LESSON_STATUS_CHECKED = "The AI wrote this lesson, and a second AI checked it. It can still be wrong. If something looks wrong, look it up.";
/** For K-2 (grade.ts isEarlyReader). */
export const LESSON_STATUS_UNCHECKED_EARLY = "The AI wrote this. No one checked it. If something looks wrong, look it up.";
export const LESSON_STATUS_CHECKED_EARLY = "The AI wrote this. A second AI checked it. It can still be wrong. If something looks wrong, look it up.";

/**
 * The status line under one lesson. `checked` is what was stored when the lesson was written
 * (db.ts lessonWasChecked: a cloud Checking model other than its writer reviewed it then), never a setting.
 */
export function lessonStatusLine(o: { checked: boolean; grade: Grade | null }): string {
  const early = isEarlyReader(o.grade);
  return o.checked
    ? (early ? LESSON_STATUS_CHECKED_EARLY : LESSON_STATUS_CHECKED)
    : (early ? LESSON_STATUS_UNCHECKED_EARLY : LESSON_STATUS_UNCHECKED);
}
