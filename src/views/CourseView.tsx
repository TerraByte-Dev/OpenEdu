import { useState, useEffect } from "react";
import type { Course, Syllabus, QuizViewContext } from "../types";

import { getCourse, getSyllabuses } from "../lib/db";
import { getLevelMeaning, researchTopic, generateTutorInstructions, generateSyllabus, generateCourseOutline, recordLedgerEntry } from "../lib/curriculum";
import { getGenerationConfig, getLibraryEnabled } from "../lib/store";
import { getManifest, isLibraryAvailable } from "../lib/library";
import ChatTab from "../components/ChatTab";
import NotesTab from "../components/NotesTab";
import QuizTab from "../components/QuizTab";
import OverviewTab from "../components/OverviewTab";
import ResourcesTab from "../components/ResourcesTab";
import ReviewTab from "../components/ReviewTab";

export type Tab = "overview" | "chat" | "notes" | "quiz" | "review" | "syllabus" | "resources";

export interface SwitchTabOpts {
  seedTopic?: string;
}

interface CourseViewProps {
  courseId: string;
  onBack: () => void;
  onOpenQuiz: (ctx: QuizViewContext) => void;
  onOpenPromotionTest: (ctx: QuizViewContext) => void;
}

export default function CourseView({ courseId, onBack, onOpenQuiz, onOpenPromotionTest }: CourseViewProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [syllabuses, setSyllabuses] = useState<Syllabus[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [viewingLevel, setViewingLevel] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenStatus, setRegenStatus] = useState("");
  const [chatSeedTopic, setChatSeedTopic] = useState<string | undefined>(undefined);
  // Resources tab (the curated Library). Shown only when the library is reachable + enabled, mirroring
  // the offline-first hiding everywhere else. `pendingResource` carries a deep-link from a chat chip.
  const [libReady, setLibReady] = useState(false);
  const [pendingResource, setPendingResource] = useState<string | null>(null);

  const switchTab = (tab: Tab, opts?: SwitchTabOpts) => {
    if (tab === "chat" && opts?.seedTopic) {
      setChatSeedTopic(opts.seedTopic);
    }
    setActiveTab(tab);
  };

  const loadCourseData = async () => {
    const c = await getCourse(courseId);
    const s = await getSyllabuses(courseId);
    setCourse(c);
    setSyllabuses(s);
    // On initial load, set viewing level to the course's active level
    setViewingLevel((prev) => prev ?? (c?.current_level ?? 1));
  };

  useEffect(() => { loadCourseData(); }, [courseId]);

  // Gate the Resources tab on library availability (enabled + a cached manifest). The manifest is
  // warmed at app init (main.tsx → refreshManifest); getManifest is cache-first + offline-safe.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const enabled = await getLibraryEnabled();
        if (!enabled) { if (alive) setLibReady(false); return; }
        const m = await getManifest();
        if (alive) setLibReady(m.length > 0);
      } catch {
        if (alive) setLibReady(isLibraryAvailable());
      }
    })();
    return () => { alive = false; };
  }, []);

  // Deep-link from a chat library citation chip → open that card in the Resources tab.
  const openResource = (id: string) => {
    setPendingResource(id);
    setActiveTab("resources");
  };

  const handleRegenerate = async () => {
    if (!course) return;
    setRegenerating(true);
    setRegenStatus("Researching topic...");
    const ALL_LEVELS = [1, 2, 3, 4, 5, 6];
    try {
      const config = await getGenerationConfig();
      const brief = await researchTopic(course.topic, config);
      setRegenStatus("Planning course structure...");
      const courseOutline = await generateCourseOutline(course.topic, brief, config, courseId);
      setRegenStatus("Designing tutor...");
      await generateTutorInstructions(courseId, course.topic, brief, config);
      const previousSyllabuses: Syllabus[] = [];
      for (let i = 0; i < ALL_LEVELS.length; i++) {
        setRegenStatus(`Building Level ${ALL_LEVELS[i]} syllabus...`);
        const syl = await generateSyllabus(courseId, course.topic, ALL_LEVELS[i], config, brief, undefined, previousSyllabuses, courseOutline);
        await recordLedgerEntry(courseId, syl);
        previousSyllabuses.push(syl);
      }
      await loadCourseData();
      setRegenStatus("");
    } catch (e) {
      setRegenStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (!course) {
    return <div className="flex-1 flex items-center justify-center text-[var(--ink-faint)]">Loading...</div>;
  }

  // Sorted list of generated level numbers
  const availableLevels = syllabuses.map((s) => s.level).sort((a, b) => a - b);
  const effectiveViewingLevel = viewingLevel ?? course.current_level;
  const viewingIndex = availableLevels.indexOf(effectiveViewingLevel);
  const viewingSyllabus = syllabuses.find((s) => s.level === effectiveViewingLevel) ?? null;

  const canGoBack = viewingIndex > 0;
  const canGoForward = viewingIndex < availableLevels.length - 1;

  const navigateLevel = (dir: -1 | 1) => {
    const newIndex = viewingIndex + dir;
    if (newIndex >= 0 && newIndex < availableLevels.length) {
      setViewingLevel(availableLevels[newIndex]);
    }
  };

  const isCurrentLevel = effectiveViewingLevel === course.current_level;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "chat", label: "Chat" },
    { id: "notes", label: "Notes" },
    { id: "quiz", label: "Quiz" },
    { id: "review", label: "Review" },
    { id: "syllabus", label: "Syllabus" },
    ...(libReady ? [{ id: "resources" as Tab, label: "Resources" }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* ── Top header bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--rule)] bg-panel shrink-0">
        {/* Left: back + title */}
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-lcd text-[var(--ink-faint)] hover:text-ink transition-colors shrink-0"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-ink truncate leading-tight">{course.title}</h1>
          <p className="text-[11px] text-[var(--ink-faint)] leading-tight">
            Active: Level {course.current_level} — {getLevelMeaning(course.current_level)}
          </p>
        </div>

        {/* Right: level navigation + test button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Level nav arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateLevel(-1)}
              disabled={!canGoBack}
              className="p-1.5 rounded-lg hover:bg-lcd text-[var(--ink-faint)] hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous unit"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="text-xs font-mono font-semibold text-[var(--ink-dim)] min-w-[32px] text-center">
              {effectiveViewingLevel}
            </span>
            <button
              onClick={() => navigateLevel(1)}
              disabled={!canGoForward}
              className="p-1.5 rounded-lg hover:bg-lcd text-[var(--ink-faint)] hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next unit"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* Take Test button */}
          <button
            onClick={() => {
              if (course && viewingSyllabus) {
                onOpenPromotionTest({ courseId, course, level: effectiveViewingLevel, syllabus: viewingSyllabus, allSyllabuses: syllabuses });
              }
            }}
            disabled={!isCurrentLevel || !viewingSyllabus}
            title={
              !isCurrentLevel
                ? "Navigate to your active level to take the promotion test"
                : !viewingSyllabus
                ? "Syllabus not generated yet"
                : "Take the promotion test for this level"
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              isCurrentLevel && viewingSyllabus
                ? "btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white"
                : "bg-panel-lite text-[var(--ink-faint)] cursor-not-allowed"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Promotion Test
          </button>
        </div>
      </div>

      {/* ── Tabs row ── */}
      <div className="flex items-center px-4 pt-1.5 bg-panel border-b border-[var(--rule)] shrink-0">
        <div className="flex gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? "bg-bg text-phosphor-bright border-b-2 border-phosphor"
                  : "text-[var(--ink-faint)] hover:text-ink hover:bg-panel-lite/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Viewing level indicator when browsing a non-active level */}
        {!isCurrentLevel && (
          <span className="ml-auto text-[10px] text-amber-400/80 flex items-center gap-1 pb-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            Viewing Level {effectiveViewingLevel} — {getLevelMeaning(effectiveViewingLevel)}
          </span>
        )}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {activeTab === "overview" && (
          <OverviewTab
            courseId={courseId}
            course={course}
            level={effectiveViewingLevel}
            currentSyllabus={viewingSyllabus}
            onRegenerate={syllabuses.length === 0 ? handleRegenerate : undefined}
            regenerating={regenerating}
            regenStatus={regenStatus}
            switchTab={switchTab}
            onOpenPromotionTest={
              viewingSyllabus && isCurrentLevel
                ? () =>
                    onOpenPromotionTest({
                      courseId,
                      course,
                      level: effectiveViewingLevel,
                      syllabus: viewingSyllabus,
                      allSyllabuses: syllabuses,
                    })
                : undefined
            }
          />
        )}
        {activeTab === "chat" && (
          <ChatTab
            courseId={courseId}
            course={course}
            level={effectiveViewingLevel}
            currentSyllabus={viewingSyllabus}
            seedTopic={chatSeedTopic}
            onSeedConsumed={() => setChatSeedTopic(undefined)}
            onOpenResource={openResource}
            onOpenReview={() => switchTab("review")}
          />
        )}
        {activeTab === "notes" && (
          <NotesTab courseId={courseId} level={effectiveViewingLevel} />
        )}
        {activeTab === "review" && (
          <ReviewTab courseId={courseId} level={effectiveViewingLevel} />
        )}
        {activeTab === "quiz" && (
          <QuizTab
            courseId={courseId}
            currentSyllabus={viewingSyllabus}
            onStartQuiz={course && viewingSyllabus ? () => onOpenQuiz({ courseId, course, level: effectiveViewingLevel, syllabus: viewingSyllabus, allSyllabuses: syllabuses }) : undefined}
          />
        )}
        {activeTab === "syllabus" && (
          <SyllabusView
            syllabuses={syllabuses}
            viewingLevel={effectiveViewingLevel}
            currentLevel={course.current_level}
            onRegenerate={syllabuses.length === 0 ? handleRegenerate : undefined}
            regenerating={regenerating}
            regenStatus={regenStatus}
          />
        )}
        {activeTab === "resources" && (
          <ResourcesTab
            course={course}
            currentSyllabus={viewingSyllabus}
            pendingResourceId={pendingResource}
            onPendingConsumed={() => setPendingResource(null)}
          />
        )}
      </div>

    </div>
  );
}

