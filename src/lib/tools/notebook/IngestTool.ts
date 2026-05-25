// notebook.ingest — save material to the student's notebook as a new, visible note that's also
// indexed for search/citation (V2_ARCHITECTURE.md §3, §6.3). Unified vault: it creates a real note
// (via importTextAsNote), so anything the tutor saves shows up in the note tree. Permission defaults
// to "ask" (rules.ts); the NotebookTab drop/picker uses importTextAsNote directly. Not in any skill's
// tools_required, so the tutor only ingests when explicitly told.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { importTextAsNote } from "../../notebook";

export const ingestTool = defineTool({
  name: "notebook.ingest",
  description:
    "Save material to the student's notebook as a new note (it becomes searchable and citable later). " +
    "Provide a title and the full text. Use only when the student asks you to save or remember material.",
  inputSchema: z.object({
    title: z.string().min(1).describe("A short title for the note."),
    text: z.string().min(1).describe("The full text content to save."),
    source_type: z.enum(["text", "md", "note"]).optional().describe("Content kind (default note)."),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ noteId: string; chunkCount: number; title: string }>> {
    yield { kind: "progress", message: `saving "${input.title}" to the notebook…` };
    const res = await importTextAsNote({
      courseId: ctx.courseId,
      title: input.title,
      text: input.text,
      sourceType: input.source_type ?? "note",
    });
    yield { kind: "result", value: { noteId: res.note.id, chunkCount: res.chunkCount, title: input.title } };
  },
});
