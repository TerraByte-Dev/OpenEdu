import { useEffect, useMemo } from "react";
import type { Lesson } from "../types";
import { renderChatMarkdown, ensureChatKatex } from "../lib/chat-markdown";
import { markLessonRead } from "../lib/db";
import { IconArrowLeft } from "./icons";

interface LessonReaderProps {
  lesson: Lesson;
  onBack: () => void;
  onRead?: () => void;
}

// Reads one cached lesson as Obsidian-style prose (reusing the chat markdown + KaTeX render path).
export default function LessonReader({ lesson, onBack, onRead }: LessonReaderProps) {
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
      </div>
      <div className="p-6">
        <article className="note-prose max-w-2xl mx-auto" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
