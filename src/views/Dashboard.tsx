import { useState, useRef, useEffect } from "react";
import type { Course, Syllabus } from "../types";
import { createCourse, deleteCourse } from "../lib/db";
import { researchTopic, generateSyllabus, generateTutorInstructions } from "../lib/curriculum";
import { getGenerationConfig, getTavilyApiKey } from "../lib/store";
import { searchTavily, formatSearchResults } from "../lib/web-search";
import { initKnowledgeFiles } from "../lib/knowledge";

interface DashboardProps {
  courses: Course[];
  onOpenCourse: (id: string) => void;
  onCourseCreated: (courseId: string) => void;
  onCreationStart?: (topic: string) => void;
  onCreationEnd?: () => void;
}

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  status: StepStatus;
}

const ALL_LEVELS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const INITIAL_STEPS: Step[] = [
  { label: "Create course record", status: "pending" },
  { label: "Research topic & curricula", status: "pending" },
  { label: "Design tutor persona", status: "pending" },
  ...ALL_LEVELS.map((l) => ({ label: `Build Level ${l.toFixed(1)} syllabus`, status: "pending" as StepStatus })),
];

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center shrink-0">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="w-5 h-5 rounded-full bg-terra-500/20 border border-terra-400 flex items-center justify-center shrink-0 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-terra-400" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center shrink-0">
        <span className="text-red-400 text-[10px] font-bold">✕</span>
      </span>
    );
  }
  return (
    <span className="w-5 h-5 rounded-full border border-surface-500 flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-surface-600" />
    </span>
  );
}

export default function Dashboard({ courses, onOpenCourse, onCourseCreated, onCreationStart, onCreationEnd }: DashboardProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [error, setError] = useState("");
  // Streaming thought-process log — live token output from the active LLM call
  const [streamLog, setStreamLog] = useState("");
  const streamLogRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the stream log as tokens arrive
  useEffect(() => {
    if (streamLogRef.current) {
      streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
    }
  }, [streamLog]);

  const setStep = (index: number, status: StepStatus) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, status } : s)));
    if (status === "active") setStreamLog(""); // clear log when a new step starts
  };

  const appendChunk = (chunk: string) => {
    setStreamLog((prev) => {
      const next = prev + chunk;
      // Cap at 3000 chars to avoid unbounded growth, keep the tail
      return next.length > 3000 ? next.slice(next.length - 3000) : next;
    });
  };

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleCreate = async () => {
    if (!topic.trim()) return;
    setCreating(true);
    setError("");
    setStreamLog("");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
    onCreationStart?.(topic.trim());

    let courseId: string | null = null;

    try {
      const config = await getGenerationConfig();

      // Step 1: Create course record
      setStep(0, "active");
      const course = await createCourse(topic.trim(), topic.trim());
      courseId = course.id;
      setStep(0, "done");
      await delay(200);

      // Step 2: Research the topic (triaging step) — optionally augmented with web search
      setStep(1, "active");
      let searchContext = "";
      const tavilyKey = await getTavilyApiKey();
      if (tavilyKey) {
        try {
          appendChunk("[Web search] Looking up real-world curricula...\n");
          const results = await searchTavily(topic.trim(), tavilyKey, 5);
          searchContext = formatSearchResults(results);
          appendChunk("[Web search] Done — injecting into research context.\n\n");
        } catch {
          // Search failure is non-fatal
        }
      }
      const researchBrief = await researchTopic(topic.trim(), config, appendChunk, searchContext);
      setStep(1, "done");
      await delay(300);

      // Step 3: Generate tutor persona — streams live
      setStep(2, "active");
      await generateTutorInstructions(course.id, topic.trim(), researchBrief, config, appendChunk);
      setStep(2, "done");
      await delay(300);

      // Steps 4–14: All 11 syllabus levels in sequence, each informed by prior levels
      const previousSyllabuses: Syllabus[] = [];
      for (let i = 0; i < ALL_LEVELS.length; i++) {
        setStep(3 + i, "active");
        const syl = await generateSyllabus(course.id, topic.trim(), ALL_LEVELS[i], config, researchBrief, appendChunk, previousSyllabuses);
        previousSyllabuses.push(syl);
        setStep(3 + i, "done");
        await delay(200);
      }

      // Initialize persistent knowledge files for this course
      await initKnowledgeFiles(course.id);

      setStreamLog("");
      setTopic("");
      setShowCreate(false);
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
      onCreationEnd?.();
      onCourseCreated(course.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
      if (courseId) {
        try { await deleteCourse(courseId); } catch { /* best effort */ }
      }
      onCreationEnd?.();
    } finally {
      setCreating(false);
    }
  };

  const completedCount = steps.filter((s) => s.status === "done").length;
  const progress = creating ? Math.round((completedCount / steps.length) * 100) : 0;
  const activeStep = steps.find((s) => s.status === "active");

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-100 mb-2">TerraTutor</h1>
          <p className="text-zinc-400">Your AI-powered learning companion. Pick a topic, get a tutor.</p>
        </div>

        {/* Create course */}
        {!showCreate && !creating ? (
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
                  TerraTutor will research your topic and craft a full 11-level curriculum — this takes 3–10 minutes depending on your model.
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
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 font-mono leading-relaxed">
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
              /* ── Creation progress UI ── */
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-200">
                      Crafting <span className="text-terra-300">{topic}</span>
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {activeStep ? activeStep.label + "..." : "Almost done..."}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-terra-400 shrink-0 ml-4">{progress}%</span>
                </div>

                {/* Progress bar */}
                <div className="h-1 rounded-full bg-surface-600 overflow-hidden mb-5">
                  <div
                    className="h-full rounded-full bg-terra-500 transition-all duration-700"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Steps */}
                <div className="space-y-2.5 mb-4">
                  {steps.map((step, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 transition-opacity ${
                        step.status === "pending" ? "opacity-30" : "opacity-100"
                      }`}
                    >
                      <StepIcon status={step.status} />
                      <span className={`text-sm ${
                        step.status === "active" ? "text-terra-200 font-medium" :
                        step.status === "done" ? "text-zinc-400" :
                        step.status === "error" ? "text-red-300 font-medium" :
                        "text-zinc-600"
                      }`}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Live streaming thought-process */}
                {streamLog && (
                  <div
                    ref={streamLogRef}
                    className="rounded-lg bg-surface-900 border border-surface-600 p-3 max-h-32 overflow-y-auto"
                  >
                    <pre className="text-[11px] font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed">
                      {streamLog}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 font-mono leading-relaxed">
                    {error}
                  </div>
                )}
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
                    <div className="h-1 rounded-full bg-surface-600 overflow-hidden">
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
