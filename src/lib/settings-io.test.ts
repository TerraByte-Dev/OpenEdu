import { describe, it, expect, vi, beforeEach } from "vitest";

// A settings file goes through the same calls Settings › About makes (parseSettingsFile, then
// applyImportedSettings; gatherSettings for an export) into the same store the model getters read. The
// Tauri store is one in-memory map, and the RAM command, Ollama, the permission store and the theme are
// stubbed.
const saved = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: async () => ({
      get: async (k: string) => saved.get(k),
      set: async (k: string, v: unknown) => { saved.set(k, v); },
      delete: async (k: string) => saved.delete(k),
      entries: async () => [...saved.entries()],
      save: vi.fn(),
    }),
  },
}));
const GiB = 1024 ** 3;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 8 * GiB) }));
vi.mock("./llm", () => ({
  getOllamaModels: vi.fn(async () => ({ models: ["gemma4:e2b"] })),
  detectModelProfile: vi.fn(async () => ({ tier: "small", contextTokens: 131072, supportsTools: true })),
}));
vi.mock("./permissions", () => ({ loadPermissionRules: vi.fn(async () => ({})), savePermissionRules: vi.fn() }));
vi.mock("./theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./theme")>()), applyTheme: vi.fn(), getThemeChoice: () => "light",
}));

import { applyImportedSettings, gatherSettings, parseSettingsFile, serializeSettings } from "./settings-io";
import { getChatConfig, getGenerationConfig, setChatModel, setGenerationModel, setLLMProvider } from "./store";
import { defaultChatModel, defaultGenerationModel } from "./models";
import { EXPORT_KIND } from "./settings-schema";

// A file as an OpenEdu version before per-provider model keys wrote it.
const oldFile = (settings: Record<string, unknown>) =>
  parseSettingsFile(JSON.stringify({ kind: EXPORT_KIND, version: 1, exportedAt: "2026-11-01T00:00:00Z", theme: "light", settings, permissions: {} }));

beforeEach(() => saved.clear());

describe("importing a settings file written before per-provider model keys", () => {
  it("moves the Ollama picks to Ollama, over this install's own, and never writes the old keys", async () => {
    saved.set("gen_model_ollama", "gemma4:e2b");
    await applyImportedSettings(oldFile({ llm_provider: "anthropic", gen_model: "qwen3.5:0.8b", chat_model: "gemma4:e4b" }));
    expect(saved.has("gen_model")).toBe(false);
    expect(saved.has("chat_model")).toBe(false);
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: defaultGenerationModel("anthropic") });
    expect(await getChatConfig()).toMatchObject({ provider: "anthropic", model: defaultChatModel("anthropic") });
    await setLLMProvider("ollama");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "gemma4:e4b" });
  });

  it("keeps a cloud pick that is an exact catalog id on its provider", async () => {
    await applyImportedSettings(oldFile({ llm_provider: "anthropic", gen_model: "claude-sonnet-5-5", chat_model: "claude-haiku-5-5" }));
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(await getChatConfig()).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5" });
  });

  // Review 2 of #341: these imported bare names were sent to the cloud provider after a switch.
  for (const local of ["claude-3.7-sonnet-reasoning-gemma3-12b", "gpt-2", "o1-distill"]) {
    it(`a bare "${local}" is Ollama's and never reaches a cloud provider`, async () => {
      for (const cloud of ["anthropic", "openai"] as const) {
        saved.clear();
        await applyImportedSettings(oldFile({ llm_provider: cloud, gen_model: local, chat_model: local }));
        expect(await getGenerationConfig()).toMatchObject({ provider: cloud, model: defaultGenerationModel(cloud) });
        expect(await getChatConfig()).toMatchObject({ provider: cloud, model: defaultChatModel(cloud) });
        await setLLMProvider("ollama");
        expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: local });
        expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: local });
      }
    });
  }
});

describe("exporting and importing per-provider model picks", () => {
  it("every provider's own pick survives an export and an import into an empty install", async () => {
    await setGenerationModel("qwen3.5:0.8b", "ollama");
    await setChatModel("qwen3.5:0.8b", "ollama");
    await setGenerationModel("claude-sonnet-5-5", "anthropic");
    await setGenerationModel("gpt-6-luna", "openai");
    await setLLMProvider("anthropic");
    const file = serializeSettings(await gatherSettings(false));
    saved.clear();
    await applyImportedSettings(parseSettingsFile(file));
    expect(await getGenerationConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    await setLLMProvider("openai");
    expect(await getGenerationConfig()).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
    await setLLMProvider("ollama");
    expect(await getGenerationConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
    expect(await getChatConfig()).toMatchObject({ provider: "ollama", model: "qwen3.5:0.8b" });
  });

  it("an import never writes a model key for a provider that does not exist", async () => {
    await applyImportedSettings(oldFile({ gen_model_gemini: "gemini-3", chat_model_constructor: "x" }));
    expect([...saved.keys()]).toEqual([]);
  });
});
