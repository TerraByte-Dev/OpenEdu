import { describe, it, expect } from "vitest";
import {
  cloudNotice, isOllamaCloudModel, needsCloudNotice, modelNeedsCloudNotice, withNoticeSeen, parseNoticesSeen,
} from "./privacy";
import { ALLOWED_IMPORT_KEYS, STORE_KEYS } from "./store-keys";

describe("isOllamaCloudModel", () => {
  it("is true for a name ending in cloud, tag or not, any case", () => {
    for (const m of ["gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "foo:cloud", "FOO-CLOUD", " kimi-k2:cloud "]) {
      expect(isOllamaCloudModel(m), m).toBe(true);
    }
  });

  it("is false for a local model, even one with cloud elsewhere in its name", () => {
    for (const m of ["gemma4:e4b", "cloudy-model:7b", "my-cloud-notes:latest", "qwen3.5:0.8b", ""]) {
      expect(isOllamaCloudModel(m), m).toBe(false);
    }
  });
});

describe("cloudNotice", () => {
  it("names the company, what goes to it and whose terms apply", () => {
    for (const [f, company] of [["openai", "OpenAI"], ["anthropic", "Anthropic"]] as const) {
      const n = cloudNotice(f);
      expect(n.title).toContain(company);
      expect(n.body).toContain(`sent to ${company} under your key`);
      expect(n.body).toContain("what the learner types");
      expect(n.body).toContain("the notes the tutor reads");
      expect(n.body).toContain("not ours");
      expect(n.confirm).toBe(`Use ${company}`);
      expect(n.cancel).toBe("Not now");
    }
  });

  it("tells a parent an Ollama cloud model sends chats to Ollama's servers", () => {
    const n = cloudNotice("ollama-cloud");
    expect(n.title).toBe("Before you use an Ollama cloud model");
    expect(n.body).toContain("doesn't run on this computer");
    expect(n.body).toContain("to Ollama's servers");
    expect(n.body).toContain("what the learner types");
    expect(n.body).toContain("the notes the tutor reads");
    expect(n.body).toContain("not ours");
    expect(n.body).not.toContain("under your key");
    expect(n.confirm).toBe("Use this cloud model");
  });
});

describe("the one-time confirm", () => {
  it("is needed the first time each cloud provider is chosen, never for Ollama", () => {
    expect(needsCloudNotice("ollama", [])).toBe(false);
    expect(needsCloudNotice("openai", [])).toBe(true);
    expect(needsCloudNotice("openai", ["openai"])).toBe(false);
    expect(needsCloudNotice("anthropic", ["openai"])).toBe(true);
    expect(needsCloudNotice("anthropic", ["anthropic"])).toBe(false);
  });

  it("is needed for the first Ollama cloud model, for chat or generation, and never for a local one", () => {
    for (const model of ["gpt-oss:120b-cloud", "foo:cloud", "FOO-CLOUD"]) {
      expect(modelNeedsCloudNotice("ollama", model, []), model).toBe(true);
      // Confirming OpenAI or Anthropic says nothing about Ollama's servers.
      expect(modelNeedsCloudNotice("ollama", model, ["openai", "anthropic"]), model).toBe(true);
      expect(modelNeedsCloudNotice("ollama", model, ["ollama-cloud"]), model).toBe(false);
    }
    for (const model of ["gemma4:e4b", "cloudy-model:7b"]) {
      expect(modelNeedsCloudNotice("ollama", model, []), model).toBe(false);
    }
    // OpenAI and Anthropic models are covered by their provider's own confirm.
    expect(modelNeedsCloudNotice("openai", "x-cloud", [])).toBe(false);
    expect(modelNeedsCloudNotice("anthropic", "x-cloud", [])).toBe(false);
  });

  it("is remembered once per provider or kind and survives a bad stored value", () => {
    expect(withNoticeSeen([], "openai")).toEqual(["openai"]);
    expect(withNoticeSeen(["openai"], "openai")).toEqual(["openai"]);
    expect(withNoticeSeen(["openai"], "ollama-cloud")).toEqual(["openai", "ollama-cloud"]);
    expect(parseNoticesSeen(undefined)).toEqual([]);
    expect(parseNoticesSeen("openai")).toEqual([]);
    expect(parseNoticesSeen(["openai", 3, null, "ollama-cloud"])).toEqual(["openai", "ollama-cloud"]);
  });

  it("can't be marked as read by importing someone else's settings file", () => {
    expect(ALLOWED_IMPORT_KEYS.has(STORE_KEYS.cloudNoticesSeen)).toBe(false);
  });
});