// ── Syllabus View ─────────────────────────────────────────────────────────────
function SyllabusView({
  syllabuses, viewingLevel, currentLevel, onRegenerate, regenerating, regenStatus,
}: {
  syllabuses: Syllabus[];
  viewingLevel: number;
  currentLevel: number;
  onRegenerate?: () => void;
  regenerating?: boolean;
  regenStatus?: string;
}) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {syllabuses.map((syllabus) => (
          <div
            key={syllabus.id || syllabus.level}
            className={`p-5 rounded-xl border ${
              syllabus.level === viewingLevel
                ? "bg-panel border-phosphor/50"
                : "bg-panel/50 border-[var(--rule)]"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                syllabus.level === currentLevel
                  ? "btn-primary text-white"
                  : syllabus.level < currentLevel
                  ? "bg-green-700/40 text-green-300"
                  : "bg-lcd text-[var(--ink-faint)]"
              }`}>
                {syllabus.level}
              </span>
              <h3 className="text-ink font-semibold">{syllabus.title}</h3>
              {syllabus.level < currentLevel && (
                <span className="text-xs text-green-400 ml-auto">Completed ✓</span>
              )}
            </div>
            <p className="text-sm text-[var(--ink-faint)] mb-4">{syllabus.description}</p>
            <div className="mb-4">
              <h4 className="text-xs uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">Learning Objectives</h4>
              <ul className="space-y-1">
                {syllabus.learning_objectives.map((obj, i) => (
                  <li key={i} className="text-sm text-[var(--ink-dim)] flex gap-2">
                    <span className="text-phosphor-ink shrink-0">–</span>{obj}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">Subtopics</h4>
              <div className="space-y-1.5">
                {syllabus.subtopics.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-3 p-2 rounded-lg bg-panel-lite/40">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      sub.mastered ? "border-green-500 bg-green-500/20" : "border-[var(--rule)]"
                    }`}>
                      {sub.mastered && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{sub.title}</div>
                      <div className="text-[10px] text-[var(--ink-faint)]">{sub.key_concepts.join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 text-xs text-[var(--ink-faint)]">~{syllabus.estimated_hours}h estimated</div>
          </div>
        ))}
        {syllabuses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--ink-faint)] mb-4">No syllabus generated yet.</p>
            {onRegenerate && (
              <div>
                {regenStatus && (
                  <p className={`text-sm mb-3 ${regenStatus.startsWith("Error") ? "text-red-400" : "text-phosphor-bright"}`}>
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
          </div>
        )}
      </div>
    </div>
  );
}
