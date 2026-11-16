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
  judgesEveryItem, parseReviewFindings, quoteFound, resolveReviewConfig, withoutFlaggedParts, lessonParts, reviewModelChoices, reviewChoiceNotice,
  type ReviewReply,
} from "./content-review";
import { GENERATION_MODELS } from "./models";
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
  { index: 1, verdict: "false_fact", sentence: "When hydrogen burns in oxygen, it produces water and carbon dioxide.", reason: "only water; there is no carbon", statement_is_false: true },
  { index: 2, verdict: "ok", sentence: "", reason: "" },
] };
const allOk: ReviewReply = { verdicts: [] };

describe("generateLesson with a review model", () => {
  it("regenerates once when the review flags a false fact, telling the writer what was false, and saves the fixed lesson", async () => {
    const lessons = [WATER_BAD, WATER_GOOD];
    const reviews = [flagWater, allOk];
    stub((tool) => (tool === "emit_lesson" ? lessons.shift() : reviews.shift()));

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Making water", key_concepts: ["combustion"] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });

    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review", "emit_lesson", "emit_lesson_review", "emit_stuck_points"]);
    expect(reviewCalls().every((c) => c.model === "reviewer:big")).toBe(true);
    expect(calls[2].content).toContain("produces water and carbon dioxide");
    expect(calls[2].content).toContain("only water");
    expect(lesson.content).not.toContain("carbon dioxide");
    expect(lesson.content).toContain("produces water and nothing else");
  });

  it("drops a part still flagged after the one regeneration, and never shows the review's words", async () => {
    const flagEgypt: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact", sentence: "Ancient Egypt was in the Fertile Crescent, between the Tigris and Euphrates rivers.", reason: "Egypt is on the Nile, outside the Fertile Crescent", statement_is_false: true }] };
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
      { index: 1, verdict: "false_fact", sentence: "Ancient Egypt was in the Fertile Crescent", reason: "x", statement_is_false: true },
      { index: 2, verdict: "false_fact", sentence: "The Nile flooded every year and left rich black soil behind", reason: "x", statement_is_false: true },
    ] };
    stub((tool) => (tool === "emit_lesson" ? EGYPT_BAD : flagAll));
    await expect(generateLesson("c1", 1, { id: "s1", title: "Egypt", key_concepts: [] }, "History", { ...GEN }, undefined, { ...REVIEW }))
      .rejects.toThrow(/fact check/i);
  });

  it("ignores a false_fact whose quoted sentence is not in the lesson (a reviewer's invention)", async () => {
    const invented: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact", sentence: "Water boils at 50 degrees on the moon.", reason: "no", statement_is_false: true }] };
    stub((tool) => (tool === "emit_lesson" ? WATER_GOOD : invented));
    await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review", "emit_stuck_points"]);
  });

  it("does not regenerate for a false_fact the reviewer itself marks as true (B10's false alarms)", async () => {
    // What claude-haiku-5-5 did on 4 of its 5 false alarms: verdict false_fact, quote real, reason "actually true".
    const selfContradicting: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact",
      sentence: "When hydrogen burns in oxygen, it produces water and nothing else.",
      reason: "This is actually true; hydrogen combustion yields only water.", statement_is_false: false }] };
    stub((tool) => (tool === "emit_lesson" ? WATER_GOOD : selfContradicting));
    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review", "emit_stuck_points"]);
    expect(lesson.content).toContain("produces water and nothing else");
  });

  it("asks the reviewer for statement_is_false as a required boolean after its reason", async () => {
    stub((tool) => (tool === "emit_lesson" ? WATER_GOOD : allOk));
    await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN }, undefined, { ...REVIEW });
    const opts = vi.mocked(callLLMStructured).mock.calls.find((c) => c[2].toolName === "emit_lesson_review")![2];
    const item = (opts.schema as { properties: { verdicts: { items: { required: string[]; properties: Record<string, { type: string }> } } } }).properties.verdicts.items;
    expect(item.properties.statement_is_false).toEqual({ type: "boolean" });
    expect(item.required).toContain("statement_is_false");
    expect(Object.keys(item.properties).indexOf("statement_is_false")).toBeGreaterThan(Object.keys(item.properties).indexOf("reason"));
  });

  it("makes no review call when the review is off (null), so the lesson path is unchanged", async () => {
    stub(() => WATER_BAD);
    await generateLesson("c1", 1, { id: "s1", title: "Water", key_concepts: [] }, "Chemistry", { ...GEN });
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_stuck_points"]); // Raise hand's help (raise-hand.ts) follows the lesson
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
    if (text.includes("position is a scalar")) verdicts.push({ index, verdict: "false_fact", sentence: "Position tells only how far an object is, so position is a scalar quantity.", reason: "position is a vector", statement_is_false: true });
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

describe("judgesEveryItem: did the reply settle every part?", () => {
  const ALLOWED = ["ok", "false_fact"] as const;
  const PARTS = ["Water boils at 100 degrees at sea level.", "The Nile is the longest river in Africa.", "Atoms are conserved."];
  const v = (index: number, verdict = "ok") => ({ index, verdict, sentence: "", reason: "", statement_is_false: false });
  const flag = (index: number, sentence: string, statement_is_false = true) => ({ index, verdict: "false_fact", sentence, reason: "x", statement_is_false });
  it("yes when each part has an ok, or a flag the code acts on", () => {
    expect(judgesEveryItem({ verdicts: [v(0), flag(1, "The Nile is the longest river in Africa."), v(2)] }, PARTS, ALLOWED)).toBe(true);
    expect(judgesEveryItem({ verdicts: [v(2), v(0), v(1)] }, PARTS, ALLOWED)).toBe(true);
  });
  it("no for an empty, missing, partial, out-of-range, duplicated or unknown-verdict reply", () => {
    expect(judgesEveryItem({ verdicts: [] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({}, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem(null, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1)] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(3)] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(1)] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(2, "wrong_key")] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(1.5)] }, PARTS, ALLOWED)).toBe(false);
  });
  it("no when a flag was thrown away: a quote not in the part, statement_is_false not true, or a part that does not exist", () => {
    expect(judgesEveryItem({ verdicts: [v(0), flag(1, "The Amazon carries more water than any other river."), v(2)] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), flag(1, "The Nile is the longest river in Africa.", false), v(2)] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(2), flag(3, "Atoms are conserved.")] }, PARTS, ALLOWED)).toBe(false);
    // ...even when the same part also got an ok.
    expect(judgesEveryItem({ verdicts: [v(0), v(1), flag(1, "Rivers flow uphill in winter."), v(2)] }, PARTS, ALLOWED)).toBe(false);
    // A flag that names no part, or a verdict outside the list beside an ok, leaves it unchecked.
    for (const index of [-1, "1", undefined] as unknown as number[]) expect(judgesEveryItem({ verdicts: [v(0), v(1), v(2), { ...flag(1, "The Nile is the longest river in Africa."), index }] }, PARTS, ALLOWED)).toBe(false);
    expect(judgesEveryItem({ verdicts: [v(0), v(1), v(2), v(1, "maybe_wrong")] }, PARTS, ALLOWED)).toBe(false);
  });
});

