import { describe, it, expect } from "vitest";
import { evaluateSetup, modelIsInstalled } from "./setup-check";

const facts = (over: Partial<Parameters<typeof evaluateSetup>[0]> = {}) => ({
  provider: "ollama",
  ollamaReachable: true,
  installed: ["gemma3:1b", "nomic-embed-text:latest"],
  chatModel: "gemma3:1b",
  embedProvider: "ollama",
  embedModel: "nomic-embed-text",
  ...over,
});

describe("modelIsInstalled", () => {
  it("matches exactly", () => {
    expect(modelIsInstalled("gemma3:1b", ["gemma3:1b"])).toBe(true);
  });

  // A working install must not be told its model is missing over a tag suffix.
  it("matches a bare name against :latest", () => {
    expect(modelIsInstalled("nomic-embed-text", ["nomic-embed-text:latest"])).toBe(true);
    expect(modelIsInstalled("llama3", ["llama3:latest"])).toBe(true);
  });

  it("matches across differing tags of the same model", () => {
    expect(modelIsInstalled("gemma3:1b", ["gemma3:4b"])).toBe(true);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(modelIsInstalled(" Gemma3:1B ", ["gemma3:1b"])).toBe(true);
  });

  it("does not match a different model", () => {
    expect(modelIsInstalled("gemma3:1b", ["llama3:latest", "qwen2:7b"])).toBe(false);
  });

  it("is false for an empty configured name or empty install list", () => {
    expect(modelIsInstalled("", ["gemma3:1b"])).toBe(false);
    expect(modelIsInstalled("gemma3:1b", [])).toBe(false);
  });
});

describe("evaluateSetup", () => {
  it("reports ready and complete for a working local install", () => {
    const s = evaluateSetup(facts());
    expect(s.ready).toBe(true);
    expect(s.complete).toBe(true);
    expect(s.checks.every((c) => c.severity === "ok")).toBe(true);
  });

  it("skips every local check for a cloud provider", () => {
    const s = evaluateSetup(facts({ provider: "anthropic" }));
    expect(s.ready).toBe(true);
    expect(s.complete).toBe(true);
    expect(s.checks.map((c) => c.id)).toEqual(["provider"]);
  });

  // The lie this module exists to stop.
  it("says Ollama is NOT running when it is not", () => {
    const s = evaluateSetup(facts({ ollamaReachable: false, installed: [] }));
    const ollama = s.checks.find((c) => c.id === "ollama")!;
    expect(ollama.severity).toBe("blocking");
    expect(s.ready).toBe(false);
    expect(ollama.detail).toMatch(/not running/i);
  });

  it("surfaces the actual connection error rather than a generic one", () => {
    // A wrong URL and a stopped service are different problems with different fixes.
    const s = evaluateSetup(facts({ ollamaReachable: false, ollamaError: "ECONNREFUSED 127.0.0.1:11500", installed: [] }));
    expect(s.checks.find((c) => c.id === "ollama")!.detail).toContain("ECONNREFUSED");
  });

  it("does not ask about models when Ollama itself is down", () => {
    // Telling someone to download a model onto a server that is not running is noise.
    const s = evaluateSetup(facts({ ollamaReachable: false, installed: [] }));
    expect(s.checks.map((c) => c.id)).toEqual(["ollama"]);
  });

  it("blocks on a missing chat model and offers to download it", () => {
    const s = evaluateSetup(facts({ installed: ["nomic-embed-text:latest"] }));
    const chat = s.checks.find((c) => c.id === "chat-model")!;
    expect(chat.severity).toBe("blocking");
    expect(s.ready).toBe(false);
    expect(chat.fix).toEqual({ label: "Download gemma3:1b", kind: "download-model", arg: "gemma3:1b" });
  });

  // The judgement call: a missing embedder degrades grounding, it does not stop tutoring. Blocking
  // first run on a second large download turns a degraded feature into a closed door.
  it("treats a missing embedder as optional, not blocking", () => {
    const s = evaluateSetup(facts({ installed: ["gemma3:1b"] }));
    const embed = s.checks.find((c) => c.id === "embed-model")!;
    expect(embed.severity).toBe("optional");
    expect(s.ready).toBe(true);      // usable
    expect(s.complete).toBe(false);  // but honestly incomplete
    expect(embed.detail).toMatch(/still works/i);
  });

  it("skips the embedder check when embeddings are not local", () => {
    const s = evaluateSetup(facts({ embedProvider: "openai", installed: ["gemma3:1b"] }));
    expect(s.checks.some((c) => c.id === "embed-model")).toBe(false);
    expect(s.ready).toBe(true);
  });

  it("every non-ok check either offers a fix or explains why there is none", () => {
    for (const f of [facts({ ollamaReachable: false, installed: [] }), facts({ installed: [] })]) {
      for (const c of evaluateSetup(f).checks) {
        if (c.severity !== "ok") expect(c.detail.length, c.id).toBeGreaterThan(10);
      }
    }
  });
});
