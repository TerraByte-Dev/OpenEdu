// What the learning record's screen (#258 PR 3) and the Home teaser show, worked out from one
// LearningRecord. Pure: the view and the teaser both count through here, so the Home teaser's numbers
// are the record's numbers (spec §6 rule 2).

import { parseUtc } from "../early/engine";
import { monthLabel, shortDate } from "../early/report";
import { learningRecord, type CourseStanding, type Evidence, type LearningRecord, type SkillLine, type WithoutProofRow } from "./build";
import { RECORD_COPY, fill, type PillKey } from "./copy";
import { firstActivityDay, localDayKey, monthsWithActivity, schoolYearStart, type RecordRange } from "./time";
import type { RecordSource } from "./sources";

/** Who the screen is written for. "teacher" is the TeacherView instance: always the learner's name. */
export type Audience = "self" | "guided" | "teacher";

const V = RECORD_COPY.view;

/** T3: mastered rows with quiz proof (3 or more questions). Early signs are not counted. */
export function masteredCount(record: LearningRecord): number {
  return record.mastered.filter((m) => !m.earlySign).length;
}

export function earlySignCount(record: LearningRecord): number {
  return record.mastered.filter((m) => m.earlySign).length;
}

export function currentMonth(now: Date): RecordRange {
  return { kind: "month", year: now.getFullYear(), month: now.getMonth() };
}

export function rangeKey(range: RecordRange): string {
  return range.kind === "month" ? `m:${range.year}-${range.month}` : `since:${range.from}`;
}

export interface RangeOption {
  key: string;
  label: string;
  range: RecordRange;
}

/**
 * The range picker (spec §3): the current month first, then every other month with activity or a saved
 * copy, newest first, then "This school year" (guided and teacher) or "Since you started" (self, only
 * once there is activity to start from).
 */
