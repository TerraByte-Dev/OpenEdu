import { useState, useEffect } from "react";
import type { QuizAttempt, Syllabus } from "../types";
import { getQuizAttempts, getSubtopicAccuracy } from "../lib/db";
import { computeStreak, accuracyPct, minutesFromSeconds } from "../lib/analytics";

interface ProgressDashboardProps {
  courseId: string;
  currentSyllabus: Syllabus | null;
}

// Trends from data already written — no model calls (slice B3). Streak / quizzes / avg / time tiles,
// a recent-score sparkbar, and a per-subtopic accuracy heatmap for the current level.
export default function ProgressDashboard({ courseId, currentSyllabus }: ProgressDashboardProps) {
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [accuracy, setAccuracy] = useState<Record<string, { correct: number; total: number }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await getQuizAttempts(courseId);
      const acc = await getSubtopicAccuracy(courseId);
      if (!alive) return;
      setAttempts(a);
      setAccuracy(Object.fromEntries(acc.map((r) => [r.subtopic_id, { correct: r.correct, total: r.total }])));
    })();
    return () => { alive = false; };
  }, [courseId]);

  if (attempts === null) return null; // quietly absent until loaded

  const completed = attempts.filter((a) => a.completed_at !== null && a.score !== null);
  const streak = computeStreak(attempts.map((a) => a.started_at), new Date());
  const avg = completed.length ? Math.round(completed.reduce((s, a) => s + (a.score ?? 0), 0) / completed.length) : null;
  const minutes = minutesFromSeconds(completed.reduce((s, a) => s + (a.time_taken_seconds ?? 0), 0));
  const recent = completed.slice(0, 10).reverse(); // chronological, last 10

  const scoreColor = (pct: number) => (pct >= 80 ? "var(--phosphor)" : pct >= 60 ? "#fbbf24" : "#f87171");

  return (
    <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="glow-line" />
        <h3 className="text-xs uppercase tracking-wider text-phosphor-ink font-semibold">Progress</h3>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        <Tile label="Streak" value={streak === 0 ? "—" : `${streak}d`} accent={streak > 0} />
        <Tile label="Quizzes" value={String(completed.length)} />
        <Tile label="Avg score" value={avg === null ? "—" : `${avg}%`} />
        <Tile label="Time" value={minutes === 0 ? "—" : `${minutes}m`} />
      </div>

      {/* Recent scores */}
      <div className="mb-5">
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">Recent scores</h4>
        {recent.length === 0 ? (
          <p className="text-xs text-[var(--ink-faint)]">Take a quiz to start tracking your scores.</p>
        ) : (
          <div className="flex items-end gap-1.5 h-20">
            {recent.map((a) => {
              const pct = Math.round(a.score ?? 0);
              return (
                <div key={a.id} className="flex-1 flex flex-col items-center justify-end h-full" title={`${pct}% · ${a.quiz_type === "promotion" ? "Promotion test" : "Quiz"} · L${a.level}`}>
                  <div
                    className="w-full rounded-t transition-all"
                    style={{ height: `${Math.max(4, pct)}%`, background: scoreColor(pct), opacity: a.quiz_type === "promotion" ? 1 : 0.7 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-subtopic accuracy (current level) */}
      {currentSyllabus && currentSyllabus.subtopics.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">
            Accuracy by subtopic — Level {currentSyllabus.level}
          </h4>
          <ul className="space-y-1.5">
            {currentSyllabus.subtopics.map((sub) => {
              const a = accuracy[sub.id] ?? { correct: 0, total: 0 };
              const pct = accuracyPct(a);
              return (
                <li key={sub.id} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--ink-dim)] w-40 truncate shrink-0">{sub.title}</span>
                  <div className="flex-1 h-2 rounded-full bg-lcd overflow-hidden">
                    {pct !== null && (
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: scoreColor(pct) }} />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-[var(--ink-faint)] w-12 text-right shrink-0">
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-panel-lite/50 border border-[var(--rule)] px-3 py-2.5 text-center">
      <div className={`readout-val text-lg leading-none ${accent ? "text-phosphor-bright" : "text-ink"}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-[var(--ink-faint)] mt-1">{label}</div>
    </div>
  );
}
