import { Store } from "@tauri-apps/plugin-store";
import type { LLMConfig, LLMProvider } from "../types";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load("settings.json");
  }
  return store;
}

// Shared provider/key config
export async function getLLMProvider(): Promise<{ provider: LLMProvider; apiKey?: string; ollamaUrl: string }> {
  const s = await getStore();
  const provider = ((await s.get<string>("llm_provider")) ?? "ollama") as LLMProvider;
  const rawKey = await s.get<string>(`apikey_${provider}`);
  const apiKey = rawKey ? rawKey.trim() : undefined;
  const ollamaUrl = (await s.get<string>("ollama_url")) ?? "http://127.0.0.1:11434";
  return { provider, apiKey, ollamaUrl };
}

// Generation model (course creation, syllabus) — recommend high-capability
export async function getGenerationConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const defaultModel = base.provider === "anthropic" ? "claude-opus-4-6"
    : base.provider === "openai" ? "gpt-4o"
    : "llama3";
  const model = (await s.get<string>("gen_model")) ?? defaultModel;
  return { ...base, model };
}

// Chat model (tutor chat) — recommend fast/cheap
export async function getChatConfig(): Promise<LLMConfig> {
  const s = await getStore();
  const base = await getLLMProvider();
  const defaultModel = base.provider === "anthropic" ? "claude-haiku-4-5-20251001"
    : base.provider === "openai" ? "gpt-4o-mini"
    : "llama3";
  const model = (await s.get<string>("chat_model")) ?? defaultModel;
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
  const provider = ((await s.get<string>("embedding_provider")) ?? "ollama") as LLMProvider;
  const model =
    (await s.get<string>("embedding_model")) ??
    (provider === "openai" ? "text-embedding-3-small" : "nomic-embed-text");
  const rawKey = await s.get<string>(`apikey_${provider}`);
  const apiKey = rawKey ? rawKey.trim() : undefined;
  const ollamaUrl = (await s.get<string>("ollama_url")) ?? "http://127.0.0.1:11434";
  return { provider, model, apiKey, ollamaUrl };
}

export async function setEmbeddingProvider(provider: LLMProvider): Promise<void> {
  const s = await getStore();
  await s.set("embedding_provider", provider);
  await s.save();
}

export async function setEmbeddingModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set("embedding_model", model);
  await s.save();
}

export async function setLLMProvider(provider: LLMProvider): Promise<void> {
  const s = await getStore();
  await s.set("llm_provider", provider);
  await s.save();
}

export async function setGenerationModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set("gen_model", model);
  await s.save();
}

export async function setChatModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set("chat_model", model);
  await s.save();
}

export async function setApiKey(provider: LLMProvider, key: string): Promise<void> {
  const s = await getStore();
  await s.set(`apikey_${provider}`, key.trim());
  await s.save();
}

export async function getApiKey(provider: LLMProvider): Promise<string | null> {
  const s = await getStore();
  const key = await s.get<string>(`apikey_${provider}`);
  return key ? key.trim() : null;
}

export async function setOllamaUrl(url: string): Promise<void> {
  const s = await getStore();
  await s.set("ollama_url", url);
  await s.save();
}

export async function setTavilyApiKey(key: string): Promise<void> {
  const s = await getStore();
  await s.set("tavily_api_key", key.trim());
  await s.save();
}

export async function getTavilyApiKey(): Promise<string | null> {
  const s = await getStore();
  const key = await s.get<string>("tavily_api_key");
  return key ? key.trim() : null;
}

// ── OpenEdu Library (curated self-hosted reference) ──
// On by default — it's a TerraByte-hosted capability, not a BYO-key one. Users who want a strictly
// offline / no-network app can turn it off; then the library.search tool is hidden entirely.
export async function getLibraryEnabled(): Promise<boolean> {
  const s = await getStore();
  const v = await s.get<boolean>("library_enabled");
  return v ?? true;
}

export async function setLibraryEnabled(enabled: boolean): Promise<void> {
  const s = await getStore();
  await s.set("library_enabled", enabled);
  await s.save();
}

// Optional advanced override of the library base URL (must also be allow-listed in capabilities to
// be reachable). Empty/unset → library.ts falls back to the baked-in default host.
export async function getLibraryUrl(): Promise<string | null> {
  const s = await getStore();
  const url = await s.get<string>("library_url");
  return url ? url.trim() : null;
}

export async function setLibraryUrl(url: string): Promise<void> {
  const s = await getStore();
  await s.set("library_url", url.trim());
  await s.save();
}

// Last-good manifest, persisted so the library survives offline windows / restarts after one sync.
export async function getLibraryManifestCache(): Promise<unknown | null> {
  const s = await getStore();
  return (await s.get("library_manifest_cache")) ?? null;
}

export async function setLibraryManifestCache(manifest: unknown): Promise<void> {
  const s = await getStore();
  await s.set("library_manifest_cache", manifest);
  await s.set("library_manifest_cache_at", new Date().toISOString());
  await s.save();
}
