// Saved months (#258 PR 5, spec §7 v19). When a month ends, its record is saved (monthly_records), so
// deleting a course or regenerating a level later cannot rewrite it. Pure: db.ts reads and writes the
// rows, this file decides what goes in them and how a saved month is shown.
//
// What is saved: the LearningRecord as built when the month ended, and the daily spreadsheet's rows,
// which are counts, titles, dates and statuses. What is not: the learner's own words (C2, B4's
// self-explanation) and B3's question/answer pairs. Those are read live from the rows still on this
// computer every time the month is shown, so deleting a course leaves none of that text behind.
//
// The screen, the paper and the daily spreadsheet all read the saved copy through shownRecord and
// shownDays; nothing else changes for them. The event log is always read from the current rows (it is
// made of the learner's own words and one row per stored event), and it says so when the month is saved.

import { parseUtc } from "../early/engine";
import {
  bySubjectThenTitle, groupTimeBySubject, latestSelfExplanation, learningRecord, missedItems, ownWordsIn, type LearningRecord,
} from "./build";
import { RECORD_FORMAT } from "./copy";
import { recordDays, type RecordDay } from "./csv";
import { finishingOrder } from "./replay";
import { monthsWithActivity, rangeBounds, type RecordRange } from "./time";
import type { RecordQuestion, RecordSavedMonth, RecordSource } from "./sources";

type MonthRange = Extract<RecordRange, { kind: "month" }>;

/** What monthly_records.body_json holds. */
export interface SavedBody {
  record: LearningRecord;
  days: RecordDay[];
}

/** A row ready for monthly_records (learner_id and saved_at come from db.ts). */
export interface MonthSnapshot {
  month: string;
  format: number;
  body_json: string;
}

/** 'YYYY-MM' (local) for a month range. */
export function monthKey(range: MonthRange): string {
  return `${range.year}-${String(range.month + 1).padStart(2, "0")}`;
}

export function monthRange(key: string): MonthRange {
  const [y, m] = key.split("-").map(Number);
  return { kind: "month", year: y, month: m - 1 };
}

/** The month before `now`'s: the latest one that has ended. */
export function lastEndedMonth(now: Date): MonthRange {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { kind: "month", year: first.getFullYear(), month: first.getMonth() };
}

/** A month that has ended by `now`. The current month (and anything later) is never saved. */
export function monthEnded(range: RecordRange, now: Date): range is MonthRange {
  return range.kind === "month" && rangeBounds(range, now).end <= now;
}

/** The record with every learner-written and verbatim item taken out. */
export function withoutVerbatim(record: LearningRecord): LearningRecord {
  return {
    ...record,
    hardOnes: record.hardOnes.map((h) => ({ ...h, missed: [] })),
    talkAboutIt: { ...record.talkAboutIt, explain: record.talkAboutIt.explain.map((e) => ({ ...e, selfExplanation: null })) },
    ownWords: [],
  };
}

/** The saved row for an ended month, built from the rows on record now; null for a month that has not ended. */
export function snapshotOf(source: RecordSource, range: RecordRange, now: Date): MonthSnapshot | null {
  if (!monthEnded(range, now)) return null;
  const record = learningRecord(source, range, now);
  const body: SavedBody = { record: withoutVerbatim(record), days: recordDays(source, record) };
  return { month: monthKey(range), format: RECORD_FORMAT, body_json: JSON.stringify(body) };
}

/** Ended months with activity that have no saved copy yet, oldest first: what the launch saves. */
export function monthsToSave(source: RecordSource, now: Date): MonthRange[] {
  const saved = new Set(source.savedMonths.map((s) => s.month));
  return monthsWithActivity(source)
    .map((m): MonthRange => ({ kind: "month", year: m.year, month: m.month }))
    .filter((range) => !saved.has(monthKey(range)) && monthEnded(range, now))
    .reverse();
}

