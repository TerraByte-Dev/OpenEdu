import { describe, it, expect, vi, beforeEach } from "vitest";

// The post-turn reflection (updateKnowledgeFiles) through its production path, with the model call and
// the database stubbed. Every model reply below is a raw gemma4:e2b output from the B9 readiness run
// (2026-11-13, readiness.reflect[*].raw), sent back for the exchange it was written about.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("./db", () => ({
  getTutorInstructions: vi.fn(async () => ({})),
  saveTutorInstruction: vi.fn(async () => {}),
}));

import { updateKnowledgeFiles, updateKnowledgeAfterQuiz } from "./knowledge";
import { tutorCorrectedLearner } from "./knowledge-reflect";
import { callLLM } from "./llm";
import { getTutorInstructions, saveTutorInstruction } from "./db";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const fence = (json: string) => "```json\n" + json + "\n```";

/** Runs one exchange through updateKnowledgeFiles and returns what it saved, by file. */
async function reflect(student: string, tutor: string, raw: string): Promise<Record<string, string>> {
  vi.mocked(callLLM).mockResolvedValue(raw);
  await updateKnowledgeFiles("course-1", student, tutor, config);
  return Object.fromEntries(vi.mocked(saveTutorInstruction).mock.calls.map(([, type, text]) => [type, text]));
}

beforeEach(() => {
  vi.mocked(callLLM).mockReset();
  vi.mocked(saveTutorInstruction).mockClear();
  vi.mocked(getTutorInstructions).mockResolvedValue({});
});

describe("updateKnowledgeFiles: a file sent as an array or object is written, not dropped", () => {
  it("writes a study_log array as one entry per line (r01)", async () => {
    const saved = await reflect(
      "Is 6 x 7 equal to 36?",
      "Close! 6 x 6 is 36. 6 x 7 is one more group of 6, so 36 + 6 = 42.",
      fence(`{
  "misconceptions": "Student confused 6 x 7 with 6 x 6. Corrected: 6 x 7 = 42.",
  "study_log": [
    "Reviewed multiplication facts involving 6.",
    "Corrected misconception regarding 6 x 7.",
    "Focus on multiplication facts."
  ]
}`),
    );
    expect(saved.study_log).toBe(
      "Reviewed multiplication facts involving 6.\nCorrected misconception regarding 6 x 7.\nFocus on multiplication facts.",
    );
    expect(saved.misconceptions).toBe("Student confused 6 x 7 with 6 x 6. Corrected: 6 x 7 = 42.");
  });

  it("writes files sent as objects as `key: value` lines (r07)", async () => {
    const saved = await reflect(
      "range(5) gives 1 2 3 4 5.",
      "Not quite. range(5) starts at 0 and stops before 5, so it gives 0, 1, 2, 3, 4.",
      fence(`{
  "knowledge_map": {
    "range(n)": "The student understands that Python's \`range(n)\` function generates numbers starting from 0 up to (but not including) n."
  },
  "misconceptions": {
    "range(n) behavior": "Corrected the misconception that \`range(5)\` includes 5. Explained that the stop value is exclusive."
  },
  "study_log": [
    "Reviewed Python's \`range()\` function behavior.",
    "Corrected the student's understanding of the exclusive stop condition.",
    "Focus remains on sequence generation functions."
  ]
}`),
    );
    expect(saved.knowledge_map).toBe(
      "range(n): The student understands that Python's `range(n)` function generates numbers starting from 0 up to (but not including) n.",
    );
    expect(saved.misconceptions).toBe(
      "range(n) behavior: Corrected the misconception that `range(5)` includes 5. Explained that the stop value is exclusive.",
    );
    expect(saved.study_log?.split("\n")).toHaveLength(3);
  });

  it("parses a reply whose string holds LaTeX (`\\pi` is not a JSON escape) (r05)", async () => {
    const saved = await reflect(
      "The area of a circle with radius 2 is 2 x 3.14 x 2.",
      "That is the circumference formula. Area is pi times r squared: 3.14 x 4 = 12.56.",
      fence(`{
  "misconceptions": "Student confused the area of a circle with the circumference formula. Corrected the area formula ($\\pi r^2$) and demonstrated the calculation.",
  "study_log": [
    "Focused on distinguishing between the area and circumference of a circle.",
    "Corrected a common confusion regarding circle formulas.",
    "Reviewed the area formula and practiced calculations."
  ]
}`),
    );
    expect(saved.study_log).toContain("Focused on distinguishing between the area and circumference of a circle.");
  });
});

