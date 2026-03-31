import { useState, useMemo } from "react";
import type { QuizQuestion, LLMConfig } from "../../types";
import { gradeWrittenResponse } from "../../lib/quiz";

interface QuestionRendererProps {
  question: Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct"> & {
    user_answer: string | null;
    is_correct: boolean | null;
  };
  onAnswer: (answer: string, isCorrect: boolean) => void;
  disabled?: boolean;
  config: LLMConfig;
}

export default function QuestionRenderer({ question, onAnswer, disabled, config }: QuestionRendererProps) {
  const [selected, setSelected] = useState<string>("");
  const [grading, setGrading] = useState(false);
  const [gradeFeedback, setGradeFeedback] = useState("");
  const [matchPairs, setMatchPairs] = useState<Record<string, string>>({});
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // AI-grade any free-text answer (fill-in-blank, written response, word problem)
  const handleAIGrade = async () => {
    if (!selected.trim() || grading) return;
    setGrading(true);
    try {
      const result = await gradeWrittenResponse(
        question.question_text,
        question.correct_answer,
        selected.trim(),
        config,
      );
      setGradeFeedback(result.feedback);
      setSubmitted(true);
      onAnswer(selected.trim(), result.isCorrect);
    } catch {
      setSubmitted(true);
      onAnswer(selected.trim(), true);
    } finally {
      setGrading(false);
    }
  };

  // Drag-to-match: toggle a pair (match or unmatch)
  const handleMatchLeft = (item: string) => {
    if (disabled || submitted) return;
    if (matchPairs[item]) {
      // Unmatch: clicking a matched left item clears it
      const updated = { ...matchPairs };
      delete updated[item];
      setMatchPairs(updated);
      setSelectedLeft(null);
    } else {
      setSelectedLeft(item === selectedLeft ? null : item);
    }
  };

  const handleMatchRight = (item: string) => {
    if (disabled || submitted || selectedLeft === null) return;
    // If this right item is already matched to someone else, unmatch that first
    const updated = { ...matchPairs };
    for (const [k, v] of Object.entries(updated)) {
      if (v === item) delete updated[k];
    }
    updated[selectedLeft] = item;
    setMatchPairs(updated);
    setSelectedLeft(null);
  };

  const handleSubmitMatch = () => {
    const pairs = question.matching_pairs ?? [];
    const allCorrect = pairs.every((p) => matchPairs[p.left] === p.right);
    setSubmitted(true);
    onAnswer(JSON.stringify(matchPairs), allCorrect);
  };

  // Memoize shuffled right items so they don't reshuffle on re-render
  const shuffledRight = useMemo(() => {
    const pairs = question.matching_pairs ?? [];
    return [...pairs.map((p) => p.right)].sort(() => Math.random() - 0.5);
  }, [question.question_text]);

  // Show answered feedback when revisiting an already-answered question
  if (disabled && question.user_answer !== null) {
    return (
      <div className={`p-4 rounded-xl border text-sm ${question.is_correct ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}>
        <div className={`font-medium mb-1 ${question.is_correct ? "text-green-300" : "text-red-300"}`}>
          {question.is_correct ? "✓ Correct" : "✗ Incorrect"}
        </div>
        {!question.is_correct && (
          <p className="text-red-300/80 text-xs mb-1">
            Your answer: {question.user_answer}
            <br />
            Correct answer: {question.correct_answer}
          </p>
        )}
        {question.explanation && <p className="text-zinc-400 text-xs">{question.explanation}</p>}
      </div>
    );
  }

  switch (question.question_type) {
    case "multiple_choice":
    case "true_false": {
      const options = question.question_type === "true_false"
        ? ["True", "False"]
        : (question.options ?? []);
      return (
        <div className="space-y-3">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => {
                if (submitted || disabled) return;
                setSelected(option);
                setSubmitted(true);
                onAnswer(option, option === question.correct_answer);
              }}
              disabled={disabled || submitted}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                selected === option
                  ? "border-terra-500 bg-terra-500/10 text-zinc-100"
                  : "border-surface-500 bg-surface-700/50 text-zinc-300 hover:border-terra-500/50 disabled:opacity-50"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }

    case "fill_in_blank": {
      const sentence = question.blank_position ?? question.question_text;
      const parts = sentence.split("___");
      return (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            {parts[0]}
            <input
              type="text"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && selected.trim() && !submitted) handleAIGrade(); }}
              disabled={disabled || submitted || grading}
              placeholder="your answer"
              className="inline-block mx-2 px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-500 text-zinc-100 text-sm focus:outline-none focus:border-terra-500 w-44"
            />
            {parts[1] ?? ""}
          </p>
          {gradeFeedback && (
            <p className="text-sm text-zinc-400 italic">{gradeFeedback}</p>
          )}
          {!submitted && (
            <button
              onClick={handleAIGrade}
              disabled={!selected.trim() || disabled || grading}
              className="px-5 py-2 rounded-xl bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {grading ? "Grading..." : "Check Answer"}
            </button>
          )}
        </div>
      );
    }

    case "written_response":
    case "word_problem":
    case "short_answer": {
      return (
        <div className="space-y-4">
          <textarea
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={disabled || submitted || grading}
            placeholder="Write your answer here..."
            rows={4}
            className="w-full px-4 py-3 rounded-xl bg-surface-700 border border-surface-500 text-zinc-100 text-sm focus:outline-none focus:border-terra-500 resize-none"
          />
          {gradeFeedback && (
            <p className="text-sm text-zinc-400 italic">{gradeFeedback}</p>
          )}
          {!submitted && (
            <button
              onClick={handleAIGrade}
              disabled={!selected.trim() || disabled || grading}
              className="px-5 py-2 rounded-xl bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {grading ? "Grading..." : "Submit Answer"}
            </button>
          )}
        </div>
      );
    }

    case "drag_to_match": {
      const pairs = question.matching_pairs ?? [];
      const leftItems = pairs.map((p) => p.left);
      const allMatched = Object.keys(matchPairs).length === pairs.length;
      return (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 mb-2">Click a left item, then its match on the right. Click a paired item again to unmatch.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {leftItems.map((item) => {
                const isPaired = !!matchPairs[item];
                const isSelected = selectedLeft === item;
                return (
                  <button
                    key={item}
                    onClick={() => handleMatchLeft(item)}
                    disabled={disabled || submitted}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      isSelected
                        ? "border-terra-500 bg-terra-500/15 text-zinc-100"
                        : isPaired
                        ? "border-terra-400/40 bg-terra-500/10 text-zinc-200"
                        : "border-surface-500 bg-surface-700/50 text-zinc-300 hover:border-terra-400/50"
                    }`}
                  >
                    <span>{item}</span>
                    {isPaired && (
                      <span className="ml-2 text-xs text-terra-300">→ {matchPairs[item]}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {shuffledRight.map((item) => {
                const isMatched = Object.values(matchPairs).includes(item);
                return (
                  <button
                    key={item}
                    onClick={() => handleMatchRight(item)}
                    disabled={disabled || submitted || selectedLeft === null}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      isMatched
                        ? "border-terra-400/40 bg-terra-500/10 text-zinc-300"
                        : selectedLeft !== null
                        ? "border-surface-400 bg-surface-700 text-zinc-200 hover:border-terra-400"
                        : "border-surface-500 bg-surface-700/50 text-zinc-500"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
          {allMatched && !submitted && (
            <button
              onClick={handleSubmitMatch}
              className="mt-2 px-5 py-2 rounded-xl bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium transition-colors"
            >
              Submit Matches
            </button>
          )}
          {submitted && (
            <div className={`p-3 rounded-lg text-sm ${question.is_correct ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
              {question.is_correct ? "✓ All matches correct!" : "✗ Some matches were wrong."}
            </div>
          )}
        </div>
      );
    }

    default:
      return <p className="text-zinc-400 text-sm">Unknown question type.</p>;
  }
}