/** The saved row for this month, when there is one in a format this version reads. */
export function savedMonth(source: RecordSource, range: RecordRange): { row: RecordSavedMonth; body: SavedBody } | null {
  if (range.kind !== "month") return null;
  const row = source.savedMonths.find((s) => s.month === monthKey(range));
  if (!row || row.format !== RECORD_FORMAT) return null;
  try {
    const body = JSON.parse(row.body_json) as SavedBody;
    if (body?.record?.format !== RECORD_FORMAT || !Array.isArray(body.days)) return null;
    return { row, body };
  } catch {
    return null;
  }
}

/**
 * A saved month as it is shown: the saved counts, titles, dates and statuses, with the learner's name,
 * grade and voice as they are now, each course's subject label as it is now (courses since deleted keep
 * theirs), and the learner-written and verbatim items read again from the rows still on record.
 */
export function restoreSaved(source: RecordSource, body: SavedBody, savedAt: string): LearningRecord {
  const r = body.record;
  const { start, end } = rangeBounds(r.range, parseUtc(r.builtAt));
  const inRange = (at: string | null) => { if (!at) return false; const t = parseUtc(at); return t >= start && t < end; };
  const live = new Map(source.courses.map((c) => [c.id, c]));
  const subjectOf = (courseId: string, saved: string | null) => (live.has(courseId) ? live.get(courseId)!.subject : saved);

  // The range's questions on one skill, as the builder reads them: by attempt level, in finishing order.
  const byAttempt = new Map<string, RecordQuestion[]>();
  for (const q of source.questions) {
    const list = byAttempt.get(q.attempt_id);
    if (list) list.push(q);
    else byAttempt.set(q.attempt_id, [q]);
  }
  const finished = finishingOrder(source.attempts).filter((a) => inRange(a.completed_at));
  const onSkill = (ref: { courseId: string; level: number; skillId: string }) => finished
    .filter((a) => a.course_id === ref.courseId && a.level === ref.level)
    .flatMap((a) => (byAttempt.get(a.id) ?? []).filter((q) => q.subtopic_id === ref.skillId));

  const named = new Set([...r.courses.map((c) => c.courseId), ...r.quizzes.map((q) => q.courseId), ...r.hardOnes.map((h) => h.courseId)]);
  return {
    ...r,
    saved: { at: savedAt, examplesGone: [...named].some((id) => !live.has(id)) },
    learner: { id: source.learner.id, name: source.learner.name, grade: source.learner.grade, recordVoice: source.learner.record_voice },
    courses: r.courses.map((c) => ({ ...c, subject: subjectOf(c.courseId, c.subject) })).sort(bySubjectThenTitle),
    timeBySubject: groupTimeBySubject(r.timeBySubject.flatMap((g) => g.courses.map((c) => ({ ...c, subject: subjectOf(c.courseId, g.subject) })))),
    hardOnes: r.hardOnes.map((h) => ({ ...h, missed: missedItems(onSkill(h).filter((q) => q.graded_by !== "unanswered")) })),
    talkAboutIt: { ...r.talkAboutIt, explain: r.talkAboutIt.explain.map((e) => ({ ...e, selfExplanation: latestSelfExplanation(onSkill(e)) })) },
    ownWords: ownWordsIn(source, inRange),
  };
}

/** The record a range shows: an ended month's saved copy when there is one, else built now from the rows on record. */
export function shownRecord(source: RecordSource, range: RecordRange, now: Date): LearningRecord {
  const saved = savedMonth(source, range);
  return saved ? restoreSaved(source, saved.body, saved.row.saved_at) : learningRecord(source, range, now);
}

/** The daily spreadsheet's rows for a record: the saved ones for a saved month (subjects as they are now), else worked out now. */
export function shownDays(source: RecordSource, record: LearningRecord): RecordDay[] {
  const saved = record.saved ? savedMonth(source, record.range) : null;
  if (!saved) return recordDays(source, record);
  const live = new Map(source.courses.map((c) => [c.id, c]));
  return saved.body.days.map((d) => (d.courseId !== null && live.has(d.courseId) ? { ...d, subject: live.get(d.courseId)!.subject } : d));
}

/** Save and CSV write a copy first when the month has ended and none is saved yet. */
export function needsSaving(record: LearningRecord, now: Date): boolean {
  return record.saved === null && monthEnded(record.range, now);
}
