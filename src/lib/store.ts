import { Store } from "@tauri-apps/plugin-store";
import type { LLMConfig, LLMProvider } from "../types";
import { STORE_FILE, STORE_KEYS, apiKeyStoreKey } from "./store-keys";
import { defaultGenerationModel, defaultChatModel, defaultEmbeddingModel } from "./models";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load(STORE_FILE);
  }
  return store;
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

// Generation model (course creation, syllabus) — defaults to the catalog's recommended model (see models.ts).
export async function getGenerationConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const model = (await s.get<string>(STORE_KEYS.genModel)) ?? defaultGenerationModel(base.provider);
  return { ...base, model };
}

// Chat model (tutor chat) — defaults to the catalog's recommended fast/cheap model.
export async function getChatConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const model = (await s.get<string>(STORE_KEYS.chatModel)) ?? defaultChatModel(base.provider);
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
