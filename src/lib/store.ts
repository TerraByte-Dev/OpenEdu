import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { LLMConfig, LLMProvider } from "../types";
import { STORE_FILE, STORE_KEYS, apiKeyStoreKey, learnerStoreKey, LEARNER_SCOPED_KEYS } from "./store-keys";
import { defaultGenerationModel, defaultChatModel, defaultEmbeddingModel, resolveStoredModel } from "./models";
import { getOllamaModels } from "./llm";
import { DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS } from "./kernel/budget";
import type { RetrievalMode } from "./kernel/ground";
import { normalizeGoal, type ActiveMinutes } from "./daily-goal";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load(STORE_FILE);
  }
  return store;
}

// Total physical RAM from src-tauri/src/system.rs, asked once per session (it cannot change while the
// app runs). null when there is no Tauri (vite in a browser) or the OS call failed; models.ts then
// keeps the pre-RAM default. Only consulted when no model is stored, so a choice made in Settings is
// never replaced by it.
let memoryBytes: Promise<number | null> | null = null;
function systemMemoryBytes(): Promise<number | null> {
  if (!memoryBytes) memoryBytes = invoke<number | null>("system_memory_bytes").catch(() => null);
  return memoryBytes;
}

// What Ollama has pulled, for the default pick (models.ts defaultOllamaModel). Asked on every resolve
// and not cached: the setup gate's "download model" fix pulls a model mid-session, and the next resolve
// has to see it. Only reached when no model is stored, so a configured install never makes this call.
// null when Ollama could not be asked, so the RAM pick stands.
async function installedOllamaModels(ollamaUrl: string): Promise<string[] | null> {
  const tags = await getOllamaModels(ollamaUrl);
  return tags.error ? null : tags.models;
}

// Shared provider/key config
export async function getLLMProvider(): Promise<{ provider: LLMProvider; apiKey?: string; ollamaUrl: string }> {
  const s = await getStore();
  const provider = ((await s.get<string>(STORE_KEYS.provider)) ?? "ollama") as LLMProvider;
  const rawKey = await s.get<string>(apiKeyStoreKey(provider));
  const apiKey = rawKey ? rawKey.trim() : undefined;
  const ollamaUrl = (await s.get<string>(STORE_KEYS.ollamaUrl)) ?? "http://127.0.0.1:11434";
  return { provider, apiKey, ollamaUrl };
}

// Generation model (course creation, syllabus) — defaults to the catalog's recommended model, or for
// Ollama the one that fits this machine's RAM (see models.ts).
export async function getGenerationConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const stored = resolveStoredModel(base.provider, "generation", await s.get<string>(STORE_KEYS.genModel));
  const model = stored ?? (base.provider === "ollama"
    ? defaultGenerationModel(base.provider, await systemMemoryBytes(), await installedOllamaModels(base.ollamaUrl))
    : defaultGenerationModel(base.provider));
  return { ...base, model };
}

// Chat model (tutor chat) — defaults to the catalog's recommended fast/cheap model.
export async function getChatConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const stored = resolveStoredModel(base.provider, "chat", await s.get<string>(STORE_KEYS.chatModel));
  const model = stored ?? (base.provider === "ollama"
    ? defaultChatModel(base.provider, await systemMemoryBytes(), await installedOllamaModels(base.ollamaUrl))
    : defaultChatModel(base.provider));
  return { ...base, model };
}

// Backward-compat: used by quiz generation (use generation config)
export async function getLLMConfig(): Promise<LLMConfig> {
  return getGenerationConfig();
}

// Embedding model (notebook RAG, Phase 3). Local-first and independent of the chat provider so a
// cloud chat user can still embed offline (Anthropic has no embeddings endpoint). Returns an
// LLMConfig whose provider/model ARE the embedding ones — fed straight to llm.ts `embed()`.
export async function getEmbeddingConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const provider = ((await s.get<string>(STORE_KEYS.embeddingProvider)) ?? "ollama") as LLMProvider;
  const model = (await s.get<string>(STORE_KEYS.embeddingModel)) ?? defaultEmbeddingModel(provider);
  const rawKey = await s.get<string>(apiKeyStoreKey(provider));
  const apiKey = rawKey ? rawKey.trim() : undefined;
  const ollamaUrl = (await s.get<string>(STORE_KEYS.ollamaUrl)) ?? "http://127.0.0.1:11434";
  return { provider, model, apiKey, ollamaUrl };
}

