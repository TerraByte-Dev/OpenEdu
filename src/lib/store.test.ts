import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// store.ts resolves the default model through the Tauri store, the system_memory_bytes command and
// Ollama's tag list. Stub all three so the wiring (not just models.ts's pure pick) is exercised in node.
const saved = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: async () => ({
      get: async (k: string) => saved.get(k),
      set: async (k: string, v: unknown) => { saved.set(k, v); },
      delete: async (k: string) => saved.delete(k),
      save: vi.fn(),
    }),
  },
}));
const GiB = 1024 ** 3;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 8 * GiB) }));
vi.mock("./llm", () => ({
  getOllamaModels: vi.fn(),
  detectModelProfile: vi.fn(async () => ({ tier: "small", contextTokens: 131072, supportsTools: true })),
}));

import { getChatConfig, getGenerationConfig, setChatModel, setGenerationModel, setLLMProvider } from "./store";
import { getOllamaModels } from "./llm";
import { defaultChatModel, defaultGenerationModel, GENERATION_MODELS, CHAT_MODELS, OLLAMA_CHAT_SUGGESTIONS } from "./models";
import { suggestedName, type KitCandidate } from "./model-kit";
import type { LLMProvider } from "../types";

describe("default model on an 8 GB machine", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
  });

  it("an upgraded install with e4b pulled and no stored model keeps e4b", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e4b", "nomic-embed-text:latest"] });
    expect((await getChatConfig()).model).toBe("gemma4:e4b");
    expect((await getGenerationConfig()).model).toBe("gemma4:e4b");
  });

  it("a fresh install with nothing pulled gets e2b", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [] });
    expect((await getChatConfig()).model).toBe("gemma4:e2b");
  });

  it("Ollama down: the RAM pick stands", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [], error: "Connection refused" });
    expect((await getChatConfig()).model).toBe("gemma4:e2b");
  });

  it("a model chosen in Settings wins, and Ollama is not asked", async () => {
    saved.set("chat_model", "qwen3.5:0.8b");
    expect((await getChatConfig()).model).toBe("qwen3.5:0.8b");
    expect(getOllamaModels).not.toHaveBeenCalled();
  });

  it("a cloud provider never asks Ollama", async () => {
    saved.set("llm_provider", "openai");
    await getChatConfig();
    expect(getOllamaModels).not.toHaveBeenCalled();
  });
});

describe("a stored cloud model the provider shut down", () => {
  beforeEach(() => saved.clear());
  afterEach(() => vi.useRealTimers());

  it("resolves to today's default model for the same role, and the stored value is not rewritten", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
    saved.set("llm_provider", "openai");
    saved.set("chat_model", "gpt-4o-mini");
    saved.set("gen_model", "gpt-4.1");
    expect((await getChatConfig()).model).toBe(defaultChatModel("openai"));
    expect((await getGenerationConfig()).model).toBe(defaultGenerationModel("openai"));
    expect(saved.get("chat_model")).toBe("gpt-4o-mini");
  });

  it("is used as is before its shutdown date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    saved.set("llm_provider", "openai");
    saved.set("chat_model", "gpt-4o-mini");
    expect((await getChatConfig()).model).toBe("gpt-4o-mini");
  });
});

