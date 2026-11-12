// The TS half of src-tauri/src/model_import.rs and ollama_setup.rs (#275). Thin on purpose: the
// decisions are in model-kit.ts and ollama-guide.ts. The Rust signatures and these wrappers are not
// type-linked; keep them in sync by hand.
//
// The webview never names a path. Rust opens each folder picker itself and returns what it found; an
// import names files only by the `rel` the scan returned.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { CreateSpec, ImportEvent, KitPlan } from "./model-kit";

/** Whether Ollama's program is where its installers put it (or on PATH). null outside Tauri. */
export async function ollamaInstalled(): Promise<boolean | null> {
  try { return await invoke<boolean>("ollama_installed"); } catch { return null; }
}

export interface InstallerFolder {
  folder: string;
  installers: { name: string; location: string; bytes: number }[];
}

/** Pick the stick or folder with Ollama's installer. null when the person cancelled. */
export function pickInstallerFolder(): Promise<InstallerFolder | null> {
  return invoke<InstallerFolder | null>("ollama_installer_pick");
}

/** Pick the folder with a model export and get back what it holds. null when the person cancelled. */
export function pickModelFolder(): Promise<KitPlan | null> {
  return invoke<KitPlan | null>("model_import_pick");
}

/** Import from the last picked folder under `model`. Resolves with the name once Ollama has it. */
export function startModelImport(model: string, spec: CreateSpec, onEvent: (e: ImportEvent) => void): Promise<string> {
  const channel = new Channel<ImportEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("model_import_start", { model, spec, onEvent: channel });
}

/** Stop at the next chunk. No effect once Ollama is building the model. */
export function cancelModelImport(): Promise<void> {
  return invoke<void>("model_import_cancel");
}
