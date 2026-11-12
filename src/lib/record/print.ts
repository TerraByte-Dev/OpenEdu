// The printed learning record (#258 PR 3b, spec §4a). Pure: everything the paper shows is worked out
// here from one LearningRecord, so page 1's caps, the cover sheet's totals and the voice rules are
// tested without a DOM. src/views/record/RecordPrint.tsx only lays these out.
//
// A printed record is, in order: the school-year cover sheet (guided and teacher, "This school year"
// only), page 1 (a fixed one-page summary), then the detail pages (sections A-C in full, flowing over
// as many pages as they need, ending with how every number is counted). The printed page always names
// the learner in the third person (spec §1 rule 4).

import { gradeLabel, normalizeGrade } from "../grade";
import type { CourseStanding, LearningRecord, MasteredRow, OwnWords } from "./build";
import { RECORD_COPY, RECORD_DISCLAIMER, RECORD_DISCLAIMER_SHORT, RECORD_FORMAT, fill } from "./copy";
import { toStored } from "./time";
import {
  approxShown, approxTimeText, dayText, durationText, earlySignCount, masteredCount, splitAtCount, standingCounts, whenText,
  type Audience,
} from "./view";

const C = RECORD_COPY;
const V = RECORD_COPY.view;
const P = RECORD_COPY.print;

/** Page 1 lists at most this many mastered skills and courses; the rest are counted in "+N more". */
export const PAGE1_CAPS = { mastered: 6, courses: 4 } as const;
/** Page 1 shortens titles to these lengths so every row stays one line (the detail pages print them whole). */
export const PAGE1_TEXT_MAX = { skill: 40, meta: 52, course: 32 } as const;
/** C2 on paper: the newest few (spec §2 C2). */
export const PRINT_OWN_WORDS_MAX = 3;

/** The default learner's name from migration 14. Saving a record still named this asks for a name first. */
export const DEFAULT_LEARNER_NAME = "Learner 1";

/**
 * Spec §1 rule 5: Save asks for a name and grade first while the learner is still 'Learner 1' or has no
 * grade. A missing grade only asks when whoever is saving may set it: in a class or school a learner
 * cannot (Settings sits behind the teacher PIN), so their own record asks for the name alone.
 */
export function needsNameCheck(learner: { name: string; grade: number | null }, canSetGrade = true): boolean {
  return learner.name.trim() === DEFAULT_LEARNER_NAME || (canSetGrade && normalizeGrade(learner.grade) === null);
}

/** Nothing to detail: no course and no day with learning. Such a record prints page 1 alone. */
export function isEmptyRecord(record: LearningRecord): boolean {
  return record.courses.length === 0 && record.days === 0 && record.quizzes.length === 0;
}

/** Shorten to `max` characters with an ellipsis. Page 1 only; nothing is shortened in the detail pages. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

// ── Which sections print, by voice ──────────────────────────────────────────────────────────────────

export interface PrintPlan {
  /** The school-year cover sheet: guided and teacher, on a since-range only. Never in the self voice (H5). */
  cover: boolean;
  /** Section D. The reflection prompts print in every voice; the rest only for a grown-up reader. */
  otherLearning: boolean;
  reflection: true;
  grownUpNotes: boolean;
  /** On page 1, unless the cover sheet already carries it (one signature per record). */
  attestation: boolean;
  /** B4, in the detail pages. */
  talkAboutIt: boolean;
  disclaimer: "full" | "short";
}

export function printPlan(range: LearningRecord["range"], audience: Audience): PrintPlan {
  const grown = audience !== "self";
  const cover = grown && range.kind === "since";
  return {
    cover, otherLearning: grown, reflection: true, grownUpNotes: grown, attestation: grown && !cover,
    talkAboutIt: grown, disclaimer: grown ? "full" : "short",
  };
}

export function disclaimerFor(plan: PrintPlan): string {
  return plan.disclaimer === "full" ? RECORD_DISCLAIMER : RECORD_DISCLAIMER_SHORT;
}

/** The primary button: "Save November's record", or the school-year / since-you-started equivalent. */
export function saveLabel(record: LearningRecord, audience: Audience): string {
  if (record.range.kind === "month") return fill(P.save, { month: record.period.label.split(" ")[0] });
  return audience === "self" ? P.saveSince : P.saveYear;
}

