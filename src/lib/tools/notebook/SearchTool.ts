// notebook.search — retrieve passages from the student's own notebook (notes + ingested docs)
// relevant to a query, so the tutor can ground answers in the student's material and cite it
// (V2_ARCHITECTURE.md §3, §6.3). Read-only; wraps searchNotebook (brute-force cosine). ChatTab
// renders the results as inline "📓 Source: …" citation chips.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { searchNotebook } from "../../notebook";
import type { NotebookSearchResult } from "../../../types";

export const searchTool = defineTool({
  name: "notebook.search",
  description:
    "Search the student's own notebook — their notes and any documents they've added — for passages " +
    "relevant to a query. Use it to ground your answer in the student's material and cite the source. " +
    "Returns the most relevant passages with their document titles.",
  inputSchema: z.object({
    query: z.string().min(1).describe("What to look for, in natural language."),
    top_k: z.number().int().min(1).max(10).optional().describe("How many passages to return (default 5)."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ results: NotebookSearchResult[] }>> {
    yield { kind: "progress", message: `searching the notebook for "${input.query}"…` };
    const results = await searchNotebook({ courseId: ctx.courseId, query: input.query, topK: input.top_k });
    yield { kind: "result", value: { results } };
  },
});
