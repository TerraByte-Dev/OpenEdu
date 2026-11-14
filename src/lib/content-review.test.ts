import { describe, it, expect, vi, beforeEach } from "vitest";

// The content review through the paths the app uses: generateLesson (curriculum.ts) and
// generateQuizQuestions / generatePromotionTestQuestions (quiz.ts), with the model call stubbed by tool
// name. Fixtures are paraphrased from B9 rerun 2's real gemma4:e2b failures (TerraTutor
// src/lib/eval/results/2026-11-14-readiness-r2-e2b.md).
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  createLesson: vi.fn(async (courseId: string, level: number, title: string, content: string, subtopicId?: string) =>
    ({ id: "l1", course_id: courseId, level, subtopic_id: subtopicId ?? null, topic_string: title, content, generated_at: "", read_at: null })),
}));

import { callLLMStructured } from "./llm";
import { generateLesson } from "./curriculum";
import { generateQuizQuestions, generatePromotionTestQuestions } from "./quiz";
import {
  parseReviewFindings, quoteFound, resolveReviewConfig, withoutFlaggedParts, lessonParts,
  type ReviewReply,
} from "./content-review";
import type { LessonContent } from "./lesson-format";
import type { LLMConfig, Syllabus } from "../types";

const GEN = { provider: "ollama", model: "gemma4:e4b", modelTier: "small" } as LLMConfig;
const REVIEW = { provider: "ollama", model: "reviewer:big", modelTier: "large" } as LLMConfig;

type Call = { tool: string; content: string; model: string };
let calls: Call[] = [];
type Handler = (tool: string, content: string, config: LLMConfig) => unknown;
function stub(handler: Handler) {
  calls = [];
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, config, opts) => {
    const content = messages.map((m) => m.content).join("\n");
    const tool = opts.toolName ?? "";
    calls.push({ tool, content, model: config.model });
    return handler(tool, content, config) as never;
  });
}
const reviewCalls = () => calls.filter((c) => c.tool.startsWith("emit_") && c.tool.endsWith("_review"));

// ─── Lessons ──────────────────────────────────────────────────────────────────

const WATER_BAD: LessonContent = {
  summary: "A chemical reaction turns substances into new substances. Here we look at how water is made.",
  sections: [
    { heading: "Making water", body: "When hydrogen burns in oxygen, it produces water and carbon dioxide. This reaction gives off a lot of heat and is used in some rockets." },
    { heading: "Balancing", body: "Two hydrogen molecules react with one oxygen molecule. Counting atoms on each side shows the equation is balanced." },
  ],
  key_takeaways: ["Hydrogen and oxygen react to make water.", "Atoms are conserved in a reaction."],
};
const WATER_GOOD: LessonContent = {
  ...WATER_BAD,
  sections: [
    { heading: "Making water", body: "When hydrogen burns in oxygen, it produces water and nothing else. This reaction gives off a lot of heat and is used in some rockets." },
    WATER_BAD.sections[1],
  ],
};
const EGYPT_BAD: LessonContent = {
  summary: "Ancient Egypt grew up along one great river.",
  sections: [
    { heading: "Where Egypt was", body: "Ancient Egypt was in the Fertile Crescent, between the Tigris and Euphrates rivers. Its farms needed the yearly flood." },
    { heading: "The Nile", body: "The Nile flooded every year and left rich black soil behind, so farmers could grow wheat and flax." },
  ],
  key_takeaways: ["The Nile's floods made farming possible."],
};

const flagWater: ReviewReply = { verdicts: [
  { index: 0, verdict: "ok", sentence: "", reason: "" },
  { index: 1, verdict: "false_fact", sentence: "When hydrogen burns in oxygen, it produces water and carbon dioxide.", reason: "only water; there is no carbon" },
  { index: 2, verdict: "ok", sentence: "", reason: "" },
] };
const allOk: ReviewReply = { verdicts: [] };