export function learnerName(record: LearningRecord): string {
  return record.learner.name.trim() || "Learner";
}

// ── Header (H1-H4) ──────────────────────────────────────────────────────────────────────────────────

export interface PrintHeader {
  kicker: string;
  title: string;
  /** "Grade 3 · November 2026 · Nov 1 – Nov 30". */
  sub: string;
  /** "Printed Nov 11, 2026 · Record format 1". */
  printed: string;
  /**
   * H4 for a past month: "Saved Dec 1, 2026 from the activity on record then." for a saved month, or
   * "Built Dec 2, 2026 from the activity still on record." for one with no saved copy.
   */
  built: string | null;
  /** A saved month whose course was deleted since: "Examples from deleted courses are no longer on this computer." */
  gone: string | null;
  /** K and grade 1: where the early-learner screens' activities are, as the screen says it. */
  note: string | null;
}

/** H4's provenance line, the same on screen and paper: saved, built now for a past range, or none for the current one. */
export function provenance(record: LearningRecord): string | null {
  if (record.saved) return fill(C.savedThen, { date: dayText(record.saved.at, true) });
  return record.current ? null : fill(C.builtFromCurrent, { date: dayText(record.builtAt, true) });
}

export function printHeader(record: LearningRecord, now: Date, kicker: string): PrintHeader {
  const grade = normalizeGrade(record.learner.grade);
  const today = dayText(toStored(now), true);
  return {
    kicker,
    title: fill(V.namedRecord, { name: learnerName(record) }),
    sub: [grade === null ? C.gradeNotSet : gradeLabel(grade), record.period.label, record.period.span].filter(Boolean).join(" · "),
    printed: fill(C.printed, { date: today, format: RECORD_FORMAT }),
    built: provenance(record),
    gone: record.saved?.examplesGone ? C.examplesGone : null,
    note: grade === 0 || grade === 1 ? V.earlyNote : null,
  };
}

// ── Page 1 ──────────────────────────────────────────────────────────────────────────────────────────

export interface TileText { big: string; rest: string; extra: string | null }

export interface Page1Mastered { skill: string; meta: string; early: boolean }

export type Page1Course =
  | { kind: "levels"; course: string; level: string; mastered: string; early: number; learning: number }
  | { kind: "note"; course: string; note: string };

export interface Page1 {
  header: PrintHeader;
  tiles: { days: TileText; time: TileText; mastered: TileText };
  masteredHead: string;
  mastered: Page1Mastered[];
  masteredMore: string | null;
  standHead: string;
  courses: Page1Course[];
  coursesMore: string | null;
  plan: PrintPlan;
  otherLearningHead: string;
  disclaimer: string;
  /** Detail pages follow (not for an empty record), so the footer points to the rules at their end. */
  detail: boolean;
}

function more(total: number, shown: number): string | null {
  return total > shown ? fill(P.more, { n: total - shown }) : null;
}

/** Quiz-checked rows first, then early signs, each by date: the page leads with proof. */
function proofFirst(rows: ReadonlyArray<MasteredRow>): MasteredRow[] {
  return [...rows.filter((m) => !m.earlySign), ...rows.filter((m) => m.earlySign)];
}

function page1Course(c: CourseStanding): Page1Course {
  const course = clip(c.course, PAGE1_TEXT_MAX.course);
  if (c.legacy) return { kind: "note", course, note: C.levels.legacy };
  if (c.level === null) return { kind: "note", course, note: C.levels.notRecorded };
  const n = standingCounts(c);
  const finished = c.status === "completed" || c.status === "archived";
  return {
    kind: "levels", course,
    level: finished ? `${fill(V.levelOnly, { level: c.level })} · ${P.finished}` : fill(V.levelOnly, { level: c.level }),
    mastered: `${n.mastered} of ${n.total}`, early: n.early, learning: n.learning,
  };
}

