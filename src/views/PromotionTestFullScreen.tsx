import { useState, useEffect, useRef, useCallback } from "react";
import type { QuizViewContext, QuizQuestion, QuizAttempt, LLMConfig } from "../types";
import {
  createPromotionAttempt, saveQuizQuestion, getLastPromotionAttempt,
  updateCourseLevel, updateCourseStatus, updateQuizQuestionGrade, getQuizAttempt, type LevelTestRow,
} from "../lib/db";
import { generatePromotionTestQuestions, generateStudyPlan, gradeAnswersBatch, levelTestShortfall, TEST_TOTAL_TARGET } from "../lib/quiz";
import { answerMark, showsAnswerAndKey, showsSafetyNotice, type AnswerMark, type GradedBy } from "../lib/quiz-grading";
import {
  testUncheckedSummary, TEST_UNCHECKED_NOTE, SELF_CHECK, selfCheckIntro, MARK_AGAIN, retakeWaitLeft,
  STOP_TEST, stopTestBody, MAKING, testMakingNote,
} from "../lib/level-test";
import { saveLevelTestResult, pendingLevelTest, pendingLevelTestFor, settleLevelTest, type PendingLevelTest, type SettledLevelTest } from "../lib/level-test-checks";
import CheckAnswers from "../components/quiz/CheckAnswers";
import MarkAgain from "../components/quiz/MarkAgain";
import { canMarkAgain, markAgain } from "../lib/written-answer-checks";
import { log } from "../lib/llm";
import { friendlyError } from "../lib/plain-language";
import { getGenerationConfig, getLocalVerifyConfig, getReviewConfig } from "../lib/store";
import { getLevelMeaning } from "../lib/curriculum";
import { saveFinishEffects } from "../lib/finish-effects";
import { addStudyPlanToLog } from "../lib/knowledge";
import QuestionRenderer from "../components/quiz/QuestionRenderer";
import CompletionCapstone from "../components/CompletionCapstone";
import SafetyNotice from "../components/SafetyNotice";
import { SAFETY_NOTICE } from "../lib/child-safety";
import type { Grade } from "../lib/grade";
import { IconXmark } from "../components/icons";

function getTimeLimitSeconds(level: number): number {
  // Rebase for 6-level scale: L1–L2 = 45min, L3–L4 = 60min, L5+ (incl. mastery) = 90min.
  if (level <= 2) return 45 * 60;
  if (level <= 4) return 60 * 60;
  return 90 * 60;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// "pending": the test is over, but written answers no model checked must be marked before it counts
// (level-test.ts). Here the learner marks them against the key; it is also where the screen opens when
// the course level's last test is still waiting, after a restart too.
type TestState = "checking" | "cooldown" | "ready" | "generating" | "in_progress" | "grading" | "pending" | "results" | "completion";

// An answer on screen as the stored row it was saved as (marking right after the test).
const toRow = (q: ActiveQuestion): LevelTestRow => ({
  id: q.saved_id!, question_text: q.question_text, question_type: q.question_type, correct_answer: q.correct_answer,
  user_answer: q.user_answer, is_correct: q.is_correct, explanation: q.explanation, graded_by: q.graded_by ?? null, test_section: q.section,
  subtopic_id: q.subtopic_id ?? null,
});

// A stored answer back as a results row (a test decided after its answers were marked).
const fromRow = (r: LevelTestRow): ActiveQuestion => ({
  question_text: r.question_text, question_type: r.question_type, options: null, correct_answer: r.correct_answer,
  user_answer: r.user_answer, is_correct: r.is_correct, difficulty_level: 0, explanation: r.explanation,
  section: r.test_section ?? "current", saved_id: r.id, graded_by: r.graded_by ?? undefined,
});

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id"> {
  user_answer: string | null;
  is_correct: boolean | null;
  section: "current" | "review";
  // DB row id (for the deferred grade write) + grader feedback, both filled at finish (issue #83).
  saved_id?: string;
  feedback?: string;
  // How the end-of-test grading marked it, so the results can show an unchecked answer as unchecked.
  graded_by?: GradedBy;
}

// How each answer looks on the results screen. An unchecked one (graded_by 'fallback') counts as right
// but must not look like an answer something checked (quiz-grading.ts answerMark).
const MARK_STYLE: Record<AnswerMark, { row: string; text: string; sign: string }> = {
  right: { row: "border-success/30 bg-success-tint", text: "text-success", sign: "✓" },
  wrong: { row: "border-danger/30 bg-danger-tint", text: "text-danger", sign: "✗" },
  unchecked: { row: "border-warning/30 bg-warning-tint", text: "text-warning", sign: "?" },
};

