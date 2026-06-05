// flashcard.review_due — list the student's flashcards due for review right now (slice B1).
// Read-only; allowed in every mode (rules.ts). Exposed via the `review` skill so the tutor can
// remind the student what's due or quiz them on it. ChatTab renders an "N due → Review" chip.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { getDueFlashcards } from "../../db";

interface DueResult {
  count: number;
  cards: Array<{ front: string; subtopic_id: string | null }>;
}

export const flashcardReviewDueTool = defineTool({
  name: "flashcard.review_due",
  description:
    "List the student's flashcards that are due for review right now (spaced repetition). Read-only — " +
    "use to remind the student what to review, or to quiz them on what's due.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("Max cards to return (default tier-capped)."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input, ctx): AsyncGenerator<ToolEvent<DueResult>> {
    yield { kind: "progress", message: "checking due flashcards…" };
    // Keep payloads lean on small local models (mirrors library.search's tier cap).
    const cap = ctx.modelTier === "tiny" || ctx.modelTier === "small" ? 6 : 10;
    const limit = Math.min(input.limit ?? cap, cap);
    const due = await getDueFlashcards(ctx.courseId, new Date().toISOString(), limit);
    yield {
      kind: "result",
      value: { count: due.length, cards: due.map((c) => ({ front: c.front, subtopic_id: c.subtopic_id })) },
    };
  },
});
