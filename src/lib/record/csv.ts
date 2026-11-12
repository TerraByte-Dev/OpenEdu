// The learning record as spreadsheets (#258 PR 4, spec §4b): a daily summary (one row per day per
// course) and, on request, the detailed event log (one row per event). Pure, no Tauri. The
// LearningRecord holds totals, not days or events, so recordDays and recordEvents work them out from
// the same pieces the record is built from: the record's range, time.ts pointsIn (the activity behind
// the days tile, already scoped and range-bucketed), build.ts courseSittings (the record's per-course
// time), and the record's own quiz, mastered and without-proof rows (one number per fact, spec §6
// rule 2). Both files go through toCsv, so every cell gets the formula-injection guard.
//
// Time honesty (spec §6 rule 3): approximate and counted minutes are never added. Each day is one or the
// other (the cut-over day stays approximate, as on the record). Approximate minutes are the record's
// per-course sittings, each credited to the day it started (or, when the course has nothing to show
// that day, the day it ended), rounded so a course's days add up exactly to the record's minutes for
// that course. Counted minutes (learner_days) belong to the learner's whole day, so they go on a row of
// their own, "All courses", and the day's course rows leave minutes empty rather than split or repeat
// a number that was never measured per course.

import { toCsv } from "../csv";
import { parseUtc } from "../early/engine";
import { courseSittings, type LearningRecord, type MasteredRow, type QuizRow } from "./build";
import { appTitle, fill, RECORD_COPY, RECORD_DISCLAIMER } from "./copy";
import type { RecordSource } from "./sources";
import { approxMinutes, countedFrom, localDayKey, pointsIn, rangeBounds, toStored, type Bounds, type Sitting } from "./time";
import { evidenceText, withoutProofText } from "./view";

const X = RECORD_COPY.csv;

/** A self-explanation is cut to this many characters in the event log. */
export const SELF_EXPLANATION_MAX = 500;

export type MinutesKind = "approximate" | "counted";

/** One row of the daily summary. */
export interface RecordDay {
  /** Local 'YYYY-MM-DD'. */
  date: string;
  /** null on the counted-time row, which is the learner's whole day, not a course's. */
  courseId: string | null;
  course: string;
  subject: string | null;
  /** The levels of that day's quizzes, level tests and lessons (tutor messages store no level). */
  levels: number[];
  /** The record's C1 rows finished that day. */
  quizzes: QuizRow[];
  /** Answered attempts started that day and finished on a later day, or never (the days tile counts the start). */
  starts: Array<{ levelTest: boolean; finished: boolean }>;
  lessons: number;
  tutorMessages: number;
  flashcardsMade: number;
  flashcardsReviewed: number;
  /** flashcards.last_reviewed_at before capture began: the only review of a card on record then. */
  latestReviews: number;
  notes: number;
  minutes: number | null;
  minutesKind: MinutesKind | null;
  /** The record's A1 rows with quiz proof (not early signs) dated that day. */
  skillsMastered: MasteredRow[];
}

export type EventActivity = keyof typeof X.activity;

/** One row of the event log. */
export interface RecordEvent {
  /** The stored time (UTC, SQLite format) the row is dated by. */
  at: string;
  courseId: string;
  course: string;
  level: number | null;
  activity: EventActivity;
  detail: string;
  /** A pill label (the same words as the screen and the paper), or "" for a plain activity. */
  status: string;
  /** Worked out from stored rows when the file is made (a status change), not stored as it happened. */
  derived: boolean;
}

/** The record's range, judged at the moment it was built. */
function boundsOf(record: LearningRecord): Bounds {
  return rangeBounds(record.range, parseUtc(record.builtAt));
}

const dayOf = (at: string) => localDayKey(parseUtc(at));

/**
 * A flashcard's last_reviewed_at stands for a review only before capture began; from then on every
 * review has its own flashcard_reviews row, and counting both would count one review twice.
 */
const latestReviewCounts = (source: RecordSource, at: Date) => source.captureSince === null || at < parseUtc(source.captureSince);

/**
 * Split a course's whole minutes over its days by each day's share of the time, largest remainder
 * first (ties to the earlier day), so the days add up to exactly `total`.
 */
export function shareMinutes(msByDay: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const days = [...msByDay.keys()].sort();
  const ms = days.reduce((n, d) => n + msByDay.get(d)!, 0);
  const out = new Map<string, number>();
  if (ms <= 0) { for (const d of days) out.set(d, 0); return out; }
  const exact = days.map((d) => (msByDay.get(d)! / ms) * total);
  days.forEach((d, i) => out.set(d, Math.floor(exact[i])));
  let left = total - days.reduce((n, d) => n + out.get(d)!, 0);
  const order = days.map((d, i) => ({ d, frac: exact[i] - Math.floor(exact[i]), i })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { d } of order) {
    if (left <= 0) break;
    out.set(d, out.get(d)! + 1);
    left--;
  }
  return out;
}

