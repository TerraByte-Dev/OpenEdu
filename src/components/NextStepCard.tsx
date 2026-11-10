import { useEffect, useMemo, useState } from "react";
import type { Course, Syllabus, QuizAttempt } from "../types";
import { getQuizAttempts } from "../lib/db";
import { rankNextSteps, type NextStep, type NextStepAction } from "../lib/next-step";
import type { SwitchTabOpts, Tab } from "../views/CourseView";

interface NextStepCardProps {
  courseId: string;
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  switchTab: (tab: Tab, opts?: SwitchTabOpts) => void;
  onRegenerate?: () => void;
  onOpenPromotionTest?: () => void;
}

// The ranking itself lives in src/lib/next-step.ts (pure, tested) so the learner's Home can reuse it
// for its Continue button. This card maps each intent to the course view's callbacks.
interface Suggestion {
  key: string;
  title: string;
  blurb: string;
  action?: () => void;
  actionLabel?: string;
}

export default function NextStepCard({
  courseId,
  course,
  level,
  currentSyllabus,
  switchTab,
  onRegenerate,
  onOpenPromotionTest,
}: NextStepCardProps) {
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const a = await getQuizAttempts(courseId);
      if (!cancelled) setAttempts(a);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const run = (a: NextStepAction): (() => void) | undefined => {
      if (a.kind === "tab") return () => switchTab(a.tab, a.opts);
      if (a.kind === "promotion") return onOpenPromotionTest;
      return onRegenerate;
    };
    const steps: NextStep[] = rankNextSteps({
      course,
      level,
      currentSyllabus,
      attempts: attempts ?? [],
      canRegenerate: !!onRegenerate,
      canPromote: !!onOpenPromotionTest,
    });
    return steps.map((s) => ({ key: s.key, title: s.title, blurb: s.blurb, actionLabel: s.actionLabel, action: s.action ? run(s.action) : undefined }));
  }, [course, level, currentSyllabus, attempts, switchTab, onRegenerate, onOpenPromotionTest]);

  if (attempts === null) {
    return (
      <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
        <h3 className="text-sm text-[var(--ink-dim)] font-semibold mb-2">
          Next step
        </h3>
        <p className="text-sm text-[var(--ink-faint)]">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="glow-line" />
        <h3 className="text-sm text-phosphor-ink font-semibold">
          Next step
        </h3>
      </div>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.key}
            className="flex items-start gap-3 p-3 rounded-lg bg-panel-lite/40 hover:bg-panel-lite transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-base text-ink font-medium">{s.title}</div>
              <div className="text-sm text-[var(--ink-faint)] mt-0.5">{s.blurb}</div>
            </div>
            {s.action && (
              <button
                onClick={s.action}
                className="px-3 py-1.5 rounded-lg btn-primary text-sm font-medium hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors shrink-0"
              >
                {s.actionLabel ?? "Open"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
