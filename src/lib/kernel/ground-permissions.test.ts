import { describe, it, expect, vi, beforeEach } from "vitest";

// The grounding stage (ground()) through its production path, with the corpora stubbed: "Search your
// notebook" and "Search the library" set to Deny in Settings › Tutor Permissions keep that half out of
// the automatic search before each reply, not only out of the tool list. Ask and Allow let it run.
// Ported from TerraTutor #202.
vi.mock("../permissions/store", () => ({ loadPermissionRules: vi.fn() }));
vi.mock("../notebook", () => ({ searchNotebook: vi.fn() }));
vi.mock("../store", () => ({ getLibraryEnabled: vi.fn(async () => true) }));
vi.mock("../library", () => ({
  isLibraryAvailable: () => true,
  getManifest: vi.fn(async () => [{ id: "fractions", title: "Fractions" }]),
  matchResourcesScored: vi.fn(() => [{ entry: { id: "fractions", title: "Fractions" }, score: 50 }]),
  fetchResource: vi.fn(async () => ({ text: "A fraction names part of a whole: the bottom number says how many equal parts.", url: "" })),
}));

import { ground } from "./ground";
import { budgetFor } from "./budget";
import { citationNote } from "./citation";
import { loadPermissionRules } from "../permissions/store";
import { searchNotebook } from "../notebook";
import { getManifest } from "../library";
import { DEFAULT_PERMISSION_RULES, type PermissionDecision, type PermissionRules } from "../permissions/rules";
import type { ToolContext } from "../tools/EduTool";
import type { LLMConfig } from "../../types";

const ctx = {
  courseId: "c1",
  level: 1,
  syllabus: null,
  modelTier: "tiny",
  config: { provider: "ollama", model: "test" } as LLMConfig,
  permissionMode: "default",
  abort: new AbortController().signal,
} as ToolContext;

const QUESTION = "what does the bottom number of a fraction mean";
const NOTE = { chunk_id: "k1", document_id: "d1", document_title: "My fraction notes", ord: 0, text: "The denominator is the bottom number of a fraction.", score: 0.9 };

const withRules = (decisions: Record<string, PermissionDecision>): PermissionRules => {
  const rules: PermissionRules = { ...DEFAULT_PERMISSION_RULES };
  for (const [tool, decision] of Object.entries(decisions)) rules[tool] = { ...DEFAULT_PERMISSION_RULES[tool], default: decision };
  return rules;
};

beforeEach(() => {
  vi.mocked(searchNotebook).mockReset();
  vi.mocked(searchNotebook).mockResolvedValue([NOTE]);
  vi.mocked(getManifest).mockClear();
  vi.mocked(loadPermissionRules).mockResolvedValue({ ...DEFAULT_PERMISSION_RULES });
});

const sources = (g: Awaited<ReturnType<typeof ground>>) => g.hits.map((h) => h.source).sort();

describe("ground(): the permission rules reach the automatic search", () => {
  it("searches the notes and the library under the default rules", async () => {
    const g = await ground(QUESTION, ctx, budgetFor(8192));
    expect(searchNotebook).toHaveBeenCalled();
    expect(sources(g)).toEqual(["library", "note"]);
    expect(g.block).toContain("My fraction notes");
    expect(g.trace.notesSearched).toBe(true);
  });

  it("never reads the notes when Search your notebook is Deny, and the chip doesn't claim them", async () => {
    vi.mocked(loadPermissionRules).mockResolvedValue(withRules({ "notebook.search": "deny" }));
    const g = await ground(QUESTION, ctx, budgetFor(8192));
    expect(searchNotebook).not.toHaveBeenCalled();
    expect(sources(g)).toEqual(["library"]);
    expect(g.block).not.toContain("My fraction notes");
    expect(g.trace).toMatchObject({ noteCandidates: 0, notesSearched: false });
    expect(citationNote(g.hits, [], g.trace)).toEqual({ kind: "ungrounded", label: "No passage quoted — the library was searched" });
  });

  it("never searches the library when Search the library is Deny", async () => {
    vi.mocked(loadPermissionRules).mockResolvedValue(withRules({ "library.search": "deny" }));
    const g = await ground(QUESTION, ctx, budgetFor(8192));
    expect(getManifest).not.toHaveBeenCalled();
    expect(sources(g)).toEqual(["note"]);
  });

  it("keeps both halves out of a glossed (non-English) question's search too", async () => {
    vi.mocked(loadPermissionRules).mockResolvedValue(withRules({ "notebook.search": "deny", "library.search": "deny" }));
    const g = await ground("分数の下の数字は何ですか", ctx, budgetFor(8192), "always", QUESTION);
    expect(searchNotebook).not.toHaveBeenCalled();
    expect(getManifest).not.toHaveBeenCalled();
    expect(g.hits).toEqual([]);
    expect(g.trace.notesSearched).toBe(false);
  });

  it("searches both halves of a glossed question under the default rules", async () => {
    const g = await ground("分数の下の数字は何ですか", ctx, budgetFor(8192), "always", QUESTION);
    expect(searchNotebook).toHaveBeenCalledTimes(2); // the question and its gloss
    expect(sources(g)).toEqual(["library", "note"]);
    expect(g.trace.notesSearched).toBe(true);
  });

  it("runs on Ask: a search before every reply cannot stop to ask (the Settings row says so)", async () => {
    vi.mocked(loadPermissionRules).mockResolvedValue(withRules({ "notebook.search": "ask", "library.search": "ask" }));
    const g = await ground(QUESTION, ctx, budgetFor(8192));
    expect(sources(g)).toEqual(["library", "note"]);
  });
});