/**
 * The daily summary's rows, oldest day first. A course appears on a day when the learner did something
 * in it that day: the days tile's activity, so the file's dates are the tile's days (a quiz started
 * before midnight and finished after it shows on both). From capture on, a card's last review is left
 * out, because its flashcard_reviews row already stands for it on the same day. On
 * a counted day an "All courses" row carries the day's counted minutes, whenever the day has activity
 * or counted minutes.
 */
export function recordDays(source: RecordSource, record: LearningRecord): RecordDay[] {
  const bounds = boundsOf(record);
  const courseById = new Map(source.courses.map((c) => [c.id, c]));
  const quizById = new Map(record.quizzes.map((q) => [q.attemptId, q]));
  const finishedOn = new Map(source.attempts.map((a) => [a.id, a.completed_at === null ? null : dayOf(a.completed_at)]));
  const rows = new Map<string, RecordDay>();
  const row = (date: string, courseId: string): RecordDay => {
    const key = `${date}|${courseId}`;
    let r = rows.get(key);
    if (!r) {
      const c = courseById.get(courseId);
      r = {
        date, courseId, course: appTitle(c?.title ?? ""), subject: c?.subject ?? null, levels: [], quizzes: [], starts: [],
        lessons: 0, tutorMessages: 0, flashcardsMade: 0, flashcardsReviewed: 0, latestReviews: 0, notes: 0, minutes: null, minutesKind: null,
        skillsMastered: [],
      };
      rows.set(key, r);
    }
    return r;
  };
  const level = (r: RecordDay, n: number | undefined) => { if (n !== undefined && !r.levels.includes(n)) r.levels.push(n); };

  for (const p of pointsIn(source, bounds)) {
    const day = localDayKey(p.at);
    switch (p.kind) {
      case "quiz_done": {
        const q = quizById.get(p.attemptId!);
        if (q) { const r = row(day, p.courseId); r.quizzes.push(q); level(r, q.level); }
        break;
      }
      case "quiz_start":
        // A start the days tile counts gets a line, unless the quiz finished the same day (its result is the line).
        if (finishedOn.get(p.attemptId!) !== day) {
          const r = row(day, p.courseId);
          r.starts.push({ levelTest: !!p.levelTest, finished: !!p.finished });
          level(r, p.level);
        }
        break;
      case "lesson": { const r = row(day, p.courseId); r.lessons++; level(r, p.level); break; }
      case "tutor": row(day, p.courseId).tutorMessages++; break;
      case "flashcard_made": row(day, p.courseId).flashcardsMade++; break;
      case "flashcard_review": row(day, p.courseId).flashcardsReviewed++; break;
      case "flashcard_last_review": if (latestReviewCounts(source, p.at)) row(day, p.courseId).latestReviews++; break;
      case "note": row(day, p.courseId).notes++; break;
    }
  }
  for (const m of record.mastered) if (!m.earlySign) row(dayOf(m.date), m.courseId).skillsMastered.push(m);

  // Approximate minutes: the record's sittings for each course, each credited to a day that has a row
  // for the course: its start day, else its end day when that is the same kind of day. Approximate time
  // never lands on a counted day, where course rows carry no minutes; failing both, the start day.
  const cut = countedFrom(source.captureSince);
  const countedKey = cut && cut < bounds.end ? localDayKey(cut) : null;
  const isCounted = (day: string) => countedKey !== null && day >= countedKey;
  const anchor = (courseId: string, s: Sitting): string => {
    const first = localDayKey(s.start);
    const last = localDayKey(s.end);
    if (rows.has(`${first}|${courseId}`)) return first;
    if (rows.has(`${last}|${courseId}`) && isCounted(last) === isCounted(first)) return last;
    return first;
  };
  for (const [courseId, list] of courseSittings(source, bounds)) {
    const ms = new Map<string, number>();
    for (const s of list) {
      const day = anchor(courseId, s);
      ms.set(day, (ms.get(day) ?? 0) + (s.end.getTime() - s.start.getTime()));
    }
    for (const [day, minutes] of shareMinutes(ms, approxMinutes(list))) {
      if (isCounted(day)) continue;
      const r = row(day, courseId);
      r.minutes = minutes;
      r.minutesKind = "approximate";
    }
  }
  for (const r of rows.values()) {
    if (!isCounted(r.date) && r.minutesKind === null) { r.minutes = 0; r.minutesKind = "approximate"; }
  }

  // Counted minutes: one row per counted day, for the learner.
  const startKey = localDayKey(bounds.start);
  const endKey = localDayKey(bounds.end);
  const counted = new Map<string, number>();
  for (const d of source.learnerDays) {
    if (isCounted(d.day) && d.day >= startKey && d.day < endKey && d.minutes > 0) counted.set(d.day, (counted.get(d.day) ?? 0) + d.minutes);
  }
  const out = [...rows.values()];
  for (const day of new Set([...out.map((r) => r.date).filter(isCounted), ...counted.keys()])) {
    out.push({
      date: day, courseId: null, course: X.allCourses, subject: null, levels: [], quizzes: [], starts: [], lessons: 0, tutorMessages: 0,
      flashcardsMade: 0, flashcardsReviewed: 0, latestReviews: 0, notes: 0, minutes: counted.get(day) ?? 0, minutesKind: "counted", skillsMastered: [],
    });
  }
  for (const r of out) r.levels.sort((a, b) => a - b);
  return out.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.courseId === null ? 1 : 0) - (b.courseId === null ? 1 : 0) || a.course.localeCompare(b.course));
}

