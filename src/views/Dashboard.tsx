import { useState, useRef, useEffect } from "react";
import type { Course } from "../types";
import { createCourse } from "../lib/db";
import { CompanionSprite } from "../components/CompanionSprite";
import { SPRITE_PERSONAS, DEFAULT_SPRITE_ID, suggestSpriteForTopic } from "../lib/sprites/registry";
import { runGenerationPipeline } from "../lib/curriculum";
import { getGenerationConfig, getTavilyApiKey } from "../lib/store";
import { searchTavily, formatSearchResults } from "../lib/web-search";
import { preflightStructuredOutput } from "../lib/llm";
import { isHealthTopic, HEALTH_NOTICE } from "../lib/health-notice";

// The new-course flow (View "create"). The learner's landing screen is views/Home.tsx; this view is
// reached from its "Start a new course" button, and stays mounted (hidden) while a build runs so the
// pipeline keeps going wherever the learner goes.
interface DashboardProps {
  onCancel: () => void;
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

// Human steps, in the order the pipeline runs them. A learner (or a parent) reads this list while
// waiting, so it says what is being made, not which subsystem is doing it.
const INITIAL_STEPS: Step[] = [
  { label: "Checking the tutor is ready", status: "pending" },
  { label: "Saving your course", status: "pending" },
  { label: "Researching the topic", status: "pending" },
  { label: "Planning the six levels", status: "pending" },
  { label: "Deciding how to teach it", status: "pending" },
  ...ALL_LEVELS.map((l) => ({
    label: l === 6 ? "Writing the final exam" : `Writing Level ${l}`,
    status: "pending" as StepStatus,
  })),
];

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="w-5 h-5 rounded-full bg-success-tint border border-success flex items-center justify-center shrink-0">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
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
      <span className="w-5 h-5 rounded-full bg-danger-tint border border-danger flex items-center justify-center shrink-0">
        <span className="text-danger text-xs font-bold">✕</span>
      </span>
    );
  }
  return (
    <span className="w-5 h-5 rounded-full border border-[var(--rule)] flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-lcd" />
    </span>
  );
}

