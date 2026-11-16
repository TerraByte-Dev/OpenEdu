import { useEffect, useState } from "react";
import { getLessonsNoteInput } from "../../lib/store";
import { log } from "../../lib/llm";
import { lessonsNote, type LessonsNote as Note } from "../../lib/ai-notice";

// "About the lessons", the grown-up's note on whether lessons are checked (ai-notice.ts lessonsNote, Fable's
// decisions 2026-11-16). The description above the Checking model picker in Settings › Models, always open: the
// only place it shows in OpenEdu. Every word and every choice is in ai-notice.ts; this only draws it, from the
// settings store.ts getLessonsNoteInput reads (the Lessons tab's models, saved cloud keys, confirmed notices). Calm,
// no warning colour or icon. `refresh` changes when a setting here is saved, so the body follows it.
export default function LessonsNote({ refresh }: { refresh?: unknown }) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let live = true;
    getLessonsNoteInput()
      .then((input) => { if (live) setNote(lessonsNote(input)); })
      .catch((e) => log.error("LessonsNote", "could not read the lesson settings", e));
    return () => { live = false; };
  }, [refresh]);

  if (!note) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <p className="text-sm font-semibold text-ink">{note.title}</p>
      <p className="text-sm text-[var(--ink-dim)]">{note.body}</p>
      {note.nudge && <p className="text-sm text-[var(--ink-dim)]">{note.nudge}</p>}
    </div>
  );
}
