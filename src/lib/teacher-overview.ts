// The teacher overview: every learner x course, with level, subtopics mastered and last active, plus
// its CSV export. Pure module, tested in teacher-overview.test.ts; db.ts getTeacherOverviewSource()
// supplies the raw rows and TeacherView.tsx renders what buildOverviewRows returns.

import { toCsv } from "./csv";
import { NO_GROUP, type GroupRow } from "./usage-modes";
import type { LearnerRow } from "./learners";

export interface OverviewSource {
  learners: ReadonlyArray<Pick<LearnerRow, "id" | "name" | "last_active_at" | "group_id">>;
  groups: ReadonlyArray<Pick<GroupRow, "id" | "name">>;
  courses: ReadonlyArray<{ id: string; title: string; learner_id: string | null; current_level: number; updated_at: string }>;
  /** One row per syllabus level; `subtopics` is the stored JSON array. */
  syllabuses: ReadonlyArray<{ course_id: string; subtopics: string | null }>;
  progress: ReadonlyArray<{ course_id: string; last_active_at: string | null }>;
}

export interface OverviewRow {
  learnerId: string;
  learnerName: string;
  /** null = in no group (or a group that was deleted). */
  groupId: string | null;
  groupName: string;
  /** null for a learner with no courses yet: they still get one row, so nobody is missing. */
  courseTitle: string | null;
  level: number | null;
  mastered: number;
  subtopics: number;
  /** SQLite datetime text (UTC), or null when never. */
  lastActive: string | null;
}

/** Mastered and total subtopics in one syllabus's JSON. Bad JSON counts as nothing, never throws. */
export function countMastery(subtopicsJson: string | null): { mastered: number; total: number } {
  try {
    const list: unknown = JSON.parse(subtopicsJson ?? "[]");
    if (!Array.isArray(list)) return { mastered: 0, total: 0 };
    return {
      mastered: list.filter((s) => !!s && typeof s === "object" && (s as { mastered?: unknown }).mastered === true).length,
      total: list.length,
    };
  } catch {
    return { mastered: 0, total: 0 };
  }
}

/** The later of two SQLite datetime strings (same format, so they compare as text). */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function buildOverviewRows(src: OverviewSource): OverviewRow[] {
  const groupName = new Map(src.groups.map((g) => [g.id, g.name]));
  const mastery = new Map<string, { mastered: number; total: number }>();
  for (const s of src.syllabuses) {
    const m = countMastery(s.subtopics);
    const acc = mastery.get(s.course_id) ?? { mastered: 0, total: 0 };
    mastery.set(s.course_id, { mastered: acc.mastered + m.mastered, total: acc.total + m.total });
  }
  const lastProgress = new Map<string, string | null>();
  for (const p of src.progress) lastProgress.set(p.course_id, later(lastProgress.get(p.course_id) ?? null, p.last_active_at));

  const rows: OverviewRow[] = [];
  for (const l of src.learners) {
    const gid = l.group_id && groupName.has(l.group_id) ? l.group_id : null;
    const base = { learnerId: l.id, learnerName: l.name, groupId: gid, groupName: gid ? groupName.get(gid)! : "" };
    const courses = src.courses.filter((c) => c.learner_id === l.id);
    if (courses.length === 0) {
      rows.push({ ...base, courseTitle: null, level: null, mastered: 0, subtopics: 0, lastActive: l.last_active_at });
      continue;
    }
    for (const c of courses) {
      const m = mastery.get(c.id) ?? { mastered: 0, total: 0 };
      rows.push({
        ...base,
        courseTitle: c.title,
        level: c.current_level,
        mastered: m.mastered,
        subtopics: m.total,
        lastActive: later(lastProgress.get(c.id) ?? null, c.updated_at),
      });
    }
  }
  return rows.sort((a, b) =>
    a.groupName.localeCompare(b.groupName) ||
    a.learnerName.localeCompare(b.learnerName) ||
    (a.courseTitle ?? "").localeCompare(b.courseTitle ?? ""));
}

/** "all", a group id, or NO_GROUP. */
export function filterOverviewRows(rows: ReadonlyArray<OverviewRow>, filter: string): OverviewRow[] {
  if (filter === "all") return [...rows];
  if (filter === NO_GROUP) return rows.filter((r) => r.groupId === null);
  return rows.filter((r) => r.groupId === filter);
}

/** The CSV the teacher saves. The Class column appears only when groups are in use (school mode). */
export function overviewCsv(rows: ReadonlyArray<OverviewRow>, withGroups: boolean): string {
  const head = ["Learner", "Course", "Level", "Subtopics mastered", "Subtopics total", "Last active (UTC)"];
  return toCsv([
    withGroups ? ["Class", ...head] : head,
    ...rows.map((r) => {
      const cells = [r.learnerName, r.courseTitle ?? "", r.level ?? "", r.mastered, r.subtopics, r.lastActive ?? ""];
      return withGroups ? [r.groupName, ...cells] : cells;
    }),
  ]);
}
