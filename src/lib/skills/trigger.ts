// Skill trigger matching + tier gating (docs/ARCHITECTURE.md).
//
// Domain skills (math-tutor, code-tutor, music-tutor, science-tutor) list `trigger.course_subject`
// words. A course routes to one in code, no model call, from data every course already has:
//   1. its topic (the title the learner typed): the first domain skill with a word in it;
//   2. else its syllabus: the domain skill whose words appear in more than half of the subtopics
//      (title + key concepts), and in at least two. One stray "rhythm" subtopic in a Poetry course
//      does not make it a music course.
// Matching runs on every turn, so existing courses route by their stored topic and syllabus.
// Mode skills (explain/socratic/…) leave `course_subject` empty; persona skills (sprite-persona-*)
// are the WHO axis and are excluded from subject routing.

import type { Course, ModelTier, Syllabus } from "../../types";
import type { Skill } from "../dsl/skill";
import { skillRegistry, loadBuiltinSkills } from "./registry";

const TIER_RANK: Record<ModelTier, number> = { tiny: 0, small: 1, medium: 2, large: 3 };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(text: string, kw: string): boolean {
  return new RegExp(`\\b${escapeRegExp(kw)}(?:s|es)?\\b`, "i").test(text);
}

// True when one of the skill's subject words is in the text, after its excluded phrases are taken out.
function mentionsSubject(skill: Skill, text: string): boolean {
  let t = text;
  for (const ex of skill.trigger.course_subject_exclude ?? []) {
    t = t.replace(new RegExp(`\\b${escapeRegExp(ex)}(?:s|es)?\\b`, "gi"), " ");
  }
  return skill.trigger.course_subject.some((kw) => matchesKeyword(t, kw));
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
  return skills.filter((s) => isSkillAvailable(s, tier) && mentionsSubject(s, course.topic));
}

export type CourseSyllabus = Pick<Syllabus, "subtopics">;

// The skill whose subject words appear in more than half of the syllabus's subtopics (and in at least
// two). Most subtopics wins; a tie goes to the earlier skill.
export function matchSkillForSyllabus(
  syllabus: CourseSyllabus | null | undefined,
  skills: Skill[],
  tier: ModelTier,
): Skill | undefined {
  const units = (syllabus?.subtopics ?? []).map((s) => [s.title, ...(s.key_concepts ?? [])].join(" . "));
  let best: Skill | undefined;
  let bestHits = 0;
  for (const s of skills) {
    if (!isSkillAvailable(s, tier) || s.trigger.course_subject.length === 0) continue;
    const hits = units.filter((u) => mentionsSubject(s, u)).length;
    if (hits >= 2 && hits * 2 > units.length && hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best;
}

// Resolve the domain skill for a course — code-routed, no LLM (V2 §11.3: route skills for tier ≤
// small). The topic decides first; a topic that names no subject falls back to the syllabus. Mode
// skills (explain/socratic/…) carry no course_subject so they never match here; persona skills
// (sprite-persona-*, Phase 4b) are the WHO axis and are excluded — they never auto-route by subject.
export function resolveDomainSkill(
  topic: string,
  tier: ModelTier,
  syllabus?: CourseSyllabus | null,
): Skill | undefined {
  loadBuiltinSkills();
  const candidates = skillRegistry.all().filter((s) => !s.name.startsWith("sprite-persona-"));
  return matchSkillsForCourse({ topic }, candidates, tier)[0] ?? matchSkillForSyllabus(syllabus, candidates, tier);
}
