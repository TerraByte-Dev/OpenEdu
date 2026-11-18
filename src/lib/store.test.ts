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

import { getChatConfig, getGenerationConfig, setChatModel, setGenerationModel, setLLMProvider, setMaxContextTokens, systemMemoryBytes, CONTEXT_TOKEN_CHOICES } from "./store";
import { contextWindowNote, CONTEXT_WINDOW_HELP } from "./context-window";
import { DEFAULT_CONTEXT_TOKENS } from "./kernel/budget";
import providerModels from "../views/settings/sections/ProviderModels.tsx?raw";
import { getOllamaModels } from "./llm";
import { defaultChatModel, defaultGenerationModel, withStoredOption, GENERATION_MODELS, CHAT_MODELS, OLLAMA_CHAT_SUGGESTIONS } from "./models";
import { suggestedName, type KitCandidate } from "./model-kit";

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
    saved.set("chat_model_ollama", "qwen3.5:0.8b");
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
    saved.set("chat_model_openai", "gpt-4o-mini");
    saved.set("gen_model_openai", "gpt-4.1");
    expect((await getChatConfig()).model).toBe(defaultChatModel("openai"));
    expect((await getGenerationConfig()).model).toBe(defaultGenerationModel("openai"));
    expect(saved.get("chat_model_openai")).toBe("gpt-4o-mini");
  });

  it("is used as is before its shutdown date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    saved.set("llm_provider", "openai");
    saved.set("chat_model_openai", "gpt-4o-mini");
    expect((await getChatConfig()).model).toBe("gpt-4o-mini");
  });
});

