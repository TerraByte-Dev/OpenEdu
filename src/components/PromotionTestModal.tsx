import { useState, useEffect, useRef, useCallback } from "react";
import type { Syllabus, QuizQuestion } from "../types";
import {
  createPromotionAttempt, saveQuizQuestion, completeQuizAttempt, getLastPromotionAttempt,
  updateCourseLevel, getSyllabus,
} from "../lib/db";
import { generatePromotionTestQuestions, generateStudyPlan } from "../lib/quiz";
import { getGenerationConfig } from "../lib/store";

import { getLevelMeaning } from "../lib/curriculum";
import { updateSubtopicMastery, updateUserProgress, refreshProgressContext } from "../lib/progress";

// Time limits from CONCEPT.md
function getTimeLimitSeconds(level: number): number {
  if (level <= 1.0) return 45 * 60;
  if (level <= 3.0) return 60 * 60;
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

type ModalState = "checking" | "cooldown" | "ready" | "generating" | "in_progress" | "results";

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id"> {
  section: "current" | "review";
}

interface Props {
  courseId: string;
  currentLevel: number;
  currentSyllabus: Syllabus | null;
  allSyllabuses: Syllabus[];
  onClose: () => void;
  onPassed: () => void;
}

export default function PromotionTestModal({
  courseId, currentLevel, currentSyllabus, allSyllabuses, onClose, onPassed,
}: Props) {
  const [modalState, setModalState] = useState<ModalState>("checking");
  const [cooldownStr, setCooldownStr] = useState("");
  const [questions, setQuestions] = useState<ActiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [genLog, setGenLog] = useState("");
  const [genError, setGenError] = useState("");
  const [passed, setPassed] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [studyPlan, setStudyPlan] = useState("");
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const genLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkCooldown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (genLogRef.current) genLogRef.current.scrollTop = genLogRef.current.scrollHeight;
  }, [genLog]);

  const checkCooldown = async () => {
    const last = await getLastPromotionAttempt(courseId, currentLevel);
    if (last && last.score !== null && last.score < 80 && last.completed_at) {
      const remaining = formatCooldown(last.completed_at);
      if (remaining) {
        setCooldownStr(remaining);
        setModalState("cooldown");
        return;
      }
    }
    setModalState("ready");
  };

  const startTest = async () => {
    if (!currentSyllabus) return;
    setModalState("generating");
    setGenLog("");
    setGenError("");

    try {
      const config = await getGenerationConfig();
      const previousSyllabuses = allSyllabuses.filter((s) => s.level < currentLevel);
      const { current, review } = await generatePromotionTestQuestions(
        currentSyllabus, previousSyllabuses, config,
      );

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
      setSelectedAnswer(null);
      setModalState("in_progress");
      setGenLog("");

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
      setModalState("ready");
    }
  };

  const submitAnswer = useCallback(async () => {
    if (selectedAnswer === null || !attemptId) return;

    const question = questions[currentIndex];
    const isCorrect = selectedAnswer === question.correct_answer;

    const updatedQuestions = questions.map((q, i) =>
      i === currentIndex ? { ...q, user_answer: selectedAnswer, is_correct: isCorrect } : q
    );
    setQuestions(updatedQuestions);

    await saveQuizQuestion({
      attempt_id: attemptId,
      question_text: question.question_text,
      question_type: question.question_type,
      options: question.options,
      correct_answer: question.correct_answer,
      user_answer: selectedAnswer,
      is_correct: isCorrect,
      difficulty_level: question.difficulty_level,
      explanation: question.explanation,
      subtopic_id: question.subtopic_id,
    });

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
    } else {
      finishTest(updatedQuestions, attemptId, false);
    }
  }, [selectedAnswer, questions, currentIndex, attemptId]);

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

    const didPass = overall >= 80 && reviewPct >= 60;
    const timeTaken = getTimeLimitSeconds(currentLevel) - timeLeft;

    await completeQuizAttempt(aid, overall, totalCorrect, timeTaken);

    // Update mastery tracking from this test's questions
    if (currentSyllabus) {
      const freshSyllabus = await getSyllabus(courseId, currentLevel);
      if (freshSyllabus) {
        await updateSubtopicMastery(courseId, freshSyllabus, answered);
        await updateUserProgress(courseId);
        await refreshProgressContext(courseId, freshSyllabus);
      }
    }

    if (didPass) {
      const levels = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
      const idx = levels.indexOf(currentLevel);
      const nextLevel = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
      if (nextLevel !== null) {
        await updateCourseLevel(courseId, nextLevel);
      }
    } else {
      // Generate study plan for failed attempt
      setGeneratingPlan(true);
      const missed = answered
        .filter((q) => !q.is_correct)
        .map((q) => ({ question_text: q.question_text, correct_answer: q.correct_answer, explanation: q.explanation }));
      try {
        const config = await getGenerationConfig();
        const plan = await generateStudyPlan(
          currentSyllabus?.title ?? "this level",
          currentLevel,
          missed,
          config,
          (t) => setStudyPlan((p) => p + t),
        );
        setStudyPlan(plan);
      } catch { /* study plan is a nice-to-have */ }
      setGeneratingPlan(false);
    }

    setOverallScore(overall);
    setReviewScore(reviewQs.length > 0 ? reviewPct : null);
    setPassed(didPass);
    setModalState("results");
    if (didPass) onPassed();
  }, [timeLeft, currentLevel, courseId, currentSyllabus, onPassed]);

  const question = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-panel border border-[var(--rule)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* ── Checking ── */}
        {modalState === "checking" && (
          <div className="flex-1 flex items-center justify-center p-12 text-[var(--ink-faint)]">
            Checking eligibility...
          </div>
        )}

        {/* ── Cooldown ── */}
        {modalState === "cooldown" && (
          <>
            <ModalHeader title="Promotion Test" onClose={onClose} />
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <div className="text-5xl mb-4">⏳</div>
              <h2 className="text-xl font-bold text-ink mb-2">Cooldown Active</h2>
              <p className="text-[var(--ink-faint)] mb-1">You need to wait before retaking this test.</p>
              <p className="text-phosphor-bright font-semibold text-lg">{cooldownStr} remaining</p>
              <p className="text-xs text-[var(--ink-faint)] mt-4">Use this time to review the study plan from your last attempt and practice weak areas.</p>
              <button onClick={onClose} className="mt-8 px-6 py-2.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-dim)] text-sm transition-colors">Close</button>
            </div>
          </>
        )}

        {/* ── Ready ── */}
        {modalState === "ready" && (
          <>
            <ModalHeader title="Promotion Test" onClose={onClose} />
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-lg mx-auto text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 btn-primary/20 border border-phosphor/30 rounded-full text-phosphor-bright text-sm font-medium mb-4">
                  Level {currentLevel.toFixed(1)} — {getLevelMeaning(currentLevel)}
                </div>
                <h2 className="text-2xl font-bold text-ink mb-2">
                  {currentSyllabus?.title ?? `Level ${currentLevel}`}
                </h2>
                <p className="text-[var(--ink-faint)] text-sm mb-6">Pass this test to advance to the next level.</p>

                <div className="grid grid-cols-3 gap-4 mb-8 text-center">
                  <div className="p-4 rounded-xl bg-panel-lite/60 border border-[var(--rule)]">
                    <div className="text-2xl font-bold text-ink">~{questions.length || "20"}</div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">Questions</div>
                  </div>
                  <div className="p-4 rounded-xl bg-panel-lite/60 border border-[var(--rule)]">
                    <div className="text-2xl font-bold text-ink">{formatTime(getTimeLimitSeconds(currentLevel))}</div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">Time Limit</div>
                  </div>
                  <div className="p-4 rounded-xl bg-panel-lite/60 border border-[var(--rule)]">
                    <div className="text-2xl font-bold text-ink">80%</div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">To Pass</div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-panel-lite/40 border border-[var(--rule)] text-left mb-6 text-sm space-y-2">
                  <p className="text-[var(--ink-dim)] font-medium">What to expect:</p>
                  <p className="text-[var(--ink-faint)]">• Questions on this level's material (~75%) + previous levels (~25%)</p>
                  <p className="text-[var(--ink-faint)]">• You need 80% overall and 60% on review questions to pass</p>
                  <p className="text-[var(--ink-faint)]">• If you fail, a study plan is generated and a 24-hour cooldown applies</p>
                </div>

                {genError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 text-left font-mono">
                    {genError}
                  </div>
                )}

                <button
                  onClick={startTest}
                  disabled={!currentSyllabus}
                  className="w-full px-6 py-3.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white font-semibold text-base disabled:opacity-50 transition-colors"
                >
                  Begin Test
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Generating ── */}
        {modalState === "generating" && (
          <>
            <ModalHeader title="Generating Test Questions" />
            <div className="flex-1 flex flex-col p-6 gap-4">
              <div className="flex items-center gap-3 text-[var(--ink-dim)]">
                <span className="w-3 h-3 rounded-full bg-phosphor-ink animate-pulse shrink-0" />
                <span className="text-sm">Building your promotion test — this may take a minute...</span>
              </div>
              {genLog && (
                <div ref={genLogRef} className="flex-1 rounded-lg bg-bg border border-[var(--rule)] p-3 overflow-y-auto">
                  <pre className="text-[11px] font-mono text-[var(--ink-faint)] whitespace-pre-wrap leading-relaxed">{genLog}</pre>
                </div>
              )}
              {genError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 font-mono">{genError}</div>
              )}
            </div>
          </>
        )}

        {/* ── In Progress ── */}
        {modalState === "in_progress" && question && (
          <>
            {/* Test header with timer */}
            <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--rule)] shrink-0">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-[var(--ink-faint)]">{currentIndex + 1} / {questions.length}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-panel-lite text-[var(--ink-faint)]">
                    {question.section === "review" ? "Review" : "Current Level"}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-lcd overflow-hidden">
                  <div className="h-full rounded-full bg-[rgb(var(--phosphor-rgb)/0.14)] transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className={`text-lg font-mono font-bold shrink-0 ${timeLeft < 300 ? "text-red-400" : "text-ink"}`}>
                {formatTime(timeLeft)}
              </div>
            </div>

            {/* Question */}
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-base text-ink mb-5 leading-relaxed">{question.question_text}</h3>
              <div className="space-y-3">
                {(question.options ?? ["True", "False"]).map((option) => (
                  <button
                    key={option}
                    onClick={() => setSelectedAnswer(option)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                      selectedAnswer === option
                        ? "border-phosphor bg-[rgb(var(--phosphor-rgb)/0.14)]/10 text-ink"
                        : "border-[var(--rule)] bg-panel-lite/50 text-[var(--ink-dim)] hover:border-phosphor/50"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--rule)] shrink-0">
              <button
                onClick={submitAnswer}
                disabled={selectedAnswer === null}
                className="w-full px-6 py-3 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {currentIndex < questions.length - 1 ? "Next Question" : "Submit Test"}
              </button>
            </div>
          </>
        )}

        {/* ── Results ── */}
        {modalState === "results" && (
          <>
            <ModalHeader title={passed ? "Test Passed!" : "Test Failed"} onClose={onClose} />
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-lg mx-auto">
                {/* Score display */}
                <div className={`text-center p-6 rounded-2xl border mb-6 ${
                  passed ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
                }`}>
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
                  <div className="text-center">
                    <p className="text-[var(--ink-dim)] mb-2">You've advanced to Level {(currentLevel + 0.5).toFixed(1)}!</p>
                    <p className="text-[var(--ink-faint)] text-sm">Your new unit has been unlocked. Keep going.</p>
                    <button
                      onClick={onClose}
                      className="mt-6 px-6 py-2.5 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-sm font-medium transition-colors"
                    >
                      Continue Learning
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-[var(--ink-faint)] text-sm mb-4">
                      You need 80% overall and 60% on the review section to advance. A 24-hour cooldown is now active.
                    </p>

                    {/* Study plan */}
                    <div className="p-4 rounded-xl bg-panel-lite/60 border border-[var(--rule)]">
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

                    <button
                      onClick={onClose}
                      className="mt-5 w-full px-6 py-2.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-dim)] text-sm transition-colors"
                    >
                      Back to Course
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--rule)] shrink-0">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {onClose && (
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-lcd text-[var(--ink-faint)] hover:text-ink transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
