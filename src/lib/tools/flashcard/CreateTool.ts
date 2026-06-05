// flashcard.create — mint a spaced-repetition flashcard for the student (slice B1). A write tool:
// permission defaults to "ask" outside study mode (rules.ts). Exposed via the `review` skill, so the
// tutor offers it when reviewing / surfacing shaky areas. ChatTab renders a "🃏 Card minted" chip.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { createFlashcard } from "../../db";

export const flashcardCreateTool = defineTool({
  name: "flashcard.create",
  description:
    "Make a spaced-repetition flashcard for the student to review later. Use when the student asks to " +
    "save something as a card, or when a fact/definition/rule is worth memorizing. Give a clear " +
    "question (front) and its answer (back). Plain text only — no LaTeX, no markdown.",
  inputSchema: z.object({
    front: z.string().min(1).describe("The prompt/question side of the card."),
    back: z.string().min(1).describe("The answer side of the card."),
    subtopic_id: z.string().optional().describe("Optional subtopic id this card belongs to."),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ cardId: string; front: string }>> {
    yield { kind: "progress", message: "making a flashcard…" };
    const card = await createFlashcard({
      courseId: ctx.courseId,
      front: input.front,
      back: input.back,
      subtopicId: input.subtopic_id ?? null,
      level: ctx.level,
      source: "tutor",
    });
    yield { kind: "result", value: { cardId: card.id, front: card.front } };
  },
});
