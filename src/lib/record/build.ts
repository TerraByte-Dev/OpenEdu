// The learning record (#258): learningRecord(source, range) turns one learner's stored rows into every
// number, status and list the record shows (spec §2). Pure and deterministic: no model call, no DOM,
// no Tauri. Statuses are judged from the rows up to the end of the range, through the replay
// (replay.ts), never from today's syllabus flags, except where the spec asks for the current month.
// Every date in the result is a stored-format string, so the record survives JSON.

import { parseUtc } from "../early/engine";
import { MASTERY_THRESHOLD } from "../mastery";
import { checkAnswerConsistency } from "../quiz-grading";
import { appTitle, RECORD_FORMAT } from "./copy";
import { notProof, replaySubtopics, skillKey, type GraderSplit, type NotProof, type SkillCheck } from "./replay";
import {
  activityPoints, approxMinutes, countedFrom, localDayKey, rangeBounds, rangeLabel, sittings, timeSpans, toStored,
  type RecordRange, type Span,
} from "./time";
import type { RecordAttempt, RecordCourse, RecordQuestion, RecordSource, RecordSubtopicEvent, RecordSyllabus } from "./sources";

/** Mastered on fewer questions than this is an early sign, kept out of the mastered count. */
export const PROOF_MIN_QUESTIONS = 3;
/** A hard one: at least this many questions on the skill in the range… */
export const HARD_MIN_QUESTIONS = 3;
/** …and under this share right. */
export const HARD_BELOW = 0.7;
/** The most hard ones shown, and missed items under each. */
const HARD_MAX = 3;
const MISSED_MAX = 2;
const NEXT_UP_MAX = 3;
/** A level test score below this cannot have passed (PromotionTestFullScreen didPass). */
const PASS_SCORE = 85;

export interface SkillRef {
  courseId: string;
  course: string;
  level: number;
  skillId: string;
  skill: string;
}

export interface Evidence {
  correct: number;
  total: number;
  levelTest: boolean;
  graders: GraderSplit;
}

/** A1: a skill whose first replayed mastery falls in the range and counts as proof. */
export interface MasteredRow extends SkillRef {
  date: string;
  /** Fewer than PROOF_MIN_QUESTIONS questions: shown as an early sign, not counted as mastered. */
  earlySign: boolean;
  evidence: Evidence;
}

export type WithoutProofReason = "tutor" | "keyword" | NotProof | "no_proof";

/** A2: mastered in the app without quiz proof. date is null when nothing on record dates it. */
export interface WithoutProofRow extends SkillRef {
  date: string | null;
  reason: WithoutProofReason;
  /** Answers on the skill passed because the grader failed ("fallback" only). */
  fallbackAnswers: number;
}

export interface LevelPass {
  courseId: string;
  course: string;
  level: number;
  date: string | null;
}

export type SkillStatus = "mastered" | "early_sign" | "learning" | "tutor" | "keyword" | "no_proof" | "not_yet";

export interface SkillLine {
  level: number;
  skillId: string;
  skill: string;
  status: SkillStatus;
  /** Mastered, then under 90% later (mastery.ts review_needed). */
  reviewAgain: boolean;
}

export interface CourseStanding {
  courseId: string;
  course: string;
  subject: string | null;
  status: RecordCourse["status"];
  /** A fractional current_level: activity counts, levels and skills are not tracked. */
  legacy: boolean;
  /** The level at range end; null for a legacy course or when a pass before it is undated. */
  level: number | null;
  levelTitle: string | null;
  objectives: string[];
  skills: SkillLine[];
  counts: Record<SkillStatus, number>;
  /** Current range only: how the app's mastered count splits (B1 reconciliation line). */
  reconciliation: { shown: number; checked: number; early: number; without: number } | null;
}

export interface LearningLine extends SkillRef {
  correct: number;
  total: number;
}

export interface HardOne extends LearningLine {
  missed: Array<{ question: string; answered: string; key: string }>;
}

