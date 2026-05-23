// Layered system-prompt assembly (V2_ARCHITECTURE.md §5).
//
// Phase 0: a single layer that delegates to the v1 builder VERBATIM — guarantees byte-identical
// output while establishing the seam. V2 §5 later splits this into ordered pure layers
// (env → persona → skill_bundle → memory → progress → concept_ledger → mode → tools →
// output_rules), each `(ctx) => string | null`, without changing the call site.

import { buildSystemPrompt } from "../curriculum";
import type { Syllabus } from "../../types";

export interface SystemPromptInput {
  instructions: Record<string, string>;
  syllabus: Syllabus | null;
  courseLevel: number;
  topic: string;
  modeSuffix?: string;
  knowledgeSummary?: string;
}

export function assembleSystemPrompt(input: SystemPromptInput): string {
  // Phase 0 = exactly one layer: the existing v1 builder. Do not add behavior here; new
  // layers get added as separate pure functions and composed, preserving v1 output.
  return buildSystemPrompt(
    input.instructions,
    input.syllabus,
    input.courseLevel,
    input.topic,
    input.modeSuffix,
    input.knowledgeSummary,
  );
}
