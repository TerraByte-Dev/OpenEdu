// Round-trip proof for the DSL layer (Phase 0, issue #3). Confirms that zod → JSON Schema is
// provider-safe (no $ref/$defs/anyOf/$schema) and that the schemas accept valid / reject invalid
// data. Pure (no fetch) — runnable in DevTools via window.__testDsl(). The "good" samples are
// typed as the inferred DSL type, so `tsc` already guarantees they're structurally valid.

import type { z } from "zod";
import { toProviderJsonSchema } from "./jsonSchema";
import { SyllabusSchema, type SyllabusDSL } from "./syllabus";
import { CourseOutlineSchema, type CourseOutlineDSL } from "./course";

const FORBIDDEN = ["$ref", "$defs", "definitions", "anyOf", "oneOf", "allOf", "$schema"];

const goodSyllabus: SyllabusDSL = {
  id: "s1",
  course_id: "c1",
  level: 1,
  title: "Foundations of Limits",
  description: "An introduction to the concept of limits.",
  learning_objectives: ["Define a limit", "Evaluate simple limits", "Recognize discontinuities"],
  subtopics: [
    { id: "1.1", title: "What is a limit", key_concepts: ["approach", "neighborhood"], practice_type: "reading", mastered: false },
    { id: "1.2", title: "One-sided limits", key_concepts: ["left", "right"], practice_type: "problem_set", mastered: false, practiced: true },
  ],
  assessment_criteria: ["Can evaluate a limit", "Can identify a discontinuity"],
  estimated_hours: 6,
  generated_at: "2026-01-01T00:00:00Z",
};

const goodOutline: CourseOutlineDSL = {
  levels: [
    { level: 1, title: "Foundations", focus_areas: ["limits", "continuity", "notation"], key_outcomes: ["evaluate limits", "read notation"], bridge: "Limits set up the derivative." },
  ],
  mastery_exam: {
    domains: ["limits", "derivatives", "integrals", "series", "applications"],
    synthesis_skills: ["model a rate", "optimize", "approximate"],
    scenarios: ["physics motion", "economics marginal cost"],
  },
};

interface DslCheck { name: string; ok: boolean; detail?: string }

export function verifyDslRoundTrip(): { ok: boolean; checks: DslCheck[] } {
  const checks: DslCheck[] = [];
  const cases: Array<[string, z.ZodType, unknown, unknown]> = [
    ["Syllabus", SyllabusSchema, goodSyllabus, { id: 1, level: "nope" }],
    ["CourseOutline", CourseOutlineSchema, goodOutline, { levels: "not-an-array" }],
  ];
  for (const [name, schema, good, bad] of cases) {
    const js = JSON.stringify(toProviderJsonSchema(schema));
    const clean = FORBIDDEN.every((f) => !js.includes(`"${f}"`));
    checks.push({ name: `${name}: provider-safe JSON Schema`, ok: clean, detail: clean ? undefined : "forbidden keyword present" });
    checks.push({ name: `${name}: accepts valid sample`, ok: schema.safeParse(good).success });
    checks.push({ name: `${name}: rejects invalid sample`, ok: !schema.safeParse(bad).success });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__testDsl = () => {
    const r = verifyDslRoundTrip();
    console.table(r.checks);
    console.log(r.ok ? "[dsl] ✓ round-trip OK" : "[dsl] ✗ failures above");
    return r.ok;
  };
}
