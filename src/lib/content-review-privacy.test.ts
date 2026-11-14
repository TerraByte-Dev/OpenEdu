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
import { generateQuizQuestions, generatePromotionTestQuestions, gradeAnswersBatch, generateStudyPlan } from "./quiz";
import { buildLessonReviewMessages, resolveReviewConfig } from "./content-review";
import { isLocalModel } from "./privacy";
import type { LessonContent } from "./lesson-format";
import type { LLMConfig, QuizQuestion, Syllabus } from "../types";

const GEN = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as LLMConfig;
const CLOUD_REVIEW = { provider: "anthropic", model: "cloud-reviewer", modelTier: "large" } as LLMConfig;
// Lane 1's Plus shape: a cloud model generates. Its key is a placeholder; nothing is sent anywhere.
const CLOUD_GEN = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key", modelTier: "large" } as LLMConfig;

type Call = { tool: string; content: string; model: string; provider: string };
let calls: Call[] = [];
const LESSON: LessonContent = { summary: "Fractions name equal parts of a whole thing.", sections: [
  { heading: "Halves", body: "Cut a pizza into two equal parts and each part is one half of it." },
  { heading: "Thirds", body: "Three equal parts make thirds, so one third is smaller than one half." },
], key_takeaways: ["Equal parts matter.", "More parts means smaller parts."] };
function stub() {
  calls = [];
  let n = 0;
  // quiz.ts shuffles multiple-choice options; a fixed draw makes both runs comparable.
  vi.spyOn(Math, "random").mockReturnValue(0.42);
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, config, opts) => {
    const content = messages.map((m) => m.content).join("\n");
    calls.push({ tool: opts.toolName ?? "", content, model: config.model, provider: config.provider });
    switch (opts.toolName) {
      case "emit_lesson":
        return structuredClone(LESSON) as never;
      case "emit_quiz_questions": { // the cloud path asks for a batch per subtopic
        const count = Number(/Generate (\d+) quiz question/.exec(content)?.[1] ?? 1);
        return { questions: Array.from({ length: count }, () => {
          n++;
          return { question_text: `Which fraction is larger, item ${n}: 1/2 or 1/3?`, question_type: "multiple_choice",
            options: [`A) 1/2 (item ${n})`, "B) 1/3", "C) They are equal", "D) Neither"], correct_answer: `A) 1/2 (item ${n})`, difficulty_level: 1,
            explanation: `Halves are bigger than thirds. Therefore the answer is A) 1/2 (item ${n})`, subtopic_id: "1.1", blank_position: "", matching_pairs: [] };
        }) } as never;
      }
      case "emit_quiz_question":
        n++; // a different key each time, so the near-duplicate filter keeps them all
        return { question_text: `Which fraction is larger, item ${n}: 1/2 or 1/3?`, question_type: "multiple_choice",
          options: [`A) 1/2 (item ${n})`, "B) 1/3", "C) They are equal", "D) Neither"], correct_answer: `A) 1/2 (item ${n})`, difficulty_level: 1,
          explanation: `Halves are bigger than thirds. Therefore the answer is A) 1/2 (item ${n})`, subtopic_id: "1.1", blank_position: "", matching_pairs: [] } as never;
      case "emit_grades": { // one verdict per [index N] the grading prompt lists
        const indexes = [...content.matchAll(/\[index (\d+)\]/g)].map((m) => Number(m[1]));
        return { results: indexes.map((index) => ({ index, correct: false, feedback: "Not quite." })) } as never;
      }
      case "emit_study_plan":
        return { items: ["Review how to compare fractions with unlike denominators.", "Practice with fraction strips.", "Retake a short quiz."] } as never;
      default:
        return { verdicts: [] } as never;
    }
  });
}
const reviewPayloads = () => calls.filter((c) => c.model === CLOUD_REVIEW.model).map((c) => c.content);
// Every payload that would leave this computer, whatever job it is for.
const cloudPayloads = () => calls.filter((c) => !isLocalModel({ provider: c.provider as LLMConfig["provider"], model: c.model })).map((c) => c.content);

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

  it("quiz: the missed questions stay with the local generation model; the review sees only fresh questions, the same as for a fresh learner", async () => {
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

// Lane 1 (TerraTutor docs/CLOUD-PRIVACY.md): which questions a learner missed stays on the computer.
// The pool's verify pass ran on the generation model, so a cloud generation model received it (B10
// audit, caveat 5). Now it runs only on a local model, or not at all.
describe("with a cloud generation model, the missed questions never leave the computer", () => {
  const LOCAL = { provider: "ollama", model: "gemma4:e4b", modelTier: "small" } as LLMConfig;

  it("no cloud-bound payload holds the pool, and the cloud payloads match a fresh learner's", async () => {
    full = false; stub();
    await generateQuizQuestions(syllabus, 8, { ...CLOUD_GEN }, [], undefined, { ...CLOUD_REVIEW }, { ...LOCAL });
    const fresh = cloudPayloads();
    full = true; stub();
    const qs = await generateQuizQuestions(syllabus, 10, { ...CLOUD_GEN }, MISSED, undefined, { ...CLOUD_REVIEW }, { ...LOCAL });
    const history = cloudPayloads();

    expect(qs.filter((q) => q.question_text.startsWith("Missed by"))).toHaveLength(2);
    expect(fresh.length).toBeGreaterThan(0);
    expect(history).toEqual(fresh);
    assertLearnerFree(history);
    // The pool was still checked, on the local model.
    const verify = calls.filter((c) => c.tool === "emit_verdicts");
    expect(verify.length).toBe(1);
    expect(verify[0]).toMatchObject({ provider: "ollama", model: LOCAL.model });
    expect(verify[0].content).toContain("Missed by");
  });

  it("skips the pool's verify pass when no local model is given, rather than use the cloud", async () => {
    full = true; stub();
    for (const verifier of [undefined, null, { ...CLOUD_GEN }, { provider: "ollama", model: "gpt-oss:120b-cloud" } as LLMConfig]) {
      calls = [];
      const qs = await generateQuizQuestions(syllabus, 10, { ...CLOUD_GEN }, MISSED, undefined, { ...CLOUD_REVIEW }, verifier);
      expect(qs.filter((q) => q.question_text.startsWith("Missed by"))).toHaveLength(2);
      expect(calls.some((c) => c.tool === "emit_verdicts")).toBe(false);
      assertLearnerFree(cloudPayloads());
    }
  });
});

// review_model "<provider>:<model>": a local model writes, a cloud model checks. The cloud request is
// built by the same review builders, so it carries the topic, the title and the generated lesson only.
describe("a cloud reviewer on another provider", () => {
  const review = () => resolveReviewConfig("anthropic:claude-haiku-5-5", { ...GEN }, "tiny", ["anthropic"], "lesson", { anthropic: { apiKey: "test-key" } });

  it("gets exactly the review builder's payload, identical for a fresh learner and one with a history", async () => {
    expect(review()).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key" });
    full = false; stub();
    await generateLesson("c1", 1, { id: "1.1", title: "Comparing fractions", key_concepts: ["halves"] }, "Fractions", { ...GEN }, undefined, review());
    const fresh = cloudPayloads();
    full = true; stub();
    await generateLesson("c1", 1, { id: "1.1", title: "Comparing fractions", key_concepts: ["halves"] }, "Fractions", { ...GEN }, undefined, review());
    const history = cloudPayloads();

    expect(history).toEqual(fresh);
    expect(history).toEqual([buildLessonReviewMessages("Fractions", "Comparing fractions", LESSON).map((m) => m.content).join("\n")]);
    // The lesson itself was written on the local model.
    expect(calls.find((c) => c.tool === "emit_lesson")).toMatchObject({ provider: "ollama", model: GEN.model });
    assertLearnerFree(history);
  });
});

// Lane 1 also keeps the learner's own words and their misses on the computer: free-text answers sent for
// grading (quiz.ts gradeAnswersBatch) and the missed questions behind the study plan after a failed test
// (generateStudyPlan). Both used to go to the generation model, so a cloud generation model received
// them. Now each runs only on a local model (the screens pass store.ts getLocalVerifyConfig); given a
// cloud model or none, nothing is sent and code decides instead.
describe("with a cloud generation model, a learner's answers and missed questions never leave the computer", () => {
  const LOCAL = { provider: "ollama", model: "gemma4:e4b", modelTier: "small" } as LLMConfig;
  const ANSWER = "my nana on Example Lane says the bigger bottom number wins";
  const ANSWERS = [
    { index: 0, question: "Explain why 1/2 is larger than 1/3.", expected: "Halves are bigger pieces than thirds.", student: ANSWER, type: "written_response" },
    { index: 1, question: "Write 0.5 as a fraction.", expected: "1/2", student: "1/2", type: "short_answer" },
  ];
  const MISSED_PLAN = MISSED.map((q) => ({ question_text: q.question_text, correct_answer: q.correct_answer, explanation: q.explanation }));
  const CLOUD_CONFIGS: Array<LLMConfig | null> = [
    { ...CLOUD_GEN }, { provider: "openai", model: "gpt-6.1-sol", apiKey: "test-key" } as LLMConfig,
    { provider: "ollama", model: "gpt-oss:120b-cloud" } as LLMConfig, null,
  ];

  it("grading: no cloud-bound payload holds the answer; the fuzzy answer is passed by code, not sent", async () => {
    for (const config of CLOUD_CONFIGS) {
      full = true; stub();
      const out = await gradeAnswersBatch(ANSWERS, config);
      expect(cloudPayloads().join(" ")).not.toContain("Example Lane");
      expect(calls).toHaveLength(0);
      expect(out.get(1)).toMatchObject({ isCorrect: true, by: "exact" });
      expect(out.get(0)).toMatchObject({ isCorrect: true, by: "fallback" });
    }
  });

  it("grading: a local model still marks the answer (positive control)", async () => {
    full = true; stub();
    const out = await gradeAnswersBatch(ANSWERS, { ...LOCAL });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "ollama", tool: "emit_grades" });
    expect(calls[0].content).toContain("Example Lane");
    expect(out.get(0)).toMatchObject({ isCorrect: false, by: "model" });
  });

  it("study plan: no cloud-bound payload holds a missed question; the plan code writes is shown", async () => {
    for (const config of CLOUD_CONFIGS) {
      full = true; stub();
      const plan = await generateStudyPlan("Fractions", 1, MISSED_PLAN, config);
      expect(calls).toHaveLength(0);
      assertLearnerFree(cloudPayloads());
      expect(plan).toContain(`• Review "${MISSED_PLAN[0].question_text}"`);
    }
  });

  it("study plan: a local model still writes it (positive control)", async () => {
    full = true; stub();
    const plan = await generateStudyPlan("Fractions", 1, MISSED_PLAN, { ...LOCAL });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "ollama", tool: "emit_study_plan" });
    expect(calls[0].content).toContain("3/8");
    expect(plan).toContain("• Practice with fraction strips.");
  });
});
