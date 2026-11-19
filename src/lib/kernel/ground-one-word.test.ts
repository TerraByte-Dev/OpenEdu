import { describe, it, expect, vi } from "vitest";

// Port of TerraTutor #254 (its click test 2026-11-19, step 11): in a cells course a learner typed only
// "mitochondria" (or "igneous"). The ranker scored the right card over the floor, yet the reply showed "No
// passage quoted — your notes and the library were searched". Through ground()'s production path, with the
// shipped Library and the card bodies the app reads, this pins why: the card IS put in front of the model,
// and the chip only says the reply did not reuse six of its content words in a row (groundedIn), which a
// paraphrase of a table row never does.
vi.mock("../permissions/store", async () => {
  const { DEFAULT_PERMISSION_RULES } = await import("../permissions/rules");
  return { loadPermissionRules: vi.fn(async () => ({ ...DEFAULT_PERMISSION_RULES })) };
});
vi.mock("../notebook", () => ({ searchNotebook: vi.fn(async () => []) }));
vi.mock("../store", () => ({ getLibraryEnabled: vi.fn(async () => true) }));
vi.mock("../library", async () => {
  const { resourceText } = await vi.importActual<typeof import("../library")>("../library");
  const rank = await import("../library-rank");
  const manifest = rank.normalizeManifest((await import("../../../public/library/index.json")).default);
  const bodies: Record<string, string> = {
    "biology/organelle-functions": (await import("../../../public/library/resources/biology/organelle-functions.md?raw")).default,
    "earth-space/rock-cycle": (await import("../../../public/library/resources/earth-space/rock-cycle.md?raw")).default,
  };
  return {
    isLibraryAvailable: () => true,
    getManifest: async () => manifest,
    matchResourcesScored: rank.matchResourcesScored,
    // library.ts fetchResource without the HTTP: the card's file through its own resourceText.
    fetchResource: async (entry: { id: string }, maxChars: number) => ({ text: resourceText(bodies[entry.id] ?? "", maxChars), url: "" }),
  };
});

import { ground, groundedIn } from "./ground";
import { citationNote } from "./citation";
import { budgetFor } from "./budget";
import type { ToolContext } from "../tools/EduTool";
import type { LLMConfig } from "../../types";

const ctx = {
  courseId: "c1", level: 1, syllabus: null, modelTier: "tiny",
  config: { provider: "ollama", model: "test" } as LLMConfig,
  permissionMode: "default", abort: new AbortController().signal,
} as ToolContext;

describe("ground(): a learner's one bare word", () => {
  it.each([
    ["mitochondria", "Organelle Functions", "| Mitochondrion | releases energy (ATP) via respiration | both |"],
    ["igneous", "The Rock Cycle", "**Igneous** — forms when molten **magma**"],
  ])("puts the card for %s in front of the model", async (question, title, line) => {
    const g = await ground(question, ctx, budgetFor(8192));
    expect(g.trace.skipped).toBeNull();
    expect(g.hits.map((h) => [h.source, h.title])).toEqual([["library", title]]);
    expect(g.block).toContain(`[REFERENCE: ${title}]`);
    expect(g.block).toContain(line);
  });

  it("shows 'No passage quoted' for a reply that uses the card in its own words, and names the card when it quotes", async () => {
    const g = await ground("mitochondria", ctx, budgetFor(8192));
    const paraphrase = "Mitochondria are where the cell releases energy. They make ATP through cellular respiration, in plant and animal cells.";
    expect(citationNote(g.hits, groundedIn(paraphrase, g.hits), g.trace)).toEqual({
      // The chip from the click test, word for word: "the library" is named only because its card was a hit.
      kind: "ungrounded", label: "No passage quoted — your notes and the library were searched",
    });
    const quoting = "The membrane-bound and other structures inside a eukaryotic cell include the mitochondrion.";
    expect(citationNote(g.hits, groundedIn(quoting, g.hits), g.trace)).toEqual({ kind: "quoted", titles: ["Organelle Functions"] });
  });
});
