import { useEffect, useState } from "react";
import type { Course, Syllabus } from "../types";
import { getSyllabus, getQuizAttempts } from "../lib/db";
import { getLevelMeaning } from "../lib/curriculum";
import { rankNextSteps, continueStep, type NextStep, type NextStepAction } from "../lib/next-step";
import {
  DAILY_GOAL_OPTIONS, courseProgressPct, goalProgress, goalSentence,
} from "../lib/daily-goal";
import { describeGenerationState } from "../lib/plain-language";
import { APP_NAME } from "../lib/product";
import { IconArrowRight } from "../components/icons";

// The learner's Home — the first screen after picking a learner, and the answer to "what do I do
// now?". One primary action (Continue: the most recent course and its next step, ranked by the same
// rules as the Next step card inside a course), a daily goal with today's progress, and the courses
// as cards. Starting something new is secondary. Everything shown is data the app already writes;
// the daily goal and today's minutes live in the plugin store, per learner (store.ts).

interface HomeProps {
  learnerName: string;
  courses: Course[];
  /** Chosen minutes per day, or null until the learner picks one. */
  dailyGoal: number | null;
  onChooseGoal: (minutes: number) => void;
  /** Minutes this learner has spent in the app today (App counts them). */
  minutesToday: number;
  onContinue: (courseId: string, action?: NextStepAction) => void;
  onOpenCourse: (courseId: string) => void;
  onResumeCourse: (courseId: string) => void;
  onStartNew: () => void;
}

interface CourseGlance {
  syllabus: Syllabus | null;
  mastered: number;
  total: number;
}

