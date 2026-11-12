// The learning record as spreadsheets (#258 PR 4, spec §4b): a daily summary (one row per day per
// course) and, on request, the detailed event log (one row per event). Pure, no Tauri. The
// LearningRecord holds totals, not days or events, so recordDays and recordEvents work them out from
// the same RecordSource, judged the same way: the record's range and local days, the same scoped rows,
// and the record's own quiz, mastered and without-proof rows wherever the record already has them (one
// number per fact, spec §6 rule 2). Both files go through toCsv, so every cell gets the
// formula-injection guard.
//
// Time honesty (spec §6 rule 3): approximate and counted minutes are never added. Each day is one or the
// other (the cut-over day stays approximate, as on the record). Approximate minutes are worked out per
// course, the record's C4 method run on that day. Counted minutes (learner_days) belong to the learner's
// whole day, so they go on a row of their own, "All courses", and the day's course rows leave minutes
// empty rather than split or repeat a number that was never measured per course.

import { toCsv } from "../csv";
import { parseUtc } from "../early/engine";
import type { LearningRecord, MasteredRow, QuizRow } from "./build";
import { appTitle, fill, RECORD_COPY, RECORD_DISCLAIMER } from "./copy";
import type { RecordSource } from "./sources";
import { approxMinutes, countedFrom, localDayKey, rangeBounds, sittings, timeSpans, type Span } from "./time";
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
  /** Answered attempts started that day and finished later, or never. */
  starts: Array<{ levelTest: boolean; finished: boolean }>;
  lessons: number;
  tutorMessages: number;
  flashcardsMade: number;
  flashcardsReviewed: number;
  /** flashcards.last_reviewed_at where no review row stands for it (before migration 18). */
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

interface Scope {
  start: Date;
  end: Date;
  inRange: (at: string | null) => boolean;
  /** Local day key of the first counted day, or null when every day is approximate. */
  countedKey: string | null;
  startKey: string;
  endKey: string;
  title: (courseId: string) => string;
}

/** The record's own range, judged at the moment it was built. */
function scopeOf(source: RecordSource, record: LearningRecord): Scope {
  const now = parseUtc(record.builtAt);
  const { start, end } = rangeBounds(record.range, now);
  const cut = countedFrom(source.captureSince);
  const titles = new Map(source.courses.map((c) => [c.id, appTitle(c.title)]));
  return {
    start,
    end,
    inRange: (at) => { if (!at) return false; const t = parseUtc(at); return t >= start && t < end; },
    countedKey: cut && cut < end ? localDayKey(cut) : null,
    startKey: localDayKey(start),
    endKey: localDayKey(end),
    title: (id) => titles.get(id) ?? "",
  };
}

const dayOf = (at: string) => localDayKey(parseUtc(at));

/** flashcards.last_reviewed_at only stands for a review no flashcard_reviews row already records. */
function latestReviewStands(source: RecordSource, f: { course_id: string; last_reviewed_at: string | null }): boolean {
  if (!f.last_reviewed_at) return false;
  if (source.captureSince === null || f.last_reviewed_at < source.captureSince) return true;
  const day = dayOf(f.last_reviewed_at);
  return !source.flashcardReviews.some((r) => r.course_id === f.course_id && dayOf(r.reviewed_at) === day);
}

/**
 * The daily summary's rows, oldest day first. A course appears on a day when the learner did something
 * in it that day (the record's T1 activity). On a counted day an "All courses" row carries the day's
 * counted minutes; it is written whenever the day has activity or counted minutes.
 */
