import { describe, it, expect } from "vitest";
import {
  cloudNotice, isOllamaCloudModel, needsCloudNotice, modelNeedsCloudNotice, withNoticeSeen, parseNoticesSeen,
  needsCheckingNotice, checkingNoticeMark,
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

// Port of TerraTutor #243 (its click test #186): picking a cloud Checking model showed the provider's
// confirm, "Before you switch to Anthropic", which says the learner's chats are sent. Only the checking
// goes there; the provider, and so the chat and the course model, stays as it was.
describe("the Checking model's confirm", () => {
  it("says what a cloud Checking model is sent, and that the chat and courses stay where they were", () => {
    for (const [f, to] of [["openai", "OpenAI"], ["anthropic", "Anthropic"], ["ollama-cloud", "Ollama's servers"]] as const) {
      const n = cloudNotice(f, "checking");
      expect(n.title, f).toContain("check with");
      expect(n.title, f).not.toContain("switch to");
      expect(n.body, f).toContain("the course topic as the learner typed it and the text the course model wrote");
      expect(n.body, f).toContain("each new lesson, its Raise hand help and each set of quiz or test questions");
      expect(n.body, f).toContain("Courses and the tutor chat still use the models you picked above.");
      expect(n.body, f).toContain(`What the learner types, quiz answers and notes are never sent to ${to} for this.`);
      expect(n.body, f).toContain("not ours");
      expect(n.body, f).toContain("rules about use by children");
      expect(n.cancel, f).toBe("Not now");
    }
    expect(cloudNotice("anthropic", "checking").body).toContain("under your key");
    expect(cloudNotice("anthropic", "checking").confirm).toBe("Check with Anthropic");
    expect(cloudNotice("ollama-cloud", "checking").body).not.toContain("under your key");
    expect(cloudNotice("ollama-cloud", "checking").confirm).toBe("Use this cloud model");
    // The chat confirm keeps its own words.
    expect(cloudNotice("anthropic", "chat")).toEqual(cloudNotice("anthropic"));
    expect(cloudNotice("anthropic").title).toBe("Before you switch to Anthropic");
  });

  it("leaves its own mark, which never stands in for the chat confirm", () => {
    expect(checkingNoticeMark("anthropic")).toBe("checking:anthropic");
    const seen = withNoticeSeen([], checkingNoticeMark("anthropic"));
    expect(needsCheckingNotice("anthropic", seen)).toBe(false);
    // Picking Anthropic as the provider later still asks: that confirm says the chats are sent.
    expect(needsCloudNotice("anthropic", seen)).toBe(true);
    expect(needsCheckingNotice("openai", seen)).toBe(true);
    const ollama = withNoticeSeen([], checkingNoticeMark("ollama-cloud"));
    expect(needsCheckingNotice("ollama-cloud", ollama)).toBe(false);
    expect(modelNeedsCloudNotice("ollama", "gpt-oss:120b-cloud", ollama)).toBe(true);
  });

  it("is not needed once the chat confirm, which covers more, was accepted", () => {
    expect(needsCheckingNotice("anthropic", ["anthropic"])).toBe(false);
    expect(needsCheckingNotice("ollama-cloud", ["ollama-cloud"])).toBe(false);
    expect(needsCheckingNotice("anthropic", [])).toBe(true);
  });
});
