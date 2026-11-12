import { describe, it, expect } from "vitest";
import { ollamaState, ollamaGuidance, platformOf, isLoopbackUrl, isImportTarget, type OllamaFacts } from "./ollama-guide";

const facts = (over: Partial<OllamaFacts> = {}): OllamaFacts => ({
  reachable: true, installed: true, models: ["gemma4:e2b"], chatModelInstalled: true, ...over,
});
const opts = { platform: "windows" as const, ollamaUrl: "http://127.0.0.1:11434" };

describe("ollamaState", () => {
  it("maps the facts to the four states", () => {
    expect(ollamaState(facts({ reachable: false, installed: false }))).toBe("not-installed");
    expect(ollamaState(facts({ reachable: false, installed: true }))).toBe("not-running");
    expect(ollamaState(facts({ models: [], chatModelInstalled: false }))).toBe("no-model");
    expect(ollamaState(facts())).toBe("ready");
  });

  // "Not installed" is advice to install software; only say it when the probe actually said so.
  it("an unknown install reads as not running, never as not installed", () => {
    expect(ollamaState(facts({ reachable: false, installed: null }))).toBe("not-running");
  });

  it("a reachable server is installed whatever the disk probe said", () => {
    expect(ollamaState(facts({ installed: false }))).toBe("ready");
  });
});

describe("ollamaGuidance", () => {
  it("not installed: find the installer on the stick, then check again", () => {
    const g = ollamaGuidance("not-installed", opts);
    expect(g.actions).toEqual(["find-installer", "recheck"]);
    expect(g.steps.join(" ")).toContain("OllamaSetup.exe");
    expect(g.body).toMatch(/can't install it for you/);
  });

  it("names the installer for each platform", () => {
    expect(ollamaGuidance("not-installed", { ...opts, platform: "mac" }).steps[1]).toContain("Ollama.dmg");
    expect(ollamaGuidance("not-installed", { ...opts, platform: "linux" }).steps[1]).toContain("ollama-linux");
  });

  it("not running: how to start it on this platform, no terminal on Windows or Mac", () => {
    const win = ollamaGuidance("not-running", opts);
    expect(win.actions[0]).toBe("recheck");
    expect(win.steps[0]).toMatch(/Start menu/);
    expect(ollamaGuidance("not-running", { ...opts, platform: "mac" }).steps[0]).toMatch(/Applications/);
    for (const p of ["windows", "mac"] as const) {
      expect(ollamaGuidance("not-running", { ...opts, platform: p }).steps.join(" ")).not.toMatch(/terminal|serve/);
    }
    expect(ollamaGuidance("not-running", { ...opts, platform: "linux" }).steps[0]).toMatch(/ollama serve/);
  });

  it("an Ollama on another computer gets no install advice", () => {
    const g = ollamaGuidance("not-installed", { ...opts, ollamaUrl: "http://192.168.1.20:11434" });
    expect(g.state).toBe("not-running");
    expect(g.actions).toEqual(["recheck"]);
    expect(g.body).toContain("192.168.1.20");
  });

  // A custom port is still this computer: the install and start advice applies, and nothing calls it remote.
  it("this computer on another port is still this computer", () => {
    for (const url of ["http://localhost", "http://127.0.0.1:8080"]) {
      const g = ollamaGuidance("not-running", { ...opts, ollamaUrl: url });
      expect(g.title, url).toBe("Ollama is installed but not running");
      expect(g.body, url).not.toMatch(/another computer/);
    }
  });

  it("every state ends in at least one action and a step", () => {
    for (const s of ["not-installed", "not-running"] as const) {
      const g = ollamaGuidance(s, opts);
      expect(g.actions.length, s).toBeGreaterThan(0);
      expect(g.steps.length, s).toBeGreaterThan(0);
    }
  });
});

describe("helpers", () => {
  it("platformOf", () => {
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/131")).toBe("windows");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("mac");
    expect(platformOf("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("isLoopbackUrl: this computer on any port", () => {
    for (const u of ["http://127.0.0.1:11434", "http://localhost:11434/", "http://[::1]:11434", "http://127.0.0.1", "http://localhost:8080"]) {
      expect(isLoopbackUrl(u), u).toBe(true);
    }
    for (const u of ["http://192.168.1.2:11434", "http://127.0.0.1.evil.com:11434", "not a url"]) expect(isLoopbackUrl(u), u).toBe(false);
  });

  // The importer only ever sends to 127.0.0.1:11434; a URL with no port is port 80, not 11434.
  it("isImportTarget: this computer on Ollama's port, over http, only", () => {
    for (const u of ["http://127.0.0.1:11434", "http://localhost:11434/", "http://[::1]:11434"]) expect(isImportTarget(u), u).toBe(true);
    for (const u of ["http://127.0.0.1", "http://localhost", "http://127.0.0.1:8080", "https://127.0.0.1:11434", "http://192.168.1.2:11434", "nope"]) {
      expect(isImportTarget(u), u).toBe(false);
    }
  });
});