describe("generateLesson with a review model", () => {
  it("regenerates once when the review flags a false fact, telling the writer what was false, and saves the fixed lesson", async () => {
    const lessons = [WATER_BAD, WATER_GOOD];
    const reviews = [flagWater, allOk];
    stub((tool) => (tool === "emit_lesson" ? lessons.shift() : reviews.shift()));

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Making water", key_concepts: ["combustion"] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });

    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review", "emit_lesson", "emit_lesson_review"]);
    expect(reviewCalls().every((c) => c.model === "reviewer:big")).toBe(true);
    expect(calls[2].content).toContain("produces water and carbon dioxide");
    expect(calls[2].content).toContain("only water");
    expect(lesson.content).not.toContain("carbon dioxide");
    expect(lesson.content).toContain("produces water and nothing else");
  });

  it("drops a part still flagged after the one regeneration, and never shows the review's words", async () => {
    const flagEgypt: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact", sentence: "Ancient Egypt was in the Fertile Crescent, between the Tigris and Euphrates rivers.", reason: "Egypt is on the Nile, outside the Fertile Crescent" }] };
    const lessons = [EGYPT_BAD, EGYPT_BAD];
    const reviews = [flagEgypt, flagEgypt];
    stub((tool) => (tool === "emit_lesson" ? lessons.shift() : reviews.shift()));

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Egypt", key_concepts: ["Nile"] }, "Ancient history", { ...GEN }, undefined, { ...REVIEW });

    expect(calls.filter((c) => c.tool === "emit_lesson")).toHaveLength(2);
    expect(lesson.content).not.toContain("Fertile Crescent");
    expect(lesson.content).toContain("The Nile flooded every year");
    expect(lesson.content).not.toContain("outside the Fertile Crescent");
  });

  it("fails rather than save a lesson whose every section is still flagged", async () => {
    const flagAll: ReviewReply = { verdicts: [
      { index: 1, verdict: "false_fact", sentence: "Ancient Egypt was in the Fertile Crescent", reason: "x" },
      { index: 2, verdict: "false_fact", sentence: "The Nile flooded every year and left rich black soil behind", reason: "x" },
    ] };
    stub((tool) => (tool === "emit_lesson" ? EGYPT_BAD : flagAll));
    await expect(generateLesson("c1", 1, { id: "s1", title: "Egypt", key_concepts: [] }, "History", { ...GEN }, undefined, { ...REVIEW }))
      .rejects.toThrow(/fact check/i);
  });

  it("ignores a false_fact whose quoted sentence is not in the lesson (a reviewer's invention)", async () => {
    const invented: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact", sentence: "Water boils at 50 degrees on the moon.", reason: "no" }] };
    stub((tool) => (tool === "emit_lesson" ? WATER_GOOD : invented));
    await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review"]);
  });

  it("makes no review call when the review is off (null), so the lesson path is unchanged", async () => {
    stub(() => WATER_BAD);
    await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN });
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson"]);
  });

  it("keeps the lesson when the review call fails", async () => {
    stub((tool) => { if (tool === "emit_lesson_review") throw new Error("timeout"); return WATER_GOOD; });
    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });
    expect(lesson.content).toContain("nothing else");
  });
});

// ─── Questions ────────────────────────────────────────────────────────────────

const syllabus = {
  level: 2,
  title: "Motion",
  subtopics: [{ id: "2.1", title: "Describing position", key_concepts: ["position", "vectors"] }],
} as unknown as Syllabus;

