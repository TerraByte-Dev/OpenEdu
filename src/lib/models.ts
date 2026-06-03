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
export const OLLAMA_GEN_SUGGESTIONS = ["llama3:70b", "qwen2.5:72b", "mistral-large", "llama3"];
export const OLLAMA_CHAT_SUGGESTIONS = ["llama3", "phi3", "gemma2", "mistral"];

const OLLAMA_GEN_DEFAULT = "llama3";
const OLLAMA_CHAT_DEFAULT = "llama3";
const OLLAMA_EMBEDDING_DEFAULT = "nomic-embed-text";
const OPENAI_EMBEDDING_DEFAULT = "text-embedding-3-small";

function recommendedId(options: ModelOption[]): string {
  return (options.find((m) => m.recommended) ?? options[0]).id;
}

// Default model id when the user hasn't picked one — DERIVED from the catalog's `recommended` flag, so the
// store default always equals the chip Settings highlights. Cloud providers fall back to their recommended
// catalog entry; Ollama uses a safe local default (discovery fills the rest in the picker).
export function defaultGenerationModel(provider: LLMProvider): string {
  return provider === "ollama" ? OLLAMA_GEN_DEFAULT : recommendedId(GENERATION_MODELS[provider]);
}
export function defaultChatModel(provider: LLMProvider): string {
  return provider === "ollama" ? OLLAMA_CHAT_DEFAULT : recommendedId(CHAT_MODELS[provider]);
}
export function defaultEmbeddingModel(provider: LLMProvider): string {
  // Embedding is local-first (Anthropic has no embeddings endpoint) — only OpenAI gets a cloud default.
  return provider === "openai" ? OPENAI_EMBEDDING_DEFAULT : OLLAMA_EMBEDDING_DEFAULT;
}
