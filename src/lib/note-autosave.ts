// Saving a Notebook note (NotesTab). A note saves a few seconds after the learner stops typing, and again on
// every way out: the editor losing focus, opening another note, leaving the Notes tab, closing the window
// (App's onCloseRequested awaits savePendingEdits). So text typed before Alt+F4, a crash or a power cut is
// kept, up to the last pause.
//
// One write at a time, never the same words twice, and words typed while a save is on its way are saved
// after it rather than dropped. A save that fails keeps its words here (`newest`, `failure`) until one
// succeeds: NotesTab won't open another note over them, and reopening the note brings them back.
//
// Pure: NotesTab hands it the write (db.ts updateNote). Tested in note-autosave.test.ts.

export interface NoteDraft { id: string; courseId: string; title: string; content: string }
export interface NoteWords { title: string; content: string }

export interface NoteSaverEvents {
  saving?(on: boolean): void;
  saved?(draft: NoteDraft): void;
  failed?(draft: NoteDraft, error: unknown): void;
}

/** How long after the last keystroke a note saves by itself. */
export const AUTOSAVE_DELAY_MS = 2000;

const same = (a: NoteWords, b: NoteWords) => a.title === b.title && a.content === b.content;

// Every saver, so the window's close can save them all without knowing who made them.
const savers = new Set<{ flush(): Promise<Set<string>> }>();

export function createNoteSaver(write: (draft: NoteDraft) => Promise<void>, delayMs = AUTOSAVE_DELAY_MS) {
  const unsaved = new Map<string, NoteDraft>();  // newest words not yet on disk, by note
  const writing = new Map<string, NoteWords>();  // the words on their way to disk right now
  const onDisk = new Map<string, NoteWords>();   // what the last save that worked wrote
  const errors = new Map<string, unknown>();     // why a note's last save failed
  const gone = new Set<string>();                // deleted notes: never written again
  const listeners = new Set<NoteSaverEvents>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  const emit = (fn: (l: NoteSaverEvents) => void) => listeners.forEach(fn);

  // Writes every note with unsaved words, newest words each, one at a time. Resolves to the ids that failed.
  const writeAll = async (): Promise<Set<string>> => {
    const failed = new Set<string>();
    for (const id of [...unsaved.keys()]) {
      const draft = unsaved.get(id);
      if (!draft || gone.has(id)) continue;
      writing.set(id, { title: draft.title, content: draft.content });
      emit((l) => l.saving?.(true));
      try {
        await write(draft);
      } catch (e) {
        // Typed back to these very words while they were saving (edit() then had nothing to keep): keep them.
        if (!unsaved.has(id) && !gone.has(id)) unsaved.set(id, draft);
        errors.set(id, e);
        failed.add(id);
        emit((l) => l.failed?.(draft, e));
        continue;
      } finally {
        writing.delete(id);
        emit((l) => l.saving?.(false));
      }
      onDisk.set(id, { title: draft.title, content: draft.content });
      errors.delete(id);
      // Typed on while it was saving: those words stay unsaved, for the timer edit() set.
      const now = unsaved.get(id);
      if (now && same(now, draft)) unsaved.delete(id);
      if (!gone.has(id)) emit((l) => l.saved?.(draft));
    }
    return failed;
  };

  const run = (): Promise<Set<string>> => {
    const p = chain.then(writeAll);
    chain = p.catch(() => {});
    return p;
  };

  const saver = {
    /**
     * The open note's words changed. `saved` is the note as last loaded; the saver's own record of what it
     * wrote wins over it, since that may be newer.
     */
    edit(draft: NoteDraft, saved: NoteWords) {
      if (gone.has(draft.id)) return;
      const ref = writing.get(draft.id) ?? onDisk.get(draft.id) ?? saved;
      if (same(draft, ref)) {
        // Back to what is on disk (an undo): nothing to save, and nothing unsaved to warn about.
        unsaved.delete(draft.id);
        if (errors.delete(draft.id)) emit((l) => l.saved?.(draft));
        return;
      }
      unsaved.set(draft.id, draft);
      clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void run(); }, delayMs);
    },
    /** Save everything unsaved now. Resolves to the ids whose save failed (their words are kept). */
    flush(): Promise<Set<string>> {
      clearTimeout(timer);
      timer = undefined;
      return run();
    },
    /** The newest words the saver holds for a note (unsaved, saving or saved), if it has any. */
    newest(id: string): NoteWords | undefined {
      const w = unsaved.get(id) ?? writing.get(id) ?? onDisk.get(id);
      return w && { title: w.title, content: w.content };
    },
    /** A note whose last save failed and whose words are still unsaved: those words, and why. */
    failure(id: string): { title: string; error: unknown } | undefined {
      const draft = unsaved.get(id);
      return draft && errors.has(id) ? { title: draft.title, error: errors.get(id) } : undefined;
    },
    /** The note was deleted: drop its unsaved words and never write it again. */
    discard(id: string) {
      gone.add(id);
      unsaved.delete(id);
      onDisk.delete(id);
      errors.delete(id);
    },
    listen(events: NoteSaverEvents): () => void {
      listeners.add(events);
      return () => { listeners.delete(events); };
    },
  };
  savers.add(saver);
  return saver;
}

export type NoteSaver = ReturnType<typeof createNoteSaver>;

/**
 * Save every note's unsaved words before the window closes. Bounded, so a database that never answers
 * can't stop the window from closing.
 */
export async function savePendingEdits(timeoutMs = 3000): Promise<void> {
  let stop: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([...savers].map((s) => s.flush())),
    new Promise<void>((resolve) => { stop = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(stop);
}
