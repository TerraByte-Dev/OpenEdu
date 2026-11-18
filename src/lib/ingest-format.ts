// Pure formatting for the notebook import result (slice C1/D6). Turns a per-file tally into an honest,
// actionable message. Kept Tauri-free so it's unit-tested; NotesTab does the importing and renders it.

import { embeddingModelMissing } from "./plain-language";

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
    // The usual cause on a new computer is the embedding model not being there, not Ollama being down:
    // say so, and where it's added. NotesTab retries every note on open (reindexCourseNotes).
    const missing = reason !== undefined && embeddingModelMissing(reason);
    return {
      kind: "warn",
      message:
        `Imported ${plural(imported, "note")}, but ${plural(pending, "note")} couldn't be added to notebook search yet.` +
        (missing ? " Notebook search isn't set up on this computer yet. Add the embedding model in Settings › Provider & Models." : "") +
        " OpenEdu tries again each time you open Notes.",
    };
  }
  if (failed > 0) {
    return { kind: "warn", message: `Imported ${plural(imported, "note")}; skipped ${failed} that failed.` };
  }
  return { kind: "ok", message: null };
}