export function rangeOptions(source: RecordSource, audience: Audience, now: Date): RangeOption[] {
  const here = currentMonth(now) as Extract<RecordRange, { kind: "month" }>;
  // A saved month stays on the list after its activity is gone (its course was deleted).
  const saved = source.savedMonths.map((s) => { const [year, month] = s.month.split("-").map(Number); return { year, month: month - 1 }; });
  const seen = new Set([`${here.year}-${here.month}`]);
  const months = [here, ...[...monthsWithActivity(source), ...saved]
    .sort((x, y) => y.year - x.year || y.month - x.month)
    .filter((m) => { const k = `${m.year}-${m.month}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((m) => ({ kind: "month" as const, year: m.year, month: m.month }))];
  const out: RangeOption[] = months.map((m) => ({ key: rangeKey(m), label: monthLabel(m.year, m.month), range: m }));
  if (audience === "self") {
    const from = firstActivityDay(source);
    if (from) out.push({ key: rangeKey({ kind: "since", from }), label: V.sinceStarted, range: { kind: "since", from } });
  } else {
    const from = schoolYearStart(source.learner.record_year_start, now);
    out.push({ key: rangeKey({ kind: "since", from }), label: V.schoolYear, range: { kind: "since", from } });
  }
  return out;
}

/** C2 with nothing to show: on a saved month whose course was deleted, that is why. */
export function ownWordsNoneText(record: LearningRecord): string {
  return record.saved?.examplesGone ? RECORD_COPY.examplesGone : V.ownWordsNone;
}

/** "in November" for a month, "since Aug 1, 2026" for a since-range. */
export function whenText(record: LearningRecord): string {
  if (record.range.kind === "month") return fill(V.inMonth, { month: record.period.label.split(" ")[0] });
  return record.period.label.charAt(0).toLowerCase() + record.period.label.slice(1);
}

/** The record since the learner's first activity, or null with none: every level pass and mastered skill to date. */
export function allTimeRecord(source: RecordSource, now: Date): LearningRecord | null {
  const from = firstActivityDay(source);
  return from ? learningRecord(source, { kind: "since", from }, now) : null;
}


/** Rows grouped by course, then level, in first-mastered order inside each group. */
export function groupByCourseAndLevel<T extends { courseId: string; course: string; level: number }>(
  rows: ReadonlyArray<T>,
): Array<{ courseId: string; course: string; levels: Array<{ level: number; rows: T[] }> }> {
  const out: Array<{ courseId: string; course: string; levels: Array<{ level: number; rows: T[] }> }> = [];
  for (const r of rows) {
    let c = out.find((x) => x.courseId === r.courseId);
    if (!c) { c = { courseId: r.courseId, course: r.course, levels: [] }; out.push(c); }
    let l = c.levels.find((x) => x.level === r.level);
    if (!l) { l = { level: r.level, rows: [] }; c.levels.push(l); }
    l.rows.push(r);
  }
  for (const c of out) c.levels.sort((a, b) => a.level - b.level);
  return out.sort((a, b) => a.course.localeCompare(b.course));
}

/** "4 of 4 right · quiz · 3 checked against the app's answer key, 1 judged by the app's model". */
export function evidenceText(e: Evidence): string {
  const E = RECORD_COPY.evidence;
  const head = fill(E.result, { correct: e.correct, total: e.total, kind: e.levelTest ? E.levelTest : E.quiz });
  const parts = (["key", "exact", "model", "fallback", "unanswered", "unknown"] as const)
    .filter((k) => e.graders[k] > 0)
    .map((k) => fill(E[k], { n: e.graders[k] }));
  return parts.length ? `${head} · ${parts.join(", ")}` : head;
}

/** "40 min" or "6 h 40 min". */
export function durationText(minutes: number): string {
  if (minutes < 60) return fill(V.minutes, { n: minutes });
  return fill(V.hoursMinutes, { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** The approximate-time tile line: "About 6 h 40 min · in 31 sittings". */
export function approxTimeText(approx: { minutes: number; sittings: number }): string {
  const time = durationText(approx.minutes);
  return fill(RECORD_COPY.tiles.time_approx, { time, sittings: approx.sittings });
}

/**
 * The approximate part of the time tile, or null when it would say nothing: the cut-over day alone can
 * leave an empty approximate part beside counted time, and "About 0 min" reads as a claim.
 */
export function approxShown(time: LearningRecord["time"]): { minutes: number; sittings: number } | null {
  return time.approx && (time.approx.sittings > 0 || !time.counted) ? time.approx : null;
}

/** B1's skill counts for one course: the skills up to its level at range end, as the course card counts them. */
export function standingCounts(c: CourseStanding): { total: number; mastered: number; early: number; learning: number } {
  const upTo = c.level ?? 0;
  const shown = c.skills.filter((s) => s.level <= upTo);
  const n = (st: SkillLine["status"]) => shown.filter((s) => s.status === st).length;
  return { total: shown.length, mastered: n("mastered"), early: n("early_sign"), learning: n("learning") };
}

/** A2: the pill and the reason line for a skill mastered in the app without quiz proof. */
export function withoutProofText(w: WithoutProofRow): { pill: PillKey; why: string } {
  const C = RECORD_COPY;
  const pill: PillKey = w.reason === "tutor" ? "tutor" : w.reason === "keyword" ? "keyword" : "no_proof";
  const why = w.reason === "tutor" || w.reason === "keyword"
    ? (w.date ? fill(C.withoutProof[w.reason], { date: dayText(w.date) }) : w.reason === "tutor" ? V.tutorUndated : V.keywordUndated)
    : w.reason === "fallback" ? fill(C.withoutProof.fallback, { n: w.fallbackAnswers })
    : C.withoutProof[w.reason];
  return { pill, why };
}

/** C1's time column: "—" when not stored, "under 1 min", or "12 min". */
export function quizTimeText(seconds: number | null): string {
  return seconds === null ? "—" : seconds < 60 ? V.underMinute : durationText(Math.round(seconds / 60));
}

/** A stored UTC time as the learner's local "Nov 9". */
export function dayText(stored: string, withYear = false): string {
  const d = parseUtc(stored);
  return withYear ? `${shortDate(d)}, ${d.getFullYear()}` : shortDate(d);
}

/** A local 'YYYY-MM-DD' as "Nov 30, 2026". */
export function localDayText(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${shortDate(date)}, ${date.getFullYear()}`;
}

// ── The Home teaser ─────────────────────────────────────────────────────────────────────────────────

export interface TeaserCounts {
  /** "November". */
  month: string;
  days: number;
  mastered: number;
}

/** The teaser's numbers, from the record the record screen shows for the same month. */
export function teaserFromRecord(record: LearningRecord): TeaserCounts {
  return { month: record.period.label.split(" ")[0], days: record.days, mastered: masteredCount(record) };
}

/** The current month's teaser, built by the same learningRecord the record screen uses. */
export function teaserCounts(source: RecordSource, now: Date): TeaserCounts {
  return teaserFromRecord(learningRecord(source, currentMonth(now), now));
}

/** "Your November so far: at least 6 days with learning · 3 skills mastered." Always second person. */
export function teaserLine(c: TeaserCounts): string {
  return fill(V.teaser, {
    month: c.month,
    days: fill(V.teaserDays, { n: c.days }),
    mastered: fill(V.teaserMastered, { n: c.mastered }),
  });
}

/** Home shows the teaser only once there is something in it: no "0 days · 0 skills" line. */
export function teaserShown(c: TeaserCounts): boolean {
  return c.days > 0 || c.mastered > 0;
}

// Home rebuilds the teaser every time it mounts, so it always equals the record's tiles. The last
// build is kept per learner and month only to paint the first frame without a jump.
const teasers = new Map<string, TeaserCounts>();

export function teaserKey(learnerId: string, now: Date): string {
  return `${learnerId}|${localDayKey(now).slice(0, 7)}`;
}

export function cachedTeaser(key: string): TeaserCounts | undefined {
  return teasers.get(key);
}

export function rememberTeaser(key: string, counts: TeaserCounts): void {
  teasers.set(key, counts);
}

/**
 * A tile's sentence split at its count, so the number can be set large: "At least 12 days with
 * learning" → "At least 12" + "days with learning". A zero reads "0": "at least 0" bounds nothing.
 */
export function splitAtCount(text: string, n: number): { big: string; rest: string } {
  const at = text.indexOf(String(n));
  if (at < 0) return { big: String(n), rest: text };
  const end = at + String(n).length;
  return { big: n === 0 ? "0" : text.slice(0, end), rest: text.slice(end).trim() };
}
