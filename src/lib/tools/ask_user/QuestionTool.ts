// ask_user.question — the tutor asks the student a multiple-choice clarifying question and waits
// for their pick before continuing the SAME turn (docs/ARCHITECTURE.md, mid-turn suspension).
// The generator awaits ctx.askUser, a kernel-mediated Promise the UI resolves on click — the
// tool never touches the UI directly.
//
// The child either clicks a choice or types their own answer in the chat box (ChatTab), so the value
// handed back may be any text. The model is told the answer in a sentence, not as {"choice": "..."}:
// on gemma4:e4b the bare JSON result was followed by an EMPTY reply in 5 of 8 runs of the 2026-11-14
// click-test card, and by 1 of 8 with the sentence (headless, same card, real model).

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { pickedAnswer } from "../../kernel/askCard";

export interface QuestionResult {
  /** The value handed back: a choice's value, or the text the student typed. */
  choice: string;
  /** What the student saw and chose: the choice's label, or their typed text. */
  answer: string;
  typed: boolean;
}

/** The tool result the model reads. */
export function questionModelText(r: QuestionResult): string {
  const said = r.typed
    ? `The student typed their own answer instead of picking a choice: "${r.answer}".`
    : `The student picked "${r.answer}"${r.answer === r.choice ? "" : ` (value: ${r.choice})`}.`;
  return `${said} Reply to the student now, following on from their answer.`;
}

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
  toModelText: questionModelText,
  async *call(input, ctx): AsyncGenerator<ToolEvent<QuestionResult>> {
    if (!ctx.askUser) {
      yield { kind: "error", error: "Cannot ask the student a question in this context." };
      return;
    }
    yield { kind: "progress", message: "waiting for the student to choose…" };
    const choice = await ctx.askUser(input.question, input.choices);
    const { text, typed } = pickedAnswer(input.choices, choice);
    yield { kind: "result", value: { choice, answer: text, typed } };
  },
});
