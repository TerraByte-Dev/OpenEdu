// math.render — typeset a mathematical expression as a rendered block (docs/ARCHITECTURE.md).
//
// The LaTeX rides inside the tool-call ARGUMENTS (which providers double-escape correctly), so it
// never enters a JSON chat string — the sanctioned workaround for the HANDOFF "no LaTeX in chat
// strings" lock, not a violation. Read-only; the tool just echoes the LaTeX as a structured result
// and ChatTab renders it with KaTeX (graceful: invalid LaTeX falls back to raw text, never crashes).

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";

export const mathRenderTool = defineTool({
  name: "math.render",
  description:
    "Render a mathematical expression or equation as a typeset block. CALL THIS whenever an equation, " +
    "formula, or numeric relationship is part of your answer: put the LaTeX in the `latex` argument " +
    "(e.g. v = \\frac{d}{t} = \\frac{60}{1.5} = 40). NEVER write backslash-LaTeX or $…$ delimiters in " +
    "your chat text — route the math through this tool instead, and still state the plain-language " +
    "result in your reply.",
  inputSchema: z.object({
    latex: z
      .string()
      .min(1)
      .describe("The expression in LaTeX, e.g. \\frac{a}{b}, x^2 + y^2 = r^2, \\sum_{i=1}^{n} i."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input): AsyncGenerator<ToolEvent<{ latex: string }>> {
    // No side effects — the value is the channel that carries LaTeX out of JSON-string territory.
    yield { kind: "result", value: { latex: input.latex } };
  },
});