// Each provider keeps its own generation and chat pick (store-keys.ts modelStoreKey). Click test 5:
// course generation on Ollama gemma4:e2b, then "Use Anthropic", sent the Ollama tag to Anthropic. These go
// through the same store calls Settings makes (ProviderModels pickProvider: setLLMProvider, then the
// getters; saveModel: setGenerationModel / setChatModel with the selected provider).
describe("a provider switch: each provider keeps its own pick", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e2b", "gemma4:e4b"] });
  });

  for (const cloud of ["anthropic", "openai"] as const) {
    it(`Ollama → ${cloud}: generation and chat use ${cloud}'s defaults, and the Ollama picks stay stored`, async () => {
      await setGenerationModel("gemma4:e2b", "ollama");
      await setChatModel("gemma4:e4b", "ollama");
      await setLLMProvider(cloud);
      expect(await getGenerationConfig()).toMatchObject({ provider: cloud, model: defaultGenerationModel(cloud) });
      expect(await getChatConfig()).toMatchObject({ provider: cloud, model: defaultChatModel(cloud) });
      expect(saved.get("gen_model_ollama")).toBe("gemma4:e2b");
      expect(saved.get("chat_model_ollama")).toBe("gemma4:e4b");
    });

    it(`${cloud} → Ollama: a cloud model picked there never reaches Ollama`, async () => {
      await setLLMProvider(cloud);
      await setGenerationModel(GENERATION_MODELS[cloud][1].id, cloud);
      await setChatModel(CHAT_MODELS[cloud][1].id, cloud);
      await setLLMProvider("ollama");
      // 8 GB machine (the invoke mock) with both defaults pulled: the RAM pick, e2b.
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
      expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
    });
  }

  it("Ollama → Anthropic → OpenAI → Ollama with no cloud pick restores the Ollama choice", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["qwen3.5:0.8b"] });
    await setLLMProvider("ollama");
    await setGenerationModel("qwen3.5:0.8b", "ollama");
    await setChatModel("qwen3.5:0.8b", "ollama");
    await setLLMProvider("anthropic");
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: defaultGenerationModel("anthropic") });
    await setLLMProvider("openai");
    expect(await getChatConfig()).toMatchObject({ provider: "openai", model: defaultChatModel("openai") });
    await setLLMProvider("ollama");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
  });

  // Review 2 of #341, failing input A: with one shared gen_model, clicking Sonnet 5.5 on Anthropic replaced
  // the Ollama pick, and back on Ollama course building used an uninstalled gemma4:e2b.
  it("A: Ollama qwen3.5:0.8b → Anthropic, pick Sonnet 5.5 → Ollama is qwen3.5:0.8b, and Anthropic is Sonnet 5.5 again", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["qwen3.5:0.8b"] });
    await setLLMProvider("ollama");
    await setGenerationModel("qwen3.5:0.8b", "ollama");
    await setChatModel("qwen3.5:0.8b", "ollama");
    await setLLMProvider("anthropic");
    await setGenerationModel("claude-sonnet-5-5", "anthropic");
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    await setLLMProvider("ollama");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    await setLLMProvider("anthropic");
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(await getChatConfig()).toMatchObject({ provider: "anthropic", model: defaultChatModel("anthropic") });
  });

  // Review 2 of #341, failing input B: Anthropic Sonnet 5.5, then OpenAI with GPT-6 Luna, then Anthropic
  // came back on Opus 4.6.
  it("B: Anthropic Sonnet 5.5 → OpenAI, pick GPT-6 Luna → Anthropic is Sonnet 5.5, and OpenAI is GPT-6 Luna", async () => {
    await setLLMProvider("anthropic");
    await setGenerationModel("claude-sonnet-5-5", "anthropic");
    await setLLMProvider("openai");
    await setGenerationModel("gpt-6-luna", "openai");
    await setChatModel("gpt-5.4-mini", "openai");
    await setLLMProvider("anthropic");
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(await getChatConfig()).toMatchObject({ provider: "anthropic", model: defaultChatModel("anthropic") });
    await setLLMProvider("openai");
    expect(await getGenerationConfig()).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
    expect(await getChatConfig()).toMatchObject({ provider: "openai", model: "gpt-5.4-mini" });
  });

  // Reviews 1 and 2 of #341: an offline GGUF import (ModelImport useModel) saves the folder's suggestedName,
  // which has no tag, and a real fine-tune folder is named like a Claude id. Ollama must keep using it, and
  // no cloud provider may ever be sent it (review 2: Anthropic got "claude-3.7-…-gemma3", OpenAI "gpt-2"),
  // nor show it as a chip (Settings builds the chips from the resolved model, withStoredOption).
  for (const dir of ["models/Claude-3.7-Sonnet-Reasoning-Gemma3-12B", "models/gpt-2", "models/o1-distill"]) {
    const candidate: KitCandidate = {
      kind: "gguf", dir, modelfile: "", ggufs: [{ rel: `${dir}/model.gguf`, bytes: 1 }], checksums: null, licenceFiles: [],
    };
    const name = suggestedName(candidate);

    it(`an imported local model named from "${dir}" stays Ollama's, and never reaches a cloud provider`, async () => {
      expect(name).not.toContain(":");
      vi.mocked(getOllamaModels).mockResolvedValue({ models: [`${name}:latest`] });
      await setLLMProvider("ollama");
      await setChatModel(name, "ollama");
      await setGenerationModel(name, "ollama");
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: name });
      expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: name });
      await setLLMProvider("ollama");
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: name });
      for (const cloud of ["anthropic", "openai"] as const) {
        await setLLMProvider(cloud);
        const gen = (await getGenerationConfig()).model;
        const chat = (await getChatConfig()).model;
        expect(gen).toBe(defaultGenerationModel(cloud));
        expect(chat).toBe(defaultChatModel(cloud));
        expect(withStoredOption(GENERATION_MODELS[cloud], gen)).toBe(GENERATION_MODELS[cloud]);
        expect(withStoredOption(CHAT_MODELS[cloud], chat)).toBe(CHAT_MODELS[cloud]);
      }
      await setLLMProvider("ollama");
      expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: name });
    });

    it(`an import from "${dir}" made while Anthropic is selected is saved as Ollama's pick`, async () => {
      vi.mocked(getOllamaModels).mockResolvedValue({ models: [`${name}:latest`] });
      await setLLMProvider("anthropic");
      await setChatModel(name, "ollama");
      await setGenerationModel(name, "ollama");
      expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: defaultGenerationModel("anthropic") });
      await setLLMProvider("ollama");
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: name });
    });
  }

  it("keeps a provider's pick on a re-click of the same provider", async () => {
    await setLLMProvider("anthropic");
    await setGenerationModel("claude-sonnet-5-5", "anthropic");
    await setLLMProvider("anthropic");
    expect((await getGenerationConfig()).model).toBe("claude-sonnet-5-5");
    await setLLMProvider("ollama");
    await setChatModel("qwen3.5:0.8b", "ollama");
    await setLLMProvider("ollama");
    expect((await getChatConfig()).model).toBe("qwen3.5:0.8b");
  });

  // The last guard: an Ollama tag under a cloud provider's own key (only a hand-edited settings file can
  // put one there) is never sent to the cloud API.
  it("an Ollama tag stored under a cloud provider's key is never sent", async () => {
    for (const provider of ["anthropic", "openai"] as const) {
      for (const tag of [...OLLAMA_CHAT_SUGGESTIONS, "gpt-oss:20b"]) {
        saved.clear();
        saved.set("llm_provider", provider);
        saved.set(`gen_model_${provider}`, tag);
        saved.set(`chat_model_${provider}`, tag);
        expect((await getGenerationConfig()).model).toBe(defaultGenerationModel(provider));
        expect((await getChatConfig()).model).toBe(defaultChatModel(provider));
      }
    }
  });

  // Review 2 of #341: an unknown llm_provider ("gemini", or "constructor") threw from the model lookups.
  it("an unknown provider in the store reads as Ollama", async () => {
    for (const bad of ["gemini", "constructor", "__proto__", 42]) {
      saved.clear();
      saved.set("llm_provider", bad);
      saved.set("gen_model_ollama", "qwen3.5:0.8b");
      expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
      expect((await getChatConfig()).provider).toBe("ollama");
    }
  });
});

