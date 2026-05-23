// Course-outline DSL (V2_ARCHITECTURE.md §8). zod source of truth; mirrors the `CourseOutline`
// / `OutlineLevel` interfaces in types/index.ts, with the same compile-time drift guard.

import { z } from "zod";
import type { CourseOutline, OutlineLevel } from "../../types";

export const OutlineLevelSchema = z.object({
  level: z.number().int(),
  title: z.string(),
  focus_areas: z.array(z.string()),
  key_outcomes: z.array(z.string()),
  bridge: z.string(),
});

export const CourseOutlineSchema = z.object({
  levels: z.array(OutlineLevelSchema),
  mastery_exam: z.object({
    domains: z.array(z.string()),
    synthesis_skills: z.array(z.string()),
    scenarios: z.array(z.string()),
  }),
});

export type OutlineLevelDSL = z.infer<typeof OutlineLevelSchema>;
export type CourseOutlineDSL = z.infer<typeof CourseOutlineSchema>;

// ── Drift guard: DSL ⇄ interface must be mutually assignable (build fails otherwise). ──
type Assert<T extends true> = T;
export type CourseOutlineDriftGuard = [
  Assert<OutlineLevelDSL extends OutlineLevel ? true : false>,
  Assert<OutlineLevel extends OutlineLevelDSL ? true : false>,
  Assert<CourseOutlineDSL extends CourseOutline ? true : false>,
  Assert<CourseOutline extends CourseOutlineDSL ? true : false>,
];