export function page1(record: LearningRecord, audience: Audience, now: Date): Page1 {
  const plan = printPlan(record.range, audience);
  const approx = approxShown(record.time);
  const counted = record.time.counted;
  const approxText = approx ? approxTimeText(approx).split(" · ") : null;
  const countedText = counted ? fill(C.tiles.time_counted, { n: counted.minutes }) : null;
  const time: TileText = approxText
    ? { big: approxText[0], rest: `${approxText[1]} · ${V.approxPill}`, extra: countedText }
    : { ...splitAtCount(countedText!, counted!.minutes), extra: null };
  const early = earlySignCount(record);
  const rows = proofFirst(record.mastered);
  const mastered = (cap: number) => ({
    mastered: rows.slice(0, cap).map((m) => ({
      skill: clip(m.skill, PAGE1_TEXT_MAX.skill),
      meta: clip(`${m.earlySign ? `${C.pills.early_sign} · ` : ""}${m.course} · ${fill(V.levelOnly, { level: m.level })} · ${dayText(m.date)}`, PAGE1_TEXT_MAX.meta),
      early: m.earlySign,
    })),
    masteredMore: more(rows.length, cap),
  });
  const p: Page1 = {
    header: printHeader(record, now, P.kicker),
    tiles: {
      days: { ...splitAtCount(fill(C.tiles.days, { n: record.days }), record.days), extra: null },
      time,
      mastered: { big: String(masteredCount(record)), rest: C.tiles.mastered, extra: early > 0 ? fill(C.tiles.earlySigns, { n: early }) : null },
    },
    masteredHead: fill(V.masteredHead, { who: learnerName(record), when: whenText(record) }),
    ...mastered(PAGE1_CAPS.mastered),
    standHead: V.standHead,
    courses: record.courses.slice(0, PAGE1_CAPS.courses).map(page1Course),
    coursesMore: more(record.courses.length, PAGE1_CAPS.courses),
    plan,
    otherLearningHead: record.range.kind === "month" ? C.writeIn.otherLearning : C.writeIn.otherLearningPeriod,
    disclaimer: disclaimerFor(plan),
    detail: !isEmptyRecord(record),
  };
  // Extra header lines (a saved month's, a K-1 note) can push a full page over: give up a row of
  // mastered skills at a time, which then show as "+N more in the detail pages".
  for (let cap = PAGE1_CAPS.mastered - 2; cap > 0 && page1HeightPx(p) > PAGE1_CONTENT_PX; cap -= 2) Object.assign(p, mastered(cap));
  return p;
}

// ── Page 1's height, worked out from the print stylesheet's fixed metrics ───────────────────────────
// index.css (.rec-sheet and friends) sets every font size, line height, padding and ruled-line pitch on
// page 1 in px; these mirror them. Every row on page 1 is one line (nowrap and an ellipsis), so the only
// wrapping text is the printed line and the footer, estimated by characters per line. The live check
// compares this with the rendered page (scrollHeight) and a saved PDF.

/** The printable height inside page 1's padding: a 10.95in sheet (index.css) less 0.55in top and bottom. */
export const PAGE1_CONTENT_PX = (10.95 - 1.1) * 96;

const M = {
  kickerRow: 16, h1: 30, sub: 18, line11: 15, gapSmall: 4,
  tilesTop: 12, tileChrome: 18, tileBig: 24, tileLine: 15,
  sectionHead: 38, masteredRow: 30, masteredGap: 6, moreLine: 19,
  theadRow: 21, tableRow: 23,
  writeTop: 14, writeHead: 16, ruled: 22, prompt: 15, promptGap: 4, writeGap: 10, attestText: 15, signRow: 28,
  footTop: 13, foot: 13, footGap: 3, footChars: 110, printedChars: 100,
  field: 30, totalsRow: 21, coverThead: 33, coverRow: 21, coverAll: 22, noteTop: 4, noteLine: 14, noteChars: 115,
} as const;

const linesOf = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));

function headerPx(h: PrintHeader): number {
  return M.kickerRow + M.gapSmall + M.h1 + M.sub + [h.built, h.gone, h.note].reduce((px, t) => px + (t ? M.line11 * linesOf(t, M.printedChars) : 0), 0);
}

function writeInPx(plan: PrintPlan): number {
  const prompts = C.writeIn.reflection.length * (M.prompt + M.ruled + M.promptGap);
  const reflection = M.writeHead + prompts;
  let px = M.writeTop + (plan.otherLearning ? Math.max(M.writeHead + 6 * M.ruled, reflection) : reflection);
  if (plan.grownUpNotes) px += M.writeGap + M.writeHead + 2 * M.ruled;
  if (plan.attestation) px += M.writeGap + 2 * M.attestText + M.signRow;
  return px;
}

