import { useState, useEffect, useCallback } from "react";
import type { Lesson, Syllabus, Subtopic } from "../types";
import { getLessons, getLesson } from "../lib/db";
import { generateLesson } from "../lib/curriculum";
import { getGenerationConfig } from "../lib/store";
import LessonReader from "./LessonReader";

interface LessonsTabProps {
  courseId: string;
  level: number;
  topic: string;
  currentSyllabus: Syllabus | null;
  // Deep-link from NextStepCard: open (generating if needed) the lesson for this subtopic.
  lessonSubtopicId?: string;
  onDeepLinkConsumed?: () => void;
}

export default function LessonsTab({ courseId, level, topic, currentSyllabus, lessonSubtopicId, onDeepLinkConsumed }: LessonsTabProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLessons(await getLessons(courseId, level));
    setLoading(false);
  }, [courseId, level]);

  useEffect(() => { load(); }, [load]);

  // Lesson for a subtopic (cached match by subtopic_id).
  const lessonFor = useCallback(
    (subtopicId: string) => lessons.find((l) => l.subtopic_id === subtopicId) ?? null,
    [lessons],
  );

  const generate = useCallback(async (sub: Subtopic): Promise<Lesson | null> => {
    setError("");
    setGeneratingId(sub.id);
    try {
      const cfg = await getGenerationConfig();
      const lesson = await generateLesson(courseId, level, { id: sub.id, title: sub.title, key_concepts: sub.key_concepts }, topic, cfg);
      setLessons((prev) => [lesson, ...prev.filter((l) => l.id !== lesson.id)]);
      return lesson;
    } catch (e) {
      setError(`Couldn't generate that lesson: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setGeneratingId(null);
    }
  }, [courseId, level, topic]);

  const openFor = useCallback(async (sub: Subtopic) => {
    const existing = lessonFor(sub.id);
    if (existing) {
      // Re-fetch so read_at is current.
      setOpenLesson((await getLesson(existing.id)) ?? existing);
      return;
    }
    const made = await generate(sub);
    if (made) setOpenLesson(made);
  }, [lessonFor, generate]);

  // Consume a deep-link once the syllabus is loaded.
  useEffect(() => {
    if (!lessonSubtopicId || loading || !currentSyllabus) return;
    const sub = currentSyllabus.subtopics.find((s) => s.id === lessonSubtopicId);
    onDeepLinkConsumed?.();
    if (sub) void openFor(sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonSubtopicId, loading, currentSyllabus]);

  if (openLesson) {
    return <LessonReader lesson={openLesson} onBack={() => setOpenLesson(null)} onRead={load} />;
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-[var(--ink-faint)]">Loading lessons…</div>;
  }

  const subtopics = currentSyllabus?.subtopics ?? [];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-ink">Lessons</h2>
          <p className="text-xs text-[var(--ink-faint)]">
            A clean, readable walkthrough of each subtopic — generated on demand and saved here.
          </p>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {subtopics.length === 0 ? (
          <div className="text-center py-12 px-6 rounded-2xl border border-[var(--rule)] bg-panel-lite/30">
            <p className="text-[var(--ink-faint)] text-sm">This level's syllabus hasn't been generated yet.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {subtopics.map((sub) => {
              const lesson = lessonFor(sub.id);
              const isGenerating = generatingId === sub.id;
              return (
                <li
                  key={sub.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[var(--rule)] bg-panel-lite/40"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      lesson ? (lesson.read_at ? "bg-green-500" : "bg-phosphor") : "bg-[var(--rule)]"
                    }`}
                    title={lesson ? (lesson.read_at ? "Read" : "Unread") : "Not generated"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{sub.title}</div>
                    <div className="text-[10px] text-[var(--ink-faint)] truncate">
                      {lesson ? (lesson.read_at ? "Read" : "Ready to read") : sub.key_concepts.join(" · ")}
                    </div>
                  </div>
                  <button
                    onClick={() => openFor(sub)}
                    disabled={isGenerating}
                    className="px-3 py-1.5 rounded-lg btn-primary text-xs font-medium hover:bg-[rgb(var(--phosphor-rgb)/0.24)] disabled:opacity-50 transition-colors shrink-0"
                  >
                    {isGenerating ? "Writing…" : lesson ? "Open" : "Generate"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
