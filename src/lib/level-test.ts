// A level test's result when some written answers were never checked. Pure: no Tauri, no DOM.
//
// A written answer no model checked (graded_by 'fallback': no local model, or the grader failed) still
// counts as right on a quiz, where the results screen marks it "?" and the learning record keeps it out
// of quiz proof. On a level test it does not count toward passing until someone marks it. Until then the
// result waits, unless the answers already decide it: the test passes even if every unchecked answer is
// wrong, or fails even if every one is right. Then nobody needs to mark them.
//
// The score the app stores and shows for a level test counts only answers something checked: the answer
// key, an exact match, the model, or the learner marking it against the key ('self').

import { answerMark, type GradedBy } from "./quiz-grading";

/** The pass rule: 85% overall and 60% on the review section (a test with no review section passes it). */
export const PASS_OVERALL = 85;
export const PASS_REVIEW = 60;

export type TestSection = "current" | "review";

export interface TestAnswer {
  section: TestSection;
  is_correct: boolean | null;
  graded_by?: GradedBy | null;
}

export type LevelTestStatus = "passed" | "failed" | "pending";

export interface LevelTestResult {
  status: LevelTestStatus;
  /** Percent right, counting only checked answers. */
  overall: number;
  /** Percent right on the review section, checked answers only; null when the test had none. */
  reviewPct: number | null;
  /** Answers checked and right. */
  correct: number;
  total: number;
  /** Written answers nothing checked. */
  unchecked: number;
}

const passes = (overall: number, review: number) => overall >= PASS_OVERALL && review >= PASS_REVIEW;
const pct = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);

export function levelTestResult(answers: ReadonlyArray<TestAnswer>): LevelTestResult {
  const count = (qs: ReadonlyArray<TestAnswer>, mark: "right" | "unchecked") => qs.filter((q) => answerMark(q) === mark).length;
  const review = answers.filter((q) => q.section === "review");
  const right = count(answers, "right");
  const open = count(answers, "unchecked");
  const reviewRight = count(review, "right");
  const reviewOpen = count(review, "unchecked");
  const reviewWith = (extra: number) => (review.length > 0 ? pct(reviewRight + extra, review.length) : 100);

  const evenIfAllWrong = passes(pct(right, answers.length), reviewWith(0));
  const evenIfAllRight = passes(pct(right + open, answers.length), reviewWith(reviewOpen));
  return {
    status: evenIfAllWrong ? "passed" : evenIfAllRight ? "pending" : "failed",
    overall: pct(right, answers.length),
    reviewPct: review.length > 0 ? pct(reviewRight, review.length) : null,
    correct: right,
    total: answers.length,
    unchecked: open,
  };
}

/** How long after a failed level test it can be taken again. */
export const RETAKE_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * The wait left before a failed level test can be taken again, as "5h 12m" or "12m", or "" when it is
 * over. `completedAt` is the attempt's completed_at, SQLite's datetime('now'): UTC with no zone
 * ("2026-11-18 14:00:00"), read as UTC. Read as local time it ran the wait 24 h plus the UTC offset.
 */
export function retakeWaitLeft(completedAt: string, now: number = Date.now()): string {
  const failedMs = new Date(`${completedAt.replace(" ", "T")}Z`).getTime();
  const remaining = Math.max(0, Math.ceil((failedMs + RETAKE_WAIT_MS - now) / 1000));
  if (remaining <= 0) return "";
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A results row on a decided level test whose written answer nothing checked. */
export const TEST_UNCHECKED_NOTE = "Not checked. No model on this computer could check this written answer, so it does not count toward this test.";

/** The line under a decided level test's score when some answers were never checked, or null. */
export function testUncheckedSummary(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 written answer was not checked. It does not count toward this test."
    : `${n} written answers were not checked. They do not count toward this test.`;
}

/** The learner marks their own unchecked answers against the key (OpenEdu has one learner and no grown-up). */
export const SELF_CHECK = {
  title: "Check your written answers",
  yourAnswer: "Your answer",
  key: "Answer key",
  right: "Right",
  notYet: "Not yet",
  save: "Save my marks",
  saving: "Saving…",
  saveFailed: "Could not save your marks. Try again.",
} as const;

export function selfCheckIntro(n: number): string {
  const what = n === 1 ? "1 of your written answers" : `${n} of your written answers`;
  return `No model on this computer could check ${what}. Compare each one with the answer key and mark it. The test counts once every one is marked.`;
}

/** A written answer the model marked wrong, marked again by the learner against the key
 * (written-answer-checks.ts). The model can fail a right answer written in other words. */
export const MARK_AGAIN = {
  ask: "I think I was right",
  intro: "The model on this computer marked this wrong. Compare your answer with the answer key. If it means the same, it was right.",
  right: "Right",
  notYet: "Not yet",
  saving: "Saving…",
  saveFailed: "Could not save your mark. Try again.",
  /** Under an answer the learner marked against the key. */
  marked: "You marked this against the answer key.",
} as const;

/**
 * Leaving a level test once it has begun. No learner is kept in a test: a stopped test is an unfinished
 * attempt, never scored and never moving the level, with no retake wait (db.ts getLastPromotionAttempt
 * reads finished tests only). The answers already given stay saved, so a missed one can come back in a
 * quiz (db.ts getReviewPoolQuestions). The wait can stay off because a level test marks nothing before
 * Finish (QuestionRenderer marksAtFinish): a learner cannot see a run going badly and stop it to skip a
 * failed test's 24-hour wait.
 */
export const STOP_TEST = {
  button: "Stop the test",
  title: "Stop the test?",
  stop: "Stop the test",
  keep: "Keep going",
} as const;

/** What stopping a begun level test does, for the confirm. `answered` = questions answered so far. */
export function stopTestBody(answered: number): string {
  const what = "It will not be scored and will not change your level. There is no wait: you can take it again whenever you are ready.";
  return answered > 0 ? `${what} The answers you gave are kept, and ones you missed may come back in a quiz for practice.` : what;
}

/**
 * "Grading your test". The answers are on disk before grading starts (db.ts markLevelTestHandedIn), so
 * closing the window or a power cut here loses nothing: the test is graded when it is opened again
 * (level-test-checks.ts finishHandedInLevelTest), and counts once.
 */
export const GRADING = {
  title: "Grading Your Test",
  body: "Scoring your written answers…",
  kept: "Your answers are saved. If this window closes or the power goes off, the scoring finishes when you open this test again.",
  /** Opened again after the app closed mid-grading. */
  resumed: "You handed this test in before the app closed. Scoring it now.",
} as const;

/** The ready screen and the "making" screens of a quiz and a level test. */
export const MAKING = {
  /** Stops the questions being made and goes back; nothing is saved (quiz.ts stopIfAborted). */
  stop: "Stop and go back",
  /** On the ready screen: a stopped test has no wait. */
  canStop: "You can stop at any time. A stopped test is not scored and has no wait.",
  /** Under the "making" spinner. */
  waitNote: "You can stop and come back later. Nothing counts until the questions appear.",
} as const;

/** Under Begin Test: how long making the test can take. On Ollama each question is one model call
 * (quiz.ts generatePerQuestion), so on a computer with no graphics card it is slow. No timing has been
 * measured on one, so the line gives none. */
export function testMakingNote(questions: number): string {
  return `First this computer writes about ${questions} questions, one at a time. On a slower computer that can take a long time, many minutes. You can stop while it works, and nothing counts until the questions appear.`;
}