export async function setEmbeddingProvider(provider: LLMProvider): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.embeddingProvider, provider);
  await s.save();
}

export async function setEmbeddingModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.embeddingModel, model);
  await s.save();
}

export async function setLLMProvider(provider: LLMProvider): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.provider, provider);
  await s.save();
}

export async function setGenerationModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.genModel, model);
  await s.save();
}

export async function setChatModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.chatModel, model);
  await s.save();
}

export async function setApiKey(provider: LLMProvider, key: string): Promise<void> {
  const s = await getStore();
  await s.set(apiKeyStoreKey(provider), key.trim());
  await s.save();
}

export async function getApiKey(provider: LLMProvider): Promise<string | null> {
  const s = await getStore();
  const key = await s.get<string>(apiKeyStoreKey(provider));
  return key ? key.trim() : null;
}

export async function setOllamaUrl(url: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.ollamaUrl, url);
  await s.save();
}

// Ceiling on the context window the app asks Ollama for (#86). The effective window is
// min(this, the model's own maximum), so raising it above what the model supports does nothing —
// but raising it at all costs RAM, because the KV cache scales with it. That is the whole reason
// this is a user-visible number and not a constant: 8192 is right on a laptop with headroom and
// wrong on a 4GB shared school machine, and only the person at the keyboard knows which they have.
// 32k is deliberately absent: without a memory probe it is an invitation to OOM a shared
// school machine, and nothing in the app can currently tell the user whether it will fit.
export const CONTEXT_TOKEN_CHOICES = [2048, 4096, 8192, 16384] as const;

// Clamp on READ, not only on write. `setMaxContextTokens` is not the only writer — settings-io's
// import path writes any allow-listed key straight through with a raw `store.set`, and this key is
// on that list. An imported file could otherwise pin num_ctx to 1, or to a window no machine can
// allocate, and budgetFor would disagree with what was actually sent.
export async function getMaxContextTokens(): Promise<number> {
  const s = await getStore();
  const v = await s.get<number>(STORE_KEYS.maxContextTokens);
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return DEFAULT_CONTEXT_TOKENS;
  return Math.min(Math.max(MIN_CONTEXT_TOKENS, Math.floor(v)), MAX_CONTEXT_TOKENS);
}

export async function setMaxContextTokens(tokens: number): Promise<void> {
  const s = await getStore();
  const clamped = Math.min(Math.max(MIN_CONTEXT_TOKENS, Math.floor(tokens)), MAX_CONTEXT_TOKENS);
  await s.set(STORE_KEYS.maxContextTokens, clamped);
  await s.save();
}

// Retrieval mode (#90). "always" is the default: the grounding stage runs before the model sees the
// turn, which is what makes a small model ground reliably instead of having to choose to. "off"
// falls back to notebook.search alone — kept so the eval can A/B the two mechanisms on one fixture,
// which is the only way the falsification condition can be tested honestly.
export async function getRetrievalMode(): Promise<RetrievalMode> {
  const s = await getStore();
  const v = await s.get<string>(STORE_KEYS.retrievalMode);
  return v === "off" || v === "auto" || v === "always" ? v : "always";
}

export async function setRetrievalMode(mode: RetrievalMode): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.retrievalMode, mode);
  await s.save();
}

// Onboarding tour (#92). Shown once per learner; "seen" covers both completing and skipping it.
export async function getTourSeen(learnerId: string): Promise<boolean> {
  const s = await getStore();
  return (await s.get<boolean>(learnerStoreKey(STORE_KEYS.tourSeen, learnerId))) ?? false;
}

export async function setTourSeen(learnerId: string, seen: boolean): Promise<void> {
  const s = await getStore();
  await s.set(learnerStoreKey(STORE_KEYS.tourSeen, learnerId), seen);
  await s.save();
}

// Learner Home daily goal (daily-goal.ts). null until the learner has chosen one.
export async function getDailyGoal(learnerId: string): Promise<number | null> {
  const s = await getStore();
  return normalizeGoal(await s.get<unknown>(learnerStoreKey(STORE_KEYS.dailyGoalMinutes, learnerId)));
}

