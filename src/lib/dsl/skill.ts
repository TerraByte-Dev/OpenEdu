// Skill frontmatter DSL (docs/ARCHITECTURE.md). zod is the source of truth. Unlike the
// course/syllabus DSLs, a skill schema is NOT sent to a provider — it validates the frontmatter of
// a skill .md bundle (built-in `src/skills/*.md`, later user-sideloaded). The parsed markdown body
// (the persona/rules text) rides alongside as the runtime `Skill`.
//
// Phase 2 kept this the minimal V2 §8 shape. Phase 4b adds the OPTIONAL persona fields
// (display_name / avatar / domain_hints) used by the sprite-persona-* skills — see the
// openedu_premade_tutors_vision note. Mode/domain skills simply omit them.

import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1), // must equal a TutorModeId for the converted pedagogical skills
  description: z.string().min(1), // one line
  trigger: z
    .object({ course_subject: z.array(z.string()).default([]) })
    .default({ course_subject: [] }),
  tools_required: z.array(z.string()).default([]), // tool names, e.g. ["progress.mark_mastered"]
  model_tier_min: z.enum(["tiny", "small", "medium", "large"]).default("tiny"),
  // Phase 4b persona fields (optional). sprite-persona-* skills carry these; mode/domain skills omit
  // them. The sprite registry (src/lib/sprites) owns the picker-facing copy — these let a persona
  // skill self-describe and keep the DSL forward-compatible. Personas NEVER set tools_required.
  display_name: z.string().optional(),
  avatar: z.string().optional(),
  domain_hints: z.array(z.string()).default([]),
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
