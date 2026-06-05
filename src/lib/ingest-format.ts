// Pure formatting for the notebook import result (slice C1/D6). Turns a per-file tally into an honest,
// actionable message. Kept Tauri-free so it's unit-tested; NotesTab does the importing and renders it.

export interface IngestTally {
  imported: number; // notes created (embedded or not)
  pending: number;  // created but NOT embedded (embedder offline / failed) — will retry on save
  failed: number;   // couldn't even create the note
}

export interface IngestSummary {
  kind: "ok" | "warn" | "error";
  message: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ingestResultSummary({ imported, pending, failed }: IngestTally): IngestSummary {
  if (imported === 0 && failed > 0) {
    return { kind: "error", message: `Couldn't import ${plural(failed, "file")}.` };
  }
  if (pending > 0) {
    return {
      kind: "warn",
      message:
        `Imported ${plural(imported, "note")}, but ${plural(pending, "note")} couldn't be embedded for ` +
        `search — is the embedder (Ollama) running? They'll re-index next time you open and save them.`,
    };
  }
  if (failed > 0) {
    return { kind: "warn", message: `Imported ${plural(imported, "note")}; skipped ${failed} that failed.` };
  }
  return { kind: "ok", message: null };
}
