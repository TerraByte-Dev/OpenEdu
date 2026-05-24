// notebook.ingest — add a document to the student's notebook so it can be searched and cited later
// (V2_ARCHITECTURE.md §3, §6.3). Wraps ingestDocument (chunk → embed → store; sha256-deduped).
// Permission defaults to "ask" (rules.ts); the NotebookTab drag-drop path calls ingestDocument
// directly. Not added to any skill's tools_required, so the tutor only ingests when explicitly told.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { ingestDocument } from "../../notebook";

export const ingestTool = defineTool({
  name: "notebook.ingest",
  description:
    "Add a document to the student's notebook so it can be searched and cited later. Provide the full " +
    "text to store; it is chunked and embedded. Use only when the student asks you to save material.",
  inputSchema: z.object({
    title: z.string().min(1).describe("A short title for the document."),
    text: z.string().min(1).describe("The full text content to ingest."),
    source_type: z.enum(["text", "md", "note"]).optional().describe("Content kind (default text)."),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call(
    input,
    ctx,
  ): AsyncGenerator<ToolEvent<{ documentId: string; chunkCount: number; deduped: boolean; title: string }>> {
    yield { kind: "progress", message: `adding "${input.title}" to the notebook…` };
    const res = await ingestDocument({
      courseId: ctx.courseId,
      title: input.title,
      sourceType: input.source_type ?? "text",
      text: input.text,
    });
    yield { kind: "result", value: { ...res, title: input.title } };
  },
});
