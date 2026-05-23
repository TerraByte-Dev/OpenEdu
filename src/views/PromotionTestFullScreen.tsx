import { useState, useEffect, useRef, useCallback } from "react";
import type { QuizViewContext, QuizQuestion, LLMConfig } from "../types";
import {
  createPromotionAttempt, saveQuizQuestion, completeQuizAttempt, getLastPromotionAttempt,
  updateCourseLevel, updateCourseStatus, getSyllabus,
} from "../lib/db";
import { generatePromotionTestQuestions, generateStudyPlan } from "../lib/quiz";
import { getGenerationConfig } from "../lib/store";
import { getLevelMeaning } from "../lib/curriculum";
import { updateSubtopicMastery, updateUserProgress, refreshProgressContext } from "../lib/progress";
import { updateKnowledgeAfterQuiz } from "../lib/knowledge";
import QuestionRenderer from "../components/quiz/QuestionRenderer";

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

function formatCooldown(completedAt: string): string {
  const failedMs = new Date(completedAt).getTime();
  const cooldownEnd = failedMs + 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
  if (remaining <= 0) return "";
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type TestState = "checking" | "cooldown" | "ready" | "generating" | "in_progress" | "results";

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id"> {
  user_answer: string | null;
  is_correct: boolean | null;
  section: "current" | "review";
}

interface Props {
  context: QuizViewContext;
  onClose: () => void;
  onPassed: (nextLevel: number) => void;
}

