// A learner's school grade (#243): K, 1-12, or not set. Pure module (no Tauri, no DOM), tested in
// grade.test.ts and called unchanged by db.ts, ChatTab and the settings/learner forms.
//
// Stored in learners.grade (migration 15) as an integer: 0 = kindergarten, 1-12 = that grade, NULL =
// not set. Everything a grade changes is decided here from its band, by code, with no model call:
// the reading-level line and child-safety rules in the tutor's system prompt, the chat text size, and
// whether replies read themselves aloud by default. With no grade set none of it applies, and the
// system prompt is byte-identical to the one before grades existed (systemPrompt-master.test.ts pins
// that), except on a safety-disclosure turn, which gets the child-safety rules (gradePromptLayer).

import { CHILD_SAFETY_RULES, isSafetyDisclosure } from "./child-safety";

/** 0 = kindergarten, 1-12 = that grade. */
export type Grade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type GradeBand = "K-2" | "3-5" | "6-8" | "9-12";

/** Every grade in picker order. */
export const GRADES: ReadonlyArray<Grade> = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** A DB or form value as a grade, or null for not set. Anything outside 0-12 is not set. */
export function normalizeGrade(raw: unknown): Grade | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 12 ? (n as Grade) : null;
}

/** "Kindergarten", "Grade 1" … "Grade 12", or "Not set". */
export function gradeLabel(grade: Grade | null): string {
  if (grade === null) return "Not set";
  return grade === 0 ? "Kindergarten" : `Grade ${grade}`;
}

export function gradeBand(grade: Grade | null): GradeBand | null {
  if (grade === null) return null;
  if (grade <= 2) return "K-2";
  if (grade <= 5) return "3-5";
  if (grade <= 8) return "6-8";
  return "9-12";
}

/** K-2: the learners who get larger chat text and replies read aloud by default. */
export function isEarlyReader(grade: Grade | null): boolean {
  return gradeBand(grade) === "K-2";
}

// One line per band, read by small models (gemma4:e2b): plain, imperative, concrete numbers.
const BAND_RULES: Record<GradeBand, string> = {
  "K-2": "Use very short sentences, under 10 words each. Use only simple, everyday words. Give one idea at a time. Keep the whole reply under 60 words.",
  "3-5": "Use short sentences, under 15 words each. Use common words. When you must use a new word, explain it in simple words.",
  "6-8": "Use clear sentences, under 20 words each. Use the subject's terms, and explain each new term the first time you use it.",
  "9-12": "Write for a high school student. Use the subject's proper terms. Keep sentences clear and direct.",
};

/**
 * The reading-level section for the tutor's system prompt, or undefined when no grade is set.
 * buildSystemPrompt places it after the mode suffix and before the output rules; undefined adds
 * nothing, so an unset grade leaves the prompt byte-identical.
 */
export function readingLevelLayer(grade: Grade | null): string | undefined {
  const band = gradeBand(grade);
  if (band === null || grade === null) return undefined;
  const who = grade === 0 ? "kindergarten" : `grade ${grade}`;
  return `## Reading level\nThe student is in ${who}. ${BAND_RULES[band]}`;
}

/**
 * Everything a grade adds to the tutor's system prompt: the reading level, then the child-safety
 * section (child-safety.ts). ChatTab passes this in buildSystemPrompt's reading-level slot, with the
 * student's message. With no grade set, a message that trips isSafetyDisclosure still gets the safety
 * section on its own; any other message gets undefined, so the prompt stays byte-identical.
 */
export function gradePromptLayer(grade: Grade | null, message = ""): string | undefined {
  const level = readingLevelLayer(grade);
  if (level) return `${level}\n\n---\n\n${CHILD_SAFETY_RULES}`;
  return isSafetyDisclosure(message) ? CHILD_SAFETY_RULES : undefined;
}

/**
 * Whether tutor replies read themselves aloud for this learner. Only K-2 learners have the setting;
 * `stored` is their choice (null when they never chose), and it defaults to on. Every other grade,
 * and no grade, reads aloud only when the speaker button is pressed.
 */
export function autoReadAloud(grade: Grade | null, stored: boolean | null): boolean {
  return isEarlyReader(grade) && (stored ?? true);
}

