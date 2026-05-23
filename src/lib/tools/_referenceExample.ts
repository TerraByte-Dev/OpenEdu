// Reference only — NOT registered, NOT imported by anything at runtime. It exists so `tsc`
// proves the EduTool contract end-to-end: zod input inference, the generator/event protocol,
// and zod defaults. Doubles as the canonical shape Phase 1 tool authors copy. Safe to delete.

import { z } from "zod";
import { defineTool, type ToolEvent } from "./EduTool";

export const exampleEchoTool = defineTool({
  name: "example.echo",
  description: "Reference-only echo tool that demonstrates the EduTool contract.",
  inputSchema: z.object({
    text: z.string().min(1),
    times: z.number().int().min(1).max(5).default(1),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  // `input` is inferred as { text: string; times: number } — declared once, on the schema.
  async *call(input): AsyncGenerator<ToolEvent<{ echoed: string }>> {
    yield { kind: "progress", message: `echoing ${input.times}×` };
    yield { kind: "result", value: { echoed: Array(input.times).fill(input.text).join(" ") } };
  },
});