describe("parseReviewFindings", () => {
  const items = ["Position is a scalar.", "A square has four equal sides, so its corners are right angles."];
  it("keeps false_fact only with a quote found in the item, and ignores ok, unknown and out-of-range verdicts", () => {
    const f = parseReviewFindings({ verdicts: [
      { index: 0, verdict: "false_fact", sentence: "Position is a scalar", reason: "vector", statement_is_false: true },
      { index: 1, verdict: "false_fact", sentence: "Triangles have four sides.", reason: "x", statement_is_false: true },
      { index: 1, verdict: "ok" },
      { index: 7, verdict: "wrong_key" },
      { index: 1, verdict: "bogus" },
    ] }, items, ["ok", "false_fact"]);
    expect(f).toEqual([{ index: 0, verdict: "false_fact", sentence: "Position is a scalar", reason: "vector" }]);
  });
  it("counts a false_fact only when statement_is_false is true, whatever the reason's words say", () => {
    const f = parseReviewFindings({ verdicts: [
      { index: 0, verdict: "false_fact", sentence: "Position is a scalar", reason: "vector", statement_is_false: false },
      { index: 1, verdict: "false_fact", sentence: "A square has four equal sides", reason: "wrong" }, // field missing
    ] }, items, ["ok", "false_fact"]);
    expect(f).toEqual([]);
    // wrong_key and unanswerable do not depend on it.
    expect(parseReviewFindings({ verdicts: [{ index: 0, verdict: "wrong_key", sentence: "", reason: "x", statement_is_false: false }] }, items, ["ok", "wrong_key"]))
      .toEqual([{ index: 0, verdict: "wrong_key", sentence: "", reason: "x" }]);
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
  it("defaults to the generation model; lessons are off on the tiny and small tiers, questions are not", () => {
    expect(resolveReviewConfig(undefined, gen, "medium", [], "lesson")?.model).toBe("gemma4:e2b");
    expect(resolveReviewConfig(undefined, gen, "large", [], "lesson")?.model).toBe("gemma4:e2b");
    expect(resolveReviewConfig(undefined, gen, "small", [], "lesson")).toBeNull();
    expect(resolveReviewConfig(undefined, gen, "small", [], "questions")).toMatchObject({ model: "gemma4:e2b", modelTier: "small" });
    expect(resolveReviewConfig(undefined, gen, "tiny", [], "lesson")).toBeNull();
    expect(resolveReviewConfig("", gen, "tiny", [], "lesson")).toBeNull();
    expect(resolveReviewConfig(undefined, gen, "tiny", [], "questions")).toMatchObject({ model: "gemma4:e2b", modelTier: "tiny" });
  });
  it("honours off and a named model", () => {
    expect(resolveReviewConfig("off", gen, "large", [], "questions")).toBeNull();
    expect(resolveReviewConfig("qwen3.5:9b", gen, "tiny", [], "lesson")).toMatchObject({ provider: "ollama", model: "qwen3.5:9b" });
    // Naming the generation model on purpose turns the lesson review on even on tiny.
    expect(resolveReviewConfig("gemma4:e2b", gen, "tiny", [], "lesson")).toMatchObject({ model: "gemma4:e2b", modelTier: "tiny" });
  });
  it("ignores an Ollama cloud review model whose privacy notice was never confirmed", () => {
    expect(resolveReviewConfig("gpt-oss:120b-cloud", gen, "small", [], "questions")?.model).toBe("gemma4:e2b");
    expect(resolveReviewConfig("gpt-oss:120b-cloud", gen, "small", ["ollama-cloud"], "questions")?.model).toBe("gpt-oss:120b-cloud");
  });

  describe("<provider>:<model> names a model on another configured provider", () => {
    const creds = { anthropic: { apiKey: "test-key" }, ollama: { ollamaUrl: "http://127.0.0.1:11434" } };
    it("a local writer with a cloud checker, once that provider's notice is accepted and its key saved", () => {
      const r = resolveReviewConfig("anthropic:claude-haiku-5-5", gen, "tiny", ["anthropic"], "lesson", creds);
      expect(r).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key" });
    });
    it("falls back to the default when the notice was never accepted or no key is saved", () => {
      expect(resolveReviewConfig("anthropic:claude-haiku-5-5", gen, "tiny", [], "lesson", creds)).toBeNull();
      expect(resolveReviewConfig("anthropic:claude-haiku-5-5", gen, "medium", [], "questions", creds)).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
      expect(resolveReviewConfig("anthropic:claude-haiku-5-5", gen, "tiny", ["anthropic"], "lesson", {})).toBeNull();
      expect(resolveReviewConfig("openai:gpt-6-luna", gen, "tiny", ["openai"], "lesson", creds)).toBeNull(); // no OpenAI key
    });
    it("a cloud writer with a local checker; an Ollama cloud model still needs its own notice", () => {
      const cloud = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k" } as LLMConfig;
      expect(resolveReviewConfig("ollama:qwen3.5:9b", cloud, "large", [], "lesson", creds)).toEqual({ provider: "ollama", model: "qwen3.5:9b", ollamaUrl: "http://127.0.0.1:11434" });
      expect(resolveReviewConfig("ollama:gpt-oss:120b-cloud", cloud, "large", [], "lesson", creds)).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5" });
    });
    it("an Ollama tag is not a provider prefix, and the generation provider's own prefix is just the model", () => {
      expect(resolveReviewConfig("qwen3.5:9b", gen, "tiny", [], "lesson", creds)).toMatchObject({ provider: "ollama", model: "qwen3.5:9b" });
      expect(resolveReviewConfig("ollama:qwen3.5:9b", gen, "tiny", [], "lesson", creds)).toMatchObject({ provider: "ollama", model: "qwen3.5:9b" });
    });
  });
});

// Settings › Models › Checking model (ReviewModelPicker.tsx) offers these choices and asks the cloud
// notice these helpers name before it saves review_model.
describe("reviewModelChoices: what the Checking model setting offers", () => {
  it("same as the course model and off first, then installed Ollama models, then each provider with a saved key", () => {
    const choices = reviewModelChoices({ ollamaModels: ["gemma4:e4b", "nomic-embed-text:latest"], cloudKeys: { anthropic: true }, stored: "" });
    expect(choices.slice(0, 2)).toEqual([
      { value: "", label: "Same as the course model", group: "default" },
      { value: "off", label: "Off", group: "default" },
    ]);
    expect(choices.filter((c) => c.group === "ollama").map((c) => c.value)).toEqual(["ollama:gemma4:e4b"]); // no embedding model
    expect(choices.filter((c) => c.group === "openai")).toEqual([]); // no OpenAI key saved
    const anthropic = choices.filter((c) => c.group === "anthropic").map((c) => c.value);
    expect(anthropic).toEqual(GENERATION_MODELS.anthropic.map((m) => `anthropic:${m.id}`));
    expect(anthropic).toContain("anthropic:claude-sonnet-5-5");
  });

  it("keeps a stored value that is not offered (a hand-typed or imported one) visible as its own choice", () => {
    const choices = reviewModelChoices({ ollamaModels: [], cloudKeys: {}, stored: "anthropic:claude-haiku-5-5" });
    expect(choices[choices.length - 1]).toEqual({ value: "anthropic:claude-haiku-5-5", label: "anthropic:claude-haiku-5-5", group: "anthropic" });
    expect(reviewModelChoices({ ollamaModels: [], cloudKeys: {}, stored: "off" })).toHaveLength(2);
  });
});

describe("reviewChoiceNotice: the confirm a Checking model choice needs before it is saved", () => {
  it("names the cloud company whose notice was not accepted here", () => {
    expect(reviewChoiceNotice("anthropic:claude-sonnet-5-5", [])).toBe("anthropic");
    expect(reviewChoiceNotice("openai:gpt-6.1-sol", ["anthropic"])).toBe("openai");
    expect(reviewChoiceNotice("ollama:gpt-oss:120b-cloud", [])).toBe("ollama-cloud");
  });

  it("needs none for a local model, off, the default, or a company already confirmed", () => {
    for (const v of ["", "off", "ollama:gemma4:e4b", "gemma4:e2b"]) expect(reviewChoiceNotice(v, []), v).toBeNull();
    expect(reviewChoiceNotice("anthropic:claude-sonnet-5-5", ["anthropic"])).toBeNull();
    expect(reviewChoiceNotice("ollama:gpt-oss:120b-cloud", ["ollama-cloud"])).toBeNull();
  });
});

describe("resolveReviewConfig with an imported value that is not a string", () => {
  it("treats it as unset instead of throwing", () => {
    const gen = { provider: "ollama", model: "gemma4:e2b" } as LLMConfig;
    expect(resolveReviewConfig(42 as unknown as string, gen, "medium", [], "questions")).toMatchObject({ model: "gemma4:e2b" });
  });
});
