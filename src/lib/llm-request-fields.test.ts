import { describe, it, expect } from "vitest";
import { anthropicRequestFields, cloudModelTier, effectivePerCallTimeoutMs, openAIRequestFields } from "./llm";
import { CHAT_MODELS, GENERATION_MODELS, defaultChatModel, defaultGenerationModel } from "./models";

// Issue #2: the catalog moved to models that reject fields llm.ts used to send to every model. The unit
// tests below pin the helpers; the "every catalog model" block walks GENERATION_MODELS and CHAT_MODELS,
// so adding an id that needs a new rule fails here. llm-request-body.test.ts pins what the call sites send.
describe("openAIRequestFields", () => {
  it("sends reasoning_effort none and no temperature to GPT-6 Luna", () => {
    expect(openAIRequestFields("gpt-6-luna", 0.2)).toEqual({ reasoning_effort: "none" });
    expect(openAIRequestFields("gpt-6-luna")).toEqual({ reasoning_effort: "none" });
  });

  it("drops temperature for GPT-6 models that cannot run at effort none", () => {
    expect(openAIRequestFields("gpt-6.1-sol", 0.2)).toEqual({});
    expect(openAIRequestFields("gpt-6-astra", 0.1)).toEqual({});
  });

  it("leaves older models exactly as before", () => {
    expect(openAIRequestFields("gpt-5.4", 0.2)).toEqual({ temperature: 0.2 });
    expect(openAIRequestFields("gpt-5.4-mini")).toEqual({});
  });
});

describe("anthropicRequestFields", () => {
  it("omits temperature on Claude 4.7 and later", () => {
    for (const m of ["claude-haiku-5-5", "claude-opus-4-7", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-4-10"]) {
      expect(anthropicRequestFields(m, 0.2)).not.toHaveProperty("temperature");
    }
  });

  it("keeps temperature on earlier models, dated ids included", () => {
    for (const m of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-3-7-sonnet-20250219", "claude-opus-4-20250514"]) {
      expect(anthropicRequestFields(m, 0.2)).toEqual({ temperature: 0.2 });
    }
    expect(anthropicRequestFields("claude-opus-4-6")).toEqual({});
  });

  it("switches Haiku 5.5's default thinking off", () => {
    expect(anthropicRequestFields("claude-haiku-5-5", 0.2)).toEqual({ thinking: { type: "disabled" } });
  });
});

describe("cloudModelTier for the catalog", () => {
  it("tiers GPT-6 Sol and Astra large, Luna medium", () => {
    expect(cloudModelTier("openai", "gpt-6.1-sol")).toBe("large");
    expect(cloudModelTier("openai", "gpt-6-astra")).toBe("large");
    expect(cloudModelTier("openai", "gpt-6-luna")).toBe("medium");
  });

  it("tiers Claude by family", () => {
    expect(cloudModelTier("anthropic", "claude-opus-4-6")).toBe("large");
    expect(cloudModelTier("anthropic", "claude-sonnet-4-6")).toBe("large");
    expect(cloudModelTier("anthropic", "claude-haiku-5-5")).toBe("medium");
  });
});

describe("effective per-call timeout for the recommended generation model", () => {
  it("gives OpenAI's recommended generation model the full 90s, not the halved cloud budget", () => {
    const model = defaultGenerationModel("openai");
    expect(effectivePerCallTimeoutMs("openai", cloudModelTier("openai", model), model)).toBe(90_000);
  });

  it("still halves Luna, older OpenAI models and Anthropic", () => {
    expect(effectivePerCallTimeoutMs("openai", "medium", "gpt-6-luna")).toBe(60_000);
    expect(effectivePerCallTimeoutMs("openai", "large", "gpt-5.4")).toBe(45_000);
    const anthropic = defaultGenerationModel("anthropic");
    expect(effectivePerCallTimeoutMs("anthropic", cloudModelTier("anthropic", anthropic), anthropic)).toBe(45_000);
  });
});

describe("every catalog model", () => {
  const all = (provider: "openai" | "anthropic") => [...GENERATION_MODELS[provider], ...CHAT_MODELS[provider]].map((m) => m.id);

  it("every OpenAI GPT-6 chat id gets reasoning_effort none (Chat Completions tools need it)", () => {
    const gpt6Chat = CHAT_MODELS.openai.map((m) => m.id).filter((id) => id.startsWith("gpt-6"));
    expect(gpt6Chat).toContain(defaultChatModel("openai"));
    for (const id of gpt6Chat) expect(openAIRequestFields(id, 0.2)).toEqual({ reasoning_effort: "none" });
  });

  it("no OpenAI GPT-6 id is sent a temperature", () => {
    for (const id of all("openai").filter((i) => i.startsWith("gpt-6"))) {
      expect(openAIRequestFields(id, 0.2)).not.toHaveProperty("temperature");
    }
  });

  it("no Anthropic id is from a family that rejects forced tool_choice", () => {
    for (const id of all("anthropic")) {
      expect(id).not.toMatch(/^claude-(?:opus-5-5|sonnet-5-5|fable-5)/);
    }
  });
});
