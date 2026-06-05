// ask_user.question — the tutor asks the student a multiple-choice clarifying question and waits
// for their pick before continuing the SAME turn (docs/ARCHITECTURE.md, mid-turn suspension).
// The generator awaits ctx.askUser, a kernel-mediated Promise the UI resolves on click — the
// tool never touches the UI directly.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";

export const questionTool = defineTool({
  name: "ask_user.question",
  description:
    "Ask the student a clarifying question with a small set of choices and wait for their pick " +
    "before continuing. Use when you need a decision (e.g., which topic to focus on) rather than guessing.",
  inputSchema: z.object({
    question: z.string().min(3).describe("The question to show the student."),
    choices: z
      .array(
        z.object({
          label: z.string().min(1).describe("Button text shown to the student."),
          value: z.string().min(1).describe("The value handed back to you when they pick this choice."),
        }),
      )
      .min(2)
      .max(5)
      .describe("Between 2 and 5 choices."),
  }),
  isReadOnly: true,
  isConcurrencySafe: false,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ choice: string }>> {
    if (!ctx.askUser) {
      yield { kind: "error", error: "Cannot ask the student a question in this context." };
      return;
    }
    yield { kind: "progress", message: "waiting for the student to choose…" };
    const choice = await ctx.askUser(input.question, input.choices);
    yield { kind: "result", value: { choice } };
  },
});
