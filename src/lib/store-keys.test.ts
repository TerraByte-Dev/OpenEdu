import { describe, it, expect } from "vitest";
import { STORE_KEYS, apiKeyStoreKey, isSecretKey, ALLOWED_IMPORT_KEYS, NON_PORTABLE_KEYS } from "./store-keys";

describe("store-keys (single source of truth)", () => {
  it("builds per-provider api key names", () => {
    expect(apiKeyStoreKey("openai")).toBe("apikey_openai");
    expect(apiKeyStoreKey("anthropic")).toBe("apikey_anthropic");
    expect(apiKeyStoreKey("ollama")).toBe("apikey_ollama");
  });

  it("recognizes secret keys (api keys + tavily) and nothing else", () => {
    expect(isSecretKey(apiKeyStoreKey("openai"))).toBe(true);
    expect(isSecretKey(STORE_KEYS.tavilyApiKey)).toBe(true);
    expect(isSecretKey(STORE_KEYS.genModel)).toBe(false);
    expect(isSecretKey(STORE_KEYS.provider)).toBe(false);
    expect(isSecretKey(STORE_KEYS.libraryEnabled)).toBe(false);
  });

  it("import allow-list includes editable settings, excludes caches", () => {
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.provider)).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.genModel)).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.libraryUrl)).toBe(true);
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.libraryManifestCache)).toBe(false);
  });

  it("caches are marked non-portable", () => {
    expect(NON_PORTABLE_KEYS.has(STORE_KEYS.libraryManifestCache)).toBe(true);
    expect(NON_PORTABLE_KEYS.has(STORE_KEYS.libraryManifestCacheAt)).toBe(true);
  });

  it("never allows importing an arbitrary unknown key", () => {
    expect(ALLOWED_IMPORT_KEYS.has("evil_key")).toBe(false);
  });
});