export interface QuizRow {
  attemptId: string;
  date: string;
  courseId: string;
  course: string;
  level: number;
  levelTest: boolean;
  /** As the app scored the attempt. */
  correct: number;
  total: number;
  score: number | null;
  /** Level tests always; quizzes only once capture began (migration 18 stores their time). */
  seconds: number | null;
  /** Level tests from migration 18. */
  passed: boolean | null;
  /** A level test whose stored rows fall short of its questions: it timed out before migration 18. */
  timedOutUnstored: boolean;
  unanswered: number;
}

export interface OwnWords {
  date: string;
  courseId: string;
  course: string;
  kind: "self_explanation" | "note";
  /** The skill a self-explanation was written on, or null. */
  skill: string | null;
  /** A note's title, or null. */
  title: string | null;
  text: string;
}

export interface TimeTotals {
  /** Days before the first full day of counted time (the cut-over day stays here). */
  approx: { minutes: number; sittings: number } | null;
  /** learner_days, from the first full day after capture began. Never added to approx. */
  counted: { minutes: number } | null;
}

export interface LearningRecord {
  format: number;
  /** When this record was worked out (stored format, UTC). */
  builtAt: string;
  /** The range contains today. */
  current: boolean;
  learner: { id: string; name: string; grade: number | null; recordVoice: "self" | "guided" | null };
  range: RecordRange;
  period: { label: string; span: string; from: string; to: string };
  /** T1: distinct local days with learning, a lower bound. */
  days: number;
  /** T2. */
  time: TimeTotals;
  /** A1 (T3 counts the rows that are not early signs). */
  mastered: MasteredRow[];
  /** A2. */
  withoutProof: WithoutProofRow[];
  /** A3: distinct skills proved before the range and checked again in it. */
  rechecked: { held: SkillRef[]; slipped: SkillRef[] };
  /** A4. */
  levelsPassed: LevelPass[];
  /** B1, ordered by subject then title. */
  courses: CourseStanding[];
  /** B2. */
  learning: LearningLine[];
  /** B3, worst first. */
  hardOnes: HardOne[];
  /** B4 (the view shows it in the guided voice and the teacher view only). */
  talkAboutIt: { explain: Array<SkillRef & { selfExplanation: string | null }>; nextUp: LearningLine[] };
  /** C1. */
  quizzes: QuizRow[];
  startedNotFinished: number;
  /** C2, newest first. */
  ownWords: OwnWords[];
  /** C3. Reviews and notes are null when the range ended before capture began. */
  activity: {
    lessonsOpened: number;
    tutorMessages: number;
    tutorConversations: number;
    flashcardsMade: number;
    flashcardsMadeByApp: number;
    flashcardsReviewed: number | null;
    notesStarted: number | null;
    coursesStarted: Array<{ courseId: string; course: string; date: string }>;
  };
  /** C4: the approximate method per course over the whole range, summed per subject. */
  timeBySubject: Array<{ subject: string | null; minutes: number; courses: Array<{ courseId: string; course: string; minutes: number; sittings: number }> }>;
}

const emptyCounts = (): Record<SkillStatus, number> =>
  ({ mastered: 0, early_sign: 0, learning: 0, tutor: 0, keyword: 0, no_proof: 0, not_yet: 0 });

const questionKey = (text: string) => text.trim().toLowerCase();

/** Answers the record counts as attempts at the skill: a timed-out test's unanswered rows are not. */
const answeredOnly = (qs: ReadonlyArray<RecordQuestion>) => qs.filter((q) => q.graded_by !== "unanswered");
const rightOf = (qs: ReadonlyArray<RecordQuestion>) => qs.filter((q) => q.is_correct === 1).length;

const bySubjectThenTitle = (a: { subject: string | null; course: string }, b: { subject: string | null; course: string }) =>
  (a.subject === null ? 1 : 0) - (b.subject === null ? 1 : 0) || (a.subject ?? "").localeCompare(b.subject ?? "") || a.course.localeCompare(b.course);

/**
 * Every level a course has passed, with the date when one is on record. From migration 18 a pass is
 * stored (passed = 1). Before it, a level counts as passed when the course moved past it (or, for
 * level 6, finished), dated by the latest level test at that level that scored high enough to pass.
 */
