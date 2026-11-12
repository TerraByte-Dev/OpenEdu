// Usage modes: who uses this computer, and what that turns on. Pure module (no Tauri, no DOM), tested
// in usage-modes.test.ts and called unchanged by App.tsx, the picker, the learner menu, the teacher
// view and the Settings section.
//
//   single  "Just me"              One learner, no picker, learner options tucked into Settings.
//   class   "A class"              Picker at every launch. A teacher PIN guards Settings, the mode,
//                                  adding and removing learners, and clearing a forgotten learner PIN.
//   school  "A school or center"   Everything in "A class", plus groups: the picker asks for the
//                                  group first, and the teacher overview filters by group.
//
// The mode and the teacher PIN live in the database (app_config, migration 14), next to the learner
// data they protect, so a settings export never carries them and a settings import cannot lower them.

import { needsPicker, autoPickLearner, type LearnerRow } from "./learners";
import { hashPin, isValidPin, type PinRecord } from "./learner-pin";

export type UsageMode = "single" | "class" | "school";

export const USAGE_MODES: ReadonlyArray<{ id: UsageMode; title: string; sentence: string }> = [
  { id: "single", title: "Just me", sentence: "One person learns on this computer." },
  { id: "class", title: "A class", sentence: "Several learners share it, and a parent or teacher looks after them." },
  { id: "school", title: "A school or center", sentence: "Many learners in several classes or groups share it." },
];

export function parseUsageMode(raw: unknown): UsageMode | null {
  return raw === "single" || raw === "class" || raw === "school" ? raw : null;
}

/**
 * The mode to start in, or null to ask the "Who uses this computer?" question. A stored mode always
 * wins. With none stored, an install that was already in use (it had courses before migration 14, a
 * finished tour, or #173 profiles) starts as "Just me" without asking: that is today's behaviour and
 * it must cost an existing user nothing. Only a fresh install is asked.
 */
export function resolveStartupMode(stored: unknown, priorUse: boolean): UsageMode | null {
  return parseUsageMode(stored) ?? (priorUse ? "single" : null);
}

/** Signs that this install was used before usage modes shipped. */
export function hasPriorUse(learners: ReadonlyArray<Pick<LearnerRow, "pin_hash">>, tourSeen: boolean): boolean {
  return tourSeen || learners.length > 1 || learners.some((l) => !!l.pin_hash);
}

/** Class and school are protected by a teacher PIN; "Just me" is not. */
export function isProtected(mode: UsageMode): boolean {
  return mode !== "single";
}

export function usesGroups(mode: UsageMode): boolean {
  return mode === "school";
}

/**
 * What the teacher PIN guards directly. In "Just me" none of them ask. Adding, removing and resetting
 * learners and managing groups live inside the teacher view, so "teacher-view" covers them; changing
 * the mode has its own rule (modeChangeStep).
 */
export const TEACHER_ACTIONS = [
  "open-settings",
  "teacher-view",
  "backup-all-data",
] as const;
export type TeacherAction = (typeof TEACHER_ACTIONS)[number];

/** What each mode guards. An action not listed here is never guarded, whatever the mode. */
const GUARDED: Record<UsageMode, ReadonlySet<TeacherAction>> = {
  single: new Set(),
  class: new Set(TEACHER_ACTIONS),
  school: new Set(TEACHER_ACTIONS),
};

export function needsTeacherPin(mode: UsageMode, action: TeacherAction): boolean {
  return GUARDED[mode].has(action);
}

/**
 * Every place in the app that opens a teacher-only screen or action. App.tsx sends each one through
 * guardEntry under its own name; none of them opens its screen directly.
 */
export const TEACHER_ENTRIES = [
  "gear",                    // titlebar gear: Settings
  "setup-gate-settings",     // SetupGate "Open settings"
  "damaged-banner-restore",  // DataDamagedBanner "How to restore a backup": Settings > Learner data
  "picker-teacher-tile",     // the picker's Teacher tile: the teacher view
  "settings-teacher-view",   // Settings > Who uses this > Open the teacher view
  "learner-data-backup",     // Settings > Learner data > Back up all learner data (every learner's data)
  "early-grownups",          // the early-learner home's press-and-hold Grown-ups button: the grown-ups view (#244)
  "grownups-settings",       // the grown-ups view's Settings link
] as const;
export type TeacherEntry = (typeof TEACHER_ENTRIES)[number];

