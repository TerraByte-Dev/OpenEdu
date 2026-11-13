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

  // #275: the four Ollama states the setup guide is written for.
  it("reports the Ollama state for the guide", () => {
    expect(evaluateSetup(facts({ ollamaReachable: false, ollamaInstalled: false, installed: [] })).ollama).toBe("not-installed");
    expect(evaluateSetup(facts({ ollamaReachable: false, ollamaInstalled: true, installed: [] })).ollama).toBe("not-running");
    expect(evaluateSetup(facts({ ollamaReachable: false, installed: [] })).ollama).toBe("not-running");
    expect(evaluateSetup(facts({ installed: [] })).ollama).toBe("no-model");
    expect(evaluateSetup(facts()).ollama).toBe("ready");
    expect(evaluateSetup(facts({ provider: "openai" })).ollama).toBeUndefined();
  });

  it("says Ollama is not installed only when the probe found no program", () => {
    const s = evaluateSetup(facts({ ollamaReachable: false, ollamaInstalled: false, ollamaError: "Connection refused", installed: [] }));
    expect(s.checks[0].detail).toMatch(/not installed on this computer/i);
    expect(s.ready).toBe(false);
  });

  // A model imported under its own name sets the chat model; course building still pointed at a
  // gemma4 default this computer doesn't have, so setup said ready and Create course failed.
  it("blocks when the course-building model is not installed, even with the chat model there", () => {
    const s = evaluateSetup(facts({ installed: ["tutor-kit:latest"], chatModel: "tutor-kit", generationModel: "gemma4:e2b" }));
    const gen = s.checks.find((c) => c.id === "gen-model");
    expect(gen?.severity).toBe("blocking");
    expect(gen?.detail).toMatch(/builds new courses/);
    expect(gen?.fix).toEqual({ label: "Download gemma4:e2b", kind: "download-model", arg: "gemma4:e2b" });
    expect(s.ready).toBe(false);
  });

  it("does not add a course-builder check when it is the chat model or is installed", () => {
    expect(evaluateSetup(facts({ generationModel: "gemma3:1b" })).checks.some((c) => c.id === "gen-model")).toBe(false);
    expect(evaluateSetup(facts({ generationModel: "GEMMA3:1b " })).checks.some((c) => c.id === "gen-model")).toBe(false);
    expect(evaluateSetup(facts({ installed: ["gemma3:1b", "llama3:8b", "nomic-embed-text:latest"], generationModel: "llama3:8b" })).ready).toBe(true);
  });

  it("offers no Download button with no network, and says a download needs the internet", () => {
    const s = evaluateSetup(facts({ installed: [], online: false }));
    for (const c of s.checks.filter((c) => c.severity !== "ok")) {
      expect(c.fix?.kind, c.id).not.toBe("download-model");
      expect(c.detail, c.id).toMatch(/needs the internet/);
    }
    // Online (or unknown), the downloads are offered as before.
    expect(evaluateSetup(facts({ installed: [] })).checks.find((c) => c.id === "chat-model")?.fix?.kind).toBe("download-model");
  });

  it("offline, a missing course builder points at Settings instead of a download", () => {
    const s = evaluateSetup(facts({ installed: ["tutor-kit:latest"], chatModel: "tutor-kit", generationModel: "gemma4:e2b", online: false }));
    expect(s.checks.find((c) => c.id === "gen-model")?.fix).toEqual({ label: "Open Settings", kind: "open-settings" });
  });
});
