import { describe, it, expect } from "vitest";
import {
  GENERATION_MODELS, CHAT_MODELS,
  defaultGenerationModel, defaultChatModel, defaultEmbeddingModel,
  defaultOllamaModelForRam, defaultOllamaModel, isOllamaDefaultModel,
  OLLAMA_GEN_SUGGESTIONS, OLLAMA_CHAT_SUGGESTIONS,
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
