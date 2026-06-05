// Syllabus DSL (docs/ARCHITECTURE.md) — zod is the source of truth; the TS type is inferred.
// Mirrors the persisted `Syllabus` / `Subtopic` interfaces in types/index.ts. The compile-time
// asserts below FAIL THE BUILD if the DSL and the hand-written interface ever drift apart, so
// the two representations can't silently diverge.
//
// Constraints kept light to match the persisted entity, plus a couple (int bounds, subtopic-id
// pattern) that don't change the inferred TS type but DO exercise the JSON-Schema round-trip.

import { z } from "zod";
import type { Subtopic, Syllabus } from "../../types";

export const SubtopicSchema = z.object({
  id: z.string().regex(/^[1-6]\.[1-6]$/),
  title: z.string(),
  key_concepts: z.array(z.string()),
  practice_type: z.string(),
  mastered: z.boolean(),
  practiced: z.boolean().optional(),
  review_needed: z.boolean().optional(),
});

export const SyllabusSchema = z.object({
  id: z.string(),
  course_id: z.string(),
  level: z.number().int(),
  title: z.string(),
  description: z.string(),
  learning_objectives: z.array(z.string()),
  subtopics: z.array(SubtopicSchema),
  assessment_criteria: z.array(z.string()),
  estimated_hours: z.number().int(),
  generated_at: z.string(),
});

export type SubtopicDSL = z.infer<typeof SubtopicSchema>;
export type SyllabusDSL = z.infer<typeof SyllabusSchema>;

// ── Drift guard: DSL ⇄ interface must be mutually assignable (build fails otherwise). ──
type Assert<T extends true> = T;
export type SyllabusDriftGuard = [
  Assert<SubtopicDSL extends Subtopic ? true : false>,
  Assert<Subtopic extends SubtopicDSL ? true : false>,
  Assert<SyllabusDSL extends Syllabus ? true : false>,
  Assert<Syllabus extends SyllabusDSL ? true : false>,
];
