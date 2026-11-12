// Learners: the rules that decide who sees what. Pure module (no Tauri, no DOM) so every rule below is
// unit-tested in learners.test.ts and called, unchanged, by db.ts, App.tsx and the picker.
//
// OpenEdu is a solo-learner app: a new install has one learner (the default one) and never adds
// another. An install that added learners in an earlier version (learner profiles, or a class or school)
// keeps all of them: the picker lists every one, a learner's PIN still guards their courses, and a
// learner can delete themselves until one is left. Nothing here ever drops a learner or a PIN.
//
// Scope is enforced at the root: every data table hangs off courses(id), and a course belongs to one
// learner (courses.learner_id, migration 13). Filter the course list and refuse a foreign course, and
// everything below a course (chats, notes, quizzes, flashcards, the misconception profile) follows.

/** The learner migration 13 creates and assigns every pre-existing course to. Must match lib.rs. */
export const DEFAULT_LEARNER_ID = "default";

export interface LearnerRow {
  id: string;
  name: string;
  /** "pbkdf2-sha256$<iterations>$<base64>" (see learner-pin.ts), or null when the learner has no PIN. */
  pin_hash: string | null;
  pin_salt: string | null;
  created_at: string;
  last_active_at: string | null;
  /** 0 = kindergarten, 1-12 = that grade, null = not set (migration 15). Read through grade.ts normalizeGrade. */
  grade?: number | null;
}

export const LEARNER_NAME_MAX = 40;

/**
 * Show the picker unless there is exactly one learner and it has no PIN. That single case is every new
 * install and every install that never added a learner, and it never sees the picker. Several learners
 * (from an earlier version) or a PIN on the only one always get it, so no PIN is ever skipped.
 */
export function needsPicker(learners: ReadonlyArray<Pick<LearnerRow, "pin_hash">>): boolean {
  return !(learners.length === 1 && !learners[0].pin_hash);
}

/** Whether entering this learner asks for their PIN first (the picker's tile, then PinScreen's verifyPin). */
export function needsPin(learner: Pick<LearnerRow, "pin_hash">): boolean {
  return !!learner.pin_hash;
}

/** The learner to enter without asking, or null when the picker must be shown. */
export function autoPickLearner<T extends Pick<LearnerRow, "pin_hash">>(learners: ReadonlyArray<T>): T | null {
  return needsPicker(learners) ? null : learners[0];
}

/**
 * The course-ownership guard. A course is visible only to the learner it is stamped with. No active
 * learner, a course with no owner, or another learner's course: refused. db.ts getCourse runs every
 * lookup through this, so a stale id (a store key, a deep link, a course opened before a switch)
 * cannot open another learner's course.
 */
export function canAccessCourse(
  course: { learner_id?: string | null } | null | undefined,
  activeLearnerId: string | null,
): boolean {
  if (!course || !activeLearnerId) return false;
  return course.learner_id === activeLearnerId;
}

/** Never delete the last learner: the app would have nobody to open as. */
export function canDeleteLearner(learners: ReadonlyArray<unknown>): boolean {
  return learners.length > 1;
}

/**
 * Validate a learner name for create/rename. Names must be unique (case-insensitive) because the
 * picker identifies people by name alone. Returns an error message, or null when the name is fine.
 */
export function validateLearnerName(
  raw: string,
  existing: ReadonlyArray<Pick<LearnerRow, "id" | "name">>,
  selfId?: string,
): string | null {
  const name = raw.trim();
  if (!name) return "Type a name.";
  if (name.length > LEARNER_NAME_MAX) return `Keep it under ${LEARNER_NAME_MAX} letters.`;
  const key = name.toLocaleLowerCase();
  if (existing.some((l) => l.id !== selfId && l.name.trim().toLocaleLowerCase() === key)) {
    return "Someone already has that name.";
  }
  return null;
}

/** Deleting a learner is confirmed by typing their name. Case and outer spaces don't matter. */
export function deleteConfirmMatches(typed: string, name: string): boolean {
  const t = typed.trim().toLocaleLowerCase();
  return t.length > 0 && t === name.trim().toLocaleLowerCase();
}
