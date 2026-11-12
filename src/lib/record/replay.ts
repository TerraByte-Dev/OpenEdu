// The skill replay for the learning record (#258, spec R2). Two pure layers:
//
// replaySubtopics re-runs the app's own mastery rule over one course's stored quiz rows, in the order
// the attempts finished, so every skill's status can be judged at any date. It mirrors
// progress.ts updateSubtopicMastery: a question counts toward the level of its ATTEMPT and only when
// its subtopic_id is in that level's syllabus; a stored NULL grade counts as wrong; each (attempt,
// skill) group goes through the real applySubtopicScore. Untagged questions are left out (the keyword
// path reaches the record through subtopic_events instead).
//
// proofFilter decides which replayed results may be shown as quiz proof. It never changes state.

import { applySubtopicScore, subtopicTransitions, type SubtopicEventKind } from "../mastery";
import type { Subtopic } from "../../types";
import type { RecordAttempt, RecordQuestion } from "./sources";

/** How the answers behind a result were marked. NULL graded_by (before migration 18, or never graded)
 * is "key" for multiple choice and true/false, "unknown" for a written answer. */
export interface GraderSplit {
  key: number;
  exact: number;
  model: number;
  fallback: number;
  unanswered: number;
  unknown: number;
}

/** One skill's result on one finished attempt, as the app scored it, and what it changed. */
export interface SkillCheck {
  attemptId: string;
  quizType: "quiz" | "promotion";
  level: number;
  skillId: string;
  /** completed_at of the attempt. */
  at: string;
  correct: number;
  total: number;
  graders: GraderSplit;
  transitions: SubtopicEventKind[];
  /** A level test that stored fewer rows than it had questions (it timed out before migration 18). */
  rowsShort: boolean;
  questions: RecordQuestion[];
}

export interface Replay {
  /** Every result in finishing order. */
  checks: SkillCheck[];
  /** The state after the last attempt, keyed by skillKey(level, id). */
  state: Map<string, Subtopic>;
}

export const skillKey = (level: number, skillId: string): string => `${level}|${skillId}`;

const CHOICE_TYPES = new Set(["multiple_choice", "true_false"]);

function graderOf(q: RecordQuestion): keyof GraderSplit {
  if (q.graded_by) return q.graded_by;
  return CHOICE_TYPES.has(q.question_type) ? "key" : "unknown";
}

/** Finished attempts in the order the app applied them. */
function finishingOrder(attempts: ReadonlyArray<RecordAttempt>): RecordAttempt[] {
  return attempts
    .filter((a) => a.completed_at !== null && (a.quiz_type === "quiz" || a.quiz_type === "promotion"))
    .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!) || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
}

/** Replay one course. syllabusesByLevel holds that course's skills per level. */
export function replaySubtopics(
  attempts: ReadonlyArray<RecordAttempt>,
  questions: ReadonlyArray<RecordQuestion>,
  syllabusesByLevel: ReadonlyMap<number, ReadonlyArray<Subtopic>>,
): Replay {
  const state = new Map<string, Subtopic>();
  for (const [level, subs] of syllabusesByLevel) {
    for (const s of subs) state.set(skillKey(level, s.id), { ...s, mastered: false, practiced: false, review_needed: false });
  }
  const byAttempt = new Map<string, RecordQuestion[]>();
  for (const q of questions) {
    const list = byAttempt.get(q.attempt_id);
    if (list) list.push(q);
    else byAttempt.set(q.attempt_id, [q]);
  }

  const checks: SkillCheck[] = [];
  for (const a of finishingOrder(attempts)) {
    const subs = syllabusesByLevel.get(a.level);
    if (!subs) continue;
    const rows = byAttempt.get(a.id) ?? [];
    const rowsShort = a.quiz_type === "promotion" && rows.length < a.total_questions;
    // In syllabus order, as the app walks them.
    for (const sub of subs) {
      const group = rows.filter((q) => q.subtopic_id === sub.id);
      if (group.length === 0) continue;
      const correct = group.filter((q) => q.is_correct === 1).length;
      const key = skillKey(a.level, sub.id);
      const prev = state.get(key)!;
      const next = applySubtopicScore(prev, correct, group.length);
      state.set(key, next);
      const graders: GraderSplit = { key: 0, exact: 0, model: 0, fallback: 0, unanswered: 0, unknown: 0 };
      for (const q of group) graders[graderOf(q)]++;
      checks.push({
        attemptId: a.id, quizType: a.quiz_type, level: a.level, skillId: sub.id, at: a.completed_at!,
        correct, total: group.length, graders, transitions: subtopicTransitions(prev, next), rowsShort, questions: group,
      });
    }
  }
  return { checks, state };
}

export type NotProof = "fallback" | "timed_out" | "mixed";

/** The key of an (attempt, skill) pair in the set of pairs the app also matched by keyword. */
export const mixedKey = (attemptId: string, level: number, skillId: string): string => `${attemptId}|${skillKey(level, skillId)}`;

/**
 * Why a result cannot be shown as quiz proof (A1, a "held" recheck), or null when it can: an answer on
 * the skill was passed because the grader failed; the level test's stored rows do not cover it; or the
 * app also matched untagged questions to the skill on that attempt (a keyword subtopic_event with the
 * attempt's id), so its counts mixed in questions the replay cannot see.
 */
export function notProof(c: SkillCheck, keywordMixed: ReadonlySet<string> = new Set()): NotProof | null {
  if (c.graders.fallback > 0) return "fallback";
  if (c.rowsShort) return "timed_out";
  if (keywordMixed.has(mixedKey(c.attemptId, c.level, c.skillId))) return "mixed";
  return null;
}

export function proofFilter(checks: ReadonlyArray<SkillCheck>, keywordMixed: ReadonlySet<string> = new Set()): SkillCheck[] {
  return checks.filter((c) => notProof(c, keywordMixed) === null);
}
