// Layered system-prompt assembly (V2_ARCHITECTURE.md §5).
//
// Phase 0: a single layer that delegates to the v1 builder VERBATIM — guarantees byte-identical
// output while establishing the seam. V2 §5 later splits this into ordered pure layers
// (env → persona → skill_bundle → memory → progress → concept_ledger → mode → tools →
// output_rules), each `(ctx) => string | null`, without changing the call site.

import { buildSystemPrompt } from "../curriculum";
import type { Syllabus } from "../../types";
import type { EduTool } from "../tools/EduTool";
import type { Skill } from "../dsl/skill";

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

// The <skill_bundle> layer (V2 §5 #3). Returns the active skill's persona/rules text to inject into
// the system prompt. For the Phase 2 pedagogical skills this is the mode-rule body (e.g. Socratic's
// "ask, don't tell"), carried as the skill's `promptSuffix` — leading "\n\n" + the .md body. It is
// routed into buildSystemPrompt's `modeSuffix` slot (the same late position the v1 mode suffix
// occupied), so the assembled prompt stays byte-identical to v1 and the eval baseline holds.
// Returns null for the default "explain" skill (empty body) and when no skill is active. Phase 4
// character/persona skills will compose their early-position persona here too.
export function skillBundleLayer(skill: Skill | null | undefined): string | null {
  return skill?.promptSuffix ? skill.promptSuffix : null;
}

// The <tools> layer (V2 §5.8). Returns a manifest of the tools offered this turn, or null when
// none — so a no-tool turn's system prompt is byte-identical to v1. The kernel appends this to
// the system message AFTER tool selection, guaranteeing the manifest matches what's actually
// offered. Native tool schemas still ride in the provider payload; this manifest helps small
// models recognize the tools exist and when to reach for them.
export function toolsLayer(tools: EduTool[]): string | null {
  if (!tools.length) return null;
  const lines = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return (
    "<tools>\n" +
    "You can call these tools when they genuinely help the student. Call a tool only when it is " +
    "useful; otherwise just reply normally in plain text.\n" +
    lines +
    "\n</tools>"
  );
}