describe("updateKnowledgeFiles: no misconception is written when the tutor confirmed the learner", () => {
  // The seven exchanges with no mistake where e2b wrote one anyway, minus those whose text names a
  // person or document. Each other file the model returned is still written.
  const invented: Array<[string, string, string, string]> = [
    ["r02", "So 4 x 5 is like 5 + 5 + 5 + 5, which is 20?", "Exactly right. Four groups of five is 20, and repeated addition shows it.", `{
  "knowledge_map": "Understands the concept of multiplication as repeated addition (e.g., 4 x 5 = 5 + 5 + 5 + 5).",
  "misconceptions": "Corrected the understanding that 4 x 5 equals 20, linking it to repeated addition.",
  "study_log": "Focused on the relationship between multiplication and repeated addition. Student correctly articulated the concept.",
  "learning_profile": "Prefers concrete representations for understanding multiplication concepts."
}`],
    ["r04", "The slope of y = 5x - 1 is 5, right?", "Yes. In y = mx + b the number in front of x is the slope, so m = 5.", `{
  "knowledge_map": "Understands the definition of slope (m) from the slope-intercept form (y = mx + b).",
  "misconceptions": "Corrected misconception: Student initially thought the y-intercept was the slope.",
  "study_log": [
    "Reviewed the definition of slope (m) in linear equations.",
    "Confirmed understanding of y = mx + b structure."
  ]
}`],
    ["r06", "A box 2 by 3 by 4 has a volume of 24 cubic units.", "Correct: 2 x 3 x 4 = 24 cubic units.", `{
  "knowledge_map": "Understands the concept of volume calculation for a rectangular prism (length * width * height = volume).",
  "misconceptions": "Corrected the calculation for the volume of a box (2 x 3 x 4 = 24).",
  "study_log": [
    "Reviewed volume calculation for a 2x3x4 box.",
    "Successfully applied the formula for volume.",
    "Focus remains on solid geometry concepts."
  ]
}`],
    ["r10", "The treble clef spaces spell FACE.", "Yes, F A C E from bottom to top.", `{
  "misconceptions": "Corrected misconception: Treble clef spaces spell 'FACE' from bottom to top.",
  "study_log": [
    "Addressed the misconception that treble clef spaces spell 'FACE'.",
    "Provided the correct reading order for notes on a staff."
  ]
}`],
    ["r12", "The cell membrane controls what goes in and out.", "That's right, it is selectively permeable.", `{
  "knowledge_map": "Understands that the cell membrane is selectively permeable and controls what enters and leaves the cell.",
  "misconceptions": "Corrected the understanding that the cell membrane is permeable by confirming it is selectively permeable.",
  "study_log": [
    "Reviewed the concept of cell membrane permeability.",
    "Confirmed the student's understanding of selective permeability.",
    "Focus on membrane function."
  ]
}`],
  ];

  it.each(invented)("%s", async (_id, student, tutor, json) => {
    const saved = await reflect(student, tutor, fence(json));
    expect(saved).not.toHaveProperty("misconceptions");
    expect(saved.study_log).toBeTruthy();
  });
});

describe("updateKnowledgeFiles: a misconception is written when the tutor corrected the learner", () => {
  const corrected: Array<[string, string, string, string]> = [
    ["r03", "To solve 2x + 4 = 10 I divide by 2 first and get x + 4 = 5.", "Careful: dividing by 2 has to divide every term, giving x + 2 = 5. It is usually easier to subtract 4 first: 2x = 6, so x = 3.",
      "Student incorrectly divided only the first term in the equation (2x + 4 = 10), leading to an incorrect intermediate step (x + 4 = 5). Corrected the rule for dividing both terms."],
    ["r09", "A half note gets half a beat.", "Easy to mix up! A half note gets 2 beats in 4/4 time. It is half of a whole note, which gets 4.",
      "Corrected misconception: Half note duration relative to beats."],
    ["r11", "Animal cells have chloroplasts too, right?", "No, chloroplasts are found in plant cells (and algae). Animal cells get energy from food instead.",
      "Student believed animal cells have chloroplasts. Corrected: Chloroplasts are found in plant cells and algae; animal cells get energy from food."],
    ["r15", "Weather and climate mean the same thing.", "They are related but different: weather is short-term conditions, climate is the long-term average.",
      "Corrected misconception: Weather and climate are not the same."],
    ["r17", "Electrons are in the nucleus with the protons.", "Not quite: protons and neutrons are in the nucleus, and electrons move around outside it.",
      "Student confused the location of electrons and protons. Corrected misconception: Electrons orbit the nucleus, not reside within it."],
  ];

  it.each(corrected)("%s", async (_id, student, tutor, misconception) => {
    const saved = await reflect(student, tutor, fence(JSON.stringify({ misconceptions: misconception })));
    expect(saved.misconceptions).toBe(misconception);
  });
});

describe("tutorCorrectedLearner", () => {
  it("reads only the opening, and a hedged confirmation as a correction", () => {
    expect(tutorCorrectedLearner("Yes, but only for whole numbers. 0 is the exception.")).toBe(true);
    expect(tutorCorrectedLearner("Exactly. A common mistake is to add the bottoms. You did not.")).toBe(false);
    expect(tutorCorrectedLearner("Good question. Plants make food from light. Animals eat. A common mistake is to mix them up.")).toBe(false);
    expect(tutorCorrectedLearner("")).toBe(false);
  });
});

describe("updateKnowledgeAfterQuiz: a bulleted study plan stays on the quiz's one log line", () => {
  it("keeps the score line among the last three entries", async () => {
    vi.mocked(getTutorInstructions).mockResolvedValue({ study_log: "earlier entry" });
    const plan = "• Review comparing fractions.\n• Practice adding fractions.\n• Practice shading fractions.";
    await updateKnowledgeAfterQuiz("course-1", 60, 10, ["s1"], plan, config);
    const log = vi.mocked(saveTutorInstruction).mock.calls.find(([, type]) => type === "study_log")![2];
    const lines = log.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("earlier entry");
    expect(lines[1]).toMatch(/Quiz: 60% \(10 questions\).*Study plan: • Review comparing fractions\. • Practice adding fractions\./);
  });
});