export const ENTRY_ACTION: Record<TeacherEntry, TeacherAction> = {
  "gear": "open-settings",
  "setup-gate-settings": "open-settings",
  "damaged-banner-restore": "open-settings",
  "picker-teacher-tile": "teacher-view",
  "settings-teacher-view": "teacher-view",
  "learner-data-backup": "backup-all-data",
  "early-grownups": "open-settings",
  "grownups-settings": "open-settings",
};

/**
 * The one guard for every entry point. `teacherUnlocked` is true only while the teacher, having typed
 * the PIN, is still in Settings or the teacher view (see staysUnlocked); then nothing asks twice.
 */
export function guardEntry(mode: UsageMode, entry: TeacherEntry, teacherUnlocked: boolean): "go" | "ask-teacher-pin" {
  if (!needsTeacherPin(mode, ENTRY_ACTION[entry])) return "go";
  return teacherUnlocked ? "go" : "ask-teacher-pin";
}

/**
 * App's `guarded`: run `then` now and hand back what it returns (so a busy button can wait for a
 * backup), or give `askPin` the action to run once the teacher PIN is typed and return undefined.
 */
export function runGuarded<T>(
  mode: UsageMode,
  entry: TeacherEntry,
  teacherUnlocked: boolean,
  then: () => T,
  askPin: (afterPin: () => void) => void,
): T | undefined {
  if (guardEntry(mode, entry, teacherUnlocked) === "go") return then();
  askPin(() => { void then(); });
  return undefined;
}

/**
 * The teacher stays unlocked only while Settings, the grown-ups view (#244) or the teacher view is on
 * screen, so the grown-ups view's Settings link does not ask twice. Leaving re-locks: back to the
 * child's screens, the next press-and-hold asks again.
 */
export function staysUnlocked(view: string, teacherViewOpen: boolean): boolean {
  return view === "settings" || view === "grownups" || teacherViewOpen;
}

/**
 * Where "Done" in the teacher view lands. Opened from Settings, it goes to the dashboard (and so
 * re-locks), never back to a Settings the next learner could use. null = stay where the app is.
 */
export function viewAfterTeacherDone(openedFrom: "settings" | "picker"): "dashboard" | null {
  return openedFrom === "settings" ? "dashboard" : null;
}

/** What a mode change asks for before it happens. */
export type ModeChange =
  | { step: "none" | "set-teacher-pin" | "verify-teacher-pin" }
  | { step: "refused"; reason: string };

/**
 * Only the teacher can lower protection. Leaving a protected mode (to "Just me", or between class and
 * school) needs the teacher PIN. No mode change deletes anyone's data, and none deletes the teacher
 * PIN: going back to "Just me" keeps it, unused, so the same teacher can come back up with it.
 *
 * Moving up from "Just me" sets a new teacher PIN, unless another learner (not the one signed in) has
 * a PIN. Otherwise any learner could make themselves the teacher and then clear another learner's PIN
 * or remove them. Then only a kept teacher PIN can move up: a class or school that went to "Just me"
 * comes back with the PIN it had, so one learner's forgotten PIN can't lock it out. With no kept
 * teacher PIN the move is refused; the learner with that PIN can remove it, or sign in and make the
 * change themselves.
 */
export function modeChangeStep(
  from: UsageMode,
  to: UsageMode,
  learners: ReadonlyArray<Pick<LearnerRow, "id" | "name" | "pin_hash">>,
  activeLearnerId: string | null,
  teacherPinKept: boolean,
): ModeChange {
  if (from === to) return { step: "none" };
  if (isProtected(from)) return { step: "verify-teacher-pin" };
  if (isProtected(to)) {
    const other = learners.find((l) => l.id !== activeLearnerId && !!l.pin_hash);
    if (other && teacherPinKept) return { step: "verify-teacher-pin" };
    if (other) return { step: "refused", reason: `${other.name} has a PIN; they must remove it first, or sign in as them.` };
  }
  return { step: "set-teacher-pin" };
}

/**
 * The "Save teacher PIN" form's submit. Returns the message to show, or null when saved. Busy is
 * always cleared, so a failed save leaves the button usable.
 */
export async function submitTeacherPin(
  pin: string,
  again: string,
  save: (record: PinRecord) => void | Promise<void>,
  setBusy: (busy: boolean) => void,
): Promise<string | null> {
  if (!isValidPin(pin)) return "A PIN is 4 to 6 numbers.";
  if (pin !== again) return "The two PINs are different.";
  setBusy(true);
  try {
    await save(await hashPin(pin));
    return null;
  } catch {
    return "Could not save the PIN. Try again.";
  } finally {
    setBusy(false);
  }
}

