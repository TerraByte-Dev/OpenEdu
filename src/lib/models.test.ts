import { describe, it, expect } from "vitest";
import {
  GENERATION_MODELS, CHAT_MODELS,
  defaultGenerationModel, defaultChatModel, defaultEmbeddingModel,
  defaultOllamaModelForRam, defaultOllamaModel, isOllamaDefaultModel,
  OLLAMA_GEN_SUGGESTIONS, OLLAMA_CHAT_SUGGESTIONS, CLOUD_SHUTDOWNS, resolveStoredModel,
} from "./models";

const CLOUD = ["openai", "anthropic"] as const;

describe("model catalog ↔ defaults (the issue #2 contract)", () => {
  for (const provider of CLOUD) {
    it(`generation default for ${provider} equals the recommended catalog entry`, () => {
      const rec = GENERATION_MODELS[provider].find((m) => m.recommended);
      expect(rec).toBeDefined();
      expect(defaultGenerationModel(provider)).toBe(rec!.id);
    });

    it(`chat default for ${provider} equals the recommended catalog entry`, () => {
      const rec = CHAT_MODELS[provider].find((m) => m.recommended);
      expect(rec).toBeDefined();
      expect(defaultChatModel(provider)).toBe(rec!.id);
    });

    it(`exactly one recommended generation + chat model for ${provider}`, () => {
      expect(GENERATION_MODELS[provider].filter((m) => m.recommended)).toHaveLength(1);
      expect(CHAT_MODELS[provider].filter((m) => m.recommended)).toHaveLength(1);
    });

    it(`defaults are members of the ${provider} catalog`, () => {
      expect(GENERATION_MODELS[provider].some((m) => m.id === defaultGenerationModel(provider))).toBe(true);
      expect(CHAT_MODELS[provider].some((m) => m.id === defaultChatModel(provider))).toBe(true);
    });
  }

  it("ollama defaults are local", () => {
    expect(defaultGenerationModel("ollama")).toBe("gemma4:e4b");
    expect(defaultChatModel("ollama")).toBe("gemma4:e4b");
    expect(defaultEmbeddingModel("ollama")).toBe("nomic-embed-text");
  });

  it("embedding default is cloud only for openai (Anthropic has no embeddings endpoint)", () => {
    expect(defaultEmbeddingModel("openai")).toBe("text-embedding-3-small");
    expect(defaultEmbeddingModel("anthropic")).toBe("nomic-embed-text");
  });
});

const GiB = 1024 ** 3;

describe("defaultOllamaModelForRam (8 GB community-centre PCs)", () => {
  it("an 8 GB machine gets e2b — e4b is 9.6 GB on disk and does not fit", () => {
    expect(defaultOllamaModelForRam(8 * GiB)).toBe("gemma4:e2b");
    expect(defaultOllamaModelForRam(7.8 * GiB)).toBe("gemma4:e2b"); // 8 GB as the OS reports it
    expect(defaultOllamaModelForRam(12 * GiB)).toBe("gemma4:e2b");
  });

  it("a 16 GB machine gets e4b even though the OS reports less than 16 GiB", () => {
    expect(defaultOllamaModelForRam(16 * GiB)).toBe("gemma4:e4b");
    expect(defaultOllamaModelForRam(15.9 * GiB)).toBe("gemma4:e4b");
    expect(defaultOllamaModelForRam(15 * GiB)).toBe("gemma4:e4b"); // integrated graphics reserving 1 GiB
    expect(defaultOllamaModelForRam(16e9)).toBe("gemma4:e4b"); // "16 GB" in decimal units
    expect(defaultOllamaModelForRam(32 * GiB)).toBe("gemma4:e4b");
  });

  it("unknown RAM keeps the pre-RAM default rather than guessing", () => {
    for (const unknown of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(defaultOllamaModelForRam(unknown)).toBe("gemma4:e4b");
    }
  });

  it("never defaults to qwen3.5:0.8b (38/54 harmful near-miss answers)", () => {
    for (const gib of [1, 2, 4, 6, 8, 16, 64]) {
      expect(defaultOllamaModelForRam(gib * GiB)).not.toBe("qwen3.5:0.8b");
    }
  });

  it("generation and chat defaults follow RAM for ollama only", () => {
    expect(defaultGenerationModel("ollama", 8 * GiB)).toBe("gemma4:e2b");
    expect(defaultChatModel("ollama", 8 * GiB)).toBe("gemma4:e2b");
    expect(defaultGenerationModel("ollama", 32 * GiB)).toBe("gemma4:e4b");
    expect(defaultChatModel("openai", 8 * GiB)).toBe(defaultChatModel("openai"));
    expect(defaultGenerationModel("anthropic", 8 * GiB)).toBe(defaultGenerationModel("anthropic"));
  });

  it("whichever default RAM picks is a chip in the offline picker (the issue #2 contract, locally)", () => {
    for (const ram of [8 * GiB, 32 * GiB, null]) {
      expect(OLLAMA_GEN_SUGGESTIONS).toContain(defaultGenerationModel("ollama", ram));
      expect(OLLAMA_CHAT_SUGGESTIONS).toContain(defaultChatModel("ollama", ram));
    }
  });
});

