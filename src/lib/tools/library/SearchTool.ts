// library.search — look up a curated reference card from the OpenEdu Library (periodic table, unit
// circle, formulas, definitions…). Read-only; wraps the lexical matcher + resource fetch in
// ../../library. One hop: returns the single best card's cleaned body (plus titles of near-matches),
// so even the floor model (gemma4:e4b) can answer + cite in one step. ChatTab renders the result as a
// "🔗 OpenEdu Library: …" source chip. Hidden unless the library is enabled AND a manifest is cached
// (offline-first) — so when unavailable the model is never offered a tool it can't use.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { getManifest, matchResources, fetchResource, isLibraryAvailable } from "../../library";
import { getLibraryEnabled } from "../../store";
import type { LibrarySearchResult } from "../../../types";

export const librarySearchTool = defineTool({
  name: "library.search",
  description:
    "Look up a curated educational reference from the OpenEdu Library — canonical facts and reference " +
    "a textbook would contain (periodic table, unit circle, formulas, constants, definitions, verb " +
    "tables…). CALL THIS before answering a factual/reference question, then ground your answer in the " +
    "returned card and cite it. Not for the student's own notes (use notebook.search for those).",
  inputSchema: z.object({
    query: z.string().min(1).describe("The reference to look up, in natural language (e.g. 'periodic table')."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  isEnabled: async () => (await getLibraryEnabled()) && isLibraryAvailable(),
  async *call(input, ctx): AsyncGenerator<ToolEvent<LibrarySearchResult>> {
    yield { kind: "progress", message: `consulting the OpenEdu Library for "${input.query}"…` };
    const manifest = await getManifest();
    const matches = matchResources(input.query, manifest, 3);
    if (matches.length === 0) {
      yield { kind: "result", value: { found: false, title: "", source_url: "", text: "", related: [] } };
      return;
    }
    // Tier-aware cap (mirrors researchTopic's searchCap): keep payloads lean for small local models.
    const cap = ctx.modelTier === "tiny" || ctx.modelTier === "small" ? 1800 : 3000;
    const best = matches[0];
    const { text, url } = await fetchResource(best, cap);
    yield {
      kind: "result",
      value: {
        found: true,
        title: best.title,
        source_url: url,
        text,
        related: matches.slice(1).map((m) => m.title),
      },
    };
  },
});
