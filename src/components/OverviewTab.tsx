import type { Course, Syllabus, Subtopic } from "../types";
import { getLevelMeaning } from "../lib/curriculum";
import type { SwitchTabOpts, Tab } from "../views/CourseView";
import NextStepCard from "./NextStepCard";

interface OverviewTabProps {
  courseId: string;
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  onRegenerate?: () => void;
  regenerating?: boolean;
  regenStatus?: string;
  switchTab: (tab: Tab, opts?: SwitchTabOpts) => void;
  onOpenPromotionTest?: () => void;
}

type SubtopicState = "untouched" | "practiced" | "mastered";

function getSubtopicState(sub: Subtopic): SubtopicState {
  if (sub.mastered) return "mastered";
  if (sub.practiced) return "practiced";
  return "untouched";
}

export default function OverviewTab({
  courseId,
  course,
  level,
  currentSyllabus,
  onRegenerate,
  regenerating,
  regenStatus,
  switchTab,
  onOpenPromotionTest,
}: OverviewTabProps) {
  const generationIncomplete =
    course.generation_state != null && course.generation_state !== "completed";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Level briefing header */}
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="tag">Level {level}</span>
            <span className="text-xs text-[var(--ink-faint)] font-mono uppercase tracking-wider">
              {getLevelMeaning(level)}
            </span>
          </div>
          {currentSyllabus ? (
            <>
              <h2 className="text-2xl text-ink font-semibold leading-tight">
                {currentSyllabus.title}
              </h2>
              <p className="text-sm text-[var(--ink-dim)] leading-relaxed">
                {currentSyllabus.description}
              </p>
            </>
          ) : (
            <h2 className="text-2xl text-ink font-semibold leading-tight">
              {course.title}
            </h2>
          )}
        </header>

        {generationIncomplete && (
          <div className="flex items-center gap-2 text-xs text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            Course generation paused at <span className="font-mono">{course.generation_state}</span>. Open the sidebar to resume.
          </div>
        )}

        {/* No-syllabus fallback */}
        {!currentSyllabus && onRegenerate && (
          <div className="rounded-xl border border-[var(--rule)] bg-panel p-6 text-center">
            <p className="text-[var(--ink-faint)] mb-3 text-sm">
              No syllabus generated for this level yet.
            </p>
            <p className="text-[var(--ink-faint)] mb-3 text-xs italic">
              {'If an older course is showing garbled math (e.g. "$\\text{c}$"), regenerating will fix it.'}
            </p>
            {regenStatus && (
              <p
                className={`text-sm mb-3 ${
                  regenStatus.startsWith("Error") ? "text-red-400" : "text-phosphor-bright"
                }`}
              >
                {regenStatus}
              </p>
            )}
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="px-5 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {regenerating ? "Generating..." : "Generate Syllabus Now"}
            </button>
          </div>
        )}

        {/* Mastery dashboard */}
        {currentSyllabus && (
          <MasteryDashboard
            syllabus={currentSyllabus}
            onSubtopicChat={(title) => switchTab("chat", { seedTopic: title })}
          />
        )}

        {/* Next step card */}
        <NextStepCard
          courseId={courseId}
          course={course}
          level={level}
          currentSyllabus={currentSyllabus}
          switchTab={switchTab}
          onRegenerate={!currentSyllabus ? onRegenerate : undefined}
          onOpenPromotionTest={onOpenPromotionTest}
        />
      </div>
    </div>
  );
}

function MasteryDashboard({
  syllabus,
  onSubtopicChat,
}: {
  syllabus: Syllabus;
  onSubtopicChat: (title: string) => void;
}) {
  const total = syllabus.subtopics.length;
  const mastered = syllabus.subtopics.filter((s) => s.mastered).length;
  const practiced = syllabus.subtopics.filter((s) => s.practiced && !s.mastered).length;

  return (
    <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
      <div className="flex items-baseline gap-4 mb-4">
        <h3 className="text-xs uppercase tracking-wider text-[var(--ink-faint)] font-semibold">
          Mastery
        </h3>
        <div className="flex items-baseline gap-3 ml-auto">
          <span className="readout-val text-xl leading-none">
            {mastered}
            <span className="text-[var(--ink-faint)] text-base">/{total}</span>
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
            mastered
          </span>
          {practiced > 0 && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] ml-2">
              · {practiced} practiced
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-1.5">
        {syllabus.subtopics.map((sub) => {
          const state = getSubtopicState(sub);
          return (
            <li
              key={sub.id}
              className="flex items-center gap-3 p-2 rounded-lg bg-panel-lite/40 hover:bg-panel-lite transition-colors group"
            >
              <SubtopicDot state={state} reviewNeeded={!!sub.review_needed} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{sub.title}</div>
                <div className="text-[10px] text-[var(--ink-faint)] truncate">
                  {sub.key_concepts.join(" · ")}
                </div>
              </div>
              <button
                onClick={() => onSubtopicChat(sub.title)}
                className="opacity-0 group-hover:opacity-100 text-[11px] text-phosphor-ink hover:text-phosphor-bright transition-opacity px-2 py-1 rounded"
              >
                Chat →
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SubtopicDot({
  state,
  reviewNeeded,
}: {
  state: SubtopicState;
  reviewNeeded: boolean;
}) {
  const base = "w-3.5 h-3.5 rounded-full shrink-0 border-2";
  let inner: React.CSSProperties = {};
  if (state === "mastered") {
    inner = {
      background: "var(--phosphor)",
      borderColor: "var(--phosphor)",
      boxShadow: "0 0 8px rgb(var(--phosphor-rgb) / 0.5)",
    };
  } else if (state === "practiced") {
    inner = {
      background: "transparent",
      borderColor: "var(--phosphor-ink)",
    };
  } else {
    inner = {
      background: "transparent",
      borderColor: "var(--rule)",
    };
  }

  return (
    <span className="relative flex items-center justify-center">
      <span className={base} style={inner} />
      {reviewNeeded && (
        <span
          title="Review needed"
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400"
          style={{ boxShadow: "0 0 6px rgb(251 191 36 / 0.6)" }}
        />
      )}
    </span>
  );
}
