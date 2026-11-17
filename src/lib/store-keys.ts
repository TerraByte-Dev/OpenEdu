// Single source of truth for the @tauri-apps/plugin-store key names in settings.json. Both `store.ts`
// (the getters/setters) and `settings-io.ts` (export/import) import from here, so the key scheme can never
// drift between them — renaming a key updates persistence, secret-masking, and import in lockstep.
// Pure module (no Tauri imports) → unit-testable in node.

import type { LLMProvider } from "../types";
import { DEFAULT_LEARNER_ID } from "./learners";
import { legacyModelOwner } from "./models";

export const STORE_FILE = "settings.json";

export const STORE_KEYS = {
  provider: "llm_provider",
  ollamaUrl: "ollama_url",
  // The generation and chat models are stored per provider, under modelStoreKey(role, provider):
  // gen_model_ollama, chat_model_anthropic, ... These two are the single keys every provider shared
  // before that. Nothing writes them any more: store.ts moves a value found here to its provider's key
  // once (legacyModelKeyMoves), and a settings file that still has them imports the same way.
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
  // The cloud choices (openai, anthropic, ollama-cloud) whose one-time privacy confirm has been
  // accepted on this PC (privacy.ts, #293). Not importable: a settings file from another machine must
  // not count as the person here having read the notice.
  cloudNoticesSeen: "cloud_notices_seen",
  // The content review model, "Checking model" in Settings › Models (content-review.ts
  // resolveReviewConfig): unset = the generation model (lessons: off on the tiny and small tiers), "off",
  // a model name on the current provider, or "<provider>:<model>" (e.g. "anthropic:claude-haiku-5-5").
  // Importable like the other model settings: a cloud value only takes effect once this PC's own notice
  // for that company was accepted (cloud_notices_seen, which is not importable) and a key is saved.
  reviewModel: "review_model",
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

// ── The generation and chat model, one pick per provider ──
// One key per role per provider, so picking a model on one provider never overwrites the pick made on
// another, and a switch back finds its own pick (or, with none, that provider's default; store.ts).
export type ModelRole = "generation" | "chat";
export const MODEL_ROLES: ReadonlyArray<ModelRole> = ["generation", "chat"];
const MODEL_PROVIDERS: ReadonlyArray<LLMProvider> = ["ollama", "openai", "anthropic"];
const LEGACY_MODEL_KEYS: Record<ModelRole, string> = { generation: STORE_KEYS.genModel, chat: STORE_KEYS.chatModel };

export function modelStoreKey(role: ModelRole, provider: LLMProvider): string {
  return `${LEGACY_MODEL_KEYS[role]}_${provider}`;
}
export const MODEL_STORE_KEYS: ReadonlyArray<string> = MODEL_ROLES.flatMap((r) => MODEL_PROVIDERS.map((p) => modelStoreKey(r, p)));
export const LEGACY_MODEL_STORE_KEYS: ReadonlyArray<string> = MODEL_ROLES.map((r) => LEGACY_MODEL_KEYS[r]);

// Where the values of the old shared keys (gen_model, chat_model) in `values` go: each to its role's key on
// the provider it belongs to (models.ts legacyModelOwner: a cloud provider only for an exact id OpenEdu
// offered there, in its catalog, shutdown list or former models, otherwise Ollama). A blank or non-string value goes nowhere. Used by store.ts on an
// existing install and by a settings import of a file written before per-provider keys. A moved value
// replaces that provider's own pick: the old key is only present beside the new ones when an older
// version wrote it, so it is the more recent choice.
export function legacyModelKeyMoves(values: Readonly<Record<string, unknown>>): Array<[string, string]> {
  const moves: Array<[string, string]> = [];
  for (const role of MODEL_ROLES) {
    const v = values[LEGACY_MODEL_KEYS[role]];
    if (typeof v === "string" && v.trim()) moves.push([modelStoreKey(role, legacyModelOwner(v)), v.trim()]);
  }
  return moves;
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
// The old shared model keys are not on it: importableSettings moves them to per-provider keys first.
export const ALLOWED_IMPORT_KEYS: ReadonlySet<string> = new Set<string>([
  STORE_KEYS.provider,
  ...MODEL_STORE_KEYS,
  STORE_KEYS.reviewModel,
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

// The [key, value] pairs a settings import writes, from a file's settings block: the old shared model keys
// moved to the provider each belongs to (legacyModelKeyMoves, applied last so they win as on an install),
// then only the allow-listed keys.
export function importableSettings(settings: Readonly<Record<string, unknown>>): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [...Object.entries(settings), ...legacyModelKeyMoves(settings)];
  return entries.filter(([key]) => ALLOWED_IMPORT_KEYS.has(key));
}
