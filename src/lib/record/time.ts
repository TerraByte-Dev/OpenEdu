// Time for the learning record (#258): which local days had learning, the approximate time from
// stored timestamps, and the record's ranges. Pure. Every stored time is UTC from datetime('now');
// it is parsed with parseUtc and bucketed by the learner's LOCAL day, never analytics.ts dayKey
// (which buckets by UTC day).

import { parseUtc } from "../early/engine";
import { SESSION_GAP_MS, monthLabel, shortDate, type MonthRef } from "../early/report";
import { localDayKey } from "../daily-goal";
import type { RecordAttempt, RecordSource } from "./sources";

export { localDayKey };

/** A quiz counts for at most this long a question, so a quiz left open over lunch is not learning. */
export const QUIZ_MS_PER_QUESTION = 2 * 60_000;

export interface Span {
  courseId: string;
  start: Date;
  end: Date;
}

export interface Sitting {
  start: Date;
  end: Date;
}

/** The SQLite form of a time ("YYYY-MM-DD HH:MM:SS", UTC), so the record's dates all read one way. */
export function toStored(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function answeredAttemptIds(source: RecordSource): Set<string> {
  return new Set(source.questions.filter((q) => q.user_answer !== null).map((q) => q.attempt_id));
}

/**
 * The time a quiz or level test took. A level test runs back from its finish by the stored time
 * taken, which its time limit bounds. A quiz runs from its start to its finish, capped at
 * QUIZ_MS_PER_QUESTION a question.
 */
export function attemptSpan(a: RecordAttempt): Span | null {
  if (!a.completed_at) return null;
  const done = parseUtc(a.completed_at);
  if (a.quiz_type === "promotion" && a.time_taken_seconds !== null) {
    return { courseId: a.course_id, start: new Date(done.getTime() - a.time_taken_seconds * 1000), end: done };
  }
  const start = parseUtc(a.started_at);
  const cap = start.getTime() + QUIZ_MS_PER_QUESTION * Math.max(0, a.total_questions);
  return { courseId: a.course_id, start, end: new Date(Math.max(start.getTime(), Math.min(done.getTime(), cap))) };
}

/**
 * Every timestamp that shows the learner doing something (tile T1): a tutor message, a quiz finished,
 * a quiz started that has an answer, a lesson first opened, a flashcard made by the learner or
 * reviewed, a note the learner started. Nothing else can be inflated by the app on its own.
 */
export function activityPoints(source: RecordSource): Array<{ courseId: string; at: Date }> {
  const answered = answeredAttemptIds(source);
  const out: Array<{ courseId: string; at: Date }> = [];
  const add = (courseId: string, at: string | null) => { if (at) out.push({ courseId, at: parseUtc(at) }); };
  for (const m of source.chats) add(m.course_id, m.created_at);
  for (const a of source.attempts) {
    add(a.course_id, a.completed_at);
    if (answered.has(a.id)) add(a.course_id, a.started_at);
  }
  for (const l of source.lessons) add(l.course_id, l.read_at);
  for (const f of source.flashcards) {
    if (f.source === "manual") add(f.course_id, f.created_at);
    add(f.course_id, f.last_reviewed_at);
  }
  for (const r of source.flashcardReviews) add(r.course_id, r.reviewed_at);
  for (const n of source.notes) add(n.course_id, n.created_at);
  return out;
}

/**
 * What the approximate time is measured from: each finished attempt as its span, every other
 * activity point as an instant. An attempt that was never finished has no span, so its start (when
 * it has an answer) stands as an instant.
 */
export function timeSpans(source: RecordSource): Span[] {
  const answered = answeredAttemptIds(source);
  const out: Span[] = [];
  const point = (courseId: string, at: string | null) => {
    if (at) { const t = parseUtc(at); out.push({ courseId, start: t, end: t }); }
  };
  for (const a of source.attempts) {
    const span = attemptSpan(a);
    if (span) out.push(span);
    else if (answered.has(a.id)) point(a.course_id, a.started_at);
  }
  for (const m of source.chats) point(m.course_id, m.created_at);
  for (const l of source.lessons) point(l.course_id, l.read_at);
  for (const f of source.flashcards) {
    if (f.source === "manual") point(f.course_id, f.created_at);
    point(f.course_id, f.last_reviewed_at);
  }
  for (const r of source.flashcardReviews) point(r.course_id, r.reviewed_at);
  for (const n of source.notes) point(n.course_id, n.created_at);
  return out;
}

/** Spans grouped into sittings: a sitting ends after SESSION_GAP_MS with nothing recorded. */
export function sittings(spans: ReadonlyArray<{ start: Date; end: Date }>): Sitting[] {
  const sorted = [...spans].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Sitting[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start.getTime() - last.end.getTime() < SESSION_GAP_MS) {
      if (s.end > last.end) last.end = s.end;
    } else {
      out.push({ start: s.start, end: s.end });
    }
  }
  return out;
}