// The generator hands out these in order, then repeats a good one with a fresh stem.
const SCALAR = {
  question_text: "Position tells only how far an object is, so position is a scalar quantity.",
  question_type: "true_false", options: [], correct_answer: "True", difficulty_level: 2,
  explanation: "Position has no direction. Therefore the answer is True", subtopic_id: "2.1", blank_position: "", matching_pairs: [],
};
const WRONG_KEY = {
  question_text: "A car moves 30 meters east and then 10 meters west. What is its displacement?",
  question_type: "multiple_choice", options: ["A) 40 m east", "B) 20 m east", "C) 20 m west", "D) 30 m east"],
  correct_answer: "A) 40 m east", difficulty_level: 2,
  explanation: "Add the distances. Therefore the answer is A) 40 m east", subtopic_id: "2.1", blank_position: "", matching_pairs: [],
};
let goodN = 0;
// Each key differs, so the near-duplicate filter keeps them all.
const good = () => {
  const n = ++goodN;
  return {
    question_text: `Which quantity has both size and direction, as in example number ${n}?`,
    question_type: "multiple_choice", options: ["A) speed", `B) velocity, case ${n}`, "C) mass", "D) time"],
    correct_answer: `B) velocity, case ${n}`, difficulty_level: 2,
    explanation: `Velocity is speed with a direction. Therefore the answer is B) velocity, case ${n}`, subtopic_id: "2.1", blank_position: "", matching_pairs: [],
  };
};

// Flags any question in the review payload that is SCALAR or WRONG_KEY, by its index in that payload.
function judge(content: string): ReviewReply {
  const blocks = content.split(/\[index (\d+)\]/).slice(1);
  const verdicts = [];
  for (let i = 0; i < blocks.length; i += 2) {
    const index = Number(blocks[i]);
    const text = blocks[i + 1];
    if (text.includes("position is a scalar")) verdicts.push({ index, verdict: "false_fact", sentence: "Position tells only how far an object is, so position is a scalar quantity.", reason: "position is a vector" });
    else if (text.includes("30 meters east")) verdicts.push({ index, verdict: "wrong_key", sentence: "", reason: "30 - 10 = 20 m east" });
    else verdicts.push({ index, verdict: "ok", sentence: "", reason: "" });
  }
  return { verdicts };
}

function questionStub(first: unknown[]) {
  goodN = 0;
  const queue = [...first];
  stub((tool, content) => {
    if (tool === "emit_quiz_question") return queue.length ? queue.shift() : good();
    if (tool === "emit_question_review") return judge(content);
    if (tool === "emit_verdicts") return { verdicts: [] };
    throw new Error(`unexpected tool ${tool}`);
  });
}

describe("generateQuizQuestions with a review model", () => {
  beforeEach(() => questionStub([SCALAR, WRONG_KEY]));

  it("drops the false-fact and wrong-key questions and tops up to the target", async () => {
    const qs = await generateQuizQuestions(syllabus, 10, { ...GEN }, [], undefined, { ...REVIEW });
    expect(qs).toHaveLength(10);
    expect(qs.some((q) => q.question_text.includes("scalar"))).toBe(false);
    expect(qs.some((q) => q.question_text.includes("30 meters east"))).toBe(false);
    expect(reviewCalls().length).toBeGreaterThan(0);
    expect(reviewCalls().every((c) => c.model === "reviewer:big")).toBe(true);
    // The review replaces the generation model's own verify pass on fresh questions.
    expect(calls.some((c) => c.tool === "emit_verdicts")).toBe(false);
  });

  it("without a review model keeps the existing verify pass and makes no review call", async () => {
    await generateQuizQuestions(syllabus, 4, { ...GEN }, []);
    expect(reviewCalls()).toHaveLength(0);
    expect(calls.some((c) => c.tool === "emit_verdicts")).toBe(true);
  });
});

describe("generatePromotionTestQuestions with a review model", () => {
  it("drops the flagged questions from the current section", async () => {
    questionStub([SCALAR, WRONG_KEY]);
    const { current } = await generatePromotionTestQuestions(syllabus, [], { ...GEN }, undefined, { ...REVIEW });
    expect(current.length).toBe(35);
    expect(current.some((q) => q.question_text.includes("scalar") || q.question_text.includes("30 meters east"))).toBe(false);
    expect(reviewCalls().length).toBeGreaterThan(0);
  });
});

// ─── Pure pieces ──────────────────────────────────────────────────────────────

