// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Settings › Provider & Models, rendered for real over a stand-in store.ts: saving a model or the Ollama
// URL runs App's setup check again (onProviderChanged → App's recheckSetup), so someone who fixes the
// tutor model here loses "Tutor model missing" at once, not after a relaunch (port of TerraTutor #243).

const order: string[] = [];
const store = vi.hoisted(() => ({
  getLLMProvider: vi.fn(),
  setLLMProvider: vi.fn(),
  setGenerationModel: vi.fn(),
  setChatModel: vi.fn(),
  setApiKey: vi.fn(),
  setOllamaUrl: vi.fn(),
  getApiKey: vi.fn(),
  getGenerationConfig: vi.fn(),
  getChatConfig: vi.fn(),
  getEmbeddingConfig: vi.fn(),
  setEmbeddingModel: vi.fn(),
  getMaxContextTokens: vi.fn(),
  setMaxContextTokens: vi.fn(),
  CONTEXT_TOKEN_CHOICES: [2048, 4096, 8192, 16384] as const,
  getCloudNoticesSeen: vi.fn(),
  markCloudNoticeSeen: vi.fn(),
  systemMemoryBytes: vi.fn(),
}));
vi.mock("../../lib/store", () => store);
vi.mock("../../lib/llm", () => ({ getOllamaModels: vi.fn(async () => ({ models: ["gemma4:e2b"] })), callLLM: vi.fn() }));
vi.mock("./ReviewModelPicker", () => ({ default: () => null }));
vi.mock("./LessonsNote", () => ({ default: () => null }));
vi.mock("../../components/ModelImport", () => ({ default: () => null }));

import ProviderModels from "./sections/ProviderModels";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const recheck = vi.fn(() => { order.push("recheck"); });

beforeEach(async () => {
  vi.clearAllMocks();
  order.length = 0;
  store.getLLMProvider.mockResolvedValue({ provider: "ollama", ollamaUrl: "http://127.0.0.1:11434" });
  store.getGenerationConfig.mockResolvedValue({ provider: "ollama", model: "nosuch-model:1" });
  store.getChatConfig.mockResolvedValue({ provider: "ollama", model: "nosuch-model:1" });
  store.getEmbeddingConfig.mockResolvedValue({ provider: "ollama", model: "nomic-embed-text" });
  store.getMaxContextTokens.mockResolvedValue(8192);
  store.getCloudNoticesSeen.mockResolvedValue([]);
  store.systemMemoryBytes.mockResolvedValue(null);
  store.getApiKey.mockResolvedValue("");
  for (const save of [store.setChatModel, store.setGenerationModel, store.setEmbeddingModel, store.setOllamaUrl]) {
    save.mockImplementation(async () => { order.push("save"); });
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(ProviderModels, { onProviderChanged: recheck })); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
// A SettingRow is its label's div, inside a div, inside the row (primitives.tsx).
const rowOf = (label: string) => [...host.querySelectorAll("div.text-sm.font-medium")].find((e) => e.textContent === label)!.parentElement!.parentElement!;
const chip = (label: string) => [...rowOf(label).querySelectorAll("button")].find((b) => b.textContent === "gemma4:e2b")!;

describe("saving in Provider & Models runs the setup check again", () => {
  it("after the tutor chat model is saved", async () => {
    await act(async () => { click(chip("Tutor chat model")); });
    expect(store.setChatModel).toHaveBeenCalledWith("gemma4:e2b", "ollama");
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["save", "recheck"]);
  });

  it("after the course model is saved", async () => {
    await act(async () => { click(chip("Course generation model")); });
    expect(store.setGenerationModel).toHaveBeenCalledWith("gemma4:e2b", "ollama");
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["save", "recheck"]);
  });

  it("after the notebook's embedding model is saved", async () => {
    const box = rowOf("Embedding model (Notebook)").querySelector("input")!;
    await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(store.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
    expect(order).toEqual(["save", "recheck"]);
  });

  it("after Save & Check on the Ollama URL", async () => {
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save & Check")!;
    await act(async () => { click(save); });
    expect(store.setOllamaUrl).toHaveBeenCalledWith("http://127.0.0.1:11434");
    expect(order).toEqual(["save", "recheck"]);
  });

  it("not when nothing was saved", () => {
    expect(recheck).not.toHaveBeenCalled();
  });
});