function footerPx(disclaimer: string): number {
  return M.footTop + M.foot * (linesOf(C.authorship, M.footChars) + linesOf(disclaimer, M.footChars) + linesOf(P.rulesPointer, M.footChars)) + 2 * M.footGap;
}

/** Page 1's content height in px, from the same caps the page prints with. */
export function page1HeightPx(p: Page1): number {
  const extras = Math.max(...Object.values(p.tiles).map((t) => (t.extra ? 1 : 0)));
  const tiles = M.tilesTop + M.tileChrome + M.tileBig + M.tileLine * (1 + extras);
  const rows = Math.ceil(p.mastered.length / 2);
  const mastered = M.sectionHead + (rows ? rows * M.masteredRow + (rows - 1) * M.masteredGap : M.tileLine) + (p.masteredMore ? M.moreLine : 0);
  const courses = M.sectionHead + (p.courses.length ? M.theadRow + p.courses.length * M.tableRow : M.tileLine) + (p.coursesMore ? M.moreLine : 0);
  return headerPx(p.header) + tiles + mastered + courses + writeInPx(p.plan) + footerPx(p.disclaimer);
}

// ── The school-year cover sheet ─────────────────────────────────────────────────────────────────────

export interface CoverCourse { courseId: string; course: string; mastered: number; levels: number; quizzes: number; minutes: number }
export interface CoverSubject { subject: string | null; mastered: number; levels: number; quizzes: number; minutes: number; courses: CoverCourse[] }
/** "All courses" has no time: approximate per-course minutes are never summed into a rival to the time total. */
export interface CoverTotals { subjects: CoverSubject[]; all: Omit<CoverSubject, "subject" | "courses" | "minutes"> }

/**
 * Totals by subject and course, from the builder's own rows: quiz-checked A1 rows (not early signs), A4
 * passes, C1 attempts and C4 approximate minutes. The "All courses" row is the sum of the subjects, and
 * equals the builder's counts. It carries no time (owner ruling): the per-course minutes are the
 * approximate method over the whole period, and a sum of them would compete with the time total, which
 * keeps approximate and counted time apart.
 */
export function coverTotals(record: LearningRecord): CoverTotals {
  const byCourse = new Map<string, CoverCourse & { subject: string | null }>();
  const entry = (courseId: string, course: string, subject: string | null) => {
    let e = byCourse.get(courseId);
    if (!e) { e = { courseId, course, subject, mastered: 0, levels: 0, quizzes: 0, minutes: 0 }; byCourse.set(courseId, e); }
    return e;
  };
  for (const c of record.courses) entry(c.courseId, c.course, c.subject);
  const subjectOf = (id: string) => record.courses.find((c) => c.courseId === id)?.subject ?? null;
  for (const m of record.mastered) if (!m.earlySign) entry(m.courseId, m.course, subjectOf(m.courseId)).mastered++;
  for (const p of record.levelsPassed) entry(p.courseId, p.course, subjectOf(p.courseId)).levels++;
  for (const q of record.quizzes) entry(q.courseId, q.course, subjectOf(q.courseId)).quizzes++;
  for (const g of record.timeBySubject) for (const c of g.courses) entry(c.courseId, c.course, g.subject).minutes += c.minutes;

  const subjects: CoverSubject[] = [];
  for (const e of byCourse.values()) {
    let s = subjects.find((x) => x.subject === e.subject);
    if (!s) { s = { subject: e.subject, mastered: 0, levels: 0, quizzes: 0, minutes: 0, courses: [] }; subjects.push(s); }
    const { subject: _subject, ...course } = e;
    s.courses.push(course);
    s.mastered += e.mastered; s.levels += e.levels; s.quizzes += e.quizzes; s.minutes += e.minutes;
  }
  subjects.sort((a, b) => (a.subject === null ? 1 : 0) - (b.subject === null ? 1 : 0) || (a.subject ?? "").localeCompare(b.subject ?? ""));
  for (const s of subjects) s.courses.sort((a, b) => a.course.localeCompare(b.course));
  const all = subjects.reduce(
    (t, s) => ({ mastered: t.mastered + s.mastered, levels: t.levels + s.levels, quizzes: t.quizzes + s.quizzes }),
    { mastered: 0, levels: 0, quizzes: 0 },
  );
  return { subjects, all };
}

