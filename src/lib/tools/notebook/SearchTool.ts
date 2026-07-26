// notebook.search — retrieve passages from the student's own notebook (notes + ingested docs)
// relevant to a query, so the tutor can ground answers in the student's material and cite it
// (docs/ARCHITECTURE.md). Read-only; wraps searchNotebook (brute-force cosine). ChatTab
// renders the results as inline "📓 Source: …" citation chips.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { searchNotebook } from "../../notebook";
import type { NotebookSearchResult } from "../../../types";

export const searchTool = defineTool({
  name: "notebook.search",
  // DEMOTED to a second hop (#90). The kernel's grounding stage already puts the most relevant
  // passages in front of the model before it runs, so the old "CALL THIS whenever… search BEFORE
  // answering" framing now competes with context the model can already see — and it directly
  // contradicted the tools manifest's own "call a tool only when it is useful". A 4B model resolves a
  // contradiction like that by doing the easier thing. This description does one job: tell it when a
  // SECOND search is worth the round trip.
  description:
    "Search the student's notebook again with different words. The most relevant passages are ALREADY " +
    "provided in CONTEXT above — read those first. Use this only if CONTEXT did not contain the answer " +
    "and you want to try different search terms.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Different words to try, in natural language."),
    top_k: z.number().int().min(1).max(10).optional().describe("How many passages to return (default 3)."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ results: NotebookSearchResult[] }>> {
    yield { kind: "progress", message: `searching the notebook for "${input.query}"…` };
    // Default 3, not 5. The kernel caps the reinjected payload anyway, so a larger k just meant
    // paying to retrieve passages that would be truncated away before the model ever saw them.
    const results = await searchNotebook({ courseId: ctx.courseId, query: input.query, topK: input.top_k ?? 3 });
    yield { kind: "result", value: { results } };
  },

  // The UI event above carries the full result — ChatTab renders source chips from it. What reaches
  // the MODEL is this: plain labelled prose, matching the grounding block's shape so a second-hop
  // result reads the same as the context the model already has. Dropping chunk_id / document_id /
  // ord / score removes ~90 characters of identifiers per hit that the model cannot act on (there is
  // no notebook.read tool to spend an id on), plus all the JSON punctuation.
  toModelText: ({ results }) => {
    if (results.length === 0) return "No matching passages in the student's notebook.";
    return results.map((r) => `[From the student's notes: ${r.document_title}]\n${r.text.trim()}`).join("\n\n");
  },
});