interface Props {
  context: QuizViewContext;
  onClose: () => void;
  // nextLevel = the level just advanced to; null = course completed (L6 mastery passed).
  onPassed: (nextLevel: number | null) => void;
  // The learner's grade: a safety disclosure typed as an answer is read as the chat reads it.
  grade: Grade | null;
}

export default function PromotionTestFullScreen({ context, onClose, onPassed, grade }: Props) {
  const { courseId, course, syllabus: currentSyllabus, allSyllabuses } = context;
  const currentLevel = course.current_level;

  const [testState, setTestState] = useState<TestState>("checking");
  const [cooldownStr, setCooldownStr] = useState("");
  const [questions, setQuestions] = useState<ActiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [genPhase, setGenPhase] = useState<"current" | "review" | "done">("current");
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [genError, setGenError] = useState("");
  const [passed, setPassed] = useState(false);
  // The level a passed L1-L5 test advanced to. onPassed waits for the results screen's "Continue
  // Learning", so a pass shows its score and breakdown as a fail does.
  const [passedTo, setPassedTo] = useState<number | null>(null);
  const [overallScore, setOverallScore] = useState(0);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [studyPlan, setStudyPlan] = useState("");
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [finishing, setFinishing] = useState(false);
  // The finished test waiting for its unchecked written answers to be marked ("pending").
  const [pendingTest, setPendingTest] = useState<PendingLevelTest | null>(null);
  // Written answers nothing checked on a decided test (they did not count toward it).
  const [uncheckedLeft, setUncheckedLeft] = useState(0);
  // The attempt the results screen shows (the test just taken, or a waiting one decided later).
  const [resultsAttempt, setResultsAttempt] = useState<string | null>(null);
  // The retake check failed: say so, with the way back (the screen never sits on "Checking" for good).
  const [checkError, setCheckError] = useState("");
  // "Stop the test" asks once before leaving a begun test (level-test.ts STOP_TEST).
  const [confirmStop, setConfirmStop] = useState(false);
  // Stops the questions being made when the learner leaves the "making" screen (quiz.ts stopIfAborted).
  const genAbortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synchronous single-flight guard for finishTest — blocks a double-click (or a click racing the
  // timeout) from grading + persisting twice (issue #83 review).
  const finishingRef = useRef(false);
  // The finish's saves (mastery, progress, cards, the study log). A mark made on the results waits for
  // them, so it brings them into line instead of being overwritten by them (finish-effects.ts).
  const savedRef = useRef<Promise<void>>(Promise.resolve());
  // Question indexes whose answer save has started, so a timeout never writes a second row for one.
  const savingRef = useRef(new Set<number>());
  // Mirrors the latest `questions` so the timeout path grades the answers the student actually gave,
  // not the pristine initial array (issue #83 — a timed-out test used to score 0%).
  const questionsRef = useRef<ActiveQuestion[]>([]);

  useEffect(() => { questionsRef.current = questions; }, [questions]);

  useEffect(() => {
    checkCooldown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const checkCooldown = async () => {
    let last: QuizAttempt | null;
    try {
      last = await getLastPromotionAttempt(courseId, currentLevel);
    } catch (e) {
      log.error("promotion-test", "retake check failed", e);
      setCheckError(`Couldn't check this test. ${friendlyError(e)}`);
      return;
    }
    // A finished test still waiting for its written answers to be marked comes back here, not a new test.
    const waiting = await pendingLevelTestFor(last).catch(() => null);
    if (waiting) {
      setPendingTest(waiting);
      setTestState("pending");
      return;
    }
    // Not passed (passed = 0), or before migration 18 a score under the bar.
    const failed = last?.passed === 0 || (last?.passed == null && last?.score != null && last.score < 85);
    if (last && failed && last.completed_at) {
      const remaining = retakeWaitLeft(last.completed_at);
      if (remaining) {
        setCooldownStr(remaining);
        setTestState("cooldown");
        return;
      }
    }
    setTestState("ready");
  };

  const startTest = async () => {
    setTestState("generating");
    setGenPhase("current");
    setGenProgress(null);
    setGenError("");
    const stop = new AbortController();
    genAbortRef.current = stop;

    try {
      const cfg = await getGenerationConfig();
      setConfig(cfg);
      const previousSyllabuses = allSyllabuses.filter((s) => s.level < currentLevel);

      const generated = await generatePromotionTestQuestions(
        currentSyllabus, previousSyllabuses, cfg,
        (done, total, phase) => { setGenPhase(phase); setGenProgress({ done, total }); },
        await getReviewConfig(cfg, "questions"),
        stop.signal,
      );
      // Stopped while it was being made: no attempt is created, so nothing is taken or counted.
      if (stop.signal.aborted) return;
      setGenPhase("done");

      // Too few questions, or no review section when the course has earlier levels: the test is not
      // started, so it is not taken and cannot promote (quiz.ts levelTestShortfall).
      const shortfall = levelTestShortfall(generated);
      if (shortfall) {
        setGenError(`Couldn't make the test. ${shortfall}`);
        setTestState("ready");
        return;
      }
      const { current, review } = generated;
      const allQ: ActiveQuestion[] = [
        ...current.map((q) => ({ ...q, user_answer: null, is_correct: null, section: "current" as const })),
        ...review.map((q) => ({ ...q, user_answer: null, is_correct: null, section: "review" as const })),
      ];

      const limit = getTimeLimitSeconds(currentLevel);
      const attempt = await createPromotionAttempt(courseId, currentLevel, allQ.length, limit);
      setAttemptId(attempt.id);
      savingRef.current = new Set();
      setTimeLeft(limit);
      setQuestions(allQ);
      setCurrentIndex(0);
      setGenPhase("done");
      setTestState("in_progress");

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // Grade what the student actually answered (questionsRef), not the pristine allQ.
            finishTest(questionsRef.current.length ? questionsRef.current : allQ, attempt.id, true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e) {
      if (stop.signal.aborted) return; // the learner stopped it and has left this screen
      log.error("promotion-test", "test generation failed", e);
      setGenError(`Couldn't make the test. ${friendlyError(e)}`);
      setTestState("ready");
    }
  };

  // Leaving the "making" screen stops the model calls, and no attempt is ever created.
  const stopMaking = () => {
    genAbortRef.current?.abort();
    onClose();
  };

  // Leaving a begun test: it stays unfinished, so it is never scored and sets no retake wait
  // (level-test.ts STOP_TEST says so to the learner first).
  const stopTest = () => {
    if (finishingRef.current) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    onClose();
  };

  // isCorrect is null for free-text answers — recorded now, graded together at finish (issue #83).
  const handleAnswer = useCallback(async (answer: string, isCorrect: boolean | null) => {
    // Once the test is finishing (submitted or timed out), a late answer is not stored: the finish
    // path has already decided which questions were answered.
    if (!attemptId || finishingRef.current) return;

    const question = questions[currentIndex];
    savingRef.current.add(currentIndex); // a row is on its way for this question (see the timed-out rows)
    const savedId = await saveQuizQuestion({
      attempt_id: attemptId,
      question_text: question.question_text,
      question_type: question.question_type,
      options: question.options,
      correct_answer: question.correct_answer,
      user_answer: answer,
      is_correct: isCorrect,
      difficulty_level: question.difficulty_level,
      explanation: question.explanation,
      subtopic_id: question.subtopic_id,
      matching_pairs: question.matching_pairs,
      blank_position: question.blank_position,
    }, isCorrect === null ? null : "key", question.section); // answered now against the key; free text is graded at finish
    setQuestions((prev) => prev.map((q, i) =>
      i === currentIndex ? { ...q, user_answer: answer, is_correct: isCorrect, saved_id: savedId } : q
    ));
    // User navigates manually via Next/Finish buttons — no auto-advance
  }, [questions, currentIndex, attemptId]);

  const finishTest = useCallback(async (
    finalQuestions: ActiveQuestion[],
    aid: string,
    timedOut: boolean,
  ) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Prefer a fresh config (a settings change can outlive the test via the timeout path), but a config
    // read must never strand the finish — fall back to the config captured at start. (audit: this was the
    // lone unguarded await on the finish path; every other failure-prone step here is already guarded.)
    let cfg = config;
    try {
      cfg = await getGenerationConfig();
    } catch (e) {
      log.warn("promotion-test", "config refetch at finish failed; using the config captured at start", e instanceof Error ? e.message : String(e));
    }
    if (!cfg) { finishingRef.current = false; setFinishing(false); return; }

    // ── 1. Deferred grading: settle every recorded free-text answer in ONE batch (issue #83). ──
    let gradedQuestions = finalQuestions;
    const pending = finalQuestions
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => q.is_correct === null && q.user_answer !== null);
    if (pending.length > 0) {
      setTestState("grading");
      const tGrade = performance.now();
      // The learner's own words are marked on a local model only (lane 1); none pulled = passed leniently.
      const outcomes = await gradeAnswersBatch(
        pending.map(({ q, index }) => ({
          index, question: q.question_text, expected: q.correct_answer,
          student: q.user_answer ?? "", type: q.question_type,
        })),
        await getLocalVerifyConfig(cfg).catch(() => null),
        grade,
      );
      gradedQuestions = finalQuestions.map((q, i) => {
        const o = outcomes.get(i);
        return o ? { ...q, is_correct: o.isCorrect, feedback: o.feedback, graded_by: o.by } : q;
      });
      await Promise.all(pending.map(({ index }) => {
        const q = gradedQuestions[index];
        const by = outcomes.get(index)?.by ?? "fallback";
        return q.saved_id ? updateQuizQuestionGrade(q.saved_id, !!q.is_correct, by).catch(console.error) : Promise.resolve();
      }));
      log.info("promotion", `graded ${pending.length} free-text answer(s) in ${Math.round(performance.now() - tGrade)}ms`);
    }

    const answered = timedOut
      ? gradedQuestions.map((q) => q.user_answer !== null ? q : { ...q, is_correct: false })
      : gradedQuestions;
    // A timed-out test scores its unanswered questions as wrong. Store them as rows too, so the stored
    // questions match what the app scored (graded_by 'unanswered' keeps them out of the review pool).
    // Not awaited: nothing below reads these rows, and results must never wait on the database. A
    // question whose answer was still being saved when time ran out already has its row, so it is skipped.
    if (timedOut) {
      void Promise.all(answered.filter((q, i) => q.user_answer === null && !q.saved_id && !savingRef.current.has(i)).map((q) =>
        saveQuizQuestion({
          attempt_id: aid,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options,
          correct_answer: q.correct_answer,
          user_answer: null,
          is_correct: false,
          difficulty_level: q.difficulty_level,
          explanation: q.explanation,
          subtopic_id: q.subtopic_id,
          matching_pairs: q.matching_pairs,
          blank_position: q.blank_position,
        }, "unanswered", q.section).catch(console.error)));
    }

    const timeTaken = getTimeLimitSeconds(currentLevel) - timeLeft;

    // The pass rule with unchecked written answers left out (level-test.ts): passed, failed, or waiting
    // for them to be marked. Its writes never throw, so the learner always reaches a results screen
    // (review #5).
    const result = await saveLevelTestResult(aid, answered, timeTaken);
    const overall = result.overall;
    const didPass = result.status === "passed";
    setQuestions(answered);
    setUncheckedLeft(result.unchecked);
    setResultsAttempt(aid);

    // ── Heavy recompute (mastery → progress → knowledge) + spaced-card minting runs in the
    // background so results render immediately and the machine no longer bogs at finish (issue #83). ──
    // The study plan joins the study log line when it is ready, so a slow plan never holds back the
    // rest, and a mark made on the results ("I think I was right") waits only for the rest.
    const persist = (studyPlan: Promise<string | null>) => {
      const t0 = performance.now();
      const saved = saveFinishEffects(courseId, currentLevel, aid, true, answered, overall)
        .then((entry) => { log.info("promotion", `test finish persistence done in ${Math.round(performance.now() - t0)}ms`); return entry; })
        .catch((e) => { console.error("promotion finish persistence failed", e); return null; });
      savedRef.current = saved.then(() => undefined);
      void saved.then(async (entry) => {
        const plan = await studyPlan;
        if (entry && plan) await addStudyPlanToLog(courseId, entry, plan);
      }).catch((e) => console.error("adding the study plan to the log failed", e));
    };

    if (didPass) {
      const levels = [1, 2, 3, 4, 5, 6];
      const idx = levels.indexOf(currentLevel);
      const nextLevel = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
      try {
        if (nextLevel !== null) {
          await updateCourseLevel(courseId, nextLevel);
        } else if (currentLevel >= 6) {
          // L6 is the mastery exam — passing it = course complete.
          await updateCourseStatus(courseId, "completed");
        }
      } catch (e) { console.error("course level update failed", e); }
      setOverallScore(overall);
      setReviewScore(result.reviewPct);
      setPassed(true);
      if (nextLevel === null && currentLevel >= 6) {
        // Course complete — hold the view on the capstone; onPassed(null) fires when the user finishes.
        setTestState("completion");
      } else {
        setPassedTo(nextLevel ?? currentLevel);
        setTestState("results");
      }
      void persist(Promise.resolve(null));
      return;
    }

    // ── Waiting: written answers no model checked could still pass or fail it. Mastery and the rest
    // are saved as for any test; the result waits for the marks. ──
    if (result.status === "pending") {
      void persist(Promise.resolve(null));
      const rows = answered.filter((q) => q.saved_id).map(toRow);
      setPendingTest({ attempt: { id: aid } as QuizAttempt, rows, unchecked: rows.filter((r) => r.graded_by === "fallback") });
      setTestState("pending");
      return;
    }

    // ── Fail: show results immediately; persist and generate the study plan in parallel in the
    // background. The plan reaches the screen when it is ready and the study log after the rest is saved. ──
    setOverallScore(overall);
    setReviewScore(result.reviewPct);
    setPassed(false);
    setTestState("results");
    void persist(startStudyPlan(answered, cfg));
  }, [timeLeft, currentLevel, courseId, currentSyllabus]);

  // After a failed test: the study plan for the missed questions, shown when ready.
  const startStudyPlan = (answers: ReadonlyArray<ActiveQuestion>, cfg: LLMConfig): Promise<string | null> => {
    setGeneratingPlan(true);
    const missed = answers
      .filter((q) => !q.is_correct)
      .map((q) => ({ question_text: q.question_text, correct_answer: q.correct_answer, explanation: q.explanation }));
    // The missed questions go to a local model only (lane 1); none pulled = the plan code writes.
    return getLocalVerifyConfig(cfg).catch(() => null)
      .then((local) => generateStudyPlan(currentSyllabus?.title ?? "this level", currentLevel, missed, local))
      .then((plan) => { setStudyPlan(plan); return plan || null; })
      .catch(() => null) // generateStudyPlan falls back to code; this only guards the unexpected
      .finally(() => setGeneratingPlan(false));
  };

  // The learner marked the written answers no model checked. Throws when the marks could not be saved,
  // so the marking screen can say so and keep them.
  const saveMarks = async (marks: ReadonlyMap<string, boolean>) => {
    if (!pendingTest) return;
    await savedRef.current;
    const settled = await settleLevelTest(pendingTest.attempt.id, marks, "self");
    if (!settled) throw new Error("not a finished level test");
    if (settled.status === "pending") {
      setPendingTest(await pendingLevelTest(courseId, currentLevel));
      return;
    }
    showSettled(settled);
  };

  const showSettled = (s: SettledLevelTest) => {
    const answers = s.rows.map(fromRow);
    setResultsAttempt(s.attemptId);
    setPendingTest(null);
    setQuestions(answers);
    setUncheckedLeft(s.unchecked);
    setOverallScore(s.overall);
    setReviewScore(s.reviewPct);
    setPassed(s.status === "passed");
    if (s.status === "passed") {
      if (currentLevel >= 6) { setTestState("completion"); return; }
      setPassedTo(s.nextLevel ?? currentLevel);
      setTestState("results");
      return;
    }
    setTestState("results");
    void getGenerationConfig().then((cfg) => startStudyPlan(answers, cfg)).catch(() => setGeneratingPlan(false));
  };

  // "I think I was right": the learner marks a written answer the model marked wrong against the key, and
  // the test is decided again (written-answer-checks.ts). Throws when the mark could not be saved.
  const saveMarkAgain = async (index: number, right: boolean) => {
    const q = questions[index];
    if (!resultsAttempt || !q?.saved_id) throw new Error("the answer is not saved");
    await savedRef.current;
    const done = await markAgain(resultsAttempt, new Map([[q.saved_id, right]]), "self");
    if (!done) throw new Error("not a finished level test");
    if (done.status === "pending") {
      // Now the answers no model checked decide it: mark those next, as after any test.
      const waiting = await pendingLevelTestFor(await getQuizAttempt(resultsAttempt));
      if (waiting) { setPendingTest(waiting); setTestState("pending"); return; }
    }
    if (done.status === "passed" && !passed) {
      showSettled({ ...done, status: "passed", overall: done.score, total: done.rows.length });
      return;
    }
    setQuestions((prev) => prev.map((p, i) => (i === index ? { ...p, is_correct: right, graded_by: "self" } : p)));
    setOverallScore(done.score);
    setReviewScore(done.reviewPct);
    setUncheckedLeft(done.unchecked);
  };

  const question = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const answeredCurrent = question?.user_answer !== null;
  const allAnswered = questions.every((q) => q.user_answer !== null);
  const isLastQuestion = currentIndex === questions.length - 1;

  // ── Checking ──
  if (testState === "checking") {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col items-center justify-center p-8 text-center">
        {checkError
          ? <p className="text-danger text-sm mb-4">{checkError}</p>
          : <p className="text-[var(--ink-faint)] mb-4">Checking eligibility...</p>}
        <button onClick={onClose} className="px-5 py-2 rounded-lg bg-panel-lite text-[var(--ink-dim)] text-sm hover:bg-lcd transition-colors">
          Back to Course
        </button>
      </div>
    );
  }

  // ── Cooldown ──
  if (testState === "cooldown") {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h2 className="text-xl font-bold text-ink mb-2">Cooldown Active</h2>
        <p className="text-[var(--ink-faint)] mb-1">You need to wait before retaking this test.</p>
        <p className="text-phosphor-bright font-semibold text-lg">{cooldownStr} remaining</p>
        <p className="text-xs text-[var(--ink-faint)] mt-4">Use this time to review the study plan and practice weak areas.</p>
        <button onClick={onClose} className="mt-8 px-6 py-2.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-dim)] text-sm transition-colors">
          Back to Course
        </button>
      </div>
    );
  }

  // ── Ready ──
  if (testState === "ready") {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
          <div>
            <h1 className="text-base font-semibold text-ink">{course.title}</h1>
            <p className="text-xs text-[var(--ink-faint)]">Promotion Test</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-panel-lite text-[var(--ink-faint)] hover:text-ink transition-colors">
            <IconXmark size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-lg w-full text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[rgb(var(--phosphor-rgb)/0.12)] border border-phosphor/30 rounded-full text-phosphor-bright text-sm font-medium mb-4">
              Level {currentLevel} — {getLevelMeaning(currentLevel)}
            </div>
            <h2 className="text-2xl font-bold text-ink mb-2">
              {currentSyllabus?.title ?? `Level ${currentLevel}`}
            </h2>
            <p className="text-[var(--ink-faint)] text-sm mb-6">Pass this test to advance to the next level.</p>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="p-4 rounded-xl bg-panel border border-[var(--rule)]">
                <div className="text-2xl font-bold text-ink">~45</div>
                <div className="text-xs text-[var(--ink-faint)] mt-0.5">Questions</div>
              </div>
              <div className="p-4 rounded-xl bg-panel border border-[var(--rule)]">
                <div className="text-2xl font-bold text-ink">{formatTime(getTimeLimitSeconds(currentLevel))}</div>
                <div className="text-xs text-[var(--ink-faint)] mt-0.5">Time Limit</div>
              </div>
              <div className="p-4 rounded-xl bg-panel border border-[var(--rule)]">
                <div className="text-2xl font-bold text-ink">85%</div>
                <div className="text-xs text-[var(--ink-faint)] mt-0.5">To Pass</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-panel border border-[var(--rule)] text-left mb-6 text-sm space-y-2">
              <p className="text-[var(--ink-dim)] font-medium">What to expect:</p>
              <p className="text-[var(--ink-faint)]">• ~75% current level material + ~25% previous level review</p>
              <p className="text-[var(--ink-faint)]">• 85% overall and 60% on review questions required to pass</p>
              <p className="text-[var(--ink-faint)]">• Fail = 24-hour cooldown + personalized study plan</p>
              <p className="text-[var(--ink-faint)]">• A written answer no model on this computer can check counts only after you mark it against the answer key</p>
              <p className="text-[var(--ink-faint)]">• {MAKING.canStop}</p>
            </div>

            {genError && (
              <div className="mb-4 p-3 rounded-lg bg-danger-tint border border-danger/30 text-sm text-danger text-left font-mono">
                {genError}
              </div>
            )}

            <button
              onClick={startTest}
              className="w-full px-6 py-3.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] font-semibold text-base transition-colors"
            >
              Begin Test
            </button>
            <p className="text-sm text-[var(--ink-faint)] mt-3">{testMakingNote(TEST_TOTAL_TARGET)}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Generating ──
  if (testState === "generating") {
    const phaseLabel = genPhase === "current"
      ? "Building current-level questions..."
      : genPhase === "review"
      ? "Building review questions..."
      : "Finalizing...";
    const phaseStep = genPhase === "current" ? 1 : genPhase === "review" ? 2 : 3;
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full border-2 border-phosphor border-t-transparent animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-semibold text-ink mb-1">Preparing Your Test</h2>
          <p className="text-sm text-[var(--ink-faint)] mb-6">{phaseLabel}</p>
          {/* Progress steps */}
          <div className="flex items-center justify-center gap-3 mb-4">
            {[1, 2].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  phaseStep > step ? "bg-[rgb(var(--phosphor-rgb)/0.14)] text-phosphor-bright" : phaseStep === step ? "bg-[rgb(var(--phosphor-rgb)/0.08)] border border-phosphor text-phosphor-bright animate-pulse" : "bg-panel-lite text-[var(--ink-faint)]"
                }`}>
                  {phaseStep > step ? "✓" : step}
                </div>
                <span className="text-xs text-[var(--ink-faint)]">{step === 1 ? "Current level" : "Review"}</span>
                {step < 2 && <div className="w-8 h-px bg-lcd mx-1" />}
              </div>
            ))}
          </div>
          {genProgress && (
            <p className="text-phosphor-bright text-sm mb-2 font-mono">
              {genProgress.done} / {genProgress.total} {genPhase === "review" ? "review " : ""}questions
            </p>
          )}
          <p className="text-sm text-[var(--ink-faint)]">~{TEST_TOTAL_TARGET} questions. {MAKING.waitNote}</p>
          {genError && (
            <div className="mt-4 p-3 rounded-lg bg-danger-tint border border-danger/30 text-sm text-danger">{genError}</div>
          )}
          <button onClick={stopMaking} className="mt-6 px-5 py-2 rounded-lg bg-panel-lite text-[var(--ink-dim)] text-sm hover:bg-lcd transition-colors">
            {MAKING.stop}
          </button>
        </div>
      </div>
    );
  }

  // ── Grading (deferred free-text grading at finish, issue #83) ──
  if (testState === "grading") {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full border-2 border-phosphor border-t-transparent animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-semibold text-ink mb-1">Grading Your Test</h2>
          <p className="text-sm text-[var(--ink-faint)]">Scoring your written answers…</p>
        </div>
      </div>
    );
  }

  // ── In Progress ──
  if (testState === "in_progress" && question) {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col">
        {/* Header with timer */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-[var(--rule)] shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[var(--ink-faint)]">{currentIndex + 1} / {questions.length}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-panel-lite text-[var(--ink-faint)]">
                {question.section === "review" ? "Review Section" : "Current Level"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-panel-lite overflow-hidden">
              <div className="h-full rounded-full bg-[rgb(var(--phosphor-rgb)/0.14)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className={`text-xl font-mono font-bold shrink-0 ${timeLeft < 300 ? "text-danger animate-pulse" : "text-ink"}`}>
            {formatTime(timeLeft)}
          </div>
          {!finishing && (
            <button
              onClick={() => setConfirmStop(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-faint)] hover:text-ink text-xs transition-colors shrink-0"
            >
              <IconXmark size={14} />
              {STOP_TEST.button}
            </button>
          )}
        </div>

        {confirmStop && !finishing && (
          <div className="px-6 py-4 border-b border-[var(--rule)] bg-panel shrink-0" role="alertdialog" aria-labelledby="stop-test-title">
            <div className="max-w-2xl mx-auto">
              <p id="stop-test-title" className="text-sm font-semibold text-ink mb-1">{STOP_TEST.title}</p>
              <p className="text-sm text-[var(--ink-dim)] mb-3">{stopTestBody(questions.filter((q) => q.user_answer !== null).length)}</p>
              <div className="flex gap-3">
                <button onClick={stopTest} className="px-4 py-2 rounded-lg bg-panel-lite hover:bg-lcd text-ink text-sm font-medium transition-colors">
                  {STOP_TEST.stop}
                </button>
                <button onClick={() => setConfirmStop(false)} className="px-4 py-2 rounded-lg btn-primary text-sm font-medium transition-colors">
                  {STOP_TEST.keep}
                </button>
              </div>
            </div>
          </div>
        )}

        {questions.length < TEST_TOTAL_TARGET && (
          <div className="px-6 py-1.5 text-[11px] border-b shrink-0 text-warning bg-warning-tint border-warning/20">
            {`Generated ${questions.length} of ${TEST_TOTAL_TARGET} questions — your model produced fewer than usual this run.`}
          </div>
        )}

        {/* Question */}
        <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
          <div className="w-full max-w-2xl">
            <h2 className="text-lg text-ink leading-relaxed mb-6">{question.question_text}</h2>

            {config && (
              <QuestionRenderer
                key={currentIndex}
                question={question}
                onAnswer={handleAnswer}
                disabled={answeredCurrent}
                grade={grade}
              />
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-6 gap-3">
              <button
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="px-5 py-2.5 rounded-xl border border-[var(--rule)] text-[var(--ink-dim)] text-sm font-medium disabled:opacity-30 hover:bg-panel-lite transition-colors"
              >
                ← Previous
              </button>
              {isLastQuestion ? (
                <button
                  onClick={() => finishTest(questions, attemptId!, false)}
                  disabled={!allAnswered || finishing}
                  className="px-5 py-2.5 rounded-xl bg-success hover:opacity-90 text-[var(--on-accent)] text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  {finishing ? "Finishing…" : "Finish Test"}
                </button>
              ) : (
                <button
                  onClick={() => setCurrentIndex((prev) => prev + 1)}
                  disabled={!answeredCurrent}
                  className="px-5 py-2.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pending: the learner marks the written answers no model checked, then the test counts ──
  if (testState === "pending" && pendingTest) {
    return (
      <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
          <div>
            <h1 className="text-base font-semibold text-ink">{SELF_CHECK.title}</h1>
            <p className="text-xs text-[var(--ink-faint)]">{course.title} — Level {currentLevel}</p>
          </div>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-dim)] text-sm transition-colors">
            Back to Course
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <p className="text-warning text-base mb-4">{selfCheckIntro(pendingTest.unchecked.length)}</p>
            <CheckAnswers key={pendingTest.unchecked.map((r) => r.id).join()} answers={pendingTest.unchecked} copy={SELF_CHECK} onSave={saveMarks}
              noteFor={(a) => (showsSafetyNotice(a, grade) ? SAFETY_NOTICE : null)} />
          </div>
        </div>
      </div>
    );
  }

  // ── Completion (L6 capstone) ──
  if (testState === "completion") {
    return (
      <CompletionCapstone
        course={course}
        syllabuses={allSyllabuses}
        masterySyllabus={currentSyllabus}
        overallScore={overallScore}
        onDone={() => onPassed(null)}
        onArchive={() => updateCourseStatus(courseId, "archived")}
      />
    );
  }

  // ── Results ──
  const uncheckedLine = testUncheckedSummary(uncheckedLeft);
  return (
    <div className="fixed inset-x-0 top-8 bottom-0 z-50 bg-bg flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
        <div>
          <h1 className="text-base font-semibold text-ink">{passed ? "Test Passed!" : "Test Failed"}</h1>
          <p className="text-xs text-[var(--ink-faint)]">{course.title} — Level {currentLevel}</p>
        </div>
        <button
          onClick={passed && passedTo !== null ? () => onPassed(passedTo) : onClose}
          className="px-4 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium transition-colors"
        >
          {passed ? "Continue Learning" : "Back to Course"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className={`text-center p-6 rounded-2xl border mb-6 ${passed ? "bg-success-tint border-success/30" : "bg-danger-tint border-danger/30"}`}>
            <div className={`text-5xl font-bold mb-1 ${passed ? "text-success" : "text-danger"}`}>
              {Math.round(overallScore)}%
            </div>
            <div className="text-[var(--ink-faint)] text-sm">Overall Score</div>
            {uncheckedLine && (
              <p className="text-warning text-sm mt-2">{uncheckedLine}</p>
            )}
            {reviewScore !== null && (
              <div className={`mt-2 text-sm ${reviewScore >= 60 ? "text-success" : "text-danger"}`}>
                Review section: {Math.round(reviewScore)}% {reviewScore >= 60 ? "✓" : "✗ (need 60%)"}
              </div>
            )}
          </div>

          {passed ? (
            <div className="text-center mb-6">
              <p className="text-[var(--ink-dim)] text-lg font-semibold mb-1">
                {currentLevel >= 6 ? "Course Complete!" : `Advanced to Level ${currentLevel + 1}!`}
              </p>
              <p className="text-[var(--ink-faint)] text-sm">
                {currentLevel >= 6 ? "You've completed the full curriculum." : "Your next unit is ready. Keep going."}
              </p>
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-[var(--ink-faint)] text-sm mb-4">
                You need 85% overall and 60% on the review section. A 24-hour cooldown is now active.
              </p>
              <div className="p-4 rounded-xl bg-panel border border-[var(--rule)]">
                <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
                  📋 Study Plan
                  {generatingPlan && <span className="text-[10px] text-[var(--ink-faint)] font-normal animate-pulse">Generating...</span>}
                </h3>
                {studyPlan ? (
                  <p className="text-sm text-[var(--ink-dim)] whitespace-pre-wrap leading-relaxed">{studyPlan}</p>
                ) : (
                  !generatingPlan && <p className="text-[var(--ink-faint)] text-sm">No study plan available.</p>
                )}
              </div>
            </div>
          )}

          {/* Question breakdown */}
          <div className="space-y-3">
            {questions.map((q, i) => {
              const mark = answerMark(q);
              const style = MARK_STYLE[mark];
              // A safety disclosure typed as the answer: the chat's notice in place of the not-checked
              // note (the answer was never marked; quiz.ts gradeAnswersBatch).
              const safety = showsSafetyNotice(q, grade);
              return (
              <div key={i} className={`p-3 rounded-xl border text-sm ${style.row}`}>
                <div className="flex items-start gap-2">
                  <span className={`font-bold shrink-0 ${style.text}`}>{style.sign}</span>
                  <div className="min-w-0">
                    <p className="text-ink">{q.question_text}</p>
                    {safety && <SafetyNotice className="mt-1" />}
                    {mark === "unchecked" && !safety && <p className="text-xs text-warning mt-0.5">{TEST_UNCHECKED_NOTE}</p>}
                    {showsAnswerAndKey(q, grade) && (
                      <p className={`text-xs mt-0.5 ${mark === "wrong" ? "text-danger" : "text-ink"}`}>Your: {q.user_answer} · Correct: {q.correct_answer}</p>
                    )}
                    {q.graded_by === "self"
                      ? <p className="text-xs text-[var(--ink-faint)] mt-1">{MARK_AGAIN.marked}</p>
                      : q.feedback && <p className="text-xs text-[var(--ink-faint)] italic mt-1">{q.feedback}</p>}
                    {q.explanation && <p className="text-xs text-[var(--ink-faint)] mt-1">{q.explanation}</p>}
                    {canMarkAgain(q) && q.saved_id && resultsAttempt && (
                      <MarkAgain copy={MARK_AGAIN} onMark={(right) => saveMarkAgain(i, right)} />
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
