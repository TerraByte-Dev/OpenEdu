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

export type UsageMode = "single" | "class" | "school";

export const USAGE_MODES: ReadonlyArray<{ id: UsageMode; title: string; sentence: string }> = [
  { id: "single", title: "Just me", sentence: "One person learns on this computer." },
  { id: "class", title: "A class", sentence: "Several learners share it, and a teacher looks after them." },
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

/** Everything the teacher PIN guards. In "Just me" none of them ask. */
export type TeacherAction =
  | "open-settings"
  | "change-mode"
  | "add-learner"
  | "remove-learner"
  | "reset-learner-pin"
  | "teacher-view"
  | "manage-groups";

export function needsTeacherPin(mode: UsageMode, _action: TeacherAction): boolean {
  // Every guarded action is guarded in both protected modes. The action is a parameter so a future
  // mode can relax one of them without touching every call site.
  return isProtected(mode);
}

/** What a mode change asks for before it happens. */
export type ModeChangeStep = "none" | "set-teacher-pin" | "verify-teacher-pin";

/**
 * Only the teacher can lower protection. Leaving a protected mode (to "Just me", or between class and
 * school) needs the teacher PIN. Moving up from "Just me" sets a new teacher PIN, because there is no
 * teacher yet. No mode change deletes anyone's data.
 */
export function modeChangeStep(from: UsageMode, to: UsageMode): ModeChangeStep {
  if (from === to) return "none";
  if (isProtected(from)) return "verify-teacher-pin";
  return "set-teacher-pin";
}

/** Whether the teacher PIN survives the change. Going back to "Just me" drops it: nothing uses it. */
export function keepsTeacherPin(to: UsageMode): boolean {
  return isProtected(to);
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
