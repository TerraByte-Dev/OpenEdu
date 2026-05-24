// Skill trigger matching + tier gating (V2_ARCHITECTURE.md §6.1, §11.3).
//
// DORMANT in Phase 2: no built-in skill sets `trigger.course_subject`, so matchSkillsForCourse
// returns []. It's the seam Phase 4 domain/persona skills (math-tutor, code-tutor) will use. Until
// a dedicated `subject` column exists, it matches the free-text `course.topic`. The mode bar is the
// skill selector for the Phase 2 pedagogical skills.

import type { Course, ModelTier } from "../../types";
import type { Skill } from "../dsl/skill";

const TIER_RANK: Record<ModelTier, number> = { tiny: 0, small: 1, medium: 2, large: 3 };

// True when the detected model tier is at least the skill's minimum.
export function isSkillAvailable(skill: Skill, tier: ModelTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[skill.model_tier_min];
}

// Skills whose course_subject keywords appear in the course topic, filtered by tier.
export function matchSkillsForCourse(
  course: Pick<Course, "topic">,
  skills: Skill[],
  tier: ModelTier,
): Skill[] {
  const topic = course.topic.toLowerCase();
  return skills.filter(
    (s) =>
      isSkillAvailable(s, tier) &&
      s.trigger.course_subject.some((kw) => topic.includes(kw.toLowerCase())),
  );
}