// An install from before per-provider keys has its picks under gen_model / chat_model, shared by every
// provider. The first model read moves each to the provider it belongs to: a cloud provider only for an
// exact id OpenEdu offered there, otherwise Ollama (models.ts legacyModelOwner).
describe("an install from before per-provider keys keeps its models", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["qwen3.5:0.8b"] });
  });

  it("Ollama picks move to Ollama's keys and the old keys go", async () => {
    saved.set("gen_model", "qwen3.5:0.8b");
    saved.set("chat_model", "gemma4:e4b");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e4b" });
    expect(saved.get("gen_model_ollama")).toBe("qwen3.5:0.8b");
    expect(saved.get("chat_model_ollama")).toBe("gemma4:e4b");
    expect(saved.has("gen_model")).toBe(false);
    expect(saved.has("chat_model")).toBe(false);
  });

  it("a cloud install keeps its catalog, shut-down and former picks", async () => {
    saved.set("llm_provider", "anthropic");
    saved.set("gen_model", "claude-sonnet-5-5");
    saved.set("chat_model", "claude-haiku-4-5-20251001");
    expect((await getGenerationConfig()).model).toBe("claude-sonnet-5-5");
    expect((await getChatConfig()).model).toBe("claude-haiku-4-5-20251001");
    saved.clear();
    saved.set("llm_provider", "openai");
    saved.set("chat_model", "gpt-4o-mini");
    expect(saved.get("chat_model_openai")).toBeUndefined();
    await getChatConfig();
    expect(saved.get("chat_model_openai")).toBe("gpt-4o-mini");
  });

  // The shapes no name rule can tell apart: on an old install they belong to Ollama.
  for (const local of ["claude-3.7-sonnet-reasoning-gemma3-12b", "gpt-2", "o1-distill", "gemma4:e2b"]) {
    it(`a shared "${local}" left from Ollama on a cloud install goes to Ollama, never to the cloud`, async () => {
      for (const cloud of ["anthropic", "openai"] as const) {
        saved.clear();
        saved.set("llm_provider", cloud);
        saved.set("gen_model", local);
        saved.set("chat_model", local);
        expect(await getGenerationConfig()).toMatchObject({ provider: cloud, model: defaultGenerationModel(cloud) });
        expect(await getChatConfig()).toMatchObject({ provider: cloud, model: defaultChatModel(cloud) });
        await setLLMProvider("ollama");
        expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: local });
        expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: local });
      }
    });
  }

  it("a pick made before the first read is not overwritten by the old key afterwards", async () => {
    saved.set("gen_model", "gemma4:e4b");
    await setGenerationModel("qwen3.5:0.8b", "ollama");
    expect((await getGenerationConfig()).model).toBe("qwen3.5:0.8b");
    expect(saved.has("gen_model")).toBe(false);
  });

  it("a blank or non-string old value moves nowhere and is dropped", async () => {
    saved.set("gen_model", "  ");
    saved.set("chat_model", 42);
    expect((await getGenerationConfig()).model).toBe("gemma4:e2b");
    expect([...saved.keys()].filter((k) => k.includes("model"))).toEqual([]);
  });
});

