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

/**
 * What monthly_records.body_json holds. The learner's name, grade and voice are left out (they are shown
 * as they are now), and so is every learner-written or verbatim item; examplesFrom keeps only the ids of
 * the courses that had any, so the record can say when one of them was deleted.
 */
export interface SavedBody {
  record: Omit<LearningRecord, "learner">;
  days: RecordDay[];
  examplesFrom: string[];
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
  const { learner: _learner, ...kept } = withoutVerbatim(record);
  const examplesFrom = new Set([
    ...record.hardOnes.filter((h) => h.missed.length > 0).map((h) => h.courseId),
    ...record.talkAboutIt.explain.filter((e) => e.selfExplanation !== null).map((e) => e.courseId),
    ...record.ownWords.map((w) => w.courseId),
  ]);
  const body: SavedBody = { record: kept, days: recordDays(source, record), examplesFrom: [...examplesFrom] };
  return { month: monthKey(range), format: RECORD_FORMAT, body_json: JSON.stringify(body) };
}

/**
 * A row saved before its month had ended in local time: the clock was ahead, or the time zone has moved
 * since. It is never shown; the launch replaces it once the month has ended.
 */
function savedEarly(row: RecordSavedMonth, range: MonthRange): boolean {
  return parseUtc(row.saved_at) < rangeBounds(range, new Date(0)).end;
}

/** This month has a saved row that was written before the month ended, so saving it again must replace it. */
export function hasEarlyCopy(source: RecordSource, range: RecordRange): boolean {
  if (range.kind !== "month") return false;
  const row = source.savedMonths.find((s) => s.month === monthKey(range));
  return !!row && savedEarly(row, range);
}

/**
 * What the launch saves, oldest first: every ended month with activity and no copy saved after it ended,
 * and every ended month whose copy was saved too early, or stamped later than `now` (the clock was ahead
 * when it was saved). `replace` overwrites such a copy.
 */
export function monthsToSave(source: RecordSource, now: Date): Array<{ range: MonthRange; replace: boolean }> {
  const keys = new Set([
    ...monthsWithActivity(source).map((m) => monthKey({ kind: "month", year: m.year, month: m.month })),
    ...source.savedMonths.map((s) => s.month),
  ]);
  return [...keys].sort().flatMap((key) => {
    const [year, month] = key.split("-").map(Number);
    const range: MonthRange = { kind: "month", year, month: month - 1 };
    if (!monthEnded(range, now)) return [];
    const row = source.savedMonths.find((s) => s.month === key);
    if (row && !savedEarly(row, range) && parseUtc(row.saved_at) <= now) return [];
    return [{ range, replace: !!row }];
  });
}

/**
 * Saved copies of months that have not ended by `now`: written while the clock was ahead. They can never
 * be right, so the launch deletes them, and the month is saved again once it really ends.
 */
export function unendedCopies(source: RecordSource, now: Date): string[] {
  return source.savedMonths
    .filter((s) => { const [year, month] = s.month.split("-").map(Number); return !monthEnded({ kind: "month", year, month: month - 1 }, now); })
    .map((s) => s.month);
}

/**
 * The saved row for this month, when the month has ended, the row was saved after it ended, and it is
 * in a format this version reads. Anything else is built from the rows on record now.
 */
export function savedMonth(source: RecordSource, range: RecordRange, now: Date): { row: RecordSavedMonth; body: SavedBody } | null {
  if (!monthEnded(range, now)) return null;
  const row = source.savedMonths.find((s) => s.month === monthKey(range));
  if (!row || row.format !== RECORD_FORMAT || savedEarly(row, range)) return null;
  try {
    const body = JSON.parse(row.body_json) as SavedBody;
    if (body?.record?.format !== RECORD_FORMAT || !Array.isArray(body.days) || !Array.isArray(body.examplesFrom)) return null;
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

  return {
    ...r,
    saved: { at: savedAt, examplesGone: body.examplesFrom.some((id) => !live.has(id)) },
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
  const saved = savedMonth(source, range, now);
  return saved ? restoreSaved(source, saved.body, saved.row.saved_at) : learningRecord(source, range, now);
}

/** The daily spreadsheet's rows for a record: the saved ones for a saved month (subjects as they are now), else worked out now. */
export function shownDays(source: RecordSource, record: LearningRecord, now: Date): RecordDay[] {
  const saved = record.saved ? savedMonth(source, record.range, now) : null;
  if (!saved) return recordDays(source, record);
  const live = new Map(source.courses.map((c) => [c.id, c]));
  return saved.body.days.map((d) => (d.courseId !== null && live.has(d.courseId) ? { ...d, subject: live.get(d.courseId)!.subject } : d));
}

/** Save and CSV write a copy first when the month has ended and none is saved yet. */
export function needsSaving(record: LearningRecord, now: Date): boolean {
  return record.saved === null && monthEnded(record.range, now);
}
