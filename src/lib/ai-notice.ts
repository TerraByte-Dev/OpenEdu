// What the app tells the learner about its AI, in one place: the line that says the tutor is an AI and
// not a person, and the words of the break reminder (break-reminder.ts decides when it shows). Plain
// copy, chosen by code, with no model call. docs/ARCHITECTURE.md, "AI disclosure and the break reminder".

import { APP_NAME } from "./product";
import { isEarlyReader, type Grade } from "./grade";

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
