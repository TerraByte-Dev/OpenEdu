import { useState } from "react";
import type { Course } from "../types";
import { createCourse, deleteCourse } from "../lib/db";
import { researchTopic, generateSyllabus, generateTutorInstructions } from "../lib/curriculum";
import { getGenerationConfig } from "../lib/store";

interface DashboardProps {
  courses: Course[];
  onOpenCourse: (id: string) => void;
  onCourseCreated: (courseId: string) => void;
}

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  detail: string;
  status: StepStatus;
}

const INITIAL_STEPS: Step[] = [
  { label: "Create course", detail: "Setting up your learning space", status: "pending" },
  { label: "Research topic", detail: "Studying traditional curricula and learning paths", status: "pending" },
  { label: "Design your tutor", detail: "Crafting a personalized teaching persona", status: "pending" },
  { label: "Build Level 0.0 syllabus", detail: "Mapping your starting point", status: "pending" },
  { label: "Build Level 0.5 syllabus", detail: "Plotting your first milestone", status: "pending" },
];

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="w-6 h-6 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="w-6 h-6 rounded-full bg-terra-500/20 border border-terra-400 flex items-center justify-center shrink-0 animate-pulse">
        <span className="w-2 h-2 rounded-full bg-terra-400" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center shrink-0">
        <span className="text-red-400 text-xs font-bold">!</span>
      </span>
    );
  }
  return (
    <span className="w-6 h-6 rounded-full border border-surface-500 flex items-center justify-center shrink-0">
      <span className="w-2 h-2 rounded-full bg-surface-500" />
    </span>
  );
}

export default function Dashboard({ courses, onOpenCourse, onCourseCreated }: DashboardProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [error, setError] = useState("");

  const setStep = (index: number, status: StepStatus) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, status } : s)));
  };

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleCreate = async () => {
    if (!topic.trim()) return;
    setCreating(true);
    setError("");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));

    let courseId: string | null = null;

    try {
      const config = await getGenerationConfig();

      // Step 1: Create course record
      setStep(0, "active");
      const course = await createCourse(topic.trim(), topic.trim());
      courseId = course.id;
      setStep(0, "done");

      await delay(300);

      // Step 2: Research the topic (the triaging process from CONCEPT.md)
      setStep(1, "active");
      const researchBrief = await researchTopic(topic.trim(), config);
      setStep(1, "done");

      await delay(800);

      // Step 3: Generate tutor personality (uses research context)
      setStep(2, "active");
      await generateTutorInstructions(course.id, topic.trim(), researchBrief, config);
      setStep(2, "done");

      await delay(800);

      // Step 4: Syllabus Level 0.0 (uses research context)
      setStep(3, "active");
      await generateSyllabus(course.id, topic.trim(), 0.0, config, researchBrief);
      setStep(3, "done");

      await delay(800);

      // Step 5: Syllabus Level 0.5 (uses research context)
      setStep(4, "active");
      await generateSyllabus(course.id, topic.trim(), 0.5, config, researchBrief);
      setStep(4, "done");

      await delay(400);

      setTopic("");
      setShowCreate(false);
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
      onCourseCreated(course.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Mark the active step as errored
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
      // Clean up partial course
      if (courseId) {
        try { await deleteCourse(courseId); } catch { /* best effort */ }
      }
    } finally {
      setCreating(false);
    }
  };

  const completedCount = steps.filter((s) => s.status === "done").length;
  const progress = creating ? Math.round((completedCount / steps.length) * 100) : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-100 mb-2">TerraTutor</h1>
          <p className="text-zinc-400">Your AI-powered learning companion. Pick a topic, get a tutor.</p>
        </div>

        {/* Create course */}
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full p-4 rounded-xl border-2 border-dashed border-surface-500 hover:border-terra-500 text-zinc-400 hover:text-terra-300 transition-colors text-sm flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Start a new course
          </button>
        ) : (
          <div className="p-6 rounded-xl bg-surface-800 border border-surface-600 mb-6">
            {!creating ? (
              <>
                <h2 className="text-lg font-semibold text-zinc-200 mb-1">What do you want to learn?</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  TerraTutor will research your topic and craft a full curriculum — this takes 1-3 minutes.
                </p>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
                  placeholder="e.g., Python, Linear Algebra, Japanese, Music Theory..."
                  className="w-full px-4 py-3 rounded-lg bg-surface-700 border border-surface-500 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-terra-500 text-sm"
                  autoFocus
                />
                {error && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                    {error}
                  </div>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleCreate}
                    disabled={!topic.trim()}
                    className="px-5 py-2 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Craft My Course
                  </button>
                  <button
                    onClick={() => { setShowCreate(false); setTopic(""); setError(""); }}
                    className="px-5 py-2 rounded-lg bg-surface-600 hover:bg-surface-500 text-zinc-300 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              /* Creation progress UI */
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1">
                    <h2 className="text-base font-semibold text-zinc-200">
                      Crafting your <span className="text-terra-300">{topic}</span> course
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Building a personalized curriculum — sit tight, this is worth it.
                    </p>
                  </div>
                  <span className="text-sm font-bold text-terra-400">{progress}%</span>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-surface-600 overflow-hidden mb-5">
                  <div
                    className="h-full rounded-full bg-terra-500 transition-all duration-700"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Steps */}
                <div className="space-y-3">
                  {steps.map((step, i) => (
                    <div key={i} className={`flex items-start gap-3 transition-opacity ${
                      step.status === "pending" ? "opacity-40" : "opacity-100"
                    }`}>
                      <StepIcon status={step.status} />
                      <div className="min-w-0 pt-0.5">
                        <div className={`text-sm font-medium ${
                          step.status === "active" ? "text-terra-200" :
                          step.status === "done" ? "text-zinc-300" :
                          step.status === "error" ? "text-red-300" :
                          "text-zinc-500"
                        }`}>
                          {step.label}
                        </div>
                        {(step.status === "active" || step.status === "error") && (
                          <div className={`text-xs mt-0.5 ${
                            step.status === "error" ? "text-red-400" : "text-zinc-500"
                          }`}>
                            {step.status === "error" ? error : step.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-zinc-600 mt-5 text-center">
                  Using a capable model for best results — cost ~$0.02-0.10 per course
                </p>
              </div>
            )}
          </div>
        )}

        {/* Course grid */}
        {courses.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
              Your Courses
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => onOpenCourse(course.id)}
                  className="p-5 rounded-xl bg-surface-800 border border-surface-600 hover:border-terra-500/50 text-left transition-all hover:shadow-lg hover:shadow-terra-500/5"
                >
                  <div className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-lg bg-terra-700/40 text-terra-300 flex items-center justify-center text-lg font-bold shrink-0">
                      {course.title.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-zinc-100 font-medium truncate">{course.title}</h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        Level {course.current_level.toFixed(1)} &middot;{" "}
                        {course.status === "completed" ? "Completed" : "In Progress"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="h-1.5 rounded-full bg-surface-600 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-terra-500 transition-all"
                        style={{ width: `${(course.current_level / 5.0) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-zinc-600">0.0</span>
                      <span className="text-[10px] text-zinc-600">5.0</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
