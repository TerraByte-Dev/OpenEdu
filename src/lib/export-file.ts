// Typed wrapper for the one write command, export_save_csv in src-tauri/src/export.rs. The Rust side
// opens the Save dialog itself and writes only where the user picked, always as .csv; the webview
// never names a path. The Rust signature and this wrapper are not type-linked: keep them in sync.

import { invoke } from "@tauri-apps/api/core";

/**
 * Ask where to save, then write. Resolves to the saved path, or null when the user cancelled.
 * `title` is the Save dialog's title; without one Rust uses the teacher overview's.
 */
export async function saveCsvFile(suggestedName: string, contents: string, title?: string): Promise<string | null> {
  return await invoke<string | null>("export_save_csv", { suggestedName, contents, title: title ?? null });
}
