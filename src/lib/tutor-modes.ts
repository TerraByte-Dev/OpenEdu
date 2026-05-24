// Tutor "modes" are the user-facing pedagogical-skill selector shown in the chat mode bar. Each
// mode's behavior + the tools it unlocks now live in a skill .md bundle (src/skills/<id>.md),
// loaded by the skill registry (V2_ARCHITECTURE.md §6.1). This file is just the bar's display
// metadata plus a thin resolver that pulls each mode's prompt text from its skill — so the
// modes→skills conversion left the ChatTab and eval-runner call sites unchanged.
//
// A mode id is 1:1 with a skill name. The prompt text is byte-identical to the v1 hard-coded
// suffixes (explain → ""), which keeps the eval baseline intact.

import { resolveSkill } from "./skills";

export type TutorModeId = "explain" | "socratic" | "quiz" | "review" | "hint" | "assess";

export interface TutorMode {
  id: TutorModeId;
  label: string;
  icon: string;
  title: string;
}

export const TUTOR_MODES: TutorMode[] = [
  { id: "explain", label: "Explain", icon: "📖", title: "Default teaching mode" },
  { id: "socratic", label: "Socratic", icon: "🤔", title: "Guide with questions" },
  { id: "quiz", label: "Quiz Me", icon: "✏️", title: "Assessment mode" },
  { id: "review", label: "Review", icon: "📋", title: "Summarize what you've learned" },
  { id: "hint", label: "Hint", icon: "💡", title: "Minimal nudges only" },
  { id: "assess", label: "Assess", icon: "✅", title: "Mastery check — confirm readiness" },
];

// The mode's system-prompt suffix, sourced from its skill bundle's body.
export function getTutorModePrompt(modeId: TutorModeId): string {
  return resolveSkill(modeId)?.promptSuffix ?? "";
}
