// Skill trigger matching + tier gating (docs/ARCHITECTURE.md).
//
// Domain skills (math-tutor, code-tutor, music-tutor) set `trigger.course_subject` keywords and
// auto-route against the free-text `course.topic` until a dedicated `subject` column exists.
// Mode skills (explain/socratic/…) are selected via the mode bar and leave `course_subject` empty;
// persona skills (sprite-persona-*) are the WHO axis and are excluded from subject routing.

import type { Course, ModelTier } from "../../types";
import type { Skill } from "../dsl/skill";
import { skillRegistry, loadBuiltinSkills } from "./registry";

const TIER_RANK: Record<ModelTier, number> = { tiny: 0, small: 1, medium: 2, large: 3 };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(topic: string, kw: string): boolean {
  return new RegExp(`\\b${escapeRegExp(kw)}(?:s|es)?\\b`, "i").test(topic);
}

// True when the detected model tier is at least the skill's minimum.
export function isSkillAvailable(skill: Skill, tier: ModelTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[skill.model_tier_min];
}

// Skills whose course_subject keywords appear as whole words in the course topic, filtered by tier.
export function matchSkillsForCourse(
  course: Pick<Course, "topic">,
  skills: Skill[],
  tier: ModelTier,
): Skill[] {
  return skills.filter(
    (s) =>
      isSkillAvailable(s, tier) &&
      s.trigger.course_subject.some((kw) => matchesKeyword(course.topic, kw)),
  );
}

// Resolve the domain skill (math-tutor / code-tutor / music-tutor) for a course topic — code-routed,
// no LLM (V2 §11.3: route skills for tier ≤ small). Returns the first subject-matching, tier-available
// domain skill, or undefined when the subject matches none. Mode skills (explain/socratic/…) carry
// no course_subject so they never match here; persona skills (sprite-persona-*, Phase 4b) are the
// WHO axis and are excluded — they never auto-route by subject.
export function resolveDomainSkill(topic: string, tier: ModelTier): Skill | undefined {
  loadBuiltinSkills();
  const candidates = skillRegistry.all().filter((s) => !s.name.startsWith("sprite-persona-"));
  return matchSkillsForCourse({ topic }, candidates, tier)[0];
}

