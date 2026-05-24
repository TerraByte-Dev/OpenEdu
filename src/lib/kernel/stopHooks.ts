// Stop hooks — when a tutoring turn must end (V2_ARCHITECTURE.md §4).
//
// Phase 1 keeps this minimal: a hard iteration cap (the per-turn budget placeholder) plus
// abort. The cap bounds tool↔model ping-pong on small models that might otherwise loop. Real
// token budgeting (tokenBudget.ts) and richer hooks come later; this is the safety net.

import type { ToolContext } from "../tools/EduTool";

// Max model calls in one turn (initial response + tool-result follow-ups). 6 comfortably covers
// the realistic case (1–2 tool calls then an answer) while capping a runaway loop.
export const MAX_TURN_ITERATIONS = 6;

export interface StopDecision {
  stop: boolean;
  reason?: "aborted" | "max_iterations";
}

// Checked at the top of each turn iteration.
export function shouldContinue(iteration: number, ctx: ToolContext): StopDecision {
  if (ctx.abort.aborted) return { stop: true, reason: "aborted" };
  if (iteration >= MAX_TURN_ITERATIONS) return { stop: true, reason: "max_iterations" };
  return { stop: false };
}
