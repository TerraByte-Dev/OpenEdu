import { useEffect, useMemo, useState } from "react";
import type { Course, Syllabus, QuizAttempt } from "../types";
import { getQuizAttempts } from "../lib/db";
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
    return rankSuggestions({
      course,
      level,
      currentSyllabus,
      attempts: attempts ?? [],
      switchTab,
      onRegenerate,
      onOpenPromotionTest,
    });
  }, [course, level, currentSyllabus, attempts, switchTab, onRegenerate, onOpenPromotionTest]);

  if (attempts === null) {
    return (
      <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
        <h3 className="text-xs uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">
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
        <h3 className="text-xs uppercase tracking-wider text-phosphor-ink font-semibold">
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
              <div className="text-sm text-ink font-medium">{s.title}</div>
              <div className="text-xs text-[var(--ink-faint)] mt-0.5">{s.blurb}</div>
            </div>
            {s.action && (
              <button
                onClick={s.action}
                className="px-3 py-1.5 rounded-lg btn-primary text-white text-xs font-medium hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors shrink-0"
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

function rankSuggestions(input: {
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  attempts: QuizAttempt[];
  switchTab: (tab: Tab, opts?: SwitchTabOpts) => void;
  onRegenerate?: () => void;
  onOpenPromotionTest?: () => void;
}): Suggestion[] {
  const { course, level, currentSyllabus, attempts, switchTab, onRegenerate, onOpenPromotionTest } = input;
  const out: Suggestion[] = [];

  // Rule 1 — No syllabus for this level
  if (!currentSyllabus) {
    if (onRegenerate) {
      out.push({
        key: "generate",
        title: "Generate your syllabus",
        blurb: "We need a syllabus before you can quiz, chat, or take a promotion test.",
        action: onRegenerate,
        actionLabel: "Generate",
      });
    } else {
      out.push({
        key: "no-syllabus",
        title: "Syllabus not generated yet",
        blurb: "Once the course finishes generating, this level's syllabus will appear here.",
      });
    }
    return out;
  }

  // Rule 2 — Generation incomplete (course-level pause/checkpoint)
  if (course.generation_state && course.generation_state !== "completed") {
    out.push({
      key: "resume",
      title: "Resume course generation",
      blurb: `Generation paused at "${course.generation_state}". Open the sidebar to resume.`,
    });
  }

  const subtopics = currentSyllabus.subtopics;
  const total = subtopics.length;
  const masteredCount = subtopics.filter((s) => s.mastered).length;

  // Level-scoped attempt stats
  const levelAttempts = attempts.filter(
    (a) => a.level === level && a.quiz_type === "quiz" && a.completed_at !== null && a.score !== null
  );
  const lastAttempt = levelAttempts[0]; // attempts are ORDER BY started_at DESC
  const lastQuizPct = lastAttempt?.score ?? null;

  // Rule 3 — Ready for Promotion Test
  if (
    onOpenPromotionTest &&
    total > 0 &&
    masteredCount >= total - 1 &&
    lastQuizPct !== null &&
    lastQuizPct >= 80
  ) {
    out.push({
      key: "promotion",
      title: "You look ready for the Promotion Test",
      blurb: `${masteredCount}/${total} subtopics mastered · last quiz ${Math.round(lastQuizPct)}%.`,
      action: onOpenPromotionTest,
      actionLabel: "Take test",
    });
  }

  // Rule 4 — No quiz attempts at this level
  if (levelAttempts.length === 0) {
    out.push({
      key: "first-quiz",
      title: "Take a practice quiz when you're ready",
      blurb: "Quiz results unlock the readiness signal for promotion.",
      action: () => switchTab("quiz"),
      actionLabel: "Open Quiz",
    });
  }

  // Rule 5 — A previously-mastered subtopic flagged for review
  const reviewSub = subtopics.find((s) => s.review_needed);
  if (reviewSub) {
    out.push({
      key: `review-${reviewSub.id}`,
      title: `Review "${reviewSub.title}"`,
      blurb: "You missed this on a recent spaced-review question.",
      action: () => switchTab("chat", { seedTopic: reviewSub.title }),
      actionLabel: "Chat",
    });
  }

  // Rule 6 — Default: chat about the weakest subtopic
  if (out.length < 3) {
    const weakest =
      subtopics.find((s) => !s.mastered && !s.practiced) ??
      subtopics.find((s) => !s.mastered) ??
      subtopics[0];
    if (weakest) {
      out.push({
        key: `chat-${weakest.id}`,
        title: `Chat with your tutor about "${weakest.title}"`,
        blurb: "Build understanding before your next quiz.",
        action: () => switchTab("chat", { seedTopic: weakest.title }),
        actionLabel: "Chat",
      });
    }
  }

  return out.slice(0, 3);
}