export default function PromotionTestFullScreen({ context, onClose, onPassed }: Props) {
  const { courseId, course, syllabus: currentSyllabus, allSyllabuses } = context;
  const currentLevel = course.current_level;

  const [testState, setTestState] = useState<TestState>("checking");
  const [cooldownStr, setCooldownStr] = useState("");
  const [questions, setQuestions] = useState<ActiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [genPhase, setGenPhase] = useState<"current" | "review" | "done">("current");
  const [genError, setGenError] = useState("");
  const [passed, setPassed] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [studyPlan, setStudyPlan] = useState("");
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkCooldown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const checkCooldown = async () => {
    const last = await getLastPromotionAttempt(courseId, currentLevel);
    if (last && last.score !== null && last.score < 85 && last.completed_at) {
      const remaining = formatCooldown(last.completed_at);
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
    setGenError("");

    try {
      const cfg = await getGenerationConfig();
      setConfig(cfg);
      const previousSyllabuses = allSyllabuses.filter((s) => s.level < currentLevel);

      const { current, review } = await generatePromotionTestQuestions(
        currentSyllabus, previousSyllabuses, cfg,
      );
      setGenPhase("review");

      const allQ: ActiveQuestion[] = [
        ...current.map((q) => ({ ...q, user_answer: null, is_correct: null, section: "current" as const })),
        ...review.map((q) => ({ ...q, user_answer: null, is_correct: null, section: "review" as const })),
      ];

      if (allQ.length === 0) throw new Error("No questions were generated. Try a more capable model.");

      const limit = getTimeLimitSeconds(currentLevel);
      const attempt = await createPromotionAttempt(courseId, currentLevel, allQ.length, limit);
      setAttemptId(attempt.id);
      setTimeLeft(limit);
      setQuestions(allQ);
      setCurrentIndex(0);
      setGenPhase("done");
      setTestState("in_progress");

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            finishTest(allQ, attempt.id, true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      setTestState("ready");
    }
  };

  const handleAnswer = useCallback(async (answer: string, isCorrect: boolean) => {
    if (!attemptId) return;

    const question = questions[currentIndex];
    const updatedQuestions = questions.map((q, i) =>
      i === currentIndex ? { ...q, user_answer: answer, is_correct: isCorrect } : q
    );
    setQuestions(updatedQuestions);

    await saveQuizQuestion({
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
    });
    // User navigates manually via Next/Finish buttons — no auto-advance
  }, [questions, currentIndex, attemptId]);

  const finishTest = useCallback(async (
    finalQuestions: ActiveQuestion[],
    aid: string,
    timedOut: boolean,
  ) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const answered = timedOut
      ? finalQuestions.map((q) => q.user_answer !== null ? q : { ...q, is_correct: false })
      : finalQuestions;

    const totalCorrect = answered.filter((q) => q.is_correct).length;
    const total = answered.length;
    const overall = total > 0 ? (totalCorrect / total) * 100 : 0;

    const reviewQs = answered.filter((q) => q.section === "review");
    const reviewCorrect = reviewQs.filter((q) => q.is_correct).length;
    const reviewPct = reviewQs.length > 0 ? (reviewCorrect / reviewQs.length) * 100 : 100;

    const didPass = overall >= 85 && reviewPct >= 60;
    const timeTaken = getTimeLimitSeconds(currentLevel) - timeLeft;

    await completeQuizAttempt(aid, overall, totalCorrect, timeTaken);

    if (currentSyllabus) {
      const freshSyllabus = await getSyllabus(courseId, currentLevel);
      if (freshSyllabus) {
        await updateSubtopicMastery(courseId, freshSyllabus, answered);
        await updateUserProgress(courseId);
        await refreshProgressContext(courseId, freshSyllabus);
      }
    }

    const missedTopics = answered
      .filter((q) => !q.is_correct && q.subtopic_id)
      .map((q) => q.subtopic_id!);

    if (didPass) {
      const levels = [1, 2, 3, 4, 5, 6];
      const idx = levels.indexOf(currentLevel);
      const nextLevel = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
      if (nextLevel !== null) {
        await updateCourseLevel(courseId, nextLevel);
      } else if (currentLevel >= 6) {
        // L6 is the mastery exam — passing it = course complete. Set the seam for
        // future "beyond the course" work. No UI change yet beyond the results screen.
        await updateCourseStatus(courseId, "completed");
      }
      const cfg = await getGenerationConfig();
      await updateKnowledgeAfterQuiz(courseId, overall, answered.length, missedTopics, null, cfg).catch(console.error);
      setOverallScore(overall);
      setReviewScore(reviewQs.length > 0 ? reviewPct : null);
      setPassed(true);
      setTestState("results");
      onPassed(nextLevel ?? currentLevel);
      return;
    } else {
      setGeneratingPlan(true);
      const missed = answered
        .filter((q) => !q.is_correct)
        .map((q) => ({ question_text: q.question_text, correct_answer: q.correct_answer, explanation: q.explanation }));
      let studyPlanText = "";
      try {
        const cfg = await getGenerationConfig();
        await generateStudyPlan(
          currentSyllabus?.title ?? "this level",
          currentLevel,
          missed,
          cfg,
          (t) => {
            studyPlanText += t;
            setStudyPlan((p) => p + t);
          },
        );
        await updateKnowledgeAfterQuiz(courseId, overall, answered.length, missedTopics, studyPlanText || null, cfg).catch(console.error);
      } catch { /* study plan is a nice-to-have */ }
      setGeneratingPlan(false);
    }

    setOverallScore(overall);
    setReviewScore(reviewQs.length > 0 ? reviewPct : null);
    setPassed(false);
    setTestState("results");
  }, [timeLeft, currentLevel, courseId, currentSyllabus, onPassed]);

  const question = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const answeredCurrent = question?.user_answer !== null;
  const allAnswered = questions.every((q) => q.user_answer !== null);
  const isLastQuestion = currentIndex === questions.length - 1;

  // ── Checking ──
  if (testState === "checking") {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center">
        <p className="text-[var(--ink-faint)]">Checking eligibility...</p>
      </div>
    );
  }

  // ── Cooldown ──
  if (testState === "cooldown") {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center p-8 text-center">
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
      <div className="fixed inset-0 z-50 bg-bg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
          <div>
            <h1 className="text-base font-semibold text-ink">{course.title}</h1>
            <p className="text-xs text-[var(--ink-faint)]">Promotion Test</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-panel-lite text-[var(--ink-faint)] hover:text-ink transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-lg w-full text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 btn-primary/20 border border-phosphor/30 rounded-full text-phosphor-bright text-sm font-medium mb-4">
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
            </div>

            {genError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 text-left font-mono">
                {genError}
              </div>
            )}

            <button
              onClick={startTest}
              className="w-full px-6 py-3.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white font-semibold text-base transition-colors"
            >
              Begin Test
            </button>
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
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full border-2 border-phosphor border-t-transparent animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-semibold text-ink mb-1">Preparing Your Test</h2>
          <p className="text-sm text-[var(--ink-faint)] mb-6">{phaseLabel}</p>
          {/* Progress steps */}
          <div className="flex items-center justify-center gap-3 mb-4">
            {[1, 2].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  phaseStep > step ? "bg-[rgb(var(--phosphor-rgb)/0.14)] text-white" : phaseStep === step ? "bg-[rgb(var(--phosphor-rgb)/0.14)]/40 border border-phosphor text-phosphor-bright animate-pulse" : "bg-panel-lite text-[var(--ink-faint)]"
                }`}>
                  {phaseStep > step ? "✓" : step}
                </div>
                <span className="text-xs text-[var(--ink-faint)]">{step === 1 ? "Current level" : "Review"}</span>
                {step < 2 && <div className="w-8 h-px bg-lcd mx-1" />}
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--ink-faint)]">45 questions — do not close this window</p>
          {genError && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{genError}</div>
          )}
        </div>
      </div>
    );
  }

  // ── In Progress ──
  if (testState === "in_progress" && question) {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col">
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
          <div className={`text-xl font-mono font-bold shrink-0 ${timeLeft < 300 ? "text-red-400 animate-pulse" : "text-ink"}`}>
            {formatTime(timeLeft)}
          </div>
        </div>

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
                config={config}
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
                  disabled={!allAnswered}
                  className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  Finish Test
                </button>
              ) : (
                <button
                  onClick={() => setCurrentIndex((prev) => prev + 1)}
                  disabled={!answeredCurrent}
                  className="px-5 py-2.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-sm font-medium disabled:opacity-40 transition-colors"
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

  // ── Results ──
  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
        <div>
          <h1 className="text-base font-semibold text-ink">{passed ? "Test Passed!" : "Test Failed"}</h1>
          <p className="text-xs text-[var(--ink-faint)]">{course.title} — Level {currentLevel}</p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-sm font-medium transition-colors"
        >
          {passed ? "Continue Learning" : "Back to Course"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className={`text-center p-6 rounded-2xl border mb-6 ${passed ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
            <div className={`text-5xl font-bold mb-1 ${passed ? "text-green-400" : "text-red-400"}`}>
              {Math.round(overallScore)}%
            </div>
            <div className="text-[var(--ink-faint)] text-sm">Overall Score</div>
            {reviewScore !== null && (
              <div className={`mt-2 text-sm ${reviewScore >= 60 ? "text-green-400" : "text-red-400"}`}>
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
            {questions.map((q, i) => (
              <div key={i} className={`p-3 rounded-xl border text-sm ${q.is_correct ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                <div className="flex items-start gap-2">
                  <span className={`font-bold shrink-0 ${q.is_correct ? "text-green-400" : "text-red-400"}`}>{q.is_correct ? "✓" : "✗"}</span>
                  <div className="min-w-0">
                    <p className="text-ink">{q.question_text}</p>
                    {!q.is_correct && q.user_answer && (
                      <p className="text-xs text-red-400 mt-0.5">Your: {q.user_answer} · Correct: {q.correct_answer}</p>
                    )}
                    {q.explanation && <p className="text-xs text-[var(--ink-faint)] mt-1">{q.explanation}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
