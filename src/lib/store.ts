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
  const ollamaUrl = (await s.get<string>("ollama_url")) ?? "http://localhost:11434";
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
