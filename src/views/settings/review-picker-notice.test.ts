// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Settings › Models › Checking model, rendered for real over a stand-in store.ts. Picking a cloud model
// there showed the provider's confirm, "Before you switch to Anthropic", which says the learner's chats
// are sent. Only the checking goes there, so the confirm says that, and accepting it leaves its own mark,
// so a later switch of the provider still asks (port of TerraTutor #243).

const store = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  getCloudNoticesSeen: vi.fn(),
  getLLMProvider: vi.fn(),
  getReviewModel: vi.fn(),
  markCloudNoticeSeen: vi.fn(),
  setReviewModel: vi.fn(),
}));
vi.mock("../../lib/store", () => store);
vi.mock("../../lib/llm", () => ({ getOllamaModels: vi.fn(async () => ({ models: [] })) }));

import ReviewModelPicker from "./ReviewModelPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  store.getApiKey.mockImplementation(async (p: string) => (p === "anthropic" ? "key" : ""));
  store.getCloudNoticesSeen.mockResolvedValue([]);
  store.getLLMProvider.mockResolvedValue({ provider: "ollama", ollamaUrl: "http://127.0.0.1:11434" });
  store.getReviewModel.mockResolvedValue("");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = async (b: Element) => { await act(async () => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

const pickHaiku = async () => {
  await act(async () => { root.render(createElement(ReviewModelPicker, { provider: "ollama", discovered: ["gemma4:e2b"] })); });
  await click(button("Claude Haiku 5.5"));
  return host.textContent ?? "";
};

describe("the Checking model's cloud confirm", () => {
  it("says only the checking goes to the company, and the chat and courses stay where they were", async () => {
    const text = await pickHaiku();
    expect(text).toContain("Before you check with Anthropic");
    expect(text).not.toContain("Before you switch to Anthropic");
    expect(text).toContain("It is sent the course topic as the learner typed it and the text the course model wrote");
    expect(text).toContain("Courses and the tutor chat still use the models you picked above.");
    expect(text).toContain("What the learner types, quiz answers and notes are never sent to Anthropic for this.");
    expect(store.setReviewModel).not.toHaveBeenCalled();
  });

  it("on Check with Anthropic, leaves the Checking mark, not the provider's, then saves", async () => {
    await pickHaiku();
    await click(button("Check with Anthropic"));
    expect(store.markCloudNoticeSeen).toHaveBeenCalledWith("checking:anthropic");
    expect(store.markCloudNoticeSeen).not.toHaveBeenCalledWith("anthropic");
    expect(store.setReviewModel).toHaveBeenCalledWith("anthropic:claude-haiku-5-5");
  });

  it("asks nothing when Anthropic was already confirmed as the provider", async () => {
    store.getCloudNoticesSeen.mockResolvedValue(["anthropic"]);
    const text = await pickHaiku();
    expect(text).not.toContain("Before you check with Anthropic");
    expect(store.setReviewModel).toHaveBeenCalledWith("anthropic:claude-haiku-5-5");
  });
});
