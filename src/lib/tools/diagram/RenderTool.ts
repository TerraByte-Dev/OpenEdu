// diagram.render — render a diagram from Mermaid source as a visual block (V2_ARCHITECTURE.md §6.4).
//
// Like math.render, the Mermaid source rides in the tool-call ARGUMENTS, not a chat string. Read-only;
// the tool echoes the Mermaid source and ChatTab renders it via a lazily-imported Mermaid (graceful:
// a Mermaid parse error falls back to showing the source, never crashes the chat).

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";

export const diagramRenderTool = defineTool({
  name: "diagram.render",
  description:
    "Render a diagram from Mermaid source as a visual block. CALL THIS when a flowchart, sequence, " +
    "state, graph, mind-map, or process is clearer drawn than described: put the Mermaid code in the " +
    "`mermaid` argument (e.g. graph TD; A[Start] --> B[End]). Briefly describe the diagram in your reply too.",
  inputSchema: z.object({
    mermaid: z
      .string()
      .min(1)
      .describe("Mermaid diagram source, e.g. 'graph TD; A[Input] --> B[Process] --> C[Output]'."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input): AsyncGenerator<ToolEvent<{ mermaid: string }>> {
    yield { kind: "result", value: { mermaid: input.mermaid } };
  },
});
