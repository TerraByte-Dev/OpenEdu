import { describe, it, expect, vi, beforeEach } from "vitest";

// store.ts getReviewConfig and getLocalVerifyConfig read the saved settings (review_model, the API keys,
// the accepted privacy notices, the Ollama URL) and Ollama's tag list. The Tauri store, the RAM command
// and Ollama are stubbed so the wiring the quiz and lesson screens call is what runs.
const saved = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: async () => ({ get: async (k: string) => saved.get(k), set: vi.fn(), save: vi.fn() }) },
}));
const GiB = 1024 ** 3;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 8 * GiB) }));
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  getOllamaModels: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  detectModelProfile: vi.fn(async () => ({ tier: "tiny", contextTokens: 131072, supportsTools: true })),
}));

import { getLocalVerifyConfig, getReviewConfig } from "./store";
import { getOllamaModels } from "./llm";
import type { LLMConfig } from "../types";

const LOCAL_GEN = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434", modelTier: "tiny" } as LLMConfig;
const CLOUD_GEN = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k", modelTier: "large" } as LLMConfig;

beforeEach(() => {
  saved.clear();
  vi.mocked(getOllamaModels).mockReset();
});

describe("getReviewConfig with review_model on another provider", () => {
  it("reviews lessons on Anthropic with the saved key once the Anthropic notice was accepted", async () => {
    saved.set("review_model", "anthropic:claude-haiku-5-5");
    saved.set("apikey_anthropic", " test-key ");
    saved.set("cloud_notices_seen", ["anthropic"]);
    expect(await getReviewConfig({ ...LOCAL_GEN }, "lesson")).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key" });
  });

  it("without the notice, keeps the default (no lesson review on the tiny tier)", async () => {
    saved.set("review_model", "anthropic:claude-haiku-5-5");
    saved.set("apikey_anthropic", "test-key");
    expect(await getReviewConfig({ ...LOCAL_GEN }, "lesson")).toBeNull();
    expect(await getReviewConfig({ ...LOCAL_GEN }, "questions")).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
  });

  it("a local reviewer for a cloud writer gets the Ollama URL and a context window", async () => {
    saved.set("review_model", "ollama:qwen3.5:9b");
    saved.set("ollama_url", "http://127.0.0.1:11500");
    const r = await getReviewConfig({ ...CLOUD_GEN }, "lesson");
    expect(r).toMatchObject({ provider: "ollama", model: "qwen3.5:9b", ollamaUrl: "http://127.0.0.1:11500" });
    expect(r?.contextTokens).toBeGreaterThan(0);
    expect(r?.apiKey).toBeUndefined();
  });
});

// The Checking model shares the provider-switch bug's pattern: a bare value runs on the course model's
// provider, so a "gemma4:e2b" chosen while on Ollama would go to Anthropic after a switch.
describe("getReviewConfig never sends a model to a provider it does not belong to", () => {
  it("a bare Ollama tag with a cloud course model: the course model checks", async () => {
    saved.set("review_model", "gemma4:e2b");
    expect(await getReviewConfig({ ...CLOUD_GEN }, "lesson")).toEqual({ ...CLOUD_GEN });
    expect(await getReviewConfig({ ...CLOUD_GEN }, "questions")).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5" });
  });

  it("a bare cloud id with a local course model: the default applies", async () => {
    saved.set("review_model", "claude-sonnet-5-5");
    expect(await getReviewConfig({ ...LOCAL_GEN }, "questions")).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
  });

  it("a provider prefix with another provider's model is ignored", async () => {
    saved.set("review_model", "anthropic:gpt-6-luna");
    saved.set("apikey_anthropic", "test-key");
    saved.set("cloud_notices_seen", ["anthropic"]);
    expect(await getReviewConfig({ ...LOCAL_GEN }, "questions")).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
    saved.set("review_model", "openai:gemma4:e2b");
    expect(await getReviewConfig({ ...CLOUD_GEN }, "questions")).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5" });
  });

  // Review of #341: an imported local model with no tag, named like a cloud id, is still Ollama's.
  it("a local model named like a cloud id checks on Ollama, bare or with the ollama: prefix", async () => {
    saved.set("review_model", "claude-3.7-sonnet-reasoning-gemma3-12b");
    expect(await getReviewConfig({ ...LOCAL_GEN }, "questions")).toMatchObject({ provider: "ollama", model: "claude-3.7-sonnet-reasoning-gemma3-12b" });
    saved.set("review_model", "ollama:gpt-2");
    expect(await getReviewConfig({ ...CLOUD_GEN }, "questions")).toMatchObject({ provider: "ollama", model: "gpt-2" });
  });
});

describe("getLocalVerifyConfig: the model the missed questions may go to", () => {
  it("is the generation model when that is local", async () => {
    const gen = { ...LOCAL_GEN };
    expect(await getLocalVerifyConfig(gen)).toBe(gen);
    expect(getOllamaModels).not.toHaveBeenCalled();
  });

  it("is this machine's default Ollama model, when pulled, for a cloud writer", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e2b", "nomic-embed-text:latest"] });
    expect(await getLocalVerifyConfig({ ...CLOUD_GEN })).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
  });

  it("is null, never the cloud, when Ollama is down or has no default model pulled", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [], error: "Connection refused" });
    expect(await getLocalVerifyConfig({ ...CLOUD_GEN })).toBeNull();
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["nomic-embed-text:latest"] });
    expect(await getLocalVerifyConfig({ ...CLOUD_GEN })).toBeNull();
    // An Ollama cloud model is not local either.
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [] });
    expect(await getLocalVerifyConfig({ provider: "ollama", model: "gpt-oss:120b-cloud" } as LLMConfig)).toBeNull();
  });
});