describe("defaultOllamaModel (an upgrade must not point a working install at a model it lacks)", () => {
  it("an 8 GB install set up on e4b before this default existed keeps e4b", () => {
    expect(defaultOllamaModel(8 * GiB, ["gemma4:e4b", "nomic-embed-text:latest"])).toBe("gemma4:e4b");
    expect(defaultChatModel("ollama", 8 * GiB, ["gemma4:e4b"])).toBe("gemma4:e4b");
    expect(defaultGenerationModel("ollama", 8 * GiB, ["gemma4:e4b"])).toBe("gemma4:e4b");
  });

  it("a fresh 8 GB install gets e2b, and so does one that has pulled it", () => {
    expect(defaultOllamaModel(8 * GiB, [])).toBe("gemma4:e2b");
    expect(defaultOllamaModel(8 * GiB, ["nomic-embed-text:latest"])).toBe("gemma4:e2b");
    expect(defaultOllamaModel(8 * GiB, ["gemma4:e4b", "gemma4:e2b"])).toBe("gemma4:e2b");
  });

  it("a large machine with only e2b pulled uses it rather than one it does not have", () => {
    expect(defaultOllamaModel(32 * GiB, ["gemma4:e2b"])).toBe("gemma4:e2b");
    expect(defaultOllamaModel(32 * GiB, ["gemma4:e2b", "gemma4:e4b"])).toBe("gemma4:e4b");
  });

  it("matches tags exactly: another gemma4 tag is not the default being present", () => {
    expect(defaultOllamaModel(8 * GiB, ["gemma4:latest"])).toBe("gemma4:e2b");
    expect(defaultOllamaModel(8 * GiB, ["GEMMA4:E4B"])).toBe("gemma4:e4b");
  });

  it("Ollama unreachable (null) leaves the RAM pick alone", () => {
    expect(defaultOllamaModel(8 * GiB, null)).toBe("gemma4:e2b");
    expect(defaultOllamaModel(null, null)).toBe("gemma4:e4b");
  });

  it("isOllamaDefaultModel names exactly the two defaults", () => {
    expect(isOllamaDefaultModel("gemma4:e2b")).toBe(true);
    expect(isOllamaDefaultModel(" Gemma4:E4B ")).toBe(true);
    expect(isOllamaDefaultModel("qwen3.5:0.8b")).toBe(false);
    expect(isOllamaDefaultModel("gemma3:1b")).toBe(false);
  });
});

describe("resolveStoredModel (a stored id the provider shut down)", () => {
  const before = new Date("2027-01-13T23:59:59Z");
  const after = new Date("2027-01-14T00:00:00Z");

  it("keeps a deprecated id until its shutdown date", () => {
    expect(resolveStoredModel("openai", "chat", "gpt-4o-mini", before)).toBe("gpt-4o-mini");
  });

  it("from the shutdown date, resolves to the recommended model for the same role", () => {
    expect(resolveStoredModel("openai", "chat", "gpt-4o-mini", after)).toBe(defaultChatModel("openai"));
    expect(resolveStoredModel("openai", "generation", "gpt-4.1", after)).toBe(defaultGenerationModel("openai"));
    expect(resolveStoredModel("openai", "generation", "gpt-4o", after)).toBe(defaultGenerationModel("openai"));
    expect(resolveStoredModel("openai", "chat", "gpt-4o", after)).toBe(defaultChatModel("openai"));
  });

  it("keeps current, unknown and hand-typed ids", () => {
    expect(resolveStoredModel("openai", "generation", "gpt-5.4", after)).toBe("gpt-5.4");
    expect(resolveStoredModel("openai", "generation", "gpt-5.4-2026-03-05", after)).toBe("gpt-5.4-2026-03-05");
    expect(resolveStoredModel("anthropic", "chat", "claude-haiku-4-5-20251001", after)).toBe("claude-haiku-4-5-20251001");
  });

  it("never switches provider, and leaves Ollama and an empty store alone", () => {
    expect(resolveStoredModel("anthropic", "chat", "gpt-4o", after)).toBe("gpt-4o");
    expect(resolveStoredModel("ollama", "chat", "gpt-4o", after)).toBe("gpt-4o");
    expect(resolveStoredModel("openai", "chat", undefined, after)).toBeUndefined();
  });

  for (const provider of CLOUD) {
    it(`the ${provider} catalog never offers a model with a shutdown date`, () => {
      const offered = [...GENERATION_MODELS[provider], ...CHAT_MODELS[provider]].map((m) => m.id);
      for (const id of Object.keys(CLOUD_SHUTDOWNS[provider])) expect(offered).not.toContain(id);
    });
  }
});