export function recordDays(source: RecordSource, record: LearningRecord): RecordDay[] {
  const scope = scopeOf(source, record);
  const courseById = new Map(source.courses.map((c) => [c.id, c]));
  const rows = new Map<string, RecordDay>();
  const row = (date: string, courseId: string): RecordDay => {
    const key = `${date}|${courseId}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        date, courseId, course: scope.title(courseId), subject: courseById.get(courseId)?.subject ?? null, levels: [], quizzes: [], starts: [],
        lessons: 0, tutorMessages: 0, flashcardsMade: 0, flashcardsReviewed: 0, latestReviews: 0, notes: 0, minutes: null, minutesKind: null,
        skillsMastered: [],
      };
      rows.set(key, r);
    }
    return r;
  };
  const known = (courseId: string) => courseById.has(courseId);
  const level = (r: RecordDay, n: number) => { if (!r.levels.includes(n)) r.levels.push(n); };

  for (const q of record.quizzes) {
    const r = row(dayOf(q.date), q.courseId);
    r.quizzes.push(q);
    level(r, q.level);
  }
  const answered = new Set(source.questions.filter((q) => q.user_answer !== null).map((q) => q.attempt_id));
  for (const a of source.attempts) {
    if (!known(a.course_id) || !answered.has(a.id) || !scope.inRange(a.started_at)) continue;
    const day = dayOf(a.started_at);
    if (a.completed_at !== null && dayOf(a.completed_at) === day) continue;
    const r = row(day, a.course_id);
    r.starts.push({ levelTest: a.quiz_type === "promotion", finished: a.completed_at !== null });
    level(r, a.level);
  }
  for (const l of source.lessons) {
    if (!known(l.course_id) || !scope.inRange(l.read_at)) continue;
    const r = row(dayOf(l.read_at), l.course_id);
    r.lessons++;
    level(r, l.level);
  }
  for (const m of source.chats) if (known(m.course_id) && scope.inRange(m.created_at)) row(dayOf(m.created_at), m.course_id).tutorMessages++;
  for (const f of source.flashcards) {
    if (!known(f.course_id)) continue;
    if (f.source === "manual" && scope.inRange(f.created_at)) row(dayOf(f.created_at), f.course_id).flashcardsMade++;
    if (scope.inRange(f.last_reviewed_at) && latestReviewStands(source, f)) row(dayOf(f.last_reviewed_at!), f.course_id).latestReviews++;
  }
  for (const v of source.flashcardReviews) if (known(v.course_id) && scope.inRange(v.reviewed_at)) row(dayOf(v.reviewed_at), v.course_id).flashcardsReviewed++;
  for (const n of source.notes) if (known(n.course_id) && scope.inRange(n.created_at)) row(dayOf(n.created_at), n.course_id).notes++;
  for (const m of record.mastered) if (!m.earlySign) row(dayOf(m.date), m.courseId).skillsMastered.push(m);

  // Approximate minutes, per course per day: the record's C4 method (sittings within one course), run on
  // the spans that start that day.
  const isCounted = (day: string) => scope.countedKey !== null && day >= scope.countedKey;
  const spans = new Map<string, Span[]>();
  for (const s of timeSpans(source)) {
    if (!known(s.courseId) || s.start < scope.start || s.start >= scope.end) continue;
    const key = `${localDayKey(s.start)}|${s.courseId}`;
    const list = spans.get(key);
    if (list) list.push(s);
    else spans.set(key, [s]);
  }
  for (const [key, list] of spans) {
    const [day, courseId] = key.split("|");
    if (isCounted(day)) continue;
    const r = row(day, courseId);
    r.minutes = approxMinutes(sittings(list));
    r.minutesKind = "approximate";
  }
  for (const r of rows.values()) {
    if (!isCounted(r.date) && r.minutesKind === null) { r.minutes = 0; r.minutesKind = "approximate"; }
  }

  // Counted minutes: one row per counted day, for the learner.
  const counted = new Map<string, number>();
  for (const d of source.learnerDays) {
    if (scope.countedKey !== null && d.day >= scope.countedKey && d.day >= scope.startKey && d.day < scope.endKey && d.minutes > 0) {
      counted.set(d.day, (counted.get(d.day) ?? 0) + d.minutes);
    }
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
 * The event log's rows, oldest first. Raw rows are dated by the time OpenEdu stored; status changes are
 * the record's own A1 and dated A2 rows, worked out when the file is made. Tutor messages carry no text:
 * the record never reads what was said.
 */
export function recordEvents(source: RecordSource, record: LearningRecord): RecordEvent[] {
  const scope = scopeOf(source, record);
  const known = new Set(source.courses.map((c) => c.id));
  const out: RecordEvent[] = [];
  const raw = (at: string, courseId: string, level: number | null, activity: EventActivity, detail = "") =>
    out.push({ at, courseId, course: scope.title(courseId), level, activity, detail, status: "", derived: false });

  for (const q of record.quizzes) raw(q.date, q.courseId, q.level, q.levelTest ? "levelTest" : "quiz", quizDetail(q));
  const answered = new Set(source.questions.filter((q) => q.user_answer !== null).map((q) => q.attempt_id));
  for (const a of source.attempts) {
    if (known.has(a.course_id) && a.completed_at === null && answered.has(a.id) && scope.inRange(a.started_at)) {
      raw(a.started_at, a.course_id, a.level, a.quiz_type === "promotion" ? "levelTest" : "quiz", X.detail.unfinished);
    }
  }
  for (const l of source.lessons) if (known.has(l.course_id) && scope.inRange(l.read_at)) raw(l.read_at, l.course_id, l.level, "lesson", appTitle(l.topic));
  for (const m of source.chats) if (known.has(m.course_id) && scope.inRange(m.created_at)) raw(m.created_at, m.course_id, null, "tutor");
  for (const f of source.flashcards) {
    if (!known.has(f.course_id)) continue;
    if (scope.inRange(f.created_at)) raw(f.created_at, f.course_id, null, "flashcardMade", f.source === "manual" ? "" : X.detail.byApp);
    if (scope.inRange(f.last_reviewed_at) && latestReviewStands(source, f)) raw(f.last_reviewed_at!, f.course_id, null, "flashcardReviewed", X.detail.latestReview);
  }
  for (const v of source.flashcardReviews) if (known.has(v.course_id) && scope.inRange(v.reviewed_at)) raw(v.reviewed_at, v.course_id, null, "flashcardReviewed");
  for (const n of source.notes) if (known.has(n.course_id) && scope.inRange(n.created_at)) raw(n.created_at, n.course_id, null, "note", n.title);

  // The learner's own words, dated by the attempt they were written in (the record's C2).
  const attempts = new Map(source.attempts.map((a) => [a.id, a]));
  for (const q of source.questions) {
    const a = attempts.get(q.attempt_id);
    const text = q.self_explanation?.trim();
    if (!a || !text || !known.has(a.course_id) || !scope.inRange(a.completed_at)) continue;
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

/** "quiz 8 of 10; 2 lessons first opened; 4 tutor messages". */
export function dayActivities(r: RecordDay): string {
  const D = X.day;
  const parts: string[] = [];
  for (const q of r.quizzes) {
    const head = fill(q.levelTest ? D.levelTest : D.quiz, { correct: q.correct, total: q.total });
    const passed = q.passed === null ? head : `${head}, ${q.passed ? D.passed : D.notPassed}`;
    parts.push(q.timedOutUnstored ? `${passed} ${D.timedOut}` : passed);
  }
  for (const s of r.starts) {
    parts.push(fill(s.finished ? D.finishedLater : D.unfinished, { kind: s.levelTest ? X.activity.levelTest : X.activity.quiz }));
  }
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

/** The last row of both files: the full disclaimer and how the file's rows were made, in one cell. */
export function disclaimerCell(): string {
  return `${RECORD_DISCLAIMER} ${X.statementFile}`;
}

/** The disclaimer row, in the widest text column (activities, detail). */
function disclaimerRow(columns: ReadonlyArray<string>, column: string): string[] {
  return columns.map((c) => (c === column ? disclaimerCell() : ""));
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
  rows.push(disclaimerRow(X.dailyColumns, "activities"));
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
  rows.push(disclaimerRow(X.eventColumns, "detail"));
  return toCsv(rows);
}

/** A learner's name as a piece of a file name: letters and digits, dashes between, lower case. */
export function fileNamePart(name: string): string {
  const part = Array.from(name.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, ""))
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
