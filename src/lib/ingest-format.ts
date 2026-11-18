// Pure formatting for the notebook import result (slice C1/D6). Turns a per-file tally into an honest,
// actionable message. Kept Tauri-free so it's unit-tested; NotesTab does the importing and renders it.

import { embeddingModelMissing, embedderUnavailable } from "./plain-language";

export interface IngestTally {
  imported: number; // notes created (embedded or not)
  pending: number;  // created but NOT embedded (embedder missing / offline) — retried when Notes next opens
  failed: number;   // couldn't even create the note
  reason?: string;  // the first embed error, if any
}

export interface IngestSummary {
  kind: "ok" | "warn" | "error";
  message: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ingestResultSummary({ imported, pending, failed, reason }: IngestTally): IngestSummary {
  if (imported === 0 && failed > 0) {
    return { kind: "error", message: `Couldn't import ${plural(failed, "file")}.` };
  }
  if (pending > 0) {
    // With no embedder that can run (none pulled, Ollama not answering, the OpenAI embedder with no key
    // or connection), the notes are still searched, by their words (notebook.ts searchNotesByWords), so
    // the message never says they won't be. The missing model is the usual cause on a new computer: say
    // where it's added. NotesTab retries the embed every time Notes opens (reindexCourseNotes).
    const byWords = imported === 1 ? "It's searched by its words" : "They're searched by their words";
    if (reason !== undefined && embeddingModelMissing(reason)) {
      return {
        kind: "warn",
        message: `Imported ${plural(imported, "note")}. ${byWords}; searching by meaning needs the embedding model, added in Settings › Provider & Models.`,
      };
    }
    if (reason !== undefined && embedderUnavailable(reason)) {
      return {
        kind: "warn",
        message: `Imported ${plural(imported, "note")}. ${byWords} for now. OpenEdu tries again each time you open Notes.`,
      };
    }
    // A note's own embed failed (the embedder is up): it is out of search until the retry indexes it.
    return {
      kind: "warn",
      message:
        `Imported ${plural(imported, "note")}, but ${plural(pending, "note")} couldn't be added to notebook search yet.` +
        " OpenEdu tries again each time you open Notes.",
    };
  }
  if (failed > 0) {
    return { kind: "warn", message: `Imported ${plural(imported, "note")}; skipped ${failed} that failed.` };
  }
  return { kind: "ok", message: null };
}