/**
 * Save, then re-read. Only a failed save is an error: once the save went through, a failed re-read
 * must not tell the teacher "Could not save" (the caller has already shown the new state).
 */
export async function saveThenRefresh(save: () => Promise<void>, refresh: () => Promise<unknown>): Promise<void> {
  await save();
  try {
    await refresh();
  } catch {
    // Saved. The screen already shows the new mode; the next refresh catches the rest up.
  }
}

/** Show "Who is learning?" at launch. A class or school always picks; "Just me" keeps #173's rule. */
export function showsPicker(mode: UsageMode, learners: ReadonlyArray<Pick<LearnerRow, "pin_hash">>): boolean {
  return isProtected(mode) || needsPicker(learners);
}

/** The learner to enter without asking, or null for the picker. */
export function autoPickFor<T extends Pick<LearnerRow, "pin_hash">>(mode: UsageMode, learners: ReadonlyArray<T>): T | null {
  return isProtected(mode) ? null : autoPickLearner(learners);
}

/**
 * The titlebar learner chip. Hidden for the plain "Just me" case (one learner, no PIN): learner
 * options are tucked into Settings there. Shown whenever there is someone to switch to or a PIN.
 */
export function showsLearnerChip(mode: UsageMode, learners: ReadonlyArray<Pick<LearnerRow, "pin_hash">>): boolean {
  return showsPicker(mode, learners);
}

/** In a class or school, learners cannot add or delete learners themselves; the teacher does. */
export function learnersManageLearners(mode: UsageMode): boolean {
  return !isProtected(mode);
}

// ── Groups (school mode) ──────────────────────────────────────────────────────

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
}

export const GROUP_NAME_MAX = 40;

/** The picker bucket for learners in no group. */
export const NO_GROUP = "__none__";

export interface PickerGroup {
  /** A group id, or NO_GROUP. */
  id: string;
  name: string;
  count: number;
}

/**
 * The group tiles the picker shows: every group with at least one learner, then "Everyone else" for
 * learners in no group. Empty groups are left out so no tile leads to an empty screen.
 */
export function pickerGroups(
  groups: ReadonlyArray<Pick<GroupRow, "id" | "name">>,
  learners: ReadonlyArray<{ group_id?: string | null }>,
): PickerGroup[] {
  const known = new Set(groups.map((g) => g.id));
  const out: PickerGroup[] = [];
  for (const g of groups) {
    const count = learners.filter((l) => l.group_id === g.id).length;
    if (count > 0) out.push({ id: g.id, name: g.name, count });
  }
  const loose = learners.filter((l) => !l.group_id || !known.has(l.group_id)).length;
  if (loose > 0) out.push({ id: NO_GROUP, name: out.length ? "Everyone else" : "Everyone", count: loose });
  return out;
}

/** The school picker asks for a group only when there is more than one tile to choose from. */
export function pickerAsksGroup(mode: UsageMode, buckets: ReadonlyArray<PickerGroup>): boolean {
  return usesGroups(mode) && buckets.length > 1;
}

/** Learners in one picker bucket. A learner whose group was deleted counts as in no group. */
export function learnersInGroup<T extends { group_id?: string | null }>(
  learners: ReadonlyArray<T>,
  groupId: string,
  groups: ReadonlyArray<Pick<GroupRow, "id">>,
): T[] {
  if (groupId !== NO_GROUP) return learners.filter((l) => l.group_id === groupId);
  const known = new Set(groups.map((g) => g.id));
  return learners.filter((l) => !l.group_id || !known.has(l.group_id));
}

/** Group names follow the learner-name rules: present, short, unique ignoring case. */
export function validateGroupName(
  raw: string,
  existing: ReadonlyArray<Pick<GroupRow, "id" | "name">>,
  selfId?: string,
): string | null {
  const name = raw.trim();
  if (!name) return "Type a name.";
  if (name.length > GROUP_NAME_MAX) return `Keep it under ${GROUP_NAME_MAX} letters.`;
  const key = name.toLocaleLowerCase();
  if (existing.some((g) => g.id !== selfId && g.name.trim().toLocaleLowerCase() === key)) {
    return "There is already a group with that name.";
  }
  return null;
}
