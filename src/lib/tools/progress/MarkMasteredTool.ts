// progress.mark_mastered — the tutor marks a subtopic in the current level as mastered or
// practiced based on what the student demonstrated in conversation (V2_ARCHITECTURE.md §3).
// Wraps the direct mark-by-id path in progress.ts, then recomputes gaps and refreshes the
// tutor's progress context. Subtopic-level only — never promotes course.current_level.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { getSyllabus } from "../../db";
import { setSubtopicStatus, updateUserProgress, refreshProgressContext } from "../../progress";

export const markMasteredTool = defineTool({
  name: "progress.mark_mastered",
  description:
    "Mark a subtopic in the current level as mastered or practiced when the student demonstrates it " +
    "in conversation. subtopic_id MUST be an id from the current level's syllabus.",
  inputSchema: z.object({
    subtopic_id: z
      .string()
      .min(1)
      .describe("Which subtopic — its id (e.g. \"1.1\") OR its title (e.g. \"Introduction to Python and Basic Output\") from the current level's syllabus."),
    status: z
      .enum(["mastered", "practiced"])
      .describe("mastered = clearly demonstrated ~90%+ understanding; practiced = has worked on it but not yet mastered."),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call(input, ctx): AsyncGenerator<ToolEvent<{ subtopic_id: string; status: string; title: string }>> {
    const syllabus = ctx.syllabus ?? (await getSyllabus(ctx.courseId, ctx.level));
    if (!syllabus) {
      yield { kind: "error", error: `No syllabus is loaded for level ${ctx.level}, so progress can't be updated.` };
      return;
    }

    yield { kind: "progress", message: `marking "${input.subtopic_id}" as ${input.status}…` };
    const res = await setSubtopicStatus(ctx.courseId, syllabus, input.subtopic_id, input.status);
    if (!res.found) {
      const valid = syllabus.subtopics.map((s) => `${s.id} ("${s.title}")`).join("; ");
      yield { kind: "error", error: `No subtopic matched "${input.subtopic_id}" in level ${ctx.level}. Valid subtopics: ${valid}.` };
      return;
    }

    // Recompute gaps + refresh the tutor's progress context from fresh DB state.
    const fresh = await getSyllabus(ctx.courseId, ctx.level);
    await updateUserProgress(ctx.courseId);
    await refreshProgressContext(ctx.courseId, fresh);

    yield { kind: "result", value: { subtopic_id: input.subtopic_id, status: input.status, title: res.title ?? input.subtopic_id } };
  },
});
