import { describe, it, expect, vi } from "vitest";

// A level test that generation left short, or with no review section although the course has earlier
// levels, is not started (PromotionTestFullScreen runs levelTestShortfall on what
// generatePromotionTestQuestions returns), so it is never taken and never promotes: the pass rule
// counts an empty review section as passed. The model call is stubbed; the rest is the app's path.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { callLLMStructured } from "./llm";
import { generatePromotionTestQuestions, levelTestShortfall, TEST_FLOOR } from "./quiz";
import type { LLMConfig, Syllabus } from "../types";

const GEN = { provider: "ollama", model: "gemma4:e4b", modelTier: "small" } as LLMConfig;
const syllabus = (level: number) => ({
  level,
  title: `Motion level ${level}`,
  subtopics: [{ id: `${level}.1`, title: `Describing position ${level}`, key_concepts: ["position", "vectors"] }],
}) as unknown as Syllabus;

let n = 0;
const question = (subtopic: string) => {
  const k = ++n;
  return {
    question_text: `Which quantity has both size and direction, as in example number ${k}?`,
    question_type: "multiple_choice", options: ["A) speed", `B) velocity, case ${k}`, "C) mass", "D) time"],
    correct_answer: `B) velocity, case ${k}`, difficulty_level: 2,
    explanation: `Velocity is speed with a direction. Therefore the answer is B) velocity, case ${k}`, subtopic_id: subtopic, blank_position: "", matching_pairs: [],
  };
};

// The model writes `currentMax` current-level questions, then fails; review questions only when asked.
function model(currentMax: number, reviewWorks: boolean) {
  n = 0;
  let current = 0;
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, _config, opts) => {
    const content = messages.map((m) => m.content).join("\n");
    if (opts.toolName === "emit_verdicts") return { verdicts: [] } as never;
    if (opts.toolName !== "emit_quiz_question") throw new Error(`unexpected tool ${opts.toolName}`);
    if (content.includes("review of earlier material")) {
      if (!reviewWorks) throw new Error("Structured output failed after 3 attempts.");
      return question("1.1") as never;
    }
    if (++current > currentMax) throw new Error("Structured output failed after 3 attempts.");
    return question("2.1") as never;
  });
}

describe("levelTestShortfall on generatePromotionTestQuestions' output", () => {
  it("gives a full test with both sections", async () => {
    model(1000, true);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...GEN });
    expect(t.current.length).toBe(35);
    expect(t.review.length).toBe(10);
    expect(t.reviewWanted).toBe(true);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);

  it("refuses a test whose review section came back empty although the course has earlier levels", async () => {
    model(1000, false);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...GEN });
    expect(t.current.length).toBe(35);
    expect(t.review).toEqual([]);
    expect(levelTestShortfall(t)).toMatch(/earlier levels.*not started and does not count/);
  }, 30_000);

  it("gives a level 1 test, which has no earlier levels to review", async () => {
    model(1000, false);
    const t = await generatePromotionTestQuestions(syllabus(1), [], { ...GEN });
    expect(t.reviewWanted).toBe(false);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);

  it("refuses a test under the floor, as the 6-question run on an 8 GB machine", async () => {
    model(6, true);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...GEN });
    expect(t.current.length).toBe(6);
    expect(t.current.length + t.review.length).toBeLessThan(TEST_FLOOR);
    expect(levelTestShortfall(t)).toMatch(/^Only 16 of 45 questions were made, and a level test needs at least 30\./);
  }, 30_000);

  it("gives a test at the floor", async () => {
    model(TEST_FLOOR - 10, true);
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...GEN });
    expect(t.current.length + t.review.length).toBe(TEST_FLOOR);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);
});
