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
import { monthsWithActivity, pointsIn, rangeBounds, type RecordRange } from "./time";
import type { RecordQuestion, RecordSavedMonth, RecordSource } from "./sources";

type MonthRange = Extract<RecordRange, { kind: "month" }>;

/**
 * What monthly_records.body_json holds. The learner's name, grade and voice are left out (they are shown
 * as they are now), and so is every learner-written or verbatim item; examplesFrom keeps only the ids of
 * the courses that had any, so the record can say when one of them was deleted.
 *
 * bounds and watermark make a copy checkable without trusting today's clock or time zone: bounds is the
 * month as it ran where it was saved (UTC ms), and watermark the newest activity in it the copy saw (UTC
 * ms, null for none). A copy is saved early when saved_at falls before bounds.end, and stale when the rows
 * on record hold activity inside bounds newer than watermark. Nothing destructive ever compares with the
 * current clock.
 */
export interface SavedBody {
  record: Omit<LearningRecord, "learner">;
  days: RecordDay[];
  examplesFrom: string[];
  bounds: { start: number; end: number };
  watermark: number | null;
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

/**
 * A month that has ended by `now`. It decides only what is shown and whether a new copy may be written;
 * the current month (and anything later) is never saved.
 */
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

/** The newest activity inside these bounds, in UTC ms, or null. */
function newestIn(source: RecordSource, bounds: SavedBody["bounds"]): number | null {
  const times = pointsIn(source, { start: new Date(bounds.start), end: new Date(bounds.end) }).map((p) => p.at.getTime());
  return times.length ? Math.max(...times) : null;
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
  const b = rangeBounds(range, now);
  const bounds = { start: b.start.getTime(), end: b.end.getTime() };
  const body: SavedBody = {
    record: kept, days: recordDays(source, record), examplesFrom: [...examplesFrom], bounds, watermark: newestIn(source, bounds),
  };
  return { month: monthKey(range), format: RECORD_FORMAT, body_json: JSON.stringify(body) };
}

/** The row's body, when it is in a format this version reads. */
function bodyOf(row: RecordSavedMonth): SavedBody | null {
  if (row.format !== RECORD_FORMAT) return null;
  try {
    const body = JSON.parse(row.body_json) as SavedBody;
    const ok = body?.record?.format === RECORD_FORMAT && Array.isArray(body.days) && Array.isArray(body.examplesFrom)
      && typeof body.bounds?.start === "number" && typeof body.bounds?.end === "number"
      && (body.watermark === null || typeof body.watermark === "number");
    return ok ? body : null;
  } catch {
    return null;
  }
}

/**
 * A copy that must be replaced, decided from stored values only: saved before its own month ended
 * (saved_at against the stored end), or missing activity the rows now hold inside the stored month,
 * newer than anything the copy saw (it was saved while the clock was ahead). A copy saved after its
 * month ended can trip neither: deleted rows are gone, not newer, and later activity falls outside it.
 */
function needsReplacing(source: RecordSource, row: RecordSavedMonth, body: SavedBody): boolean {
  if (parseUtc(row.saved_at).getTime() < body.bounds.end) return true;
  const newest = newestIn(source, body.bounds);
  return newest !== null && (body.watermark === null || newest > body.watermark);
}

/** This month's saved copy must be replaced when it is saved again (see needsReplacing). */
export function copyNeedsReplacing(source: RecordSource, range: RecordRange): boolean {
  if (range.kind !== "month") return false;
  const row = source.savedMonths.find((s) => s.month === monthKey(range));
  const body = row ? bodyOf(row) : null;
  return !!row && !!body && needsReplacing(source, row, body);
}

/**
 * What the launch saves, oldest first: every ended month with activity and no copy yet, and every month
 * whose copy must be replaced (`replace`). A copy that is fine is never touched, whatever the clock says.
 */
export function monthsToSave(source: RecordSource, now: Date): Array<{ range: MonthRange; replace: boolean }> {
  const keys = new Set([
    ...monthsWithActivity(source).map((m) => monthKey({ kind: "month", year: m.year, month: m.month })),
    ...source.savedMonths.map((s) => s.month),
  ]);
  return [...keys].sort().flatMap((key): Array<{ range: MonthRange; replace: boolean }> => {
    const [year, month] = key.split("-").map(Number);
    const range: MonthRange = { kind: "month", year, month: month - 1 };
    if (!monthEnded(range, now)) return [];
    const row = source.savedMonths.find((s) => s.month === key);
    if (!row) return [{ range, replace: false }];
    const body = bodyOf(row);
    return body && needsReplacing(source, row, body) ? [{ range, replace: true }] : [];
  });
}

/**
 * The saved copy this month shows: only once the month has ended, and only a copy in a format this
 * version reads that need not be replaced. Anything else is built from the rows on record now. Hiding
 * a copy never deletes it.
 */
export function savedMonth(source: RecordSource, range: RecordRange, now: Date): { row: RecordSavedMonth; body: SavedBody } | null {
  if (!monthEnded(range, now)) return null;
  const row = source.savedMonths.find((s) => s.month === monthKey(range));
  const body = row ? bodyOf(row) : null;
  if (!row || !body || needsReplacing(source, row, body)) return null;
  return { row, body };
}

/**
 * A saved month as it is shown: the saved counts, titles, dates and statuses, with the learner's name,
 * grade and voice as they are now, each course's subject label as it is now (courses since deleted keep
 * theirs), and the learner-written and verbatim items read again from the rows still on record.
 */
export function restoreSaved(source: RecordSource, body: SavedBody, savedAt: string): LearningRecord {
  const r = body.record;
  // The month as it ran where it was saved, so a time-zone move since cannot shift which words belong to it.
  const start = new Date(body.bounds.start);
  const end = new Date(body.bounds.end);
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
