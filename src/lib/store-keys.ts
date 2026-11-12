// Single source of truth for the @tauri-apps/plugin-store key names in settings.json. Both `store.ts`
// (the getters/setters) and `settings-io.ts` (export/import) import from here, so the key scheme can never
// drift between them — renaming a key updates persistence, secret-masking, and import in lockstep.
// Pure module (no Tauri imports) → unit-testable in node.

import type { LLMProvider } from "../types";
import { DEFAULT_LEARNER_ID } from "./learners";

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
  // How retrieval behaves: "always" runs the grounding stage before every turn, "off" leaves
  // notebook.search as the only path. Exposed so the A/B in the eval is runnable, and so a user
  // whose vault is noise can turn it off (#90).
  retrievalMode: "retrieval_mode",
  // Onboarding (#92): whether the feature tour has been completed or skipped. Not in
  // ALLOWED_IMPORT_KEYS — importing someone else's settings should not silently mark YOUR tour as
  // seen, which would hide it from the person it exists for. Per learner: see LEARNER_SCOPED_KEYS.
  tourSeen: "tour_seen",
  // Learner Home: the daily goal (minutes a day, chosen once) and today's active minutes
  // ({ day, minutes }, see daily-goal.ts). Per learner, like the tour. Not importable: both are
  // about one person on this PC, not a setting anyone would carry to another machine.
  dailyGoalMinutes: "daily_goal_minutes",
  activeMinutes: "active_minutes",
  // A K-2 learner's choice to have tutor replies read aloud on their own (#243, grade.ts
  // autoReadAloud). Unset = the default, on. Per learner; not importable, like the daily goal.
  readAloudAuto: "read_aloud_auto",
} as const;

// Keys that remember something about ONE learner rather than the machine. Read and write them only
// through learnerStoreKey(). Everything else in STORE_KEYS (provider, models, API keys, library,
// context size) is shared by every learner on the PC.
export const LEARNER_SCOPED_KEYS: ReadonlyArray<string> = [
  STORE_KEYS.tourSeen, STORE_KEYS.dailyGoalMinutes, STORE_KEYS.activeMinutes, STORE_KEYS.readAloudAuto,
];

const LEARNER_KEY_SEPARATOR = "@learner:";

// The store key for `base` as seen by `learnerId`. The default learner (the one every pre-profiles
// install was migrated into) keeps the bare key, so an existing install reads exactly what it wrote
// before and nothing needs migrating. Every other learner gets its own suffixed key.
export function learnerStoreKey(base: string, learnerId: string): string {
  return learnerId === DEFAULT_LEARNER_ID ? base : `${base}${LEARNER_KEY_SEPARATOR}${learnerId}`;
}

// A per-learner key belonging to a non-default learner. Kept out of a settings export: it carries a
// learner id and no setting anyone would want on another machine.
export function isLearnerScopedKey(key: string): boolean {
  return key.includes(LEARNER_KEY_SEPARATOR);
}

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
  STORE_KEYS.retrievalMode,
  // secrets — only present when the export was made with "include keys"
  STORE_KEYS.tavilyApiKey,
  apiKeyStoreKey("ollama"),
  apiKeyStoreKey("openai"),
  apiKeyStoreKey("anthropic"),
]);
