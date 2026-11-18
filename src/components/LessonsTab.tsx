import { useState, useEffect, useCallback } from "react";
import type { Lesson, Syllabus, Subtopic } from "../types";
import { getLessons, getLesson, lessonWasChecked } from "../lib/db";
import { lessonHelpFor, lessonWritesFor, writeLessonOnce } from "../lib/curriculum";
import { getLessonConfigs } from "../lib/store";
import { log } from "../lib/llm";
import { friendlyError } from "../lib/plain-language";
import LessonReader from "./LessonReader";
import { lessonStatusLine } from "../lib/ai-notice";
import { isEarlyReader, type Grade } from "../lib/grade";
import RaiseHand from "./RaiseHand";

interface LessonsTabProps {
  courseId: string;
  level: number;
  topic: string;
  currentSyllabus: Syllabus | null;
  // Deep-link from NextStepCard: open (generating if needed) the lesson for this subtopic.
  lessonSubtopicId?: string;
  onDeepLinkConsumed?: () => void;
  /** Raise hand's "Try typing to your tutor": open the chat for this subtopic. */
  onTypeToTutor?: (subtopicTitle: string | null) => void;
  /** For the status line under the lesson (ai-notice.ts lessonStatusLine): K-2 wording. */
  grade?: Grade | null;
}

export default function LessonsTab({ courseId, level, topic, currentSyllabus, lessonSubtopicId, onDeepLinkConsumed, onTypeToTutor, grade = null }: LessonsTabProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState("");
  // Whether the open lesson was checked when it was written (lesson_checks), once read for that lesson.
  const [check, setCheck] = useState<{ id: string; checked: boolean } | null>(null);

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

  const saved = useCallback((lesson: Lesson) => {
    setLessons((prev) => [lesson, ...prev.filter((l) => l.id !== lesson.id)]);
  }, []);

  // Lessons still being written from an earlier visit to this level or tab (CourseView remounts this tab
  // per course level; curriculum.ts writeLessonOnce): shown as writing, and in the list once saved, so
  // they are never offered to be written again. Not opened: the learner may be reading something else.
  useEffect(() => {
    let live = true;
    for (const w of lessonWritesFor(courseId, level)) {
      setGeneratingId(w.subtopicId);
      w.run
        .then((lesson) => { if (live) saved(lesson); })
        .catch((e) => { if (live) setError(`Couldn't make that lesson. ${friendlyError(e)}`); })
        .finally(() => { if (live) setGeneratingId((g) => (g === w.subtopicId ? null : g)); });
    }
    return () => { live = false; };
  }, [courseId, level, saved]);

  const generate = useCallback(async (sub: Subtopic): Promise<Lesson | null> => {
    setError("");
    setGeneratingId(sub.id);
    try {
      // Joins this subtopic's write when one is running, so a second tap never writes it twice.
      const lesson = await writeLessonOnce(courseId, level, { id: sub.id, title: sub.title, key_concepts: sub.key_concepts }, topic, getLessonConfigs);
      saved(lesson);
      return lesson;
    } catch (e) {
      log.error("LessonsTab", "lesson generation failed", e);
      setError(`Couldn't make that lesson. ${friendlyError(e)}`);
      return null;
    } finally {
      // Only this write's "Writing…": another may have started since.
      setGeneratingId((g) => (g === sub.id ? null : g));
    }
  }, [courseId, level, topic, saved]);

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

  useEffect(() => {
    if (!openLesson) return;
    const id = openLesson.id;
    let live = true;
    lessonWasChecked(id)
      .then((checked) => { if (live) setCheck({ id, checked }); })
      .catch(() => { if (live) setCheck({ id, checked: false }); }); // unknown reads as not checked
    return () => { live = false; };
  }, [openLesson?.id]);

  // Consume a deep-link once the syllabus is loaded.
  useEffect(() => {
    if (!lessonSubtopicId || loading || !currentSyllabus) return;
    const sub = currentSyllabus.subtopics.find((s) => s.id === lessonSubtopicId);
    onDeepLinkConsumed?.();
    if (sub) void openFor(sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonSubtopicId, loading, currentSyllabus]);

  if (openLesson) {
    const lesson = openLesson;
    const sub = currentSyllabus?.subtopics.find((s) => s.id === lesson.subtopic_id)
      ?? { id: lesson.subtopic_id ?? lesson.id, title: lesson.topic_string, key_concepts: [] };
    const raiseHand = (
      <RaiseHand
        surface="lesson"
        targets={[{ id: sub.id, title: sub.title }]}
        load={() => lessonHelpFor(lesson, sub, topic, getLessonConfigs)}
        onTypeToTutor={(t) => onTypeToTutor?.(t?.title ?? null)}
      />
    );
    const status = check?.id === lesson.id ? lessonStatusLine({ checked: check.checked, grade }) : null;
    return <LessonReader lesson={lesson} onBack={() => setOpenLesson(null)} onRead={load} raiseHand={raiseHand} status={status} largeText={isEarlyReader(grade)} />;
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

        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

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
                      lesson ? (lesson.read_at ? "bg-success" : "bg-phosphor") : "bg-[var(--rule)]"
                    }`}
                    title={lesson ? (lesson.read_at ? "Read" : "Unread") : "Not generated"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-base text-ink truncate">{sub.title}</div>
                    <div className="text-sm text-[var(--ink-faint)] truncate">
                      {lesson ? (lesson.read_at ? "Read" : "Ready to read") : sub.key_concepts.join(" · ")}
                    </div>
                  </div>
                  <button
                    onClick={() => openFor(sub)}
                    disabled={isGenerating}
                    className="px-3 py-1.5 rounded-lg btn-primary text-sm font-medium hover:bg-[rgb(var(--phosphor-rgb)/0.24)] disabled:opacity-50 transition-colors shrink-0"
                  >
                    {isGenerating ? "Writing…" : lesson ? "Open" : "Write it for me"}
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
