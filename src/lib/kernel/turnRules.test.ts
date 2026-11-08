import { describe, it, expect, vi, beforeEach } from "vitest";

// The system prompt the kernel actually sends, per turn type, for the two ways ChatTab builds one.
// The model call is the only stand-in: the prompt is built with buildSystemPrompt + chatTurnSkills,
// the functions ChatTab calls, and sent through tutorEngine.run, the function ChatTab calls.
//
// Every non-reveal turn must send the same bytes as before the worked-answer turn policy (lever L1,
// docs/BENCHMARKS.md section 3) existed. The snapshot file pins those bytes.

type Sent = Array<{ role: string; content: string }>;
const sent: Sent[] = [];

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "text" as const, delta: "Here is the next step." };
    yield { type: "done" as const, finishReason: "stop" as const };
  }),
}));

import { tutorEngine } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { personaIdentityLayer } from "./systemPrompt";
import { SHOW_ANSWER_MESSAGE } from "./suggestions";
import { OUTPUT_RULES, WORKED_ANSWER_RULES } from "./outputRules";
import { buildSystemPrompt } from "../curriculum";
import { resolvePersona } from "../skills";
import type { Syllabus, LLMConfig } from "../../types";

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;

// Made-up content. Nothing here comes from an eval item.
const PROBLEM = "A recipe needs 3 cups of flour for every 2 cups of milk. How many cups of flour go with 8 cups of milk?";
const ATTEMPT = "Is it 10?";

const SYLLABUS: Syllabus = {
  id: "syl-1",
  course_id: "c-1",
  level: 2,
  title: "Energy and motion",
  description: "How things move and why.",
  learning_objectives: ["Describe kinetic and potential energy"],
  subtopics: [
    { id: "s1", title: "Kinetic energy", key_concepts: ["mass", "speed"], practice_type: "problem", mastered: true },
    { id: "s2", title: "Potential energy", key_concepts: ["height"], practice_type: "problem", mastered: false },
  ],
  assessment_criteria: ["Solves one-step energy problems"],
  estimated_hours: 2,
  generated_at: "2026-01-01T00:00:00Z",
};

interface Course {
  mode: string;
  topic: string;
  instructions: Record<string, string>;
  syllabus: Syllabus | null;
  level: number;
  knowledge?: string;
  spriteId?: string;
}

const COURSES: Record<string, Course> = {
  // The shape the k12-flow eval runs: no stored instructions, no persona, no syllabus.
  "bare math course, explain": { mode: "explain", topic: "Mathematics", instructions: {}, syllabus: null, level: 1 },
  // A full course: generated instructions, a syllabus, a persona, a knowledge summary, socratic mode.
  "full science course, socratic": {
    mode: "socratic",
    topic: "Physics",
    instructions: { pedagogy: "Build from what the student already knows.", rules: "Use metric units.", progress_context: "Mastered 1 of 2 subtopics." },
    syllabus: SYLLABUS,
    level: 2,
    knowledge: "Confuses mass and weight.",
    spriteId: "nova",
  },
};

// The kernel's own report, in its result, of whether the last prompt it sent carried the worked-answer rules.
let lastWorkedAnswerRules: boolean | null = null;

// What ChatTab does on send, minus React and the DB: build the system prompt, then tutorEngine.run.
async function systemSent(course: Course, history: Sent, userText: string): Promise<string> {
  const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills(course.mode, course.topic, "tiny", false);
  const system = buildSystemPrompt(
    course.instructions,
    course.syllabus,
    course.level,
    course.topic,
    skillSuffix,
    course.knowledge,
    personaIdentityLayer(resolvePersona(course.spriteId) ?? null),
  );
  sent.length = 0;
  lastWorkedAnswerRules = null;
  ({ workedAnswerRules: lastWorkedAnswerRules } = await tutorEngine.run(
    { messages: [{ role: "system", content: system }, ...history, { role: "user", content: userText }], config: CONFIG, retrieval: "off", onText: () => {} },
    {
      courseId: "c-1",
      level: course.level,
      syllabus: course.syllabus,
      modelTier: "tiny",
      contextTokens: 8192,
      permissionMode: "default",
      config: CONFIG,
      abort: new AbortController().signal,
      activeSkill,
      domainSkill,
      supportsTools: false,
    },
  ));
  expect(sent).toHaveLength(1);
  expect(sent[0][0].role).toBe("system");
  return sent[0][0].content;
}

const AFTER_ATTEMPT: Sent = [
  { role: "user", content: PROBLEM },
  { role: "assistant", content: "What do you get when you scale both amounts by the same number?" },
  { role: "user", content: ATTEMPT },
  { role: "assistant", content: "Not quite. Which number turns the 2 cups of milk into 8?" },
];