function needsBuilding(course: Course): boolean {
  return course.generation_state != null && course.generation_state !== "completed";
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Home({
  learnerName, courses, dailyGoal, onChooseGoal, minutesToday, onContinue, onOpenCourse, onResumeCourse, onStartNew,
}: HomeProps) {
  const recent = courses[0] ?? null; // getCourses orders by updated_at DESC
  const [glances, setGlances] = useState<Record<string, CourseGlance>>({});
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [changingGoal, setChangingGoal] = useState(false);

  // One syllabus read per course (for the card's progress) and the attempts of the most recent one
  // (for Continue). Re-run when the list changes — a finished build or a level-up lands here.
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(courses.map(async (c) => {
        const syllabus = await getSyllabus(c.id, c.current_level).catch(() => null);
        const total = syllabus?.subtopics.length ?? 0;
        const mastered = syllabus?.subtopics.filter((s) => s.mastered).length ?? 0;
        return [c.id, { syllabus, mastered, total }] as const;
      }));
      if (!alive) return;
      const map = Object.fromEntries(entries);
      setGlances(map);
      if (recent && !needsBuilding(recent)) {
        const attempts = await getQuizAttempts(recent.id).catch(() => []);
        if (!alive) return;
        const steps = rankNextSteps({
          course: recent, level: recent.current_level, currentSyllabus: map[recent.id]?.syllabus ?? null,
          attempts, canRegenerate: false, canPromote: true,
        });
        setNextStep(continueStep(steps));
      } else {
        setNextStep(null);
      }
    })();
    return () => { alive = false; };
  }, [courses, recent]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8 bg-bg">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {greeting(new Date())}, {learnerName}.
          </h1>
        </header>

        {/* Continue — the one thing to do now */}
        {recent ? (
          <section className="rounded-2xl border border-phosphor/40 bg-panel p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
            <div className="text-sm text-phosphor-ink font-semibold mb-1">Continue</div>
            <h2 className="text-2xl text-ink font-semibold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              {recent.title}
            </h2>
            <p className="text-base text-[var(--ink-dim)] mt-1">
              Level {recent.current_level} — {getLevelMeaning(recent.current_level)}
            </p>
            {needsBuilding(recent) ? (
              <>
                <p className="text-base text-ink mt-4">{describeGenerationState(recent.generation_state)}</p>
                <button onClick={() => onResumeCourse(recent.id)} className="btn btn-primary mt-4" style={{ fontSize: "1.05rem", padding: "12px 22px" }}>
                  Finish building it
                </button>
              </>
            ) : (
              <>
                {nextStep && (
                  <div className="mt-4 rounded-xl bg-panel-lite/50 border border-[var(--rule)] p-4">
                    <div className="text-base text-ink font-medium">{nextStep.title}</div>
                    <div className="text-sm text-[var(--ink-faint)] mt-0.5">{nextStep.blurb}</div>
                  </div>
                )}
                <button
                  onClick={() => onContinue(recent.id, nextStep?.action)}
                  className="btn btn-primary mt-4"
                  style={{ fontSize: "1.05rem", padding: "12px 22px" }}
                >
                  Continue
                  <IconArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border border-phosphor/40 bg-panel p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
            <h2 className="text-2xl text-ink font-semibold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              Let's pick something to learn.
            </h2>
            <p className="text-base text-[var(--ink-dim)] mt-1">
              Tell {APP_NAME} a topic and it writes you a course, from the basics up. It takes a few minutes.
            </p>
            <button onClick={onStartNew} className="btn btn-primary mt-4" style={{ fontSize: "1.05rem", padding: "12px 22px" }}>
              Start a course
            </button>
          </section>
        )}

        {/* Daily goal */}
        <section className="rounded-xl border border-[var(--rule)] bg-panel p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="glow-line" />
            <h3 className="text-sm text-phosphor-ink font-semibold">Today</h3>
          </div>
          {dailyGoal === null || changingGoal ? (
            <div>
              <p className="text-base text-ink mb-3">How many minutes a day do you want to learn?</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Minutes per day">
                {DAILY_GOAL_OPTIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { onChooseGoal(m); setChangingGoal(false); }}
                    className={`btn ${m === dailyGoal ? "btn-primary" : ""}`}
                  >
                    {m} minutes
                  </button>
                ))}
              </div>
              <p className="text-sm text-[var(--ink-faint)] mt-3">You can change this any time.</p>
            </div>
          ) : (
            <GoalBar minutes={minutesToday} goal={dailyGoal} onChange={() => setChangingGoal(true)} />
          )}
        </section>

        {/* Courses */}
        {courses.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-[var(--ink-dim)] font-semibold">Your courses</h3>
              <button onClick={onStartNew} className="text-sm text-phosphor-ink hover:text-phosphor-bright transition-colors">
                + Start a new course
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {courses.map((course) => {
                const g = glances[course.id];
                const pct = courseProgressPct(course, g?.mastered ?? 0, g?.total ?? 0);
                const building = needsBuilding(course);
                return (
                  <button
                    key={course.id}
                    onClick={() => (building ? onResumeCourse(course.id) : onOpenCourse(course.id))}
                    className="rounded-xl border border-[var(--rule)] bg-panel hover:border-phosphor text-left transition-colors group p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <span
                        className="text-ink group-hover:text-phosphor-bright leading-tight line-clamp-2 transition-colors"
                        style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", fontWeight: 500 }}
                      >
                        {course.title}
                      </span>
                      <span className="text-sm text-[var(--ink-dim)] shrink-0 mt-0.5">
                        {course.status === "completed" ? "Done" : `Level ${course.current_level}`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-lcd overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${course.title}: ${pct}% done`}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--phosphor)" }} />
                    </div>
                    <div className="text-sm text-[var(--ink-faint)] mt-1.5">
                      {building
                        ? <span className="text-warning">Not finished — click to continue building</span>
                        : g && g.total > 0
                          ? `${g.mastered} of ${g.total} topics learned at this level · ${pct}% of the course`
                          : `${pct}% of the course`}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function GoalBar({ minutes, goal, onChange }: { minutes: number; goal: number; onChange: () => void }) {
  const p = goalProgress(minutes, goal);
  return (
    <div>
      <p className={`text-base ${p.done ? "text-phosphor-bright" : "text-ink"}`}>{goalSentence(minutes, goal)}</p>
      <div className="h-2 rounded-full bg-lcd overflow-hidden mt-3" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Today's goal">
        <div className="h-full rounded-full transition-all" style={{ width: `${p.pct}%`, background: "var(--phosphor)" }} />
      </div>
      <p className="text-sm text-[var(--ink-faint)] mt-2">
        Your goal is {goal} minutes a day.{" "}
        <button onClick={onChange} className="text-phosphor-ink hover:text-phosphor-bright transition-colors">Change</button>
      </p>
    </div>
  );
}