describe("parseReviewFindings", () => {
  const items = ["Position is a scalar.", "A square has four equal sides, so its corners are right angles."];
  it("keeps false_fact only with a quote found in the item, and ignores ok, unknown and out-of-range verdicts", () => {
    const f = parseReviewFindings({ verdicts: [
      { index: 0, verdict: "false_fact", sentence: "Position is a scalar", reason: "vector" },
      { index: 1, verdict: "false_fact", sentence: "Triangles have four sides.", reason: "x" },
      { index: 1, verdict: "ok" },
      { index: 7, verdict: "wrong_key" },
      { index: 1, verdict: "bogus" },
    ] }, items, ["ok", "false_fact"]);
    expect(f).toEqual([{ index: 0, verdict: "false_fact", sentence: "Position is a scalar", reason: "vector" }]);
  });
  it("treats a lesson reply that says wrong_key as ok (not a lesson verdict)", () => {
    expect(parseReviewFindings({ verdicts: [{ index: 0, verdict: "wrong_key" }] }, items, ["ok", "false_fact"])).toEqual([]);
  });
  it("returns nothing for a missing reply", () => {
    expect(parseReviewFindings(null, items, ["ok", "false_fact"])).toEqual([]);
  });
});

describe("quoteFound", () => {
  it("accepts the sentence with different quotes, case and spacing, or with words dropped", () => {
    expect(quoteFound("“Z sounds like K.”", "The letter z sounds  like k in many words.")).toBe(true);
    expect(quoteFound("the letter Z sounds like K", "The letter z sounds  like k in many words.")).toBe(true);
    expect(quoteFound("letter sounds like", "The letter z sounds like k in many words.")).toBe(true);
  });
  it("rejects a quote the item never said, and quotes too short to locate", () => {
    expect(quoteFound("Equal sides make right angles", "A square has four equal sides.")).toBe(false);
    expect(quoteFound("is", "This is it.")).toBe(false);
  });
});

describe("withoutFlaggedParts", () => {
  it("removes flagged sections and takeaways by part index", () => {
    const out = withoutFlaggedParts(WATER_BAD, [
      { index: 1, verdict: "false_fact", sentence: "", reason: "" },
      { index: 3, verdict: "false_fact", sentence: "", reason: "" },
    ])!;
    expect(out.sections.map((s) => s.heading)).toEqual(["Balancing"]);
    expect(out.key_takeaways).toEqual(["Atoms are conserved in a reaction."]);
    expect(lessonParts(WATER_BAD)).toHaveLength(5);
  });
});

describe("resolveReviewConfig", () => {
  const gen = { provider: "ollama", model: "gemma4:e2b" } as LLMConfig;
  it("defaults to the generation model; lessons are off on the tiny tier, questions are not", () => {
    expect(resolveReviewConfig(undefined, gen, "small", [], "lesson")?.model).toBe("gemma4:e2b");
    expect(resolveReviewConfig(undefined, gen, "tiny", [], "lesson")).toBeNull();
    expect(resolveReviewConfig("", gen, "tiny", [], "lesson")).toBeNull();
    expect(resolveReviewConfig(undefined, gen, "tiny", [], "questions")).toMatchObject({ model: "gemma4:e2b", modelTier: "tiny" });
  });
  it("honours off and a named model", () => {
    expect(resolveReviewConfig("off", gen, "large", [], "questions")).toBeNull();
    expect(resolveReviewConfig("qwen3.5:9b", gen, "tiny", [], "lesson")).toMatchObject({ provider: "ollama", model: "qwen3.5:9b" });
  });
  it("ignores an Ollama cloud review model whose privacy notice was never confirmed", () => {
    expect(resolveReviewConfig("gpt-oss:120b-cloud", gen, "small", [], "questions")?.model).toBe("gemma4:e2b");
    expect(resolveReviewConfig("gpt-oss:120b-cloud", gen, "small", ["ollama-cloud"], "questions")?.model).toBe("gpt-oss:120b-cloud");
  });
});
