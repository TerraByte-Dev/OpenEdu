// What Settings › Ollama Connection / Models and About › Diagnostics say about Ollama, from one
// /api/tags probe (llm.ts getOllamaModels). Pure, so tested. Ollama that answers with an empty list is
// running with no model yet: a fresh install, before a pull or the offline import has put one in. That
// is not "offline", and the fix is the import or a pull, not installing Ollama. setup-check.ts tells the
// two apart the same way (ollamaReachable = !tags.error).

export type OllamaState = "connected" | "no-models" | "offline";

export function ollamaState(tags: { models: string[]; error?: string }): OllamaState {
  if (tags.error) return "offline";
  return tags.models.length > 0 ? "connected" : "no-models";
}

/** The short label beside the status dot. */
export function ollamaStatusLabel(state: OllamaState | "checking", modelCount: number): string {
  if (state === "connected") return `${modelCount} model${modelCount === 1 ? "" : "s"}`;
  if (state === "no-models") return "Running, no models yet";
  if (state === "offline") return "Offline";
  return "Checking…";
}

/**
 * The line under the connection row when Ollama has no models. That row and the "Import a model from a
 * USB stick or folder" row are both shown only when Ollama is the provider, so the import is always on
 * the same page.
 */
export const OLLAMA_NO_MODELS_HINT =
  "Ollama is running but has no models yet. Add one with “Import a model from a USB stick or folder” further down this page; no internet needed. With internet you can also run:";

/** About › Diagnostics' Ollama line. */
export function ollamaDiagnostics(tags: { models: string[]; error?: string }): string {
  const state = ollamaState(tags);
  if (state === "connected") return `connected · ${tags.models.length} models`;
  if (state === "no-models") return "running, no models yet";
  return `offline${tags.error ? ` (${tags.error})` : ""}`;
}
