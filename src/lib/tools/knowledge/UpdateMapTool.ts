// knowledge.update_map — the tutor records a concise observation about the student's
// understanding into their knowledge map (docs/ARCHITECTURE.md). The model supplies the
// already-distilled note, so this is a direct write (no second reflection call). The holistic
// post-turn reflection (updateKnowledgeFiles) still covers the other knowledge files; the kernel
// reports usedKnowledgeUpdate so the caller skips that reflection when this tool ran.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { recordKnowledgeNote } from "../../knowledge";

export const updateMapTool = defineTool({
  name: "knowledge.update_map",
  description:
    "Record a short note about what the student now understands (or still struggles with) into " +
    "their knowledge map. Use after they clearly demonstrate a new grasp or reveal a persistent gap.",
  inputSchema: z.object({
    content: z
      .string()
      .min(3)
      .describe("One or two plain-text sentences capturing the student's current understanding or gap. No markdown."),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ recorded: string }>> {
    yield { kind: "progress", message: "updating knowledge map…" };
    await recordKnowledgeNote(ctx.courseId, input.content);
    yield { kind: "result", value: { recorded: input.content } };
  },
});
