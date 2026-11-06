import { describe, it, expect, vi, beforeEach } from "vitest";

// store.ts resolves the default model through the Tauri store, the system_memory_bytes command and
// Ollama's tag list. Stub all three so the wiring (not just models.ts's pure pick) is exercised in node.
const saved = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: async () => ({ get: async (k: string) => saved.get(k), set: vi.fn(), save: vi.fn() }) },
}));
const GiB = 1024 ** 3;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 8 * GiB) }));
vi.mock("./llm", () => ({ getOllamaModels: vi.fn() }));

import { getChatConfig, getGenerationConfig } from "./store";
import { getOllamaModels } from "./llm";

describe("default model on an 8 GB machine", () => {
  beforeEach(() => {
    saved.clear();
    vi.mocked(getOllamaModels).mockReset();
  });

  it("an upgraded install with e4b pulled and no stored model keeps e4b", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: ["gemma4:e4b", "nomic-embed-text:latest"] });
    expect((await getChatConfig()).model).toBe("gemma4:e4b");
    expect((await getGenerationConfig()).model).toBe("gemma4:e4b");
  });

  it("a fresh install with nothing pulled gets e2b", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [] });
    expect((await getChatConfig()).model).toBe("gemma4:e2b");
  });

  it("Ollama down: the RAM pick stands", async () => {
    vi.mocked(getOllamaModels).mockResolvedValue({ models: [], error: "Connection refused" });
    expect((await getChatConfig()).model).toBe("gemma4:e2b");
  });

  it("a model chosen in Settings wins, and Ollama is not asked", async () => {
    saved.set("chat_model", "qwen3.5:0.8b");
    expect((await getChatConfig()).model).toBe("qwen3.5:0.8b");
    expect(getOllamaModels).not.toHaveBeenCalled();
  });

  it("a cloud provider never asks Ollama", async () => {
    saved.set("llm_provider", "openai");
    await getChatConfig();
    expect(getOllamaModels).not.toHaveBeenCalled();
  });
});
