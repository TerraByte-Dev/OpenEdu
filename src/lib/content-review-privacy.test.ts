import { describe, it, expect, vi } from "vitest";

// Lane 1's rule (TerraTutor docs/CLOUD-PRIVACY.md): a review payload is a function of (topic, generated
// content) alone. These tests run the production generators twice: once for a fresh learner and once
// for a learner with a full history (knowledge files, misconceptions, a learning profile, progress, a
// name, and missed questions in the review pool). Every learner-data reader the app has is stubbed to
// serve that history, so if a generator ever starts reading it, the review payload changes and this fails.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LEARNER_NAME = "Quill Placeholder";
const HISTORY: Record<string, string> = {
  knowledge_map: `${LEARNER_NAME} knows halves and quarters; shaky on thirds.`,
  misconceptions: "Thinks a bigger denominator means a bigger fraction. Lives on Example Lane.",
  learning_profile: "Likes dinosaurs; reads at grade 3; gets frustrated after two misses.",
  study_log: "2026-11-01 missed 3/8 vs 1/2 twice.",
};
let full = false;
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  createLesson: vi.fn(async (courseId: string, level: number, title: string, content: string, subtopicId?: string) =>
    ({ id: "l1", course_id: courseId, level, subtopic_id: subtopicId ?? null, topic_string: title, content, generated_at: "", read_at: null })),
  getTutorInstruction: vi.fn(async (_c: string, type: string) => (full ? HISTORY[type] ?? null : null)),
  getTutorInstructions: vi.fn(async () => (full ? { ...HISTORY } : {})),
  getUserProgress: vi.fn(async () => (full ? { course_id: "c1", current_level: 2, total_time_minutes: 300, quizzes_taken: 9, average_score: 61 } : null)),
  listLearners: vi.fn(async () => [{ id: "default", name: full ? LEARNER_NAME : "Learner", grade: full ? 3 : null }]),
  getQuizAttempts: vi.fn(async () => []),
}));

import { callLLMStructured } from "./llm";
import { generateLesson } from "./curriculum";
import { generateQuizQuestions, generatePromotionTestQuestions } from "./quiz";
import type { LLMConfig, QuizQuestion, Syllabus } from "../types";

const GEN = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as LLMConfig;
const CLOUD_REVIEW = { provider: "anthropic", model: "cloud-reviewer", modelTier: "large" } as LLMConfig;

type Call = { tool: string; content: string; model: string };
let calls: Call[] = [];
function stub() {
  calls = [];
  let n = 0;
  // quiz.ts shuffles multiple-choice options; a fixed draw makes both runs comparable.
  vi.spyOn(Math, "random").mockReturnValue(0.42);
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, config, opts) => {
    const content = messages.map((m) => m.content).join("\n");
    calls.push({ tool: opts.toolName ?? "", content, model: config.model });
    switch (opts.toolName) {
      case "emit_lesson":
        return { summary: "Fractions name equal parts of a whole thing.", sections: [
          { heading: "Halves", body: "Cut a pizza into two equal parts and each part is one half of it." },
          { heading: "Thirds", body: "Three equal parts make thirds, so one third is smaller than one half." },
        ], key_takeaways: ["Equal parts matter.", "More parts means smaller parts."] } as never;
      case "emit_quiz_question":
        n++; // a different key each time, so the near-duplicate filter keeps them all
        return { question_text: `Which fraction is larger, item ${n}: 1/2 or 1/3?`, question_type: "multiple_choice",
          options: [`A) 1/2 (item ${n})`, "B) 1/3", "C) They are equal", "D) Neither"], correct_answer: `A) 1/2 (item ${n})`, difficulty_level: 1,
          explanation: `Halves are bigger than thirds. Therefore the answer is A) 1/2 (item ${n})`, subtopic_id: "1.1", blank_position: "", matching_pairs: [] } as never;
      default:
        return { verdicts: [] } as never;
    }
  });
}
const reviewPayloads = () => calls.filter((c) => c.model === CLOUD_REVIEW.model).map((c) => c.content);

const MISSED: QuizQuestion[] = [1, 2].map((i) => ({
  id: `m${i}`, attempt_id: "a0", question_text: `Missed by ${LEARNER_NAME}: is 3/8 more than 1/2? (${i})`, question_type: "true_false",
  options: null, correct_answer: "False", user_answer: "True", is_correct: false, difficulty_level: 1,
  explanation: "3/8 is less than 4/8. Therefore the answer is False", subtopic_id: "1.1", matching_pairs: null, blank_position: null, self_explanation: "i guessed",
}) as unknown as QuizQuestion);

const syllabus = { level: 1, title: "Fractions", subtopics: [{ id: "1.1", title: "Comparing fractions", key_concepts: ["halves", "thirds"] }] } as unknown as Syllabus;

function assertLearnerFree(payloads: string[]) {
  const all = payloads.join("\n");
  expect(all).not.toContain(LEARNER_NAME);
  expect(all).not.toContain("Example Lane");
  expect(all).not.toContain("dinosaurs");
  expect(all).not.toContain("grade 3");
  expect(all).not.toContain("3/8");
  expect(all).not.toContain("i guessed");
}

describe("the review payload carries no learner data", () => {
  it("lesson: identical for a fresh learner and a learner with a full history", async () => {
    full = false; stub();
    await generateLesson("c1", 1, { id: "1.1", title: "Comparing fractions", key_concepts: ["halves"] }, "Fractions", { ...GEN }, undefined, { ...CLOUD_REVIEW });
    const fresh = reviewPayloads();
    full = true; stub();
    await generateLesson("c1", 1, { id: "1.1", title: "Comparing fractions", key_concepts: ["halves"] }, "Fractions", { ...GEN }, undefined, { ...CLOUD_REVIEW });
    const history = reviewPayloads();

    expect(fresh.length).toBe(1);
    expect(history).toEqual(fresh);
    assertLearnerFree(history);
  });

  it("quiz: the missed questions stay with the generation model; the review sees only fresh questions, the same as for a fresh learner", async () => {
    // 10 questions with 2 missed in the pool = 8 fresh (splitNewVsReview), so the fresh learner asks for 8.
    full = false; stub();
    await generateQuizQuestions(syllabus, 8, { ...GEN }, [], undefined, { ...CLOUD_REVIEW });
    const fresh = reviewPayloads();
    full = true; stub();
    const qs = await generateQuizQuestions(syllabus, 10, { ...GEN }, MISSED, undefined, { ...CLOUD_REVIEW });
    const history = reviewPayloads();

    expect(qs.filter((q) => q.question_text.startsWith("Missed by"))).toHaveLength(2); // the pool was used
    expect(fresh.length).toBeGreaterThan(0);
    expect(history).toEqual(fresh);
    assertLearnerFree(history);
    // The pool's re-check ran, on the generation model.
    expect(calls.some((c) => c.tool === "emit_verdicts" && c.model === GEN.model && c.content.includes("Missed by"))).toBe(true);
  });

  it("promotion test: identical for a fresh learner and a learner with a full history", async () => {
    full = false; stub();
    await generatePromotionTestQuestions(syllabus, [], { ...GEN }, undefined, { ...CLOUD_REVIEW });
    const fresh = reviewPayloads();
    full = true; stub();
    await generatePromotionTestQuestions(syllabus, [], { ...GEN }, undefined, { ...CLOUD_REVIEW });
    const history = reviewPayloads();

    expect(fresh.length).toBeGreaterThan(0);
    expect(history).toEqual(fresh);
    assertLearnerFree(history);
  });
});
