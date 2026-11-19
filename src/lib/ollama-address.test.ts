import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import capsRaw from "../../src-tauri/capabilities/default.json?raw";

// An Ollama address the http allow-list refuses (this computer on another port, or another computer).
// The real plugin rejects the fetch with "url not allowed on the configured scope: …", which Settings showed
// word for word with "Install from ollama.com" under it (TerraTutor's click test 2026-11-19, :11435; ported
// from TerraTutor #247). Through the functions the app calls: getOllamaModels (Settings, the setup check), a
// chat turn (callLLMTurn -> friendlyError), evaluateSetup (the setup screen) and ollamaGuidance.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMTurn, getOllamaModels, type NeutralMessage } from "./llm";
import { friendlyError, ollamaUnavailable } from "./plain-language";
import { evaluateSetup } from "./setup-check";
import { OLLAMA_ADDRESS_NOT_ALLOWED, ollamaAddressAllowed, ollamaGuidance } from "./ollama-guide";
import type { LLMConfig } from "../types";

const WRONG = "http://127.0.0.1:11435";
const original = globalThis.fetch;
let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  globalThis.fetch = ((url: unknown) => {
    fetched.push(String(url));
    return Promise.reject(`url not allowed on the configured scope: ${String(url)}`);
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = original; });

describe("an Ollama address the app may not use", () => {
  it("allows exactly the Ollama addresses on OpenEdu's http allow-list", () => {
    const caps = JSON.parse(capsRaw) as { permissions: Array<string | { identifier: string; allow?: Array<{ url: string }> }> };
    const ollama = caps.permissions
      .flatMap((p) => (typeof p === "object" && p.identifier === "http:allow-fetch" ? p.allow ?? [] : []))
      .map((a) => a.url)
      .filter((u) => u.includes(":11434"));
    expect(ollama.sort()).toEqual(["http://127.0.0.1:11434/**", "http://localhost:11434/**"]);
    for (const ok of ["http://127.0.0.1:11434", "http://localhost:11434", "http://localhost:11434/"]) expect(ollamaAddressAllowed(ok), ok).toBe(true);
    for (const no of [WRONG, "http://127.0.0.1", "https://127.0.0.1:11434", "http://[::1]:11434", "http://192.168.1.20:11434", "not a url"]) {
      expect(ollamaAddressAllowed(no), no).toBe(false);
    }
  });

  it("Settings' probe says what to fix in plain words", async () => {
    const tags = await getOllamaModels(WRONG);
    expect(fetched).toEqual([`${WRONG}/api/tags`]);
    expect(tags).toEqual({ models: [], error: OLLAMA_ADDRESS_NOT_ALLOWED });
  });

  it("a chat turn says the same, not that Ollama isn't running", async () => {
    const USER: NeutralMessage[] = [{ role: "user", content: "hi" }];
    let err: unknown;
    try {
      for await (const ev of callLLMTurn(USER, { provider: "ollama", model: "gemma4:e2b", ollamaUrl: WRONG } as LLMConfig)) void ev;
    } catch (e) { err = e; }
    expect(friendlyError(err)).toBe(OLLAMA_ADDRESS_NOT_ALLOWED);
    expect(ollamaUnavailable(err)).toBe(true);
    // Another computer is refused the same way.
    err = undefined;
    try {
      for await (const ev of callLLMTurn(USER, { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://192.168.1.20:11434" } as LLMConfig)) void ev;
    } catch (e) { err = e; }
    expect(friendlyError(err)).toBe(OLLAMA_ADDRESS_NOT_ALLOWED);
  });

  it("the setup check and its guide point to the address, not to installing Ollama", async () => {
    const tags = await getOllamaModels(WRONG);
    const status = evaluateSetup({
      provider: "ollama", ollamaReachable: !tags.error, ollamaError: tags.error, ollamaInstalled: true, installed: [],
      chatModel: "gemma4:e2b", embedProvider: "ollama", embedModel: "nomic-embed-text",
    });
    const check = status.checks.find((c) => c.id === "ollama")!;
    expect(check.detail).toBe(OLLAMA_ADDRESS_NOT_ALLOWED);
    expect(check.fix).toEqual({ label: "Open Settings", kind: "open-settings" });
    const guide = ollamaGuidance("not-running", { platform: "windows", ollamaUrl: WRONG });
    expect(guide.title).toBe("Ollama's address needs changing");
    expect(guide.actions).toEqual(["recheck"]);
    expect([guide.body, ...guide.steps].join(" ")).toContain("http://127.0.0.1:11434");
    expect([guide.body, ...guide.steps].join(" ")).not.toMatch(/install|Start menu|ollama\.com/i);
  });
});
