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

// Checked 2026-11-11 against https://platform.claude.com/docs/en/about-claude/models,
// https://platform.claude.com/docs/en/about-claude/model-deprecations and
// https://developers.openai.com/api/docs/models (+ /deprecations). A model is listed only if OpenEdu's
// requests work on it as llm.ts sends them (see openAIRequestFields / anthropicRequestFields):
//   - gpt-6.1-sol, gpt-6-astra and gpt-6.1-terra need the Responses API for tool calls, so they are
//     generation-only (the tutor calls tools on Chat Completions). gpt-6-luna can call tools there
//     with reasoning_effort "none", which llm.ts sends.
//   - claude-opus-5-5, claude-sonnet-5-5 and claude-fable-5-x reject the forced tool_choice that
//     callAnthropicStructured uses, so they are left out until that path moves to output_config.format.
//     claude-opus-4-6 (retirement not before 2027-02-05) stays the Anthropic generation default.
//   - claude-haiku-4-5-20251001 left the picker (Haiku 5.5 replaces it). It is not shut down, so a stored
//     one keeps working, and Settings shows it as an extra selected chip (withStoredOption).
export const GENERATION_MODELS: Record<CloudProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true },
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
    { id: "gpt-5.4", label: "GPT-5.4" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  ],
};

export const CHAT_MODELS: Record<CloudProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-6-luna", label: "GPT-6 Luna", recommended: true },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
  anthropic: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
};

// Cloud ids OpenEdu used to offer, with the provider's shutdown date (UTC). From that date a stored one
// resolves to today's recommended model for the same provider and role, instead of a 404 on every call.
// OpenAI announced all four on 2026-10-14 (https://developers.openai.com/api/docs/deprecations). Bare
// gpt-4o is included because both snapshots it can still point to (2024-08-06, 2024-11-20) shut down
// that day; 2024-05-13 already has.
export const CLOUD_SHUTDOWNS: Record<CloudProvider, Record<string, string>> = {
  openai: {
    "gpt-4.1": "2027-01-14",
    "gpt-4.1-mini": "2027-01-14",
    "gpt-4o": "2027-01-14",
    "gpt-4o-mini": "2027-01-14",
  },
  anthropic: {},
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
// 78% of positives on the held-out RAG eval (src/lib/eval/results/2026-11-06-heldout-dev.md). That eval
// measures tutor answers grounded in notes, nothing else: e2b has NOT been run through curriculum
// generation or checked for quiz answer-key correctness. It is the generation default on small
// machines only because e4b there means swapping or not loading at all. e2b tiers as "tiny"
// (llm.ts ollamaNameTierOverride), where e4b is "small"; the one tier-gated safety step that would
// otherwise switch off, the quiz verify pass, is kept on for both defaults (quiz-grading.ts
// runsVerifyPass).
const OLLAMA_LARGE_DEFAULT = "gemma4:e4b";
const OLLAMA_SMALL_DEFAULT = "gemma4:e2b";

export function isOllamaDefaultModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === OLLAMA_LARGE_DEFAULT || m === OLLAMA_SMALL_DEFAULT;
}

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

// The RAM pick, unless it is not pulled and the other default is. This is what keeps an upgrade from
// breaking a working install: an 8 GB machine set up before this default existed has e4b pulled (the
// README and the old Settings hint both said `ollama pull gemma4:e4b`) and no stored model, so the bare
// RAM pick would point it at an e2b it does not have, and ask a bandwidth-poor site for a 4.6 GB
// download to get back to where it was. `installed` is the Ollama tag list, or null when Ollama could
// not be asked; matching is exact, because setup-check's modelIsInstalled treats any gemma4:* as a
// match for any other and would call e2b present when only e4b is.
export function defaultOllamaModel(ramBytes: number | null, installed: string[] | null): string {
  const pick = defaultOllamaModelForRam(ramBytes);
  if (!installed) return pick;
  const has = (m: string) => installed.some((i) => i.trim().toLowerCase() === m);
  if (has(pick)) return pick;
  const other = pick === OLLAMA_LARGE_DEFAULT ? OLLAMA_SMALL_DEFAULT : OLLAMA_LARGE_DEFAULT;
  return has(other) ? other : pick;
}
const OLLAMA_EMBEDDING_DEFAULT = "nomic-embed-text";
const OPENAI_EMBEDDING_DEFAULT = "text-embedding-3-small";

function recommendedId(options: ModelOption[]): string {
  return (options.find((m) => m.recommended) ?? options[0]).id;
}

// Default model id when the user hasn't picked one — DERIVED from the catalog's `recommended` flag, so the
// store default always equals the chip Settings highlights. Cloud providers fall back to their recommended
// catalog entry; Ollama picks by RAM and what is pulled (discovery fills the rest in the picker).
// `ramBytes` and `installed` are ignored for cloud providers.
export function defaultGenerationModel(provider: LLMProvider, ramBytes: number | null = null, installed: string[] | null = null): string {
  return provider === "ollama" ? defaultOllamaModel(ramBytes, installed) : recommendedId(GENERATION_MODELS[provider]);
}
export function defaultChatModel(provider: LLMProvider, ramBytes: number | null = null, installed: string[] | null = null): string {
  return provider === "ollama" ? defaultOllamaModel(ramBytes, installed) : recommendedId(CHAT_MODELS[provider]);
}
// The model a stored setting should resolve to. A stored id is kept as is unless its provider has shut
// it down (CLOUD_SHUTDOWNS); then the recommended model for the same provider and role is used. Only
// the current provider's own list is consulted, so this never moves anyone to another provider, and
// nothing is written back: the stored value stays until the user picks again.
export function resolveStoredModel(
  provider: LLMProvider,
  role: "generation" | "chat",
  stored: string | undefined,
  now: Date = new Date(),
): string | undefined {
  // A hand-edited settings import can put anything here; a non-string means "nothing stored".
  if (typeof stored !== "string") return undefined;
  if (provider === "ollama") return stored;
  // Own keys only, so "constructor" or "__proto__" never read as a shutdown entry. (Object.hasOwn is
  // ES2022; tsconfig's lib is ES2021, and this is the same check.)
  const shutdowns: Record<string, string> = CLOUD_SHUTDOWNS[provider] ?? {};
  const id = stored.trim();
  if (!Object.prototype.hasOwnProperty.call(shutdowns, id)) return stored;
  if (now < new Date(`${shutdowns[id]}T00:00:00Z`)) return stored;
  return role === "generation" ? defaultGenerationModel(provider) : defaultChatModel(provider);
}

// The chips Settings shows for a cloud role. A stored id that is not in the catalog (one that left the
// picker but still works, or a hand-typed one) is what the app will actually send, so it is appended as
// an extra chip labelled with its id, and the selection stays visible.
export function withStoredOption(options: ModelOption[], stored: string): ModelOption[] {
  if (!stored.trim() || options.some((m) => m.id === stored)) return options;
  return [...options, { id: stored, label: stored }];
}
export function defaultEmbeddingModel(provider: LLMProvider): string {
  // Embedding is local-first (Anthropic has no embeddings endpoint) — only OpenAI gets a cloud default.
  return provider === "openai" ? OPENAI_EMBEDDING_DEFAULT : OLLAMA_EMBEDDING_DEFAULT;
}
