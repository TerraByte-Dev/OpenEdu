import { useState, useEffect, useRef } from "react";
import type { QuizViewContext, QuizQuestion, LLMConfig } from "../types";
import { createQuizAttempt, saveQuizQuestion, completeQuizAttempt, getSyllabus, getReviewPoolQuestions, updateQuizQuestionSelfExplanation, updateQuizQuestionGrade } from "../lib/db";
import { generateQuizQuestions, gradeAnswersBatch, QUIZ_TARGET, QUIZ_FLOOR } from "../lib/quiz";
import { log } from "../lib/llm";
import { getLLMConfig } from "../lib/store";
import { updateSubtopicMastery, updateUserProgress, refreshProgressContext } from "../lib/progress";
import { updateKnowledgeAfterQuiz } from "../lib/knowledge";
import QuestionRenderer from "../components/quiz/QuestionRenderer";

interface QuizFullScreenProps {
  context: QuizViewContext;
  onClose: () => void;
}

type State = "generating" | "in_progress" | "grading" | "results";

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id"> {
  user_answer: string | null;
  is_correct: boolean | null;
  // DB row id once the answer is saved — lets a later self-explanation / deferred grade update the same row.
  saved_id?: string;
  // Grader feedback for free-text answers, filled in during the end-of-test grading phase (issue #83).
  feedback?: string;
}