export default function Dashboard({ onCancel, onCourseCreated, onCreationStart, onCreationEnd, resumeCourse, onResumeConsumed }: DashboardProps) {
  const [topic, setTopic] = useState("");
  // Phase 4b: chosen persona for the new course (SAGE default → skippable picker).
  const [selectedSprite, setSelectedSprite] = useState<string>(DEFAULT_SPRITE_ID);
  const [creating, setCreating] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [error, setError] = useState("");
  // Streaming thought-process log — continuous across all steps so the user can scroll back.
  // Collapsed by default: it is raw model output, useful to whoever is debugging a build and noise
  // to the learner waiting for a course.
  const [streamLog, setStreamLog] = useState("");
  const [showLog, setShowLog] = useState(false);
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
      appendChunk(`Checking that ${config.model} can build a course...\n`);
      const preflight = await preflightStructuredOutput(config);
      if (!preflight.ok) {
        appendChunk(`${preflight.reason ?? "The tutor could not be checked."}\n${preflight.suggestion ?? ""}\n`);
        setStep(0, "error");
        throw new Error(`${preflight.reason ?? "The tutor could not be checked"} — ${preflight.suggestion ?? ""}`);
      }
      appendChunk("Ready.\n");
      setStep(0, "done");
      await delay(200);

      // Step 1: Course record. Create on fresh runs; on resume the row already exists.
      setStep(1, "active");
      if (isResume) {
        appendChunk(`Picking up "${existingCourse!.title}" where it left off.\n`);
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
            appendChunk("Looking up real-world curricula...\n");
            const results = await searchTavily(effectiveTopic, tavilyKey, 5);
            searchContext = formatSearchResults(results);
            appendChunk("Found some. Using them in the research.\n\n");
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
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(2rem, 5vw, 2.75rem)",
                fontWeight: 600,
                color: "var(--ink-em)",
              }}
            >
              OpenEdu
            </h1>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <div className="glow-line" />
            <span className="text-sm text-[var(--ink-dim)]">
              Your tutor, on this computer.
            </span>
          </div>
        </div>

        {/* Create course */}
        <div className="rounded-xl border border-[var(--rule)] bg-panel mb-6">
            <div className="px-5 pt-4">
              <h2 className="text-lg font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
                {creating ? "Building your course" : "New course"}
              </h2>
            </div>
            <div className="p-5">
              {!creating ? (
                <>
                  <p className="text-sm text-[var(--ink-dim)] mb-4 leading-relaxed">
                    Tell us what you want to learn. OpenEdu researches it and writes a six-level course, from the basics up.
                    That takes a few minutes, and you can leave this screen while it works.
                  </p>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
                    placeholder="What do you want to learn? For example: fractions, the solar system, Spanish"
                    className="cf-input mb-4"
                    autoFocus
                  />
                  {isHealthTopic(topic) && (
                    <div className="mb-4 p-3 rounded-lg border border-warning/40 border-l-4 border-l-warning text-xs text-ink leading-relaxed"
                         style={{ background: "var(--warning-tint)" }}>
                      {HEALTH_NOTICE}
                    </div>
                  )}
                  {/* Persona picker (Phase 4b) — SAGE default; the ★ suggestion is a non-binding hint. */}
                  <div className="mb-4">
                    <div className="text-sm text-[var(--ink-dim)] mb-2">Pick a tutor (you can change this later)</div>
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
                            <span className={`text-xs ${active ? "text-phosphor-bright" : "text-[var(--ink-faint)]"}`}>{p.displayName}</span>
                            {isSuggested && !active && (
                              <span className="absolute -top-1.5 -right-1.5 text-xs leading-none px-1 py-0.5 rounded bg-[rgb(var(--phosphor-rgb)/0.2)] text-phosphor-bright border border-phosphor/40" title="A good fit for this topic">★</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {error && (
                    <div className="mb-4 p-3 rounded-lg border border-danger/30 text-sm text-danger leading-relaxed"
                         style={{ background: "var(--danger-tint)" }}>
                      {error}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={handleCreate} disabled={!topic.trim()} className="btn btn-primary disabled:opacity-40">
                      Create course
                    </button>
                    <button onClick={() => { setTopic(""); setSelectedSprite(DEFAULT_SPRITE_ID); setError(""); onCancel(); }} className="btn">
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-base text-ink font-medium" style={{ fontFamily: "var(--font-display)" }}>
                        {topic}
                      </div>
                      <div className="text-sm text-[var(--ink-dim)] mt-0.5">
                        {activeStep ? `${activeStep.label}…` : "Almost done…"}
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
                      style={{ width: `${progress}%`, background: "var(--phosphor)" }}
                    />
                  </div>

                  {/* Steps */}
                  <div className="space-y-1.5 mb-4">
                    {steps.map((step, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 text-sm transition-opacity ${
                          step.status === "pending" ? "opacity-25" : "opacity-100"
                        }`}
                      >
                        <StepIcon status={step.status} />
                        <span className={
                          step.status === "active" ? "text-phosphor-bright" :
                          step.status === "done" ? "text-[var(--ink-faint)]" :
                          step.status === "error" ? "text-danger" :
                          "text-[var(--ink-faint)]"
                        }>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Live stream log — the model's raw output, behind a disclosure. Auto-follows
                      the tail until you scroll up; scroll back to bottom to resume following. */}
                  {streamLog && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowLog((v) => !v)}
                        aria-expanded={showLog}
                        className="text-sm text-[var(--ink-faint)] hover:text-ink transition-colors"
                      >
                        {showLog ? "Hide the details" : "Show the details"}
                      </button>
                      {showLog && (
                        <div
                          ref={streamLogRef}
                          onScroll={handleStreamScroll}
                          className="lcd p-3 mt-2 max-h-64 overflow-y-auto"
                        >
                          <pre className="text-xs font-lcd text-phosphor whitespace-pre-wrap leading-relaxed">
                            {streamLog}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 p-3 rounded-lg border border-danger/30 text-sm text-danger leading-relaxed"
                         style={{ background: "var(--danger-tint)" }}>
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}