// The same try, but the tutor's reply after it is one ChatTab offers no show-answer chip under.
const triedThen = (reply: string): Sent => [...AFTER_ATTEMPT.slice(0, 3), { role: "assistant", content: reply }];

// Turns that are not the show-answer chip. Includes near-misses of its text: only the exact message
// the chip sends is the event.
const OTHER_TURNS: Array<[string, Sent, string]> = [
  ["new problem", [], PROBLEM],
  ["a try at the problem", AFTER_ATTEMPT.slice(0, 2), ATTEMPT],
  ["hint chip", AFTER_ATTEMPT, "Give me a hint."],
  ["walk-through chip", AFTER_ATTEMPT, "Walk me through it."],
  ["chip label typed", AFTER_ATTEMPT, "Show me the answer"],
  ["no full stop", AFTER_ATTEMPT, SHOW_ANSWER_MESSAGE.slice(0, -1)],
  ["lower case", AFTER_ATTEMPT, SHOW_ANSWER_MESSAGE.toLowerCase()],
  ["extra words after", AFTER_ATTEMPT, `${SHOW_ANSWER_MESSAGE} Please.`],
  ["extra words before", AFTER_ATTEMPT, `Please. ${SHOW_ANSWER_MESSAGE}`],
  ["quoted", AFTER_ATTEMPT, `"${SHOW_ANSWER_MESSAGE}"`],
  ["trailing space", AFTER_ATTEMPT, `${SHOW_ANSWER_MESSAGE} `],
  ["after the answer was shown", [...AFTER_ATTEMPT, { role: "user", content: SHOW_ANSWER_MESSAGE }, { role: "assistant", content: "Step 1. Final answer: 12" }], "Thanks. Can I try another?"],
  // The exact chip text when the chip was not offered: typed or pasted, it is not the chip.
  ["chip text as the first message", [], SHOW_ANSWER_MESSAGE],
  ["chip text before any try", AFTER_ATTEMPT.slice(0, 2), SHOW_ANSWER_MESSAGE],
  ["chip text after a reply that asked nothing", triedThen("Not quite. Scale both amounts by 4: 3 × 4 = 12 cups of flour."), SHOW_ANSWER_MESSAGE],
  ["chip text after a reply too short for chips", triedThen("Not quite. Which number turns 2 into 8?"), SHOW_ANSWER_MESSAGE],
  ["chip text after a stopped reply", triedThen("Not quite. Which number turns the 2 cups of milk into 8?\n\n_[stopped]_"), SHOW_ANSWER_MESSAGE],
];

beforeEach(() => { sent.length = 0; });

describe.each(Object.entries(COURSES))("system prompt sent by the kernel: %s", (name, course) => {
  it("is the same bytes on every turn that is not the show-answer chip", async () => {
    const normal = await systemSent(course, [], PROBLEM);
    expect(normal).toMatchSnapshot(`${name} :: every other turn`);
    for (const [label, history, text] of OTHER_TURNS) {
      expect(await systemSent(course, history, text), label).toBe(normal);
    }
  });

  it("show-answer chip turn", async () => {
    expect(await systemSent(course, AFTER_ATTEMPT, SHOW_ANSWER_MESSAGE)).toMatchSnapshot(`${name} :: show-answer chip`);
  });

  it("swaps only the output rules on the show-answer chip turn", async () => {
    const normal = await systemSent(course, [], PROBLEM);
    const reveal = await systemSent(course, AFTER_ATTEMPT, SHOW_ANSWER_MESSAGE);
    expect(normal.endsWith(OUTPUT_RULES)).toBe(true);
    expect(reveal).toBe(normal.slice(0, -OUTPUT_RULES.length) + WORKED_ANSWER_RULES);
  });

  it("reports in its result whether the prompt it sent ended with the worked-answer rules", async () => {
    expect((await systemSent(course, AFTER_ATTEMPT, SHOW_ANSWER_MESSAGE)).endsWith(WORKED_ANSWER_RULES)).toBe(true);
    expect(lastWorkedAnswerRules).toBe(true);
    for (const [label, history, text] of OTHER_TURNS) {
      expect((await systemSent(course, history, text)).endsWith(WORKED_ANSWER_RULES), label).toBe(false);
      expect(lastWorkedAnswerRules, label).toBe(false);
    }
  });

  it("goes back to the normal rules on the turn after", async () => {
    const normal = await systemSent(course, [], PROBLEM);
    const shown: Sent = [...AFTER_ATTEMPT, { role: "user", content: SHOW_ANSWER_MESSAGE }, { role: "assistant", content: "Step 1. Final answer: 12" }];
    expect(await systemSent(course, shown, "Can I try another one?")).toBe(normal);
  });
});