export default function QuizFullScreen({ context, onClose }: QuizFullScreenProps) {
  const { courseId, course, syllabus } = context;
  const [state, setState] = useState<State>("generating");
  const [questions, setQuestions] = useState<ActiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  // Synchronous single-flight guard — a fast double-click can fire handleFinish twice before the
  // `finishing` state re-renders, which would double-grade and double-persist (issue #83 review).
  const finishingRef = useRef(false);
  // React StrictMode (dev) invokes mount effects twice. Without this guard the quiz generates TWICE,
  // and the slower, non-deterministic second run overwrites the first mid-session — resetting you to
  // question 1 with a different question set/count — while two pipelines fight over the single local
  // Ollama instance and inflate timeouts. (Prod builds don't double-invoke; the guard is correct regardless.)
  const generatedRef = useRef(false);

  useEffect(() => {
    if (generatedRef.current) return;
    generatedRef.current = true;
    generate();
  }, []);

  const generate = async () => {
    setState("generating");
    setError("");
    setGenProgress(null);
    try {
      const cfg = await getLLMConfig();
      setConfig(cfg);
      // Pull the spaced "review pool" (prior misses) so ~20% of the quiz is retrieval practice.
      const reviewPool = await getReviewPoolQuestions(courseId, 6);
      const generated = await generateQuizQuestions(syllabus, QUIZ_TARGET, cfg, reviewPool, (done, total) => setGenProgress({ done, total }));
      const attempt = await createQuizAttempt(courseId, "quiz", syllabus.level, generated.length);
      setAttemptId(attempt.id);
      setQuestions(generated.map((q) => ({ ...q, user_answer: null, is_correct: null })));
      setCurrentIndex(0);
      setScore(null);
      setState("in_progress");
    } catch (e) {
      setError(`Failed to generate quiz: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Save the answer for the current question — no auto-advance. isCorrect is null for free-text
  // answers (recorded now, graded in the end-of-test phase); the row is updated then.
  const handleAnswer = async (answer: string, isCorrect: boolean | null) => {
    const question = questions[currentIndex];
    let savedId: string | undefined;
    if (attemptId) {
      savedId = await saveQuizQuestion({
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
        self_explanation: question.self_explanation ?? null,
      });
    }
    setQuestions((prev) =>
      prev.map((q, i) => (i === currentIndex ? { ...q, user_answer: answer, is_correct: isCorrect, saved_id: savedId } : q))
    );
  };

  // Persist a self-explanation typed after the answer was graded (writes to the same quiz_questions row).
  const handleSelfExplain = async (text: string) => {
    const q = questions[currentIndex];
    setQuestions((prev) => prev.map((qq, i) => (i === currentIndex ? { ...qq, self_explanation: text } : qq)));
    if (q?.saved_id && text) {
      await updateQuizQuestionSelfExplanation(q.saved_id, text).catch(console.error);
    }
  };

  const handleFinish = async (finalQuestions: ActiveQuestion[]) => {
    if (finishingRef.current || !attemptId || !config) return;
    finishingRef.current = true;
    setFinishing(true);

    // ── 1. Deferred grading: settle every recorded free-text answer in ONE batch (issue #83), so
    // taking the quiz never blocks on a per-answer model call. MC/true_false are already resolved. ──
    const graded = await gradeRecordedAnswers(finalQuestions);

    // ── 2. Score and show results immediately. ALL persistence (incl. completeQuizAttempt) runs in
    // the background, so a DB hiccup can never strand the user on the grading spinner (review #5). ──
    const correct = graded.filter((q) => q.is_correct).length;
    const total = graded.length;
    const pct = total > 0 ? (correct / total) * 100 : 0;

    setQuestions(graded);
    setScore({ correct, total });
    setState("results");
    setFinishing(false);

    // ── 3. Persist (attempt + heavy mastery → progress → knowledge recompute) in the background —
    // results are already on screen, so the machine no longer bogs down at finish (issue #83). ──
    void persistQuizResults(graded, pct, correct, total);
  };

  // Grade the pending free-text answers (is_correct === null) in one batched call and write the
  // resolved grades back to their rows. Returns the questions with grades + feedback applied. Shows
  // a brief "Grading…" phase only when there is actually something to grade.
  const gradeRecordedAnswers = async (qs: ActiveQuestion[]): Promise<ActiveQuestion[]> => {
    if (!config) return qs;
    const pending = qs
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => q.is_correct === null && q.user_answer !== null);
    if (pending.length === 0) return qs;

    setState("grading");
    const t0 = performance.now();
    const outcomes = await gradeAnswersBatch(
      pending.map(({ q, index }) => ({
        index,
        question: q.question_text,
        expected: q.correct_answer,
        student: q.user_answer ?? "",
        type: q.question_type,
      })),
      config,
    );
    const graded = qs.map((q, i) => {
      const o = outcomes.get(i);
      return o ? { ...q, is_correct: o.isCorrect, feedback: o.feedback } : q;
    });
    await Promise.all(pending.map(({ index }) => {
      const q = graded[index];
      return q.saved_id ? updateQuizQuestionGrade(q.saved_id, !!q.is_correct).catch(console.error) : Promise.resolve();
    }));
    log.info("quiz", `graded ${pending.length} free-text answer(s) in ${Math.round(performance.now() - t0)}ms`);
    return graded;
  };

  const persistQuizResults = async (graded: ActiveQuestion[], pct: number, correct: number, total: number) => {
    const t0 = performance.now();
    try {
      if (attemptId) await completeQuizAttempt(attemptId, pct, correct, 0);
      const freshSyllabus = await getSyllabus(courseId, syllabus.level);
      if (freshSyllabus) {
        await updateSubtopicMastery(courseId, freshSyllabus, graded);
        await updateUserProgress(courseId);
        await refreshProgressContext(courseId, freshSyllabus);
      }
      const missedTopics = graded.filter((q) => !q.is_correct && q.subtopic_id).map((q) => q.subtopic_id!);
      await updateKnowledgeAfterQuiz(courseId, pct, total, missedTopics, null, config!);
      log.info("quiz", `quiz finish persistence done in ${Math.round(performance.now() - t0)}ms`);
    } catch (e) {
      console.error("quiz finish persistence failed", e);
    }
  };

  const question = questions[currentIndex];

  if (state === "generating") {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center">
        <div className="text-center">
          {error ? (
            <>
              <p className="text-red-400 text-sm mb-4">{error}</p>
              <button onClick={onClose} className="px-5 py-2 rounded-lg bg-panel-lite text-[var(--ink-dim)] text-sm hover:bg-lcd transition-colors">
                Back to Course
              </button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full border-2 border-phosphor border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-[var(--ink-faint)]">Generating quiz questions for {syllabus.title}...</p>
              {genProgress && (
                <p className="text-phosphor-bright text-sm mt-2 font-mono">{genProgress.done} / {genProgress.total} questions</p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (state === "grading") {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-phosphor border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-[var(--ink-faint)]">Grading your answers…</p>
        </div>
      </div>
    );
  }

  if (state === "results") {
    const pct = score ? (score.correct / score.total) * 100 : 0;
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--rule)] shrink-0">
          <div>
            <h1 className="text-base font-semibold text-ink">{course.title}</h1>
            <p className="text-xs text-[var(--ink-faint)]">Level {syllabus.level} — Quiz Results</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium transition-colors"
          >
            Return to Course
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className={`text-center p-6 rounded-2xl border mb-6 ${pct >= 80 ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
              <div className={`text-5xl font-bold mb-1 ${pct >= 80 ? "text-green-400" : "text-amber-400"}`}>
                {score?.correct}/{score?.total}
              </div>
              <div className="text-[var(--ink-faint)] text-sm">{Math.round(pct)}% correct</div>
              <p className="text-[var(--ink-dim)] text-sm mt-2">
                {pct >= 80 ? "Excellent! You have a strong grasp of this material." : "Keep studying — you're making progress."}
              </p>
            </div>

            <div className="space-y-4">
              {questions.map((q, i) => (
                <div key={i} className={`p-4 rounded-xl border ${q.is_correct ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-start gap-2 mb-2">
                    <span className={`text-sm font-bold shrink-0 ${q.is_correct ? "text-green-400" : "text-red-400"}`}>
                      {q.is_correct ? "✓" : "✗"}
                    </span>
                    <p className="text-sm text-ink">{q.question_text}</p>
                  </div>
                  {!q.is_correct && q.user_answer && (
                    <div className="ml-5 text-xs space-y-0.5">
                      <p className="text-red-400">Your answer: {q.user_answer}</p>
                      <p className="text-green-400">Correct: {q.correct_answer}</p>
                    </div>
                  )}
                  {q.feedback && <p className="ml-5 mt-1.5 text-xs text-[var(--ink-faint)] italic">{q.feedback}</p>}
                  {q.explanation && <p className="ml-5 mt-1.5 text-xs text-[var(--ink-faint)]">{q.explanation}</p>}
                  {q.subtopic_id && <p className="ml-5 mt-1 text-[10px] text-[var(--ink-faint)]">Subtopic: {q.subtopic_id}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // In progress
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const answeredCurrent = question?.user_answer !== null;
  const allAnswered = questions.every((q) => q.user_answer !== null);
  const isLastQuestion = currentIndex === questions.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-[var(--rule)] shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--ink-faint)] truncate">{course.title} — Level {syllabus.level}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-[var(--ink-faint)]">{currentIndex + 1} / {questions.length}</span>
            <div className="flex-1 h-1 rounded-full bg-lcd overflow-hidden">
              <div className="h-full rounded-full bg-[rgb(var(--phosphor-rgb)/0.14)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-faint)] hover:text-ink text-xs transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          Exit Quiz
        </button>
      </div>

      {questions.length < QUIZ_TARGET && (
        <div className={`px-6 py-1.5 text-[11px] border-b shrink-0 ${questions.length < QUIZ_FLOOR ? "text-red-400/90 bg-red-500/5 border-red-500/20" : "text-amber-400/80 bg-amber-500/5 border-amber-500/20"}`}>
          {questions.length < QUIZ_FLOOR
            ? `Only ${questions.length} of ${QUIZ_TARGET} questions generated — your model is struggling with this topic. A more capable model will give a fuller quiz.`
            : `Generated ${questions.length} of ${QUIZ_TARGET} questions — your model produced fewer than usual this run.`}
        </div>
      )}

      {/* Question */}
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            {question?.subtopic_id && (
              <span className="text-[10px] text-[var(--ink-faint)] mb-2 block">Subtopic: {question.subtopic_id}</span>
            )}
            <h2 className="text-lg text-ink leading-relaxed">{question?.question_text}</h2>
          </div>

          {question && (
            <QuestionRenderer
              key={currentIndex}
              question={question}
              onAnswer={handleAnswer}
              disabled={answeredCurrent}
              onSelfExplain={handleSelfExplain}
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
                onClick={() => handleFinish(questions)}
                disabled={!allAnswered || finishing}
                className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
              >
                {finishing ? "Saving..." : "Finish Quiz"}
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