// Settings › Context window (context-window.ts) says what each choice changes. These run every choice
// through the getters the app sends num_ctx from, so the words can't drift from what is sent.
describe("Context window: what the setting says matches what is sent", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e2b"] });
  });

  it("below 8k only chat follows it, so the note warns of a reload; from 8k up every call uses one size", async () => {
    for (const n of CONTEXT_TOKEN_CHOICES) {
      await setMaxContextTokens(n);
      const chat = (await getChatConfig()).contextTokens;
      const gen = (await getGenerationConfig()).contextTokens;
      const note = contextWindowNote(n, null);
      expect(chat, `${n}`).toBe(n);
      if (n < DEFAULT_CONTEXT_TOKENS) {
        expect(gen, `${n}`).toBe(DEFAULT_CONTEXT_TOKENS);
        expect(note.warn).toBe(true);
        expect(note.text).toContain("tutor chat only");
        expect(note.text).toContain("model reloads");
        expect(note.text).toContain("does not make OpenEdu faster");
      } else {
        expect(gen, `${n}`).toBe(n);
        expect(note.text).toContain("lessons, quizzes, level tests and course building");
        expect(note.text).not.toContain("reloads");
      }
    }
  });

  it("16k on this 8 GB computer (system_memory_bytes) warns that it does not fit, and 8k does not", async () => {
    const ram = await systemMemoryBytes();
    expect(ram).toBe(8 * GiB);
    const big = contextWindowNote(16384, ram);
    expect(big.warn).toBe(true);
    expect(big.text).toContain("about 8 GB of memory");
    expect(big.text).toContain("Choose 8k");
    expect(contextWindowNote(8192, ram).warn).toBe(false);
    expect(contextWindowNote(16384, 32 * GiB).warn).toBe(false);
    expect(contextWindowNote(16384, null).warn).toBe(false);
  });

  it("the help no longer tells anyone to lower it when the app is slow or a model fails to load", () => {
    expect(CONTEXT_WINDOW_HELP).not.toMatch(/sluggish|fails to load|one place to change/i);
    expect(CONTEXT_WINDOW_HELP).toContain("Tutor chat and the notes assistant use exactly this size");
    expect(CONTEXT_WINDOW_HELP).toContain("need at least 8k");
  });

  it("Settings draws this help and this note, with this computer's memory", () => {
    expect(providerModels).toContain("help={CONTEXT_WINDOW_HELP}");
    expect(providerModels).toContain("contextWindowNote(maxCtx, ramBytes)");
    expect(providerModels).toContain("setRamBytes(await systemMemoryBytes())");
  });
});
