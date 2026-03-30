import { useState, useEffect } from "react";
import type { Course, Syllabus } from "../types";
import { getCourse, getSyllabuses } from "../lib/db";
import { getLevelMeaning, researchTopic, generateTutorInstructions, generateSyllabus } from "../lib/curriculum";
import { getGenerationConfig } from "../lib/store";
import ChatTab from "../components/ChatTab";
import NotesTab from "../components/NotesTab";
import QuizTab from "../components/QuizTab";

type Tab = "chat" | "syllabus" | "notes" | "quiz";

interface CourseViewProps {
  courseId: string;
  onBack: () => void;
}

export default function CourseView({ courseId, onBack }: CourseViewProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [syllabuses, setSyllabuses] = useState<Syllabus[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [regenerating, setRegenerating] = useState(false);
  const [regenStatus, setRegenStatus] = useState("");

  const loadCourseData = async () => {
    const c = await getCourse(courseId);
    setCourse(c);
    const s = await getSyllabuses(courseId);
    setSyllabuses(s);
  };

  useEffect(() => {
    loadCourseData();
  }, [courseId]);

  const handleRegenerate = async () => {
    if (!course) return;
    setRegenerating(true);
    setRegenStatus("Researching topic...");
    try {
      const config = await getGenerationConfig();
      const brief = await researchTopic(course.topic, config);
      setRegenStatus("Designing tutor...");
      await generateTutorInstructions(courseId, course.topic, brief, config);
      setRegenStatus("Building Level 0.0 syllabus...");
      await generateSyllabus(courseId, course.topic, 0.0, config, brief);
      setRegenStatus("Building Level 0.5 syllabus...");
      await generateSyllabus(courseId, course.topic, 0.5, config, brief);
      await loadCourseData();
      setRegenStatus("");
    } catch (e) {
      setRegenStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (!course) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }

  const currentSyllabus = syllabuses.find(
    (s) => s.level === course.current_level
  ) ?? syllabuses[0] ?? null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "syllabus", label: "Syllabus" },
    { id: "notes", label: "Notes" },
    { id: "quiz", label: "Quiz" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Course header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-surface-600 bg-surface-800">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-surface-600 text-zinc-400 hover:text-zinc-200"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-zinc-100 truncate">{course.title}</h1>
          <p className="text-xs text-zinc-500">
            Level {course.current_level.toFixed(1)} &mdash; {getLevelMeaning(course.current_level)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-2 bg-surface-800 border-b border-surface-600">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? "bg-surface-900 text-terra-300 border-b-2 border-terra-500"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {activeTab === "chat" && (
          <ChatTab courseId={courseId} course={course} currentSyllabus={currentSyllabus} />
        )}
        {activeTab === "syllabus" && (
          <SyllabusView
            syllabuses={syllabuses}
            currentLevel={course.current_level}
            onRegenerate={syllabuses.length === 0 ? handleRegenerate : undefined}
            regenerating={regenerating}
            regenStatus={regenStatus}
          />
        )}
        {activeTab === "notes" && <NotesTab courseId={courseId} />}
        {activeTab === "quiz" && (
          <QuizTab courseId={courseId} currentSyllabus={currentSyllabus} />
        )}
      </div>
    </div>
  );
}

function SyllabusView({
  syllabuses,
  currentLevel,
  onRegenerate,
  regenerating,
  regenStatus,
}: {
  syllabuses: Syllabus[];
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
              syllabus.level === currentLevel
                ? "bg-surface-800 border-terra-500/50"
                : "bg-surface-800/50 border-surface-600"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                syllabus.level === currentLevel
                  ? "bg-terra-600 text-white"
                  : "bg-surface-600 text-zinc-400"
              }`}>
                {syllabus.level.toFixed(1)}
              </span>
              <h3 className="text-zinc-100 font-semibold">{syllabus.title}</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-4">{syllabus.description}</p>

            <div className="mb-4">
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Learning Objectives
              </h4>
              <ul className="space-y-1">
                {syllabus.learning_objectives.map((obj, i) => (
                  <li key={i} className="text-sm text-zinc-300 flex gap-2">
                    <span className="text-terra-400 shrink-0">-</span>
                    {obj}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Subtopics
              </h4>
              <div className="space-y-2">
                {syllabus.subtopics.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-surface-700/50"
                  >
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      sub.mastered
                        ? "border-green-500 bg-green-500/20"
                        : "border-surface-500"
                    }`}>
                      {sub.mastered && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" className="text-green-400" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-200">{sub.title}</div>
                      <div className="text-[10px] text-zinc-500">
                        {sub.key_concepts.join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-500">
              ~{syllabus.estimated_hours} hours estimated
            </div>
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
