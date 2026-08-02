import { useState, useRef, useEffect } from "react";
import type { Course } from "../types";
import { createCourse } from "../lib/db";
import { CompanionSprite } from "../components/CompanionSprite";
import { BrandMark } from "../components/BrandMark";
import { SPRITE_PERSONAS, DEFAULT_SPRITE_ID, suggestSpriteForTopic } from "../lib/sprites/registry";
import { runGenerationPipeline } from "../lib/curriculum";
import { getGenerationConfig, getTavilyApiKey } from "../lib/store";
import { searchTavily, formatSearchResults } from "../lib/web-search";
import { preflightStructuredOutput } from "../lib/llm";

interface DashboardProps {
  courses: Course[];
  onOpenCourse: (id: string) => void;
  onCourseCreated: (courseId: string) => void;
  onCreationStart?: (topic: string) => void;
  onCreationEnd?: () => void;
  // When set (via App's pendingResumeCourse plumbing), Dashboard auto-launches a resume on mount.
  resumeCourse?: Course | null;
  onResumeConsumed?: () => void;
}

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  status: StepStatus;
}

const ALL_LEVELS = [1, 2, 3, 4, 5, 6];

const INITIAL_STEPS: Step[] = [
  { label: "Verify model capability", status: "pending" },
  { label: "Create course record", status: "pending" },
  { label: "Research topic & curricula", status: "pending" },
  { label: "Plan course structure", status: "pending" },
  { label: "Design teaching approach", status: "pending" },
  ...ALL_LEVELS.map((l) => ({ label: `Build Level ${l} syllabus`, status: "pending" as StepStatus })),
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
      <span className="w-5 h-5 rounded-full bg-[rgb(var(--phosphor-rgb)/0.14)] border border-phosphor-ink flex items-center justify-center shrink-0 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-phosphor-ink" />
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
    <span className="w-5 h-5 rounded-full border border-[var(--rule)] flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-lcd" />
    </span>
  );
}

