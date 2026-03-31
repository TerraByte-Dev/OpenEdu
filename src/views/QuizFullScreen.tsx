import { useState, useEffect } from "react";
import type { QuizViewContext, QuizQuestion, LLMConfig } from "../types";
import { createQuizAttempt, saveQuizQuestion, completeQuizAttempt, getSyllabus } from "../lib/db";
import { generateQuizQuestions } from "../lib/quiz";
import { getLLMConfig } from "../lib/store";
import { updateSubtopicMastery, updateUserProgress, refreshProgressContext } from "../lib/progress";
import { updateKnowledgeAfterQuiz } from "../lib/knowledge";
import QuestionRenderer from "../components/quiz/QuestionRenderer";

interface QuizFullScreenProps {
  context: QuizViewContext;
  onClose: () => void;
}

type State = "generating" | "in_progress" | "results";

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id"> {
  user_answer: string | null;
  is_correct: boolean | null;
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
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    generate();
  }, []);

  const generate = async () => {
    setState("generating");
    setError("");
    try {
      const cfg = await getLLMConfig();
      setConfig(cfg);
      const generated = await generateQuizQuestions(syllabus, 20, cfg);
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

  // Save the answer for the current question — no auto-advance
  const handleAnswer = async (answer: string, isCorrect: boolean) => {
    const question = questions[currentIndex];
    const updatedQuestions = questions.map((q, i) =>
      i === currentIndex ? { ...q, user_answer: answer, is_correct: isCorrect } : q
    );
    setQuestions(updatedQuestions);

    if (attemptId) {
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
    }
  };

  const handleFinish = async (finalQuestions: ActiveQuestion[]) => {
    if (finishing || !attemptId || !config) return;
    setFinishing(true);
    const correct = finalQuestions.filter((q) => q.is_correct).length;
    const total = finalQuestions.length;
    setScore({ correct, total });

    await completeQuizAttempt(attemptId, (correct / total) * 100, correct, 0);
    const freshSyllabus = await getSyllabus(courseId, syllabus.level);
    if (freshSyllabus) {
      await updateSubtopicMastery(courseId, freshSyllabus, finalQuestions);
      await updateUserProgress(courseId);
      await refreshProgressContext(courseId, freshSyllabus);
    }
    const missedTopics = finalQuestions
      .filter((q) => !q.is_correct && q.subtopic_id)
      .map((q) => q.subtopic_id!);
    await updateKnowledgeAfterQuiz(courseId, (correct / total) * 100, total, missedTopics, null, config).catch(console.error);

    setState("results");
    setFinishing(false);
  };

  const question = questions[currentIndex];

  if (state === "generating") {
    return (
      <div className="fixed inset-0 z-50 bg-surface-900 flex flex-col items-center justify-center">
        <div className="text-center">
          {error ? (
            <>
              <p className="text-red-400 text-sm mb-4">{error}</p>
              <button onClick={onClose} className="px-5 py-2 rounded-lg bg-surface-700 text-zinc-300 text-sm hover:bg-surface-600 transition-colors">
                Back to Course
              </button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full border-2 border-terra-500 border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-zinc-400">Generating quiz questions for {syllabus.title}...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (state === "results") {
    const pct = score ? (score.correct / score.total) * 100 : 0;
    return (
      <div className="fixed inset-0 z-50 bg-surface-900 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700 shrink-0">
          <div>
            <h1 className="text-base font-semibold text-zinc-100">{course.title}</h1>
            <p className="text-xs text-zinc-500">Level {syllabus.level.toFixed(1)} — Quiz Results</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium transition-colors"
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
              <div className="text-zinc-400 text-sm">{Math.round(pct)}% correct</div>
              <p className="text-zinc-300 text-sm mt-2">
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
                    <p className="text-sm text-zinc-200">{q.question_text}</p>
                  </div>
                  {!q.is_correct && q.user_answer && (
                    <div className="ml-5 text-xs space-y-0.5">
                      <p className="text-red-400">Your answer: {q.user_answer}</p>
                      <p className="text-green-400">Correct: {q.correct_answer}</p>
                    </div>
                  )}
                  {q.explanation && <p className="ml-5 mt-1.5 text-xs text-zinc-500">{q.explanation}</p>}
                  {q.subtopic_id && <p className="ml-5 mt-1 text-[10px] text-zinc-600">Subtopic: {q.subtopic_id}</p>}
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
    <div className="fixed inset-0 z-50 bg-surface-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-surface-700 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-500 truncate">{course.title} — Level {syllabus.level.toFixed(1)}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-zinc-400">{currentIndex + 1} / {questions.length}</span>
            <div className="flex-1 h-1 rounded-full bg-surface-600 overflow-hidden">
              <div className="h-full rounded-full bg-terra-500 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-zinc-400 hover:text-zinc-200 text-xs transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          Exit Quiz
        </button>
      </div>

      {/* Question */}
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            {question?.subtopic_id && (
              <span className="text-[10px] text-zinc-500 mb-2 block">Subtopic: {question.subtopic_id}</span>
            )}
            <h2 className="text-lg text-zinc-100 leading-relaxed">{question?.question_text}</h2>
          </div>

          {question && config && (
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
              className="px-5 py-2.5 rounded-xl border border-surface-500 text-zinc-300 text-sm font-medium disabled:opacity-30 hover:bg-surface-700 transition-colors"
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
                className="px-5 py-2.5 rounded-xl bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
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
