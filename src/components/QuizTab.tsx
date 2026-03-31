import type { Syllabus } from "../types";

interface QuizTabProps {
  courseId: string;
  currentSyllabus: Syllabus | null;
  onStartQuiz?: () => void;
}

export default function QuizTab({ currentSyllabus, onStartQuiz }: QuizTabProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-zinc-100 mb-2">Knowledge Check</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Test your understanding of{" "}
          {currentSyllabus
            ? `Level ${currentSyllabus.level.toFixed(1)} — ${currentSyllabus.title}`
            : "the current material"}
          . 10 questions, untimed.
        </p>
        {!currentSyllabus && (
          <p className="text-xs text-amber-400/70 mb-4">
            No syllabus for this level yet — generate one in the Syllabus tab first.
          </p>
        )}
        <button
          onClick={onStartQuiz}
          disabled={!currentSyllabus || !onStartQuiz}
          className="px-6 py-3 rounded-xl bg-terra-600 hover:bg-terra-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Start Quiz
        </button>
      </div>
    </div>
  );
}
