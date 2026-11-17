import { describe, it, expect } from "vitest";
import {
  STORE_KEYS, apiKeyStoreKey, isSecretKey, ALLOWED_IMPORT_KEYS, NON_PORTABLE_KEYS,
  modelStoreKey, MODEL_STORE_KEYS, LEGACY_MODEL_STORE_KEYS, legacyModelKeyMoves, importableSettings,
} from "./store-keys";

describe("store-keys (single source of truth)", () => {
  it("builds per-provider api key names", () => {
    expect(apiKeyStoreKey("openai")).toBe("apikey_openai");
    expect(apiKeyStoreKey("anthropic")).toBe("apikey_anthropic");
    expect(apiKeyStoreKey("ollama")).toBe("apikey_ollama");
  });

  it("recognizes secret keys (api keys + tavily) and nothing else", () => {
    expect(isSecretKey(apiKeyStoreKey("openai"))).toBe(true);
    expect(isSecretKey(STORE_KEYS.tavilyApiKey)).toBe(true);
    for (const k of [...MODEL_STORE_KEYS, ...LEGACY_MODEL_STORE_KEYS]) expect(isSecretKey(k), k).toBe(false);
    expect(isSecretKey(STORE_KEYS.provider)).toBe(false);
    expect(isSecretKey(STORE_KEYS.libraryEnabled)).toBe(false);
  });

  it("import allow-list includes editable settings, excludes caches", () => {
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.provider)).toBe(true);
    for (const k of MODEL_STORE_KEYS) expect(ALLOWED_IMPORT_KEYS.has(k), k).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.libraryUrl)).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.libraryManifestCache)).toBe(false);
  });

  it("caches are marked non-portable", () => {
    expect(NON_PORTABLE_KEYS.has(STORE_KEYS.libraryManifestCache)).toBe(true);
    expect(NON_PORTABLE_KEYS.has(STORE_KEYS.libraryManifestCacheAt)).toBe(true);
  });

  it("imports the Checking model like the other model settings, but never the accepted privacy notices", () => {
    // An imported cloud review_model does nothing here until this PC's own notice for that company is
    // accepted and a key is saved (content-review.ts resolveReviewConfig), so the file cannot send
    // anything off the computer unannounced.
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.reviewModel)).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.cloudNoticesSeen)).toBe(false);
  });

  it("never allows importing an arbitrary unknown key", () => {
    expect(ALLOWED_IMPORT_KEYS.has("evil_key")).toBe(false);
  });
});

describe("model keys: one pick per role per provider", () => {
  it("names a key per role and provider, and lists all six", () => {
    expect(modelStoreKey("generation", "ollama")).toBe("gen_model_ollama");
    expect(modelStoreKey("chat", "anthropic")).toBe("chat_model_anthropic");
    expect([...MODEL_STORE_KEYS].sort()).toEqual([
      "chat_model_anthropic", "chat_model_ollama", "chat_model_openai",
      "gen_model_anthropic", "gen_model_ollama", "gen_model_openai",
    ]);
    expect(LEGACY_MODEL_STORE_KEYS).toEqual([STORE_KEYS.genModel, STORE_KEYS.chatModel]);
  });

  it("moves an old shared value to a cloud provider only on an exact id, otherwise to Ollama", () => {
    expect(legacyModelKeyMoves({ gen_model: "claude-sonnet-5-5", chat_model: " GPT-6-Luna " })).toEqual([
      ["gen_model_anthropic", "claude-sonnet-5-5"], ["chat_model_openai", "GPT-6-Luna"],
    ]);
    expect(legacyModelKeyMoves({ gen_model: "claude-3.7-sonnet-reasoning-gemma3-12b", chat_model: "gpt-2" })).toEqual([
      ["gen_model_ollama", "claude-3.7-sonnet-reasoning-gemma3-12b"], ["chat_model_ollama", "gpt-2"],
    ]);
    expect(legacyModelKeyMoves({ gen_model: "", chat_model: 7, llm_provider: "openai" })).toEqual([]);
  });

  it("an import writes the old keys as per-provider keys, never the old keys themselves", () => {
    const writes = importableSettings({ llm_provider: "anthropic", gen_model: "o1-distill", chat_model: "claude-haiku-5-5", evil_key: 1 });
    expect(writes).toEqual([["llm_provider", "anthropic"], ["gen_model_ollama", "o1-distill"], ["chat_model_anthropic", "claude-haiku-5-5"]]);
  });

  it("an import of an unknown provider's model key is refused", () => {
    expect(importableSettings({ gen_model_gemini: "x", "gen_model___proto__": "y" })).toEqual([]);
  });
});