function coursePasses(course: RecordCourse, attempts: ReadonlyArray<RecordAttempt>): Array<{ level: number; date: string | null }> {
  const out: Array<{ level: number; date: string | null }> = [];
  for (let level = 1; level <= 6; level++) {
    const tests = attempts
      .filter((a) => a.quiz_type === "promotion" && a.level === level && a.completed_at !== null)
      .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!));
    const stored = tests.find((a) => a.passed === 1);
    if (stored) { out.push({ level, date: stored.completed_at }); continue; }
    const moved = course.current_level > level || (level === 6 && (course.status === "completed" || course.status === "archived"));
    if (!moved) continue;
    const couldPass = tests.filter((a) => (a.score ?? 0) >= PASS_SCORE && a.passed !== 0);
    out.push({ level, date: couldPass.length ? couldPass[couldPass.length - 1].completed_at : null });
  }
  return out;
}

/** The level at a past range's end: 1 + the passes dated before it, or null when an undated pass may fall before it. */
function levelAt(passes: ReadonlyArray<{ level: number; date: string | null }>, end: Date): number | null {
  let level = 1;
  for (const p of [...passes].sort((a, b) => a.level - b.level)) {
    if (p.level !== level) break;
    if (p.date === null) return null;
    if (parseUtc(p.date) >= end) break;
    level++;
  }
  return Math.min(level, 6);
}

