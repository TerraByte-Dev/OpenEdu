// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resetStores, seedStore } from "../../lib/eval/headless/shims/plugin-store";
import { STORE_FILE, STORE_KEYS } from "../../lib/store-keys";

// Settings › About, rendered for real over the in-memory store: the Version row shows the identifier the
// build runs under, as Tauri reports it, so a dev build started with another identifier says which data
// folder it uses. Port of TerraTutor #256 (its click test 2026-11-19, issue 7).

vi.mock("@tauri-apps/plugin-store", () => import("../../lib/eval/headless/shims/plugin-store"));
// No Ollama here: the About page's diagnostics probe gets an empty list.
vi.mock("../../lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm")>()),
  getOllamaModels: vi.fn(async () => ({ models: [] })),
  detectModelTier: vi.fn(async () => undefined),
  detectModelProfile: vi.fn(async () => ({ tier: "tiny", contextTokens: 8192, supportsTools: false })),
}));
vi.mock("../../lib/library", () => ({ getManifest: vi.fn(async () => []) }));
const app = vi.hoisted(() => ({
  getVersion: vi.fn(async () => "0.1.0"),
  getIdentifier: vi.fn(async () => "com.terrabytesolutions.openedu.dev"),
}));
vi.mock("@tauri-apps/api/app", () => app);

import About from "./sections/About";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetStores();
  seedStore(STORE_FILE, { [STORE_KEYS.provider]: "ollama" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Settings › About: the Version row", () => {
  it("shows the identifier this build runs under", async () => {
    await act(async () => { root.render(createElement(About, {})); });
    await vi.waitFor(() => expect(host.textContent).toContain("Identifier: com.terrabytesolutions.openedu.dev"));
  });

  it("shows the shipped identifier when the runtime one can't be read", async () => {
    app.getIdentifier.mockRejectedValueOnce(new Error("no Tauri"));
    await act(async () => { root.render(createElement(About, {})); });
    // The diagnostics take several awaits; once they show, the rejected identifier probe has settled.
    await vi.waitFor(() => expect(host.textContent).toContain("Database"));
    expect(host.textContent).toContain("Identifier: com.terrabytesolutions.openedu");
    expect(host.textContent).not.toContain("openedu.dev");
  });
});
