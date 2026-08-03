import { useState } from "react";
import type { Course, Syllabus } from "../types";

interface CompletionCapstoneProps {
  course: Course;
  syllabuses: Syllabus[];      // all levels, for the mastery tally
  masterySyllabus: Syllabus | null; // L6 — its learning_objectives are the synthesis skills
  overallScore: number;
  onDone: () => void;
  onArchive: () => void | Promise<void>;
}

// The end of the arc: a code-assembled (no LLM → small-model-safe) completion screen shown when the
// student passes the L6 mastery exam. Celebrates, summarizes mastery across all six levels, and
// offers to archive the finished course.
export default function CompletionCapstone({ course, syllabuses, masterySyllabus, overallScore, onDone, onArchive }: CompletionCapstoneProps) {
  const [archiving, setArchiving] = useState(false);

  const learningLevels = syllabuses.filter((s) => s.level <= 5);
  const totalSubtopics = learningLevels.reduce((n, s) => n + s.subtopics.length, 0);
  const masteredSubtopics = learningLevels.reduce((n, s) => n + s.subtopics.filter((t) => t.mastered).length, 0);
  const synthesisSkills = (masterySyllabus?.learning_objectives ?? []).slice(0, 6);

  const archive = async () => {
    setArchiving(true);
    await onArchive();
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      <div className="flex items-center justify-end px-6 py-4 shrink-0">
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium transition-colors"
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-10">
        <div className="max-w-xl mx-auto text-center">
          <div className="text-6xl mb-4 phosphor-glow">🎓</div>
          <h1 className="text-3xl font-bold text-ink mb-1">Course complete</h1>
          <p className="text-[var(--ink-dim)] mb-1">{course.title}</p>
          <p className="text-sm text-[var(--ink-faint)] mb-8">
            You passed the mastery exam with {Math.round(overallScore)}% — the full six-level curriculum is behind you.
          </p>

          {/* Mastery tally */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <Stat value="6" label="Levels cleared" />
            <Stat value={`${masteredSubtopics}/${totalSubtopics}`} label="Subtopics mastered" />
            <Stat value={`${Math.round(overallScore)}%`} label="Mastery exam" />
          </div>

          {/* Synthesis skills */}
          {synthesisSkills.length > 0 && (
            <div className="text-left rounded-xl border border-[var(--rule)] bg-panel p-5 mb-8">
              <h3 className="text-xs uppercase tracking-wider text-phosphor-ink font-semibold mb-3">
                What you can now do
              </h3>
              <ul className="space-y-2">
                {synthesisSkills.map((skill, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--ink-dim)]">
                    <span className="text-phosphor-ink shrink-0">✓</span>
                    <span>{skill}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-[var(--ink-faint)] mb-4">
            Ready for what's next? Start a new course from the dashboard to keep the momentum going.
          </p>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onDone}
              className="px-5 py-2.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium transition-colors"
            >
              Back to course
            </button>
            <button
              onClick={archive}
              disabled={archiving}
              className="px-5 py-2.5 rounded-xl border border-[var(--rule)] text-[var(--ink-dim)] text-sm font-medium hover:bg-panel-lite disabled:opacity-50 transition-colors"
            >
              {archiving ? "Archiving…" : "Archive course"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-panel border border-[var(--rule)] px-3 py-4">
      <div className="readout-val text-2xl leading-none text-phosphor-bright">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] mt-1.5">{label}</div>
    </div>
  );
}
