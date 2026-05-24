// Skill frontmatter DSL (V2_ARCHITECTURE.md §6.1, §8). zod is the source of truth. Unlike the
// course/syllabus DSLs, a skill schema is NOT sent to a provider — it validates the frontmatter of
// a skill .md bundle (built-in `src/skills/*.md`, later user-sideloaded). The parsed markdown body
// (the persona/rules text) rides alongside as the runtime `Skill`.
//
// Phase 2 keeps this the minimal V2 §8 shape. Persona fields (avatar / display_name / voice) are
// deliberately deferred to Phase 4 — see the openedu_premade_tutors_vision note.

import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1), // must equal a TutorModeId for the converted pedagogical skills
  description: z.string().min(1), // one line
  trigger: z
    .object({ course_subject: z.array(z.string()).default([]) })
    .default({ course_subject: [] }),
  tools_required: z.array(z.string()).default([]), // tool names, e.g. ["progress.mark_mastered"]
  model_tier_min: z.enum(["tiny", "small", "medium", "large"]).default("tiny"),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// A loaded skill: validated frontmatter + the markdown body, plus the derived prompt suffix the
// <skill_bundle> system-prompt layer injects. `promptSuffix` reproduces the v1 tutor-mode suffix
// byte-for-byte (leading "\n\n" + trimmed body) so the modes→skills conversion can't regress the
// eval baseline.
export interface Skill extends SkillFrontmatter {
  body: string;
  promptSuffix: string;
}