export function learningRecord(source: RecordSource, range: RecordRange, now: Date = new Date()): LearningRecord {
  const { start, end } = rangeBounds(range, now);
  const current = start <= now && now < end;
  const inRange = (at: string | null): boolean => { if (!at) return false; const t = parseUtc(at); return t >= start && t < end; };
  const beforeEnd = (at: string | null): boolean => at !== null && parseUtc(at) < end;

  const courses = source.courses.filter((c) => beforeEnd(c.created_at));
  const courseById = new Map(source.courses.map((c) => [c.id, c]));
  const titleOf = (courseId: string) => appTitle(courseById.get(courseId)?.title ?? "");
  const attemptById = new Map(source.attempts.map((a) => [a.id, a]));
  const questionsByAttempt = new Map<string, RecordQuestion[]>();
  for (const q of source.questions) {
    const list = questionsByAttempt.get(q.attempt_id);
    if (list) list.push(q);
    else questionsByAttempt.set(q.attempt_id, [q]);
  }
  const answeredAttempts = new Set(source.questions.filter((q) => q.user_answer !== null).map((q) => q.attempt_id));

  const mastered: MasteredRow[] = [];
  const withoutProof: WithoutProofRow[] = [];
  const held: SkillRef[] = [];
  const slipped: SkillRef[] = [];
  const levelsPassed: LevelPass[] = [];
  const standings: CourseStanding[] = [];
  const learning: LearningLine[] = [];
  const hard: Array<HardOne & { pct: number; selfExplanation: string | null }> = [];

  for (const course of courses) {
    const courseTitle = appTitle(course.title);
    const legacy = !Number.isInteger(course.current_level);
    const base: CourseStanding = {
      courseId: course.id, course: courseTitle, subject: course.subject, status: course.status, legacy,
      level: null, levelTitle: null, objectives: [], skills: [], counts: emptyCounts(), reconciliation: null,
    };
    if (legacy) { standings.push(base); continue; }

    const attempts = source.attempts.filter((a) => a.course_id === course.id);
    const passes = coursePasses(course, attempts);
    for (const p of passes) {
      if (inRange(p.date) || (current && p.date === null)) levelsPassed.push({ courseId: course.id, course: courseTitle, level: p.level, date: p.date });
    }
    const level = current ? Math.min(6, Math.max(1, course.current_level)) : levelAt(passes, end);

    const syllabi = source.syllabuses.filter((s) => s.course_id === course.id).sort((a, b) => a.level - b.level);
    const byLevel = new Map(syllabi.map((s) => [s.level, s.subtopics]));
    const replay = replaySubtopics(
      attempts.filter((a) => beforeEnd(a.completed_at)),
      attempts.flatMap((a) => questionsByAttempt.get(a.id) ?? []),
      byLevel,
    );
    const checksByKey = new Map<string, SkillCheck[]>();
    for (const c of replay.checks) {
      const k = skillKey(c.level, c.skillId);
      const list = checksByKey.get(k);
      if (list) list.push(c);
      else checksByKey.set(k, [c]);
    }
    const events = source.subtopicEvents.filter((e) => e.course_id === course.id && beforeEnd(e.created_at));

    const skills: SkillLine[] = [];
    const counts = emptyCounts();
    let shown = 0, checked = 0, early = 0;
    for (const syl of syllabi) {
      for (const sub of syl.subtopics) {
        const ref: SkillRef = { courseId: course.id, course: courseTitle, level: syl.level, skillId: sub.id, skill: appTitle(sub.title) };
        const checks = checksByKey.get(skillKey(syl.level, sub.id)) ?? [];
        const state = replay.state.get(skillKey(syl.level, sub.id));
        const firstMastered = checks.find((c) => c.transitions.includes("mastered"));
        const block = firstMastered ? notProof(firstMastered) : null;
        const evOf = (kind: RecordSubtopicEvent["event"]) => events
          .filter((e) => e.level === syl.level && e.subtopic_id === sub.id && e.event === kind)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

        let status: SkillStatus;
        let unproven: Omit<WithoutProofRow, keyof SkillRef> | null = null;
        if (firstMastered && !block) {
          status = firstMastered.total >= PROOF_MIN_QUESTIONS ? "mastered" : "early_sign";
          if (inRange(firstMastered.at)) {
            const attempt = attemptById.get(firstMastered.attemptId)!;
            mastered.push({
              ...ref, date: firstMastered.at, earlySign: status === "early_sign",
              evidence: { correct: firstMastered.correct, total: firstMastered.total, levelTest: attempt.quiz_type === "promotion", graders: firstMastered.graders },
            });
          }
        } else if (firstMastered) {
          status = "no_proof";
          unproven = { date: firstMastered.at, reason: block!, fallbackAnswers: firstMastered.graders.fallback };
        } else if (evOf("mastered")) {
          // A tutor mark or a keyword match. The replay has not mastered the skill, so the event is not a
          // duplicate of tagged-question evidence.
          const ev = evOf("mastered")!;
          status = ev.source;
          unproven = { date: ev.created_at, reason: ev.source, fallbackAnswers: 0 };
        } else if (current && sub.mastered) {
          status = "no_proof";
          unproven = { date: null, reason: "no_proof", fallbackAnswers: 0 };
        } else if (state?.practiced || events.some((e) => e.source === "keyword" && e.level === syl.level && e.subtopic_id === sub.id)) {
          status = "learning";
        } else {
          status = "not_yet";
        }
        // Listed when it happened in the range; in the current month, every skill the app shows as
        // mastered without proof is listed, so the reconciliation line adds up.
        if (unproven && (inRange(unproven.date) || (current && sub.mastered))) withoutProof.push({ ...ref, ...unproven });

        const reviewAgain = (status === "mastered" || status === "early_sign") && !!state?.review_needed;
        skills.push({ level: syl.level, skillId: sub.id, skill: ref.skill, status, reviewAgain });
        counts[status]++;
        if (sub.mastered) {
          shown++;
          if (status === "mastered") checked++;
          if (status === "early_sign") early++;
        }

        // A3: proved before the range, and back in a quiz inside it. Exact repeats of a question
        // answered earlier on the skill are left out; a result that is not proof cannot count as held.
        if (firstMastered && !block && parseUtc(firstMastered.at) < start) {
          const seen = new Set<string>();
          let heldTimes = 0, slip = false;
          for (const c of checks) {
            const fresh = answeredOnly(c.questions).filter((q) => !seen.has(questionKey(q.question_text)));
            if (inRange(c.at) && fresh.length > 0) {
              if (rightOf(fresh) / fresh.length < MASTERY_THRESHOLD) slip = true;
              else if (notProof(c) === null) heldTimes++;
            }
            for (const q of answeredOnly(c.questions)) seen.add(questionKey(q.question_text));
          }
          if (slip) slipped.push(ref);
          else if (heldTimes > 0) held.push(ref);
        }

        const inRangeChecks = checks.filter((c) => inRange(c.at));
        // B2: practised in the range, not mastered by its end; cumulative to the range end.
        if (status === "learning" && inRangeChecks.length > 0) {
          const all = answeredOnly(checks.flatMap((c) => c.questions));
          learning.push({ ...ref, correct: rightOf(all), total: all.length });
        }
        // B3: the range's questions on the skill.
        const answered = answeredOnly(inRangeChecks.flatMap((c) => c.questions));
        if (answered.length >= HARD_MIN_QUESTIONS && rightOf(answered) / answered.length < HARD_BELOW) {
          const missed = answered
            .filter((q) => q.is_correct === 0 && q.user_answer !== null && q.graded_by !== "model" && q.graded_by !== "fallback")
            .filter((q) => checkAnswerConsistency({ question_text: q.question_text, question_type: q.question_type, correct_answer: q.correct_answer, explanation: q.explanation }) === null)
            .reverse()
            .slice(0, MISSED_MAX)
            .map((q) => ({ question: q.question_text, answered: q.user_answer!, key: q.correct_answer }));
          const explained = inRangeChecks.flatMap((c) => c.questions).map((q) => q.self_explanation?.trim() ?? "").filter(Boolean);
          hard.push({
            ...ref, correct: rightOf(answered), total: answered.length, missed,
            pct: rightOf(answered) / answered.length, selfExplanation: explained.length ? explained[explained.length - 1] : null,
          });
        }
      }
    }

    const levelSyl: RecordSyllabus | undefined = level === null ? undefined : syllabi.find((s) => s.level === level);
    standings.push({
      ...base, level, levelTitle: levelSyl ? appTitle(levelSyl.title) : null,
      objectives: (levelSyl?.learning_objectives ?? []).map(appTitle), skills, counts,
      reconciliation: current ? { shown, checked, early, without: shown - checked - early } : null,
    });
  }

  hard.sort((a, b) => a.pct - b.pct || b.total - a.total);
  const hardOnes: HardOne[] = hard.slice(0, HARD_MAX).map(({ pct: _pct, selfExplanation: _s, ...h }) => h);

  // ── C1 ──
  const quizzes: QuizRow[] = source.attempts
    .filter((a) => courseById.has(a.course_id) && inRange(a.completed_at))
    .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!))
    .map((a) => {
      const rows = questionsByAttempt.get(a.id) ?? [];
      const levelTest = a.quiz_type === "promotion";
      const quizTimed = source.captureSince !== null && a.started_at >= source.captureSince;
      return {
        attemptId: a.id, date: a.completed_at!, courseId: a.course_id, course: titleOf(a.course_id), level: a.level, levelTest,
        correct: a.correct_count, total: a.total_questions, score: a.score,
        seconds: levelTest || quizTimed ? a.time_taken_seconds : null,
        passed: a.passed === null ? null : a.passed === 1,
        timedOutUnstored: levelTest && rows.length < a.total_questions,
        unanswered: rows.filter((q) => q.graded_by === "unanswered").length,
      };
    });
  const startedNotFinished = source.attempts.filter((a) => a.completed_at === null && inRange(a.started_at) && answeredAttempts.has(a.id)).length;

  // ── C2 ──
  const skillTitle = (courseId: string, level: number, id: string | null): string | null => {
    const sub = source.syllabuses.find((s) => s.course_id === courseId && s.level === level)?.subtopics.find((s) => s.id === id);
    return sub ? appTitle(sub.title) : null;
  };
  const ownWords: OwnWords[] = [];
  for (const q of source.questions) {
    const a = attemptById.get(q.attempt_id);
    const text = q.self_explanation?.trim();
    if (!a || !text || !inRange(a.completed_at)) continue;
    ownWords.push({ date: a.completed_at!, courseId: a.course_id, course: titleOf(a.course_id), kind: "self_explanation", skill: skillTitle(a.course_id, a.level, q.subtopic_id), title: null, text });
  }
  for (const n of source.notes) {
    if (inRange(n.created_at)) ownWords.push({ date: n.created_at, courseId: n.course_id, course: titleOf(n.course_id), kind: "note", skill: null, title: n.title, text: n.content });
  }
  ownWords.sort((a, b) => b.date.localeCompare(a.date));

  // ── C3 ──
  const captured = source.captureSince !== null && parseUtc(source.captureSince) < end;
  const chats = source.chats.filter((m) => inRange(m.created_at));
  const made = source.flashcards.filter((f) => inRange(f.created_at));
  const activity: LearningRecord["activity"] = {
    lessonsOpened: source.lessons.filter((l) => inRange(l.read_at)).length,
    tutorMessages: chats.length,
    tutorConversations: new Set(chats.map((m) => m.thread_id ?? m.course_id)).size,
    flashcardsMade: made.filter((f) => f.source === "manual").length,
    flashcardsMadeByApp: made.filter((f) => f.source !== "manual").length,
    flashcardsReviewed: captured ? source.flashcardReviews.filter((r) => inRange(r.reviewed_at)).length : null,
    notesStarted: captured ? source.notes.filter((n) => inRange(n.created_at)).length : null,
    coursesStarted: courses.filter((c) => inRange(c.created_at)).map((c) => ({ courseId: c.id, course: appTitle(c.title), date: c.created_at })),
  };

  // ── T1, T2, C4 ──
  const days = new Set(activityPoints(source).filter((p) => p.at >= start && p.at < end).map((p) => localDayKey(p.at))).size;
  const spans = timeSpans(source).filter((s) => s.start >= start && s.start < end);
  const cut = countedFrom(source.captureSince);
  const countedStart = cut && cut < end ? (cut > start ? cut : start) : null;
  const approxSpans = countedStart ? spans.filter((s) => s.start < countedStart) : spans;
  const approxSittings = sittings(approxSpans);
  const time: TimeTotals = {
    approx: countedStart && countedStart <= start ? null : { minutes: approxMinutes(approxSittings), sittings: approxSittings.length },
    counted: countedStart
      ? { minutes: source.learnerDays.filter((d) => d.day >= localDayKey(countedStart) && d.day < localDayKey(end)).reduce((s, d) => s + d.minutes, 0) }
      : null,
  };

  const perCourse = new Map<string, Span[]>();
  for (const s of spans) {
    const list = perCourse.get(s.courseId);
    if (list) list.push(s);
    else perCourse.set(s.courseId, [s]);
  }
  const subjects = new Map<string | null, LearningRecord["timeBySubject"][number]>();
  for (const c of courses) {
    const list = perCourse.get(c.id);
    if (!list) continue;
    const sit = sittings(list);
    const group = subjects.get(c.subject) ?? { subject: c.subject, minutes: 0, courses: [] };
    group.courses.push({ courseId: c.id, course: appTitle(c.title), minutes: approxMinutes(sit), sittings: sit.length });
    group.minutes += approxMinutes(sit);
    subjects.set(c.subject, group);
  }
  const timeBySubject = [...subjects.values()]
    .map((g) => ({ ...g, courses: g.courses.sort((a, b) => a.course.localeCompare(b.course)) }))
    .sort((a, b) => bySubjectThenTitle({ subject: a.subject, course: "" }, { subject: b.subject, course: "" }));

  const { label, span } = rangeLabel(range, now);
  return {
    format: RECORD_FORMAT,
    builtAt: toStored(now),
    current,
    learner: { id: source.learner.id, name: source.learner.name, grade: source.learner.grade, recordVoice: source.learner.record_voice },
    range,
    period: { label, span, from: localDayKey(start), to: localDayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)) },
    days,
    time,
    mastered: mastered.sort((a, b) => a.date.localeCompare(b.date)),
    withoutProof,
    rechecked: { held, slipped },
    levelsPassed: levelsPassed.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.level - b.level),
    courses: standings.sort(bySubjectThenTitle),
    learning,
    hardOnes,
    talkAboutIt: {
      explain: hard.slice(0, HARD_MAX).map((h) => ({ courseId: h.courseId, course: h.course, level: h.level, skillId: h.skillId, skill: h.skill, selfExplanation: h.selfExplanation })),
      nextUp: learning.slice(0, NEXT_UP_MAX),
    },
    quizzes,
    startedNotFinished,
    ownWords,
    activity,
    timeBySubject,
  };
}
