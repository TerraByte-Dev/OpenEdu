// Typed wrappers for the backup's file commands in src-tauri/src/backup.rs. Rust opens the Save dialog and
// keeps the picked path; the webview gets only the temporary `.partial` path that VACUUM INTO writes, and
// Rust renames it to the picked name once the copy is whole (db-resilience.ts backupTo). The Rust
// signatures and these wrappers are not type-linked: keep them in sync.

import { invoke } from "@tauri-apps/api/core";
import type { BackupDestination } from "./db-resilience";

/** Ask where to save the backup. Null when the user cancelled. */
export async function pickBackupDestination(suggestedName: string): Promise<BackupDestination | null> {
  const partial = await invoke<string | null>("backup_pick", { suggestedName });
  if (!partial) return null;
  return {
    partial,
    finish: () => invoke<string>("backup_finish"),
    abandon: () => invoke<void>("backup_abandon"),
  };
}
