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
        <h2 className="text-xl font-semibold text-ink mb-2">Knowledge Check</h2>
        <p className="text-sm text-[var(--ink-faint)] mb-6">
          Test your understanding of{" "}
          {currentSyllabus
            ? `Level ${currentSyllabus.level} — ${currentSyllabus.title}`
            : "the current material"}
          . 20 questions, untimed.
        </p>
        {!currentSyllabus && (
          <p className="text-xs text-amber-400/70 mb-4">
            No syllabus for this level yet — generate one in the Syllabus tab first.
          </p>
        )}
        <button
          onClick={onStartQuiz}
          disabled={!currentSyllabus || !onStartQuiz}
          className="px-6 py-3 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Start Quiz
        </button>
      </div>
    </div>
  );
}