/** Cut to `max` characters (whole characters, never half an emoji), ending in "…" when cut. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function quizDetail(q: QuizRow): string {
  const D = X.detail;
  const result = q.score === null
    ? fill(D.result, { correct: q.correct, total: q.total })
    : fill(D.resultScore, { correct: q.correct, total: q.total, score: Math.round(q.score) });
  const extra = [
    ...(q.passed === null ? [] : [q.passed ? X.day.passed : X.day.notPassed]),
    ...(q.unanswered > 0 ? [fill(RECORD_COPY.view.unansweredNote, { n: q.unanswered })] : []),
  ];
  const text = [result, ...extra].join(", ");
  return q.timedOutUnstored ? `${text} ${X.day.timedOut}` : text;
}

/**
 * The event log's rows, oldest first: the same activity as the daily summary, one row each, dated by
 * the time OpenEdu stored, plus the learner's self-explanations, plus the record's own A1 and dated A2
 * rows as status changes, worked out when the file is made. Tutor messages carry no text: the record
 * never reads what was said.
 */
export function recordEvents(source: RecordSource, record: LearningRecord): RecordEvent[] {
  const bounds = boundsOf(record);
  const titles = new Map(source.courses.map((c) => [c.id, appTitle(c.title)]));
  const quizById = new Map(record.quizzes.map((q) => [q.attemptId, q]));
  const out: RecordEvent[] = [];
  const raw = (at: string, courseId: string, level: number | null, activity: EventActivity, detail = "") =>
    out.push({ at, courseId, course: titles.get(courseId) ?? "", level, activity, detail, status: "", derived: false });

  for (const p of pointsIn(source, bounds)) {
    const at = toStored(p.at);
    switch (p.kind) {
      case "quiz_done": {
        const q = quizById.get(p.attemptId!);
        if (q) raw(at, p.courseId, q.level, q.levelTest ? "levelTest" : "quiz", quizDetail(q));
        break;
      }
      case "quiz_start": if (!p.finished) raw(at, p.courseId, p.level ?? null, p.levelTest ? "levelTest" : "quiz", X.detail.unfinished); break;
      case "lesson": raw(at, p.courseId, p.level ?? null, "lesson", appTitle(p.title ?? "")); break;
      case "tutor": raw(at, p.courseId, null, "tutor"); break;
      case "flashcard_made": raw(at, p.courseId, null, "flashcardMade"); break;
      case "flashcard_review": raw(at, p.courseId, null, "flashcardReviewed"); break;
      case "flashcard_last_review": if (latestReviewCounts(source, p.at)) raw(at, p.courseId, null, "flashcardReviewed", X.detail.latestReview); break;
      case "note": raw(at, p.courseId, null, "note", p.title ?? ""); break;
    }
  }

  // The learner's own words, dated by the attempt they were written in (the record's C2).
  const inRange = (at: string | null) => { if (!at) return false; const t = parseUtc(at); return t >= bounds.start && t < bounds.end; };
  const attempts = new Map(source.attempts.map((a) => [a.id, a]));
  for (const q of source.questions) {
    const a = attempts.get(q.attempt_id);
    const text = q.self_explanation?.trim();
    if (!a || !text || !inRange(a.completed_at)) continue;
    const sub = source.syllabuses.find((s) => s.course_id === a.course_id && s.level === a.level)?.subtopics.find((s) => s.id === q.subtopic_id);
    const said = truncate(text, SELF_EXPLANATION_MAX);
    raw(a.completed_at!, a.course_id, a.level, "selfExplanation", sub ? fill(X.detail.explanationOn, { skill: appTitle(sub.title), text: said }) : said);
  }

  const P = RECORD_COPY.pills;
  for (const m of record.mastered) {
    out.push({
      at: m.date, courseId: m.courseId, course: m.course, level: m.level, activity: "status",
      detail: `${m.skill} · ${evidenceText(m.evidence)}`, status: m.earlySign ? P.early_sign : P.mastered, derived: true,
    });
  }
  for (const w of record.withoutProof) {
    if (w.date === null) continue; // the log is dated; undated marks are on the record itself
    const { pill, why } = withoutProofText(w);
    out.push({ at: w.date, courseId: w.courseId, course: w.course, level: w.level, activity: "status", detail: `${w.skill} · ${why}`, status: P[pill], derived: true });
  }

  return out
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.at.localeCompare(y.e.at) || Number(x.e.derived) - Number(y.e.derived) || x.i - y.i)
    .map(({ e }) => e);
}

