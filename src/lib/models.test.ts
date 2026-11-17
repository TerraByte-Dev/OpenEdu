import { describe, it, expect } from "vitest";
import {
  GENERATION_MODELS, CHAT_MODELS,
  defaultGenerationModel, defaultChatModel, defaultEmbeddingModel,
  defaultOllamaModelForRam, defaultOllamaModel, isOllamaDefaultModel,
  OLLAMA_GEN_SUGGESTIONS, OLLAMA_CHAT_SUGGESTIONS, CLOUD_SHUTDOWNS, modelProvider, resolveStoredModel, withStoredOption,
} from "./models";
import type { LLMProvider } from "../types";

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

  it("never switches provider, and leaves Ollama's own models and an empty store alone", () => {
    expect(resolveStoredModel("ollama", "chat", "gemma4:e2b", after)).toBe("gemma4:e2b");
    expect(resolveStoredModel("ollama", "chat", "gpt-oss:120b-cloud", after)).toBe("gpt-oss:120b-cloud");
    expect(resolveStoredModel("openai", "chat", undefined, after)).toBeUndefined();
  });

  // Click test 5: course generation on Ollama gemma4:e2b, then "Use Anthropic"; the next course build sent
  // the Ollama tag to Anthropic's API. One gen_model key serves every provider, so a stored id is used only
  // by the provider it belongs to; undefined means the provider's default applies.
  it("ignores another provider's model, so a cloud provider never gets an Ollama tag (and back)", () => {
    for (const role of ["generation", "chat"] as const) {
      for (const tag of ["gemma4:e2b", "gemma4:e4b", "qwen3.5:0.8b", "gpt-oss:20b", "llama3", " gemma4:e2b "]) {
        expect(resolveStoredModel("anthropic", role, tag, after)).toBeUndefined();
        expect(resolveStoredModel("openai", role, tag, after)).toBeUndefined();
      }
      expect(resolveStoredModel("anthropic", role, "gpt-6-luna", after)).toBeUndefined();
      expect(resolveStoredModel("anthropic", role, "gpt-4o", after)).toBeUndefined();
      expect(resolveStoredModel("openai", role, "claude-opus-4-6", after)).toBeUndefined();
      expect(resolveStoredModel("ollama", role, "claude-opus-4-6", after)).toBeUndefined();
      expect(resolveStoredModel("ollama", role, "gpt-4o", after)).toBeUndefined();
      expect(resolveStoredModel("anthropic", role, "", after)).toBeUndefined();
    }
  });

  it("treats a non-string stored value (hand-edited settings import) as nothing stored", () => {
    for (const bad of [null, 42, {}, ["gpt-4o"]]) {
      expect(resolveStoredModel("openai", "chat", bad as unknown as string, after)).toBeUndefined();
    }
  });

  it("never reads an Object prototype key as a catalog or shutdown entry", () => {
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(modelProvider(id)).toBe("ollama");
      expect(resolveStoredModel("openai", "generation", id, after)).toBeUndefined();
      expect(resolveStoredModel("ollama", "generation", id, after)).toBe(id);
    }
    expect(resolveStoredModel("groq" as LLMProvider, "chat", "gpt-4o", after)).toBeUndefined();
  });

  for (const provider of CLOUD) {
    it(`the ${provider} catalog never offers a model with a shutdown date`, () => {
      const offered = [...GENERATION_MODELS[provider], ...CHAT_MODELS[provider]].map((m) => m.id);
      for (const id of Object.keys(CLOUD_SHUTDOWNS[provider])) expect(offered).not.toContain(id);
    });
  }
});