// Click test 5: Settings › Provider & Models with course generation on Ollama gemma4:e2b, then "Use
// Anthropic". getGenerationConfig returned { provider: "anthropic", model: "gemma4:e2b" } and chat stayed
// on gemma4:e4b, so the next course build or chat turn would send an Ollama tag to the cloud API. These go
// through the same store calls Settings makes (ProviderModels pickProvider: setLLMProvider, then the getters).
describe("a provider switch never keeps another provider's model", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e2b", "gemma4:e4b"] });
  });

  for (const cloud of ["anthropic", "openai"] as const) {
    it(`Ollama → ${cloud}: generation and chat use ${cloud}'s defaults, and the Ollama tags stay stored`, async () => {
      await setGenerationModel("gemma4:e2b");
      await setChatModel("gemma4:e4b");
      await setLLMProvider(cloud);
      expect(await getGenerationConfig()).toMatchObject({ provider: cloud, model: defaultGenerationModel(cloud) });
      expect(await getChatConfig()).toMatchObject({ provider: cloud, model: defaultChatModel(cloud) });
      expect(saved.get("gen_model")).toBe("gemma4:e2b");
      expect(saved.get("chat_model")).toBe("gemma4:e4b");
    });

    it(`${cloud} → Ollama: a cloud model picked there never reaches Ollama`, async () => {
      await setLLMProvider(cloud);
      await setGenerationModel(GENERATION_MODELS[cloud][1].id);
      await setChatModel(CHAT_MODELS[cloud][1].id);
      await setLLMProvider("ollama");
      // 8 GB machine (the invoke mock) with both defaults pulled: the RAM pick, e2b.
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
      expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
    });
  }

  // Review of #341: the switch used to delete the stored models, so a user who only looked at the cloud
  // providers came back to a default this computer may not have pulled, and chat and course building failed.
  it("Ollama → Anthropic → OpenAI → Ollama with no cloud pick restores the Ollama choice", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["qwen3.5:0.8b"] });
    await setLLMProvider("ollama");
    await setGenerationModel("qwen3.5:0.8b");
    await setChatModel("qwen3.5:0.8b");
    await setLLMProvider("anthropic");
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: defaultGenerationModel("anthropic") });
    await setLLMProvider("openai");
    expect(await getChatConfig()).toMatchObject({ provider: "openai", model: defaultChatModel("openai") });
    await setLLMProvider("ollama");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
  });

  // Review of #341: an offline GGUF import (ModelImport useModel: setChatModel, then setGenerationModel)
  // saves the folder's suggestedName, which has no tag. A real fine-tune folder is named like a Claude id.
  // Ollama must keep using it, and selecting Ollama again must not drop it.
  for (const dir of ["models/Claude-3.7-Sonnet-Reasoning-Gemma3-12B", "models/gpt-2", "models/o1-distill"]) {
    it(`an imported local model named from "${dir}" stays the Ollama model`, async () => {
      const candidate: KitCandidate = {
        kind: "gguf", dir, modelfile: "", ggufs: [{ rel: `${dir}/model.gguf`, bytes: 1 }], checksums: null, licenceFiles: [],
      };
      const name = suggestedName(candidate);
      expect(name).not.toContain(":");
      vi.mocked(getOllamaModels).mockResolvedValue({ models: [`${name}:latest`] });
      await setLLMProvider("ollama");
      await setChatModel(name);
      await setGenerationModel(name);
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: name });
      expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: name });
      await setLLMProvider("ollama");
      expect(saved.get("gen_model")).toBe(name);
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: name });
    });
  }

  it("keeps a model that belongs to the provider picked (a re-click, or the same provider again)", async () => {
    await setLLMProvider("anthropic");
    await setGenerationModel("claude-sonnet-5-5");
    await setLLMProvider("anthropic");
    expect((await getGenerationConfig()).model).toBe("claude-sonnet-5-5");
    await setLLMProvider("ollama");
    await setChatModel("qwen3.5:0.8b");
    await setLLMProvider("ollama");
    expect((await getChatConfig()).model).toBe("qwen3.5:0.8b");
  });

  // A store written before this fix (or a settings import) can still hold a mismatched pair with no switch
  // to clear it. The getters skip it without rewriting it.
  it("a mismatched pair already in the store is never sent", async () => {
    const tags = [...OLLAMA_CHAT_SUGGESTIONS, "gpt-oss:20b"];
    for (const provider of ["anthropic", "openai"] as LLMProvider[]) {
      for (const tag of tags) {
        saved.clear();
        saved.set("llm_provider", provider);
        saved.set("gen_model", tag);
        saved.set("chat_model", tag);
        expect((await getGenerationConfig()).model).toBe(defaultGenerationModel(provider));
        expect((await getChatConfig()).model).toBe(defaultChatModel(provider));
        expect(saved.get("gen_model")).toBe(tag);
      }
    }
    saved.clear();
    saved.set("gen_model", "claude-opus-4-6");
    saved.set("chat_model", "gpt-6-luna");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
  });
});
