// Single source of truth for the model catalogs shown in Settings AND the default model ids used by
// store.ts. Hoisted out of the Settings view so the "recommended" chip and the actual fallback default can
// never disagree — that disagreement was the root of issue #2 (a picker recommending gpt-5.4 while the
// store defaulted to gpt-4o). Pure module (no Tauri imports) → unit-testable.

import type { LLMProvider } from "../types";

export interface ModelOption { id: string; label: string; recommended?: boolean }
type CloudProvider = Exclude<LLMProvider, "ollama">;

export const PROVIDERS: { id: LLMProvider; name: string; needsKey: boolean }[] = [
  { id: "ollama", name: "Ollama (Local — Free)", needsKey: false },
  { id: "openai", name: "OpenAI", needsKey: true },
  { id: "anthropic", name: "Anthropic", needsKey: true },
];

export const GENERATION_MODELS: Record<CloudProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-5.4", label: "GPT-5.4", recommended: true },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
};

export const CHAT_MODELS: Record<CloudProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: true },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
};

// Curated fallback lists shown when Ollama isn't connected (no live model discovery available).
// gemma4:e4b is the only local model verified end to end (generation + the RAG eval). gemma4:e2b is
// the default below 16 GB (see defaultOllamaModelForRam), so it is listed too or the picker would
// highlight nothing on exactly the machines it is the default for. qwen3.5:0.8b runs the harness and
// grounds 36/36 positives, but fails the zero-fabrication bar on negatives
// (src/lib/eval/results/2026-11-06-qwen3.5-0.8b.md), so it is offered, never defaulted.
export const OLLAMA_GEN_SUGGESTIONS = ["gemma4:e4b", "gemma4:e2b"];
export const OLLAMA_CHAT_SUGGESTIONS = ["gemma4:e4b", "gemma4:e2b", "qwen3.5:0.8b"];

// The two local defaults. e4b is 9.6 GB on disk and does not fit an 8 GB machine, which is the
// hardware a community learning centre has. e2b (4.6 GB) gave 0 of 54 harmful near-miss answers and
// 78% of positives on the held-out RAG eval (src/lib/eval/results/2026-11-06-heldout-dev.md). It has
// NOT been run through curriculum generation; it is the generation default on small machines only
// because e4b there means swapping or not loading at all.
const OLLAMA_LARGE_DEFAULT = "gemma4:e4b";
const OLLAMA_SMALL_DEFAULT = "gemma4:e2b";

// "16 GB or more", measured the way the OS reports it. Installed RAM always reads LOW: firmware and
// integrated graphics reserve some before the OS sees it (this dev box: 32 GiB installed, 31.90 GiB
// reported). A strict 16 GiB cutoff would therefore send every 16 GB machine to the small model.
// 14 GiB leaves 2 GiB for that reservation and still puts a 12 GB machine below the line.
export const LARGE_MODEL_MIN_RAM_BYTES = 14 * 1024 ** 3;

// Default local model for a machine with `totalBytes` of physical RAM (src-tauri/src/system.rs). Pure
// so the threshold is tested. Unknown RAM (no Tauri, a failed OS call) keeps the pre-RAM default,
// e4b: guessing small would silently downgrade a machine that can run the verified model.
export function defaultOllamaModelForRam(totalBytes: number | null): string {
  if (totalBytes === null || !Number.isFinite(totalBytes) || totalBytes <= 0) return OLLAMA_LARGE_DEFAULT;
  return totalBytes >= LARGE_MODEL_MIN_RAM_BYTES ? OLLAMA_LARGE_DEFAULT : OLLAMA_SMALL_DEFAULT;
}
const OLLAMA_EMBEDDING_DEFAULT = "nomic-embed-text";
const OPENAI_EMBEDDING_DEFAULT = "text-embedding-3-small";

function recommendedId(options: ModelOption[]): string {
  return (options.find((m) => m.recommended) ?? options[0]).id;
}

// Default model id when the user hasn't picked one — DERIVED from the catalog's `recommended` flag, so the
// store default always equals the chip Settings highlights. Cloud providers fall back to their recommended
// catalog entry; Ollama picks by RAM (discovery fills the rest in the picker). `ramBytes` is ignored for
// cloud providers.
export function defaultGenerationModel(provider: LLMProvider, ramBytes: number | null = null): string {
  return provider === "ollama" ? defaultOllamaModelForRam(ramBytes) : recommendedId(GENERATION_MODELS[provider]);
}
export function defaultChatModel(provider: LLMProvider, ramBytes: number | null = null): string {
  return provider === "ollama" ? defaultOllamaModelForRam(ramBytes) : recommendedId(CHAT_MODELS[provider]);
}
export function defaultEmbeddingModel(provider: LLMProvider): string {
  // Embedding is local-first (Anthropic has no embeddings endpoint) — only OpenAI gets a cloud default.
  return provider === "openai" ? OPENAI_EMBEDDING_DEFAULT : OLLAMA_EMBEDDING_DEFAULT;
}