describe("withStoredOption (Settings shows the model the app will use)", () => {
  const list = CHAT_MODELS.anthropic;

  it("adds a stored id that is not in the list as an extra chip labelled with its id", () => {
    expect(withStoredOption(list, "claude-haiku-4-5-20251001", "anthropic")).toEqual([
      ...list, { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5-20251001" },
    ]);
  });

  it("returns the list unchanged for a listed id or an empty value", () => {
    expect(withStoredOption(list, list[0].id, "anthropic")).toBe(list);
    expect(withStoredOption(list, "", "anthropic")).toBe(list);
    expect(withStoredOption(list, "  ", "anthropic")).toBe(list);
  });

  // Click test 5 showed a selected "gemma4:e2b" chip among Anthropic's course-generation models.
  it("never adds another provider's model as a chip", () => {
    for (const other of ["gemma4:e2b", "gemma4:e4b", "gpt-6-luna"]) expect(withStoredOption(list, other, "anthropic")).toBe(list);
    expect(withStoredOption(CHAT_MODELS.openai, "claude-haiku-5-5", "openai")).toBe(CHAT_MODELS.openai);
  });
});

describe("modelProvider: every model id belongs to exactly one provider", () => {
  for (const provider of CLOUD) {
    it(`every ${provider} catalog and shutdown id is ${provider}'s`, () => {
      const ids = [...GENERATION_MODELS[provider], ...CHAT_MODELS[provider]].map((m) => m.id);
      for (const id of [...ids, ...Object.keys(CLOUD_SHUTDOWNS[provider])]) expect(modelProvider(id), id).toBe(provider);
    });
  }

  it("every Ollama suggestion and default is Ollama's", () => {
    for (const id of [...OLLAMA_GEN_SUGGESTIONS, ...OLLAMA_CHAT_SUGGESTIONS, defaultOllamaModel(null, null), defaultEmbeddingModel("ollama")]) {
      expect(modelProvider(id), id).toBe("ollama");
    }
  });

  it("an Ollama name:tag is never a cloud id, whatever it starts with", () => {
    for (const id of ["gpt-oss:20b", "gpt-oss:120b-cloud", "claude-ish:7b", "o3:latest", "qwen3.5:9b", "Gemma4:E2B"]) {
      expect(modelProvider(id), id).toBe("ollama");
    }
  });

  it("hand-typed cloud ids go by their provider's shape", () => {
    expect(modelProvider("gpt-5.4-2026-03-05")).toBe("openai");
    expect(modelProvider("o3-mini")).toBe("openai");
    expect(modelProvider("chatgpt-4o-latest")).toBe("openai");
    expect(modelProvider("ft:gpt-4o-mini-2024-07-18:org::abc123")).toBe("openai");
    expect(modelProvider("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(modelProvider(" Claude-Sonnet-4-6 ")).toBe("anthropic");
    for (const id of ["gpt-oss", "olmo2", "llama3", "nomic-embed-text", ""]) expect(modelProvider(id), id).toBe("ollama");
  });
});

describe("Anthropic catalog keeps the 4.6 models that still work (#257 review)", () => {
  it("offers Sonnet 4.6 for generation and Opus 4.6 for chat", () => {
    expect(GENERATION_MODELS.anthropic.map((m) => m.id)).toContain("claude-sonnet-4-6");
    expect(CHAT_MODELS.anthropic.map((m) => m.id)).toContain("claude-opus-4-6");
  });
});

describe("Anthropic 5.x models are back in the generation picker (structured outputs, B10 round 2)", () => {
  // They left the picker because they reject the forced tool_choice; callAnthropicStructured now sends
  // output_config.format, which all of them accept (llm-anthropic-structured.test.ts).
  const ids = () => GENERATION_MODELS.anthropic.map((m) => m.id);

  it("offers Sonnet 5.5, Opus 5.5 and Fable 5.2 for course generation (and so as a checking model)", () => {
    expect(ids()).toEqual(expect.arrayContaining(["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]));
  });

  it("keeps them out of tutor chat, whose tool turns do not send thinking blocks back", () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]) {
      expect(CHAT_MODELS.anthropic.map((m) => m.id)).not.toContain(id);
    }
  });

  it("does not change the default a family already has", () => {
    expect(defaultGenerationModel("anthropic")).toBe("claude-opus-4-6");
  });
});
