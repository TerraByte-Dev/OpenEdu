import { useState } from "react";
import type { Syllabus, QuizQuestion } from "../types";
import { createQuizAttempt, saveQuizQuestion, completeQuizAttempt } from "../lib/db";
import { generateQuizQuestions } from "../lib/quiz";
import { getLLMConfig } from "../lib/store";

interface QuizTabProps {
  courseId: string;
  currentSyllabus: Syllabus | null;
}

type QuizState = "idle" | "generating" | "in_progress" | "reviewing";

interface ActiveQuestion extends Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct"> {
  user_answer: string | null;
  is_correct: boolean | null;
}

export default function QuizTab({ courseId, currentSyllabus }: QuizTabProps) {
  const [state, setState] = useState<QuizState>("idle");
  const [questions, setQuestions] = useState<ActiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const startQuiz = async () => {
    if (!currentSyllabus) {
      setError("No syllabus available for the current level.");
      return;
    }

    setState("generating");
    setError("");

    try {
      const config = await getLLMConfig();
      const generated = await generateQuizQuestions(currentSyllabus, 10, config);

      const attempt = await createQuizAttempt(courseId, "quiz", currentSyllabus.level, generated.length);
      setAttemptId(attempt.id);

      setQuestions(generated.map((q) => ({ ...q, user_answer: null, is_correct: null })));
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setScore(null);
      setState("in_progress");
    } catch (e) {
      setError(`Failed to generate quiz: ${e instanceof Error ? e.message : String(e)}`);
      setState("idle");
    }
  };

  const submitAnswer = () => {
    if (selectedAnswer === null) return;

    const question = questions[currentIndex];
    const isCorrect = selectedAnswer === question.correct_answer;

    setQuestions((prev) =>
      prev.map((q, i) =>
        i === currentIndex ? { ...q, user_answer: selectedAnswer, is_correct: isCorrect } : q
      )
    );

    // Save to DB
    if (attemptId) {
      saveQuizQuestion({
        attempt_id: attemptId,
        question_text: question.question_text,
        question_type: question.question_type,
        options: question.options,
        correct_answer: question.correct_answer,
        user_answer: selectedAnswer,
        is_correct: isCorrect,
        difficulty_level: question.difficulty_level,
        explanation: question.explanation,
      });
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
    } else {
      // Quiz complete
      const answered = questions.map((q, i) =>
        i === currentIndex ? { ...q, user_answer: selectedAnswer, is_correct: isCorrect } : q
      );
      const correct = answered.filter((q) => q.is_correct).length;
      const total = answered.length;
      setScore({ correct, total });

      if (attemptId) {
        completeQuizAttempt(attemptId, (correct / total) * 100, correct, 0);
      }

      setState("reviewing");
    }
  };

  if (state === "idle") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">Knowledge Check</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Test your understanding of{" "}
            {currentSyllabus
              ? `Level ${currentSyllabus.level} — ${currentSyllabus.title}`
              : "the current material"}
            . 10 questions, untimed.
          </p>
          {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
          <button
            onClick={startQuiz}
            className="px-6 py-3 rounded-xl bg-terra-600 hover:bg-terra-500 text-white font-medium transition-colors"
          >
            Start Quiz
          </button>
        </div>
      </div>
    );
  }

  if (state === "generating") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin text-terra-400 text-2xl mb-3">&#9696;</div>
          <p className="text-zinc-400">Generating questions...</p>
        </div>
      </div>
    );
  }

  if (state === "reviewing") {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-zinc-100 mb-2">Quiz Complete</h2>
            <p className={`text-4xl font-bold ${
              score && score.correct / score.total >= 0.8 ? "text-green-400" : "text-amber-400"
            }`}>
              {score?.correct}/{score?.total}
            </p>
            <p className="text-sm text-zinc-400 mt-1">
              {score && score.correct / score.total >= 0.8
                ? "Great job! You're mastering this material."
                : "Keep studying — you'll get there!"}
            </p>
          </div>

          <div className="space-y-4">
            {questions.map((q, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border ${
                  q.is_correct ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="flex items-start gap-2 mb-2">
                  <span className={`text-sm font-bold ${q.is_correct ? "text-green-400" : "text-red-400"}`}>
                    {q.is_correct ? "+" : "x"}
                  </span>
                  <p className="text-sm text-zinc-200">{q.question_text}</p>
                </div>
                {!q.is_correct && (
                  <div className="ml-5 text-xs">
                    <p className="text-red-400">Your answer: {q.user_answer}</p>
                    <p className="text-green-400">Correct: {q.correct_answer}</p>
                  </div>
                )}
                <p className="ml-5 mt-2 text-xs text-zinc-500">{q.explanation}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <button
              onClick={() => { setState("idle"); setQuestions([]); setScore(null); }}
              className="px-6 py-2.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-zinc-200 text-sm transition-colors"
            >
              Back to Quiz Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // In progress
  const question = questions[currentIndex];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full">
        {/* Progress */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm text-zinc-500">
            {currentIndex + 1} / {questions.length}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-surface-600 overflow-hidden">
            <div
              className="h-full rounded-full bg-terra-500 transition-all"
              style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <h3 className="text-lg text-zinc-100 mb-6">{question.question_text}</h3>

        {/* Options */}
        <div className="space-y-3 mb-6">
          {(question.options ?? ["True", "False"]).map((option) => (
            <button
              key={option}
              onClick={() => setSelectedAnswer(option)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                selectedAnswer === option
                  ? "border-terra-500 bg-terra-500/10 text-zinc-100"
                  : "border-surface-500 bg-surface-800 text-zinc-300 hover:border-surface-400"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <button
          onClick={submitAnswer}
          disabled={selectedAnswer === null}
          className="w-full px-6 py-3 rounded-xl bg-terra-600 hover:bg-terra-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {currentIndex < questions.length - 1 ? "Next" : "Finish Quiz"}
        </button>
      </div>
    </div>
  );
}