/** From the first to the last recorded moment of each sitting, added up, to the nearest minute. */
export function approxMinutes(list: ReadonlyArray<Sitting>): number {
  return Math.round(list.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()), 0) / 60_000);
}

// ── Ranges ──────────────────────────────────────────────────────────────────────────────────────────

/** A calendar month (month 0-11), or everything since a local day ('YYYY-MM-DD') up to today. */
export type RecordRange = { kind: "month"; year: number; month: number } | { kind: "since"; from: string };

export interface Bounds {
  /** Local midnight the range starts at. */
  start: Date;
  /** Local midnight after its last day (exclusive). */
  end: Date;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function rangeBounds(range: RecordRange, now: Date): Bounds {
  if (range.kind === "month") return { start: new Date(range.year, range.month, 1), end: new Date(range.year, range.month + 1, 1) };
  return { start: parseDay(range.from), end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) };
}

/** "November 2026" and "Nov 1 – Nov 30", or "Since Aug 1, 2026". */
export function rangeLabel(range: RecordRange, now: Date): { label: string; span: string } {
  const { start, end } = rangeBounds(range, now);
  if (range.kind === "since") return { label: `Since ${shortDate(start)}, ${start.getFullYear()}`, span: "" };
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  return { label: monthLabel(range.year, range.month), span: `${shortDate(start)} – ${shortDate(last)}` };
}

/** The school year's first day on or before today: learners.record_year_start ('MM-DD'), Aug 1 when unset. */
export function schoolYearStart(recordYearStart: string | null, now: Date): string {
  const mmdd = recordYearStart && /^\d\d-\d\d$/.test(recordYearStart) ? recordYearStart : "08-01";
  const [m, d] = mmdd.split("-").map(Number);
  const thisYear = new Date(now.getFullYear(), m - 1, d);
  return localDayKey(thisYear <= now ? thisYear : new Date(now.getFullYear() - 1, m - 1, d));
}

/** The local day of the learner's first recorded activity ("Since you started"), or null. */
export function firstActivityDay(source: RecordSource): string | null {
  const times = activityPoints(source).map((p) => p.at.getTime());
  return times.length ? localDayKey(new Date(times.reduce((a, b) => Math.min(a, b)))) : null;
}

/** Local months with any recorded activity, newest first (the record's month picker). */
export function monthsWithActivity(source: RecordSource): MonthRef[] {
  const seen = new Map<string, MonthRef>();
  for (const { at } of activityPoints(source)) seen.set(`${at.getFullYear()}-${at.getMonth()}`, { year: at.getFullYear(), month: at.getMonth() });
  return [...seen.values()].sort((x, y) => y.year - x.year || y.month - x.month);
}

/**
 * Local midnight of the first full day after capture began (migration 18). From here on, time is
 * counted (learner_days); before it, including the cut-over day itself, it is approximate. Null when
 * capture never began.
 */
export function countedFrom(captureSince: string | null): Date | null {
  if (!captureSince) return null;
  const t = parseUtc(captureSince);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
}
