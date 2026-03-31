import { useState, useEffect } from "react";
import type { Course, Syllabus, QuizViewContext } from "../types";

import { getCourse, getSyllabuses } from "../lib/db";
import { getLevelMeaning, researchTopic, generateTutorInstructions, generateSyllabus, generateCourseOutline } from "../lib/curriculum";
import { getGenerationConfig } from "../lib/store";
import ChatTab from "../components/ChatTab";
import NotesTab from "../components/NotesTab";
import QuizTab from "../components/QuizTab";

type Tab = "chat" | "notes" | "quiz" | "syllabus";

interface CourseViewProps {
  courseId: string;
  onBack: () => void;
  onOpenQuiz: (ctx: QuizViewContext) => void;
  onOpenPromotionTest: (ctx: QuizViewContext) => void;
}

export default function CourseView({ courseId, onBack, onOpenQuiz, onOpenPromotionTest }: CourseViewProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [syllabuses, setSyllabuses] = useState<Syllabus[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [viewingLevel, setViewingLevel] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenStatus, setRegenStatus] = useState("");

  const loadCourseData = async () => {
    const c = await getCourse(courseId);
    const s = await getSyllabuses(courseId);
    setCourse(c);
    setSyllabuses(s);
    // On initial load, set viewing level to the course's active level
    setViewingLevel((prev) => prev ?? (c?.current_level ?? 0));
  };

  useEffect(() => { loadCourseData(); }, [courseId]);

  const handleRegenerate = async () => {
    if (!course) return;
    setRegenerating(true);
    setRegenStatus("Researching topic...");
    const ALL_LEVELS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    try {
      const config = await getGenerationConfig();
      const brief = await researchTopic(course.topic, config);
      setRegenStatus("Planning course structure...");
      const courseOutline = await generateCourseOutline(course.topic, brief, config, courseId);
      setRegenStatus("Designing tutor...");
      await generateTutorInstructions(courseId, course.topic, brief, config);
      const previousSyllabuses: Syllabus[] = [];
      for (let i = 0; i < ALL_LEVELS.length; i++) {
        setRegenStatus(`Building Level ${ALL_LEVELS[i].toFixed(1)} syllabus...`);
        const syl = await generateSyllabus(courseId, course.topic, ALL_LEVELS[i], config, brief, undefined, previousSyllabuses, courseOutline);
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
    return <div className="flex-1 flex items-center justify-center text-zinc-500">Loading...</div>;
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
    { id: "chat", label: "Chat" },
    { id: "notes", label: "Notes" },
    { id: "quiz", label: "Quiz" },
    { id: "syllabus", label: "Syllabus" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* ── Top header bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-600 bg-surface-800 shrink-0">
        {/* Left: back + title */}
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-surface-600 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-zinc-100 truncate leading-tight">{course.title}</h1>
          <p className="text-[11px] text-zinc-500 leading-tight">
            Active: Level {course.current_level.toFixed(1)} — {getLevelMeaning(course.current_level)}
          </p>
        </div>

        {/* Right: level navigation + test button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Level nav arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateLevel(-1)}
              disabled={!canGoBack}
              className="p-1.5 rounded-lg hover:bg-surface-600 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous unit"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="text-xs font-mono font-semibold text-zinc-300 min-w-[32px] text-center">
              {effectiveViewingLevel.toFixed(1)}
            </span>
            <button
              onClick={() => navigateLevel(1)}
              disabled={!canGoForward}
              className="p-1.5 rounded-lg hover:bg-surface-600 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                ? "bg-terra-600 hover:bg-terra-500 text-white"
                : "bg-surface-700 text-zinc-500 cursor-not-allowed"
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
      <div className="flex items-center px-4 pt-1.5 bg-surface-800 border-b border-surface-600 shrink-0">
        <div className="flex gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? "bg-surface-900 text-terra-300 border-b-2 border-terra-500"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-700/50"
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
            Viewing Level {effectiveViewingLevel.toFixed(1)} — {getLevelMeaning(effectiveViewingLevel)}
          </span>
        )}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {activeTab === "chat" && (
          <ChatTab
            courseId={courseId}
            course={course}
            level={effectiveViewingLevel}
            currentSyllabus={viewingSyllabus}
          />
        )}
        {activeTab === "notes" && (
          <NotesTab courseId={courseId} level={effectiveViewingLevel} />
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
                ? "bg-surface-800 border-terra-500/50"
                : "bg-surface-800/50 border-surface-600"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                syllabus.level === currentLevel
                  ? "bg-terra-600 text-white"
                  : syllabus.level < currentLevel
                  ? "bg-green-700/40 text-green-300"
                  : "bg-surface-600 text-zinc-400"
              }`}>
                {syllabus.level.toFixed(1)}
              </span>
              <h3 className="text-zinc-100 font-semibold">{syllabus.title}</h3>
              {syllabus.level < currentLevel && (
                <span className="text-xs text-green-400 ml-auto">Completed ✓</span>
              )}
            </div>
            <p className="text-sm text-zinc-400 mb-4">{syllabus.description}</p>
            <div className="mb-4">
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Learning Objectives</h4>
              <ul className="space-y-1">
                {syllabus.learning_objectives.map((obj, i) => (
                  <li key={i} className="text-sm text-zinc-300 flex gap-2">
                    <span className="text-terra-400 shrink-0">–</span>{obj}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Subtopics</h4>
              <div className="space-y-1.5">
                {syllabus.subtopics.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-700/40">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      sub.mastered ? "border-green-500 bg-green-500/20" : "border-surface-500"
                    }`}>
                      {sub.mastered && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-200">{sub.title}</div>
                      <div className="text-[10px] text-zinc-500">{sub.key_concepts.join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 text-xs text-zinc-500">~{syllabus.estimated_hours}h estimated</div>
          </div>
        ))}
        {syllabuses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-500 mb-4">No syllabus generated yet.</p>
            {onRegenerate && (
              <div>
                {regenStatus && (
                  <p className={`text-sm mb-3 ${regenStatus.startsWith("Error") ? "text-red-400" : "text-terra-300"}`}>
                    {regenStatus}
                  </p>
                )}
                <button
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="px-5 py-2 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
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