export interface CoverSheet {
  header: PrintHeader;
  fields: ReadonlyArray<string>;
  totals: Array<{ label: string; value: string }>;
  table: CoverTotals;
  /** False when listing each course would run past the sheet (coverHeightPx): subject rows only, courses in the detail pages. */
  withCourses: boolean;
  timeNote: string;
  disclaimer: string;
}

/** The cover sheet's content height in px, from the same metrics (index.css .rec-cover). Every table row is one line. */
export function coverHeightPx(c: CoverSheet): number {
  const s = c.table.subjects;
  const rows = s.length + (c.withCourses ? s.reduce((n, x) => n + x.courses.length, 0) : 0);
  const note = c.timeNote + (c.withCourses ? "" : ` ${P.cover.subjectsOnly}`);
  return headerPx(c.header)
    + M.sectionHead + c.fields.length * M.field
    + M.sectionHead + Math.ceil((c.totals.length - 1) / 2) * M.totalsRow + M.totalsRow
    + M.sectionHead + M.coverThead + rows * M.coverRow + M.coverAll + M.noteTop + M.noteLine * linesOf(note, M.noteChars)
    + M.writeTop + 2 * M.attestText + M.signRow
    + footerPx(c.disclaimer);
}

export function coverSheet(record: LearningRecord, now: Date): CoverSheet {
  const approx = approxShown(record.time);
  const time = [
    ...(approx ? [`${fill(V.about, { time: durationText(approx.minutes) })} (${V.approxPill})`] : []),
    ...(record.time.counted ? [fill(C.tiles.time_counted, { n: record.time.counted.minutes })] : []),
  ].join(" · ");
  const table = coverTotals(record);
  const sheet: CoverSheet = {
    header: printHeader(record, now, P.coverKicker),
    fields: C.writeIn.coverFields,
    // Time last: its approximate and counted parts can need the full width.
    totals: [
      { label: P.cover.days, value: splitAtCount(fill(C.tiles.days, { n: record.days }), record.days).big },
      { label: P.cover.mastered, value: String(masteredCount(record)) },
      { label: P.cover.levels, value: String(record.levelsPassed.length) },
      { label: P.cover.early, value: String(earlySignCount(record)) },
      { label: P.cover.quizzes, value: String(record.quizzes.length) },
      { label: P.cover.time, value: time },
    ],
    table,
    withCourses: true,
    timeNote: record.time.counted ? P.cover.timeNoteCounted : P.cover.timeNote,
    disclaimer: RECORD_DISCLAIMER,
  };
  return { ...sheet, withCourses: coverHeightPx(sheet) <= PAGE1_CONTENT_PX };
}

// ── The detail pages ────────────────────────────────────────────────────────────────────────────────

/**
 * What the detail pages print: sections A-C of the record in full. The only cut is C2, the learner's
 * own words, where paper shows the newest few (spec §2 C2); B4 prints for a grown-up reader only.
 */
export function detailPages(record: LearningRecord, audience: Audience) {
  const plan = printPlan(record.range, audience);
  const ownWords: OwnWords[] = record.ownWords.slice(0, PRINT_OWN_WORDS_MAX);
  return {
    mastered: proofFirst(record.mastered),
    withoutProof: record.withoutProof,
    rechecked: record.rechecked,
    levelsPassed: record.levelsPassed,
    courses: record.courses,
    learning: record.learning,
    hardOnes: record.hardOnes,
    talkAboutIt: plan.talkAboutIt ? record.talkAboutIt : null,
    quizzes: record.quizzes,
    startedNotFinished: record.startedNotFinished,
    ownWords,
    ownWordsNote: record.ownWords.length > ownWords.length ? fill(P.ownWordsShown, { shown: ownWords.length, n: record.ownWords.length }) : null,
    activity: record.activity,
    timeBySubject: record.timeBySubject,
    disclaimer: disclaimerFor(plan),
  };
}
