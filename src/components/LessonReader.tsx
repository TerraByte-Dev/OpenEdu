import { useEffect, useMemo, type ReactNode } from "react";
import type { Lesson } from "../types";
import { renderChatMarkdown, ensureChatKatex } from "../lib/chat-markdown";
import { markLessonRead } from "../lib/db";
import { IconArrowLeft } from "./icons";
import ReadAloudButton from "./ReadAloudButton";

interface LessonReaderProps {
  lesson: Lesson;
  onBack: () => void;
  onRead?: () => void;
  /** Raise hand, in the header's right corner. */
  raiseHand?: ReactNode;
  /** Whether a second AI checked this lesson (ai-notice.ts lessonStatusLine): one caption line at its foot. */
  status?: string | null;
  /** K-2 (grade.ts isEarlyReader): the lesson at the chat's larger text size (.lesson-text-large). */
  largeText?: boolean;
}

// Reads one cached lesson as Obsidian-style prose (reusing the chat markdown + KaTeX render path), with the
// chat's speaker button, which reads the lesson only (never the status line).
export default function LessonReader({ lesson, onBack, onRead, raiseHand, status, largeText = false }: LessonReaderProps) {
  useEffect(() => {
    void ensureChatKatex();
    markLessonRead(lesson.id).then(() => onRead?.()).catch(() => {});
  }, [lesson.id]);

  const html = useMemo(() => renderChatMarkdown(lesson.content), [lesson.content]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-[var(--rule)] bg-panel/95 backdrop-blur">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel-lite hover:bg-lcd text-[var(--ink-faint)] hover:text-ink text-xs transition-colors"
        >
          <IconArrowLeft size={14} />
          Lessons
        </button>
        <span className="text-xs text-[var(--ink-faint)] truncate">{lesson.topic_string}</span>
        <div className="ml-auto shrink-0 flex items-center gap-2">
          <ReadAloudButton text={lesson.content} />
          {raiseHand}
        </div>
      </div>
      <div className="p-6">
        <article className={`note-prose max-w-2xl mx-auto ${largeText ? "lesson-text-large" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
        {/* A label, not a warning: caption style, no icon, no colour, no banner; never read aloud by itself. */}
        {status && <p className="max-w-2xl mx-auto mt-6 text-[14px] text-[var(--ink-faint)]">{status}</p>}
      </div>
    </div>
  );
}