/** "quiz 8 of 10; 2 lessons first opened; 4 messages to the tutor". */
export function dayActivities(r: RecordDay): string {
  const D = X.day;
  if (r.courseId === null) return r.minutes === 0 ? X.noCountedMinutes : "";
  const parts: string[] = [];
  for (const q of r.quizzes) {
    const head = fill(q.levelTest ? D.levelTest : D.quiz, { correct: q.correct, total: q.total });
    const passed = q.passed === null ? head : `${head}, ${q.passed ? D.passed : D.notPassed}`;
    parts.push(q.timedOutUnstored ? `${passed} ${D.timedOut}` : passed);
  }
  for (const s of r.starts) parts.push(fill(s.finished ? D.finishedLater : D.unfinished, { kind: s.levelTest ? X.activity.levelTest : X.activity.quiz }));
  const count = (n: number, template: string) => { if (n > 0) parts.push(fill(template, { n })); };
  count(r.lessons, D.lessons);
  count(r.tutorMessages, D.tutor);
  count(r.flashcardsMade, D.flashcardsMade);
  count(r.flashcardsReviewed, D.flashcardsReviewed);
  count(r.latestReviews, D.latestReviews);
  count(r.notes, D.notes);
  return parts.join("; ");
}

function workedOut(record: LearningRecord): string {
  return fill(X.workedOut, { date: dayOf(record.builtAt) });
}

/** The last row's text: the full disclaimer and how the file's rows were made (and, daily, how its minutes were). */
export function disclaimerCell(daily: boolean): string {
  return [RECORD_DISCLAIMER, X.statementFile, ...(daily ? [X.timeNote] : [])].join(" ");
}

/** The disclaimer row, in the widest text column (activities, detail). */
function disclaimerRow(columns: ReadonlyArray<string>, column: string, daily: boolean): string[] {
  return columns.map((c) => (c === column ? disclaimerCell(daily) : ""));
}

/** The daily summary file. Every row is a day total, so every row is worked out from stored rows. */
export function recordDailyCsv(record: LearningRecord, days: ReadonlyArray<RecordDay>): string {
  const by = workedOut(record);
  const rows: Array<Array<string | number | null>> = [[...X.dailyColumns]];
  for (const r of days) {
    rows.push([
      r.date,
      r.course,
      r.courseId === null ? "" : r.subject ?? RECORD_COPY.noSubject,
      r.levels.join(", "),
      dayActivities(r),
      r.minutes,
      r.minutesKind === null ? "" : X[r.minutesKind],
      r.skillsMastered.map((m) => fill(RECORD_COPY.view.levelOnly, { level: m.level }) + `: ${m.skill}`).join("; "),
      by,
    ]);
  }
  rows.push(disclaimerRow(X.dailyColumns, "activities", true));
  return toCsv(rows);
}

/** The local "HH:MM" of a stored time. */
function localTime(at: string): string {
  const d = parseUtc(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The event log file. */
export function recordEventCsv(record: LearningRecord, events: ReadonlyArray<RecordEvent>): string {
  const by = workedOut(record);
  const rows: Array<Array<string | number | null>> = [[...X.eventColumns]];
  for (const e of events) {
    rows.push([dayOf(e.at), localTime(e.at), e.course, e.level, X.activity[e.activity], e.detail, e.status, e.derived ? by : X.storedWhen]);
  }
  rows.push(disclaimerRow(X.eventColumns, "detail", false));
  return toCsv(rows);
}

/** A learner's name as a piece of a file name: letters (with their marks) and digits, dashes between, lower case. */
export function fileNamePart(name: string): string {
  const part = Array.from(name.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, ""))
    .slice(0, 40).join("").replace(/-+$/, "");
  return part || "learner";
}

/** openedu-record-<name>-2026-11.csv and …-events.csv; a since-range is named from its first day. */
export function recordCsvNames(record: LearningRecord): { daily: string; events: string } {
  const r = record.range;
  const period = r.kind === "month" ? `${r.year}-${String(r.month + 1).padStart(2, "0")}` : `since-${r.from}`;
  const stem = `openedu-record-${fileNamePart(record.learner.name)}-${period}`;
  return { daily: `${stem}.csv`, events: `${stem}-events.csv` };
}
