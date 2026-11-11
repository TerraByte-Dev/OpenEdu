import { describe, it, expect } from "vitest";
import { anthropicRequestFields, cloudModelTier, openAIRequestFields } from "./llm";

// Issue #2: the catalog moved to models that reject fields llm.ts used to send to every model. These
// pin what each catalog model gets, so a catalog change that needs a new rule fails here, not as a 400.
describe("openAIRequestFields", () => {
  it("sends reasoning_effort none to GPT-6 Luna, which keeps temperature and Chat Completions tools legal", () => {
    expect(openAIRequestFields("gpt-6-luna", 0.2)).toEqual({ reasoning_effort: "none", temperature: 0.2 });
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
    for (const m of ["claude-haiku-5-5", "claude-opus-4-7", "claude-opus-5-5", "claude-sonnet-5"]) {
      expect(anthropicRequestFields(m, 0.2)).not.toHaveProperty("temperature");
    }
  });

  it("keeps temperature on earlier models", () => {
    for (const m of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-3-7-sonnet-20250219"]) {
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