export default function Dashboard({ courses, onOpenCourse, onCourseCreated, onCreationStart, onCreationEnd, resumeCourse, onResumeConsumed }: DashboardProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [topic, setTopic] = useState("");
  // Phase 4b: chosen persona for the new course (SAGE default → skippable picker).
  const [selectedSprite, setSelectedSprite] = useState<string>(DEFAULT_SPRITE_ID);
  const [creating, setCreating] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [error, setError] = useState("");
  // Streaming thought-process log — continuous across all steps so the user can scroll back.
  const [streamLog, setStreamLog] = useState("");
  const streamLogRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only when the user is parked at the bottom. Manual scroll-up pauses follow,
  // scroll back to bottom resumes it. Standard tail -f / chat-window UX.
  const followBottomRef = useRef(true);

  const handleStreamScroll = () => {
    const el = streamLogRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    followBottomRef.current = distanceFromBottom < 24;
  };

  useEffect(() => {
    if (streamLogRef.current && followBottomRef.current) {
      streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
    }
  }, [streamLog]);

  const setStep = (index: number, status: StepStatus) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, status } : s)));
    if (status === "active") {
      const label = INITIAL_STEPS[index]?.label ?? `Step ${index + 1}`;
      setStreamLog((prev) => {
        const sep = prev ? `\n━━━ ${label} ━━━\n` : `━━━ ${label} ━━━\n`;
        const next = prev + sep;
        return next.length > 50000 ? next.slice(next.length - 50000) : next;
      });
    }
  };

  const appendChunk = (chunk: string) => {
    setStreamLog((prev) => {
      const next = prev + chunk;
      // Cap at 50KB — plenty of scrollback for a full build, still bounded.
      return next.length > 50000 ? next.slice(next.length - 50000) : next;
    });
  };

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runPipelineFor = async (existingCourse: Course | null) => {
    const isResume = !!existingCourse;
    const effectiveTopic = isResume ? existingCourse!.topic : topic.trim();
    if (!effectiveTopic) return;

    setCreating(true);
    setError("");
    setStreamLog("");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
    onCreationStart?.(effectiveTopic);

    let courseId: string | null = isResume ? existingCourse!.id : null;

    try {
      const config = await getGenerationConfig();

      // Step 0: Preflight — refuse to start a 5–10 min pipeline on a model that can't emit structured JSON.
      // Re-runs on resume too — the user may have switched models since the failure.
      setStep(0, "active");
      appendChunk(`[preflight] Probing ${config.provider}/${config.model} for structured-output capability...\n`);
      const preflight = await preflightStructuredOutput(config);
      if (!preflight.ok) {
        appendChunk(`[preflight] ✗ ${preflight.reason ?? "Unknown failure"}\n${preflight.suggestion ?? ""}\n`);
        setStep(0, "error");
        throw new Error(`${preflight.reason ?? "Model preflight failed"} — ${preflight.suggestion ?? ""}`);
      }
      appendChunk(`[preflight] ✓ Model OK${preflight.detectedTier ? ` (detected tier: ${preflight.detectedTier})` : ""}.\n`);
      setStep(0, "done");
      await delay(200);

      // Step 1: Course record. Create on fresh runs; on resume the row already exists.
      setStep(1, "active");
      if (isResume) {
        appendChunk(`[resume] Continuing course "${existingCourse!.title}" from state: ${existingCourse!.generation_state ?? "(unknown — restarting pipeline)"}\n`);
      } else {
        const course = await createCourse(effectiveTopic, effectiveTopic, selectedSprite);
        courseId = course.id;
      }
      setStep(1, "done");
      await delay(200);

      // Optional: web search grounding (fresh runs only — on resume we trust the saved brief).
      let searchContext = "";
      if (!isResume) {
        const tavilyKey = await getTavilyApiKey();
        if (tavilyKey) {
          try {
            appendChunk("[Web search] Looking up real-world curricula...\n");
            const results = await searchTavily(effectiveTopic, tavilyKey, 5);
            searchContext = formatSearchResults(results);
            appendChunk("[Web search] Done — injecting into research context.\n\n");
          } catch {
            // Search failure is non-fatal
          }
        }
      }

      // Steps 2–10: pipeline (research → outline → instructions → syllabus L1..L6).
      await runGenerationPipeline({
        courseId: courseId!,
        topic: effectiveTopic,
        config,
        searchContext: searchContext || undefined,
        fromState: isResume ? existingCourse!.generation_state : null,
        onStep: (idx, status) => setStep(idx, status),
        onChunk: appendChunk,
      });

      setStreamLog("");
      setTopic("");
      setSelectedSprite(DEFAULT_SPRITE_ID);
      setShowCreate(false);
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
      onCreationEnd?.();
      onCourseCreated(courseId!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
      // DO NOT delete the course on failure. The pipeline writes state at each step boundary,
      // so the row's generation_state already points at the step that needs retry. The user
      // sees a "Resume generation" affordance on this course in the sidebar.
      onCreationEnd?.();
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = () => runPipelineFor(null);

  // Auto-launch resume when App passes a resumeCourse prop. Consumed once.
  useEffect(() => {
    if (resumeCourse && !creating) {
      setShowCreate(true);
      void runPipelineFor(resumeCourse);
      onResumeConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeCourse]);

  const completedCount = steps.filter((s) => s.status === "done").length;
  const progress = creating ? Math.round((completedCount / steps.length) * 100) : 0;
  const activeStep = steps.find((s) => s.status === "active");

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8 bg-bg">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <BrandMark size={52} glow title="TerraByte Solutions LLC" />
            <h1
              className="wordmark-glow"
              style={{
                fontFamily: "'VT323', var(--font-mono)",
                fontSize: "clamp(2.4rem, 6vw, 4rem)",
                color: "var(--phosphor)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              OpenEdu
            </h1>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <div className="glow-line" />
            <span className="text-xs font-mono text-[var(--ink-faint)] uppercase tracking-widest">
              EDUCATION OS — AI-POWERED LEARNING
            </span>
          </div>
        </div>

        {/* Create course */}
        {!showCreate && !creating ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full p-4 border border-dashed border-[var(--rule)] hover:border-phosphor text-[var(--ink-faint)] hover:text-phosphor-bright transition-colors text-sm flex items-center justify-center gap-2 font-mono uppercase tracking-wider"
            style={{ background: "var(--phosphor-veil)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            INIT NEW_COURSE
          </button>
        ) : (
          <div className="window mb-6">
            <div className="window-titlebar">
              <span className="window-dot close" />
              <span className="window-dot min" />
              <span className="window-dot max" />
              <span className="ml-2 uppercase tracking-widest text-[10px]">
                {creating ? "BUILDING COURSE..." : "NEW COURSE"}
              </span>
            </div>
            <div className="p-5">
              {!creating ? (
                <>
                  <p className="text-xs text-[var(--ink-faint)] mb-4 font-mono">
                    <span className="text-phosphor-ink">$</span> OpenEdu will research your topic and craft a focused 6-level curriculum — 3–10 min.
                  </p>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
                    placeholder="topic: Python, Linear Algebra, Music Theory..."
                    className="cf-input mb-4"
                    autoFocus
                  />
                  {/* Persona picker (Phase 4b) — SAGE default; the ★ suggestion is a non-binding hint. */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--ink-faint)] mb-2">Tutor persona</div>
                    <div className="flex gap-2 flex-wrap">
                      {SPRITE_PERSONAS.map((p) => {
                        const active = selectedSprite === p.id;
                        const isSuggested = !!topic.trim() && suggestSpriteForTopic(topic)?.id === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedSprite(p.id)}
                            title={`${p.displayName} — ${p.blurb}`}
                            className={`relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${active ? "border-phosphor bg-panel-lite" : "border-[var(--rule)] hover:border-phosphor/40"}`}
                          >
                            <CompanionSprite spriteId={p.id} size={44} />
                            <span className={`text-[9px] ${active ? "text-phosphor-bright" : "text-[var(--ink-faint)]"}`}>{p.displayName}</span>
                            {isSuggested && !active && (
                              <span className="absolute -top-1.5 -right-1.5 text-[8px] leading-none px-1 py-0.5 rounded bg-[rgb(var(--phosphor-rgb)/0.2)] text-phosphor-bright border border-phosphor/40">★</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {error && (
                    <div className="mb-4 p-3 border border-red-500/30 text-sm text-red-300 font-mono leading-relaxed"
                         style={{ background: "rgba(239,68,68,0.06)" }}>
                      ERR: {error}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={handleCreate} disabled={!topic.trim()} className="btn btn-primary disabled:opacity-40">
                      EXECUTE
                    </button>
                    <button onClick={() => { setShowCreate(false); setTopic(""); setSelectedSprite(DEFAULT_SPRITE_ID); setError(""); }} className="btn">
                      ABORT
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-sm font-mono text-phosphor-ink">
                        <span className="text-[var(--ink-faint)]">BUILD:</span> {topic}
                      </div>
                      <div className="text-xs text-[var(--ink-faint)] mt-0.5 font-mono">
                        {activeStep ? `> ${activeStep.label}` : "> FINALIZING..."}
                      </div>
                    </div>
                    <span
                      className="readout-val shrink-0 ml-4"
                      style={{ fontSize: "1.8rem" }}
                    >{progress}%</span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-px bg-[var(--rule)] overflow-hidden mb-5">
                    <div
                      className="h-full transition-all duration-700"
                      style={{ width: `${progress}%`, background: "var(--phosphor)", boxShadow: "0 0 8px var(--phosphor)" }}
                    />
                  </div>

                  {/* Steps */}
                  <div className="space-y-1.5 mb-4">
                    {steps.map((step, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 font-mono text-xs transition-opacity ${
                          step.status === "pending" ? "opacity-25" : "opacity-100"
                        }`}
                      >
                        <StepIcon status={step.status} />
                        <span className={
                          step.status === "active" ? "text-phosphor-bright" :
                          step.status === "done" ? "text-[var(--ink-faint)]" :
                          step.status === "error" ? "text-red-300" :
                          "text-[var(--ink-faint)]"
                        }>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Live stream log — continuous transcript, scrollable. Auto-follows the
                      tail until you scroll up; scroll back to bottom to resume following. */}
                  {streamLog && (
                    <div
                      ref={streamLogRef}
                      onScroll={handleStreamScroll}
                      className="lcd p-3 max-h-64 overflow-y-auto"
                    >
                      <pre className="text-[10px] font-mono text-phosphor whitespace-pre-wrap leading-relaxed">
                        {streamLog}
                      </pre>
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 p-3 border border-red-500/30 text-xs text-red-300 font-mono leading-relaxed"
                         style={{ background: "rgba(239,68,68,0.06)" }}>
                      ERR: {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Course grid */}
        {courses.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-mono text-[var(--ink-faint)] uppercase tracking-widest">LOADED COURSES</span>
              <div className="flex-1 h-px bg-[var(--rule)]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => onOpenCourse(course.id)}
                  className="window text-left transition-all group"
                  style={{ display: "block" }}
                >
                  <div className="window-titlebar">
                    <span className="window-dot close" />
                    <span className="window-dot min" />
                    <span className="window-dot max" />
                    <span className="ml-2 uppercase tracking-widest text-[10px] group-hover:text-phosphor-ink transition-colors truncate flex-1">
                      COURSE
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <span
                        className="text-phosphor phosphor-glow uppercase leading-tight line-clamp-2"
                        style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", letterSpacing: "0.02em" }}
                      >
                        {course.title}
                      </span>
                      <span className="text-xs font-mono text-[var(--ink-faint)] shrink-0 mt-1">
                        LVL {course.current_level}
                      </span>
                    </div>
                    {/* Progress bar — 0% at L1 start, 100% at L6 (mastery exam ready). */}
                    <div className="h-px bg-[var(--rule)] overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(100, ((course.current_level - 1) / 5) * 100))}%`,
                          background: "var(--phosphor)",
                          boxShadow: "0 0 6px var(--phosphor)",
                        }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] font-mono text-[var(--ink-faint)]">1</span>
                      <span className="text-[9px] font-mono text-[var(--ink-faint)]">6</span>
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
