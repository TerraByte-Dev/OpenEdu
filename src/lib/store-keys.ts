// Single source of truth for the @tauri-apps/plugin-store key names in settings.json. Both `store.ts`
// (the getters/setters) and `settings-io.ts` (export/import) import from here, so the key scheme can never
// drift between them — renaming a key updates persistence, secret-masking, and import in lockstep.
// Pure module (no Tauri imports) → unit-testable in node.

import type { LLMProvider } from "../types";

export const STORE_FILE = "settings.json";

export const STORE_KEYS = {
  provider: "llm_provider",
  ollamaUrl: "ollama_url",
  genModel: "gen_model",
  chatModel: "chat_model",
  embeddingProvider: "embedding_provider",
  embeddingModel: "embedding_model",
  tavilyApiKey: "tavily_api_key",
  libraryEnabled: "library_enabled",
  libraryUrl: "library_url",
  libraryManifestCache: "library_manifest_cache",
  libraryManifestCacheAt: "library_manifest_cache_at",
  // Ceiling on the context window the app requests from Ollama, in tokens (#86). The effective
  // window is min(this, the model's own maximum). User-visible because it trades answer quality for
  // RAM: the KV cache scales with it, and on a 4GB machine an over-large window is what turns a
  // working setup into `signal: killed`.
  maxContextTokens: "max_context_tokens",
} as const;

// Per-provider API key, e.g. "apikey_openai".
export const API_KEY_PREFIX = "apikey_";
export function apiKeyStoreKey(provider: LLMProvider): string {
  return `${API_KEY_PREFIX}${provider}`;
}

// Keys that hold secrets — excluded from a settings export unless the user explicitly opts in.
export function isSecretKey(key: string): boolean {
  return key === STORE_KEYS.tavilyApiKey || key.startsWith(API_KEY_PREFIX);
}

// Large / regenerable caches we never carry in a portable settings file.
export const NON_PORTABLE_KEYS: ReadonlySet<string> = new Set([
  STORE_KEYS.libraryManifestCache,
  STORE_KEYS.libraryManifestCacheAt,
]);

// The ONLY keys an import is allowed to write — prevents a hand-edited file from injecting arbitrary keys.
export const ALLOWED_IMPORT_KEYS: ReadonlySet<string> = new Set<string>([
  STORE_KEYS.provider,
  STORE_KEYS.genModel,
  STORE_KEYS.chatModel,
  STORE_KEYS.embeddingProvider,
  STORE_KEYS.embeddingModel,
  STORE_KEYS.ollamaUrl,
  STORE_KEYS.libraryEnabled,
  STORE_KEYS.libraryUrl,
  STORE_KEYS.maxContextTokens,
  // secrets — only present when the export was made with "include keys"
  STORE_KEYS.tavilyApiKey,
  apiKeyStoreKey("ollama"),
  apiKeyStoreKey("openai"),
  apiKeyStoreKey("anthropic"),
]);
