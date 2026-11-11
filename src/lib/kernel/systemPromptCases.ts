// Inputs for systemPrompt-master.test.ts: buildSystemPrompt arguments covering every slot (empty
// instructions, a full syllabus, progress, knowledge, a mode suffix, a persona). The fixture in
// __fixtures__/system-prompt-master.json holds the prompts master (86aadaa) built from them, before
// learner grades existed (#243).
import type { Syllabus } from "../../types";
import type { buildSystemPrompt } from "../curriculum";

const SYLLABUS: Syllabus = {
  id: "s-1",
  course_id: "c-1",
  level: 2,
  title: "Adding fractions",
  description: "Add fractions with like and unlike denominators.",
  learning_objectives: ["Add fractions with the same denominator", "Find a common denominator"],
  subtopics: [
    { id: "t-1", title: "Like denominators", key_concepts: ["numerator", "denominator"], practice_type: "problems", mastered: true },
    { id: "t-2", title: "Unlike denominators", key_concepts: ["common denominator", "equivalent fractions"], practice_type: "problems", mastered: false },
  ],
  assessment_criteria: ["Adds 1/2 + 1/3 correctly"],
  estimated_hours: 2,
  generated_at: "2026-11-10T00:00:00Z",
};

/** buildSystemPrompt's arguments as master took them: everything before the reading-level slot. */
export type MasterPromptArgs = [
  instructions: Record<string, string>,
  syllabus: Syllabus | null,
  courseLevel: number,
  topic: string,
  modePromptSuffix?: string,
  knowledgeSummary?: string,
  personaIdentity?: string,
];

// Compile-time check that MasterPromptArgs still lines up with the real signature.
const _check: (...a: MasterPromptArgs) => string = null as unknown as typeof buildSystemPrompt;
void _check;

export const PROMPT_CASES: Array<{ name: string; args: MasterPromptArgs }> = [
  { name: "empty instructions, no syllabus", args: [{}, null, 1, "Fractions"] },
  {
    name: "every slot filled",
    args: [
      {
        identity: "You are Pip, a patient math tutor.",
        pedagogy: "Ask what the student already knows before explaining.",
        rules: "Never give the final answer before the student tries.",
        progress_context: "Mastered: like denominators. Working on: unlike denominators.",
      },
      SYLLABUS,
      2,
      "Fractions",
      "\n\n## Mode\nAsk one guiding question at a time.",
      "The student confuses numerator and denominator.",
      "You are Nova, a calm guide who speaks simply.",
    ],
  },
];