export async function setDailyGoal(learnerId: string, minutes: number): Promise<void> {
  const s = await getStore();
  await s.set(learnerStoreKey(STORE_KEYS.dailyGoalMinutes, learnerId), minutes);
  await s.save();
}

// Today's active minutes for one learner ({ day, minutes }); App ticks it while the session is on
// screen. A record from another day is still returned as-is: daily-goal.ts minutesToday() reads it
// as zero, and tickActiveMinutes() rolls it over.
export async function getActiveMinutes(learnerId: string): Promise<ActiveMinutes | null> {
  const s = await getStore();
  const v = await s.get<ActiveMinutes>(learnerStoreKey(STORE_KEYS.activeMinutes, learnerId));
  return v && typeof v.day === "string" && typeof v.minutes === "number" ? v : null;
}

export async function setActiveMinutes(learnerId: string, rec: ActiveMinutes): Promise<void> {
  const s = await getStore();
  await s.set(learnerStoreKey(STORE_KEYS.activeMinutes, learnerId), rec);
  await s.save();
}

// A K-2 learner's read-aloud choice (grade.ts autoReadAloud). null until they choose.
export async function getReadAloudAuto(learnerId: string): Promise<boolean | null> {
  const s = await getStore();
  const v = await s.get<unknown>(learnerStoreKey(STORE_KEYS.readAloudAuto, learnerId));
  return typeof v === "boolean" ? v : null;
}

export async function setReadAloudAuto(learnerId: string, on: boolean): Promise<void> {
  const s = await getStore();
  await s.set(learnerStoreKey(STORE_KEYS.readAloudAuto, learnerId), on);
  await s.save();
}

// A K-1 learner's early-learner screens choice (grade.ts earlyScreensOn). null until the family chooses.
export async function getEarlyScreens(learnerId: string): Promise<boolean | null> {
  const s = await getStore();
  const v = await s.get<unknown>(learnerStoreKey(STORE_KEYS.earlyScreens, learnerId));
  return typeof v === "boolean" ? v : null;
}

export async function setEarlyScreens(learnerId: string, on: boolean): Promise<void> {
  const s = await getStore();
  await s.set(learnerStoreKey(STORE_KEYS.earlyScreens, learnerId), on);
  await s.save();
}

// Drop everything the store remembers about one learner (on learner delete).
export async function clearLearnerStore(learnerId: string): Promise<void> {
  const s = await getStore();
  for (const base of LEARNER_SCOPED_KEYS) await s.delete(learnerStoreKey(base, learnerId));
  await s.save();
}

export async function setTavilyApiKey(key: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.tavilyApiKey, key.trim());
  await s.save();
}

export async function getTavilyApiKey(): Promise<string | null> {
  const s = await getStore();
  const key = await s.get<string>(STORE_KEYS.tavilyApiKey);
  return key ? key.trim() : null;
}

// ── OpenEdu Library (curated reference, bundled with the app) ──
// On by default — it ships inside the app (public/library/) and works fully offline, no key needed.
// Turning it off hides the library.search tool and the Resources tab entirely.
export async function getLibraryEnabled(): Promise<boolean> {
  const s = await getStore();
  const v = await s.get<boolean>(STORE_KEYS.libraryEnabled);
  return v ?? true;
}

export async function setLibraryEnabled(enabled: boolean): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.libraryEnabled, enabled);
  await s.save();
}

// Optional advanced override of the library base URL — point at a remote static host to fetch a larger/
// updated corpus (must also be allow-listed in capabilities). Empty/unset → library.ts uses the BUNDLED copy.
export async function getLibraryUrl(): Promise<string | null> {
  const s = await getStore();
  const url = await s.get<string>(STORE_KEYS.libraryUrl);
  return url ? url.trim() : null;
}

export async function setLibraryUrl(url: string): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.libraryUrl, url.trim());
  await s.save();
}

// Last-good manifest, persisted so the library survives offline windows / restarts after one sync.
export async function getLibraryManifestCache(): Promise<unknown | null> {
  const s = await getStore();
  return (await s.get(STORE_KEYS.libraryManifestCache)) ?? null;
}

export async function setLibraryManifestCache(manifest: unknown): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEYS.libraryManifestCache, manifest);
  await s.set(STORE_KEYS.libraryManifestCacheAt, new Date().toISOString());
  await s.save();
}
