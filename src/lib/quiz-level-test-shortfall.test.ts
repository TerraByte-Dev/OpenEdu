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
import { generatePromotionTestQuestions, levelTestReviewLevels, levelTestShortfall, levelTestTarget, TEST_FLOOR, SAME_KEY_CAP } from "./quiz";
import { dedupeByQuestionText, keyForm } from "./quiz-grading";
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
    // 35 is all a test with no review section is made with: the screen's target says so.
    expect(t.current.length + t.review.length).toBe(levelTestTarget(false));
    expect(levelTestTarget(false)).toBe(35);
  }, 30_000);

  it("says a short level 1 test fell short of 35, not 45", async () => {
    model(6, false);
    const t = await generatePromotionTestQuestions(syllabus(1), [], { ...GEN });
    expect(levelTestShortfall(t)).toMatch(/^Only 6 of 35 questions were made/);
  }, 30_000);

  it("reviews the same levels the screen counts on: the last four earlier levels with subtopics", () => {
    const bare = { ...syllabus(1), subtopics: [] } as Syllabus;
    expect(levelTestReviewLevels([])).toEqual([]);
    expect(levelTestReviewLevels([bare])).toEqual([]);
    expect(levelTestReviewLevels([syllabus(1), syllabus(2), syllabus(3), syllabus(4), bare]).map((s) => s.level)).toEqual([2, 3, 4]);
    expect(levelTestTarget(true)).toBe(45);
  });

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

// TerraTutor live test part 7 issue 3: a level test keyed "Lava" about 9 times in 31, each stem unlike the others.
// One level-test section asks at most SAME_KEY_CAP questions with one key; more are set aside, and fill
// back only to keep the test at its minimum (TEST_FLOOR).
const LAVA_STEMS = [
  "What flows out of an erupting volcano?",
  "What is molten rock called once it reaches the surface?",
  "What glows red as it pours down a mountainside in Hawaii?",
  "Basalt forms when which material cools?",
  "Which hot liquid can bury roads near Kilauea?",
  "Pahoehoe and aa are two kinds of what?",
  "What do volcanologists sample with long metal poles?",
  "Obsidian is glass made from what?",
  "What hardens into new land on a growing island?",
];
const lava = (i: number, sub: string) => i % 2
  ? {
    question_text: LAVA_STEMS[i], question_type: "multiple_choice", options: ["A) Ash", "B) Lava", "C) Steam", "D) Sand"],
    correct_answer: "B) Lava", difficulty_level: 2, explanation: "Molten rock above ground is lava. Therefore the answer is B) Lava",
    subtopic_id: sub, blank_position: "", matching_pairs: [],
  }
  : {
    question_text: LAVA_STEMS[i], question_type: "short_answer", options: [],
    correct_answer: "the lava", difficulty_level: 2, explanation: "Molten rock above ground is lava. Therefore the answer is the lava",
    subtopic_id: sub, blank_position: "", matching_pairs: [],
  };
const isLava = (q: { correct_answer: string }) => keyForm(q.correct_answer) === "lava";
// The model's first 31 current-level questions, 9 of them keyed "Lava"; after that it writes `more`
// others, then fails. Review questions `review` times.
function lavaModel(more: number, review: number, sub = "1.1") {
  n = 0;
  const at = new Set([2, 5, 7, 11, 14, 19, 23, 26, 30]);
  let current = 0, l = 0, reviews = 0;
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, _config, opts) => {
    const content = messages.map((m) => m.content).join("\n");
    if (opts.toolName === "emit_verdicts") return { verdicts: [] } as never;
    if (content.includes("review of earlier material")) {
      if (++reviews > review) throw new Error("Structured output failed after 3 attempts.");
      return question("1.1") as never;
    }
    const c = ++current;
    if (c > 31 + more) throw new Error("Structured output failed after 3 attempts.");
    return (at.has(c) ? lava(l++, sub) : question(sub)) as never;
  });
}

describe("one key many times in a level test (TerraTutor live test part 7 issue 3)", () => {
  it("the nine Lava stems are not near-duplicates of each other, so only the cap catches them", () => {
    expect(dedupeByQuestionText(LAVA_STEMS.map((_, i) => lava(i, "1.1")))).toHaveLength(9);
  });

  it(`asks for others past ${SAME_KEY_CAP} Lava questions, and the test is full without them`, async () => {
    lavaModel(1000, 0);
    const t = await generatePromotionTestQuestions(syllabus(1), [], { ...GEN });
    expect(t.current).toHaveLength(35);
    expect(t.current.filter(isLava)).toHaveLength(SAME_KEY_CAP);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);

  it("fills back from the set-aside ones to the test's minimum when the model can write no others", async () => {
    lavaModel(0, 0);
    const t = await generatePromotionTestQuestions(syllabus(1), [], { ...GEN });
    // 22 others + 2 Lava, then 6 of the 7 set aside: 30, the minimum, not 35.
    expect(t.current).toHaveLength(TEST_FLOOR);
    expect(t.current.filter(isLava)).toHaveLength(8);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);

  it("with a review section, fills the current one back only as far as a short review section needs", async () => {
    lavaModel(0, 5, "2.1");
    const t = await generatePromotionTestQuestions(syllabus(2), [syllabus(1)], { ...GEN });
    // Current: 24 (2 Lava), over its own minimum of 20; review: 5 of 10. One set-aside Lava makes 30.
    expect(t.review).toHaveLength(5);
    expect(t.current).toHaveLength(25);
    expect(t.current.filter(isLava)).toHaveLength(3);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);
});

// Review of TerraTutor #263 (the same-key fix): "Is 8 even or odd?" keyed "Even" is a classification's pick, as routine as
// true/false, so an "Even and odd" level test is not capped down below its minimum.
describe("a classification key many times in a level test", () => {
  it("an even/odd test, 7 of every 10 questions keyed Even or Odd, is full", async () => {
    n = 0;
    let c = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_messages, _config, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] } as never;
      const k = ++c + 1;
      if (k % 10 >= 7) return question("1.1") as never;
      const key = k % 2 ? "Odd" : "Even";
      return {
        question_text: `Is ${k} even or odd?`, question_type: "short_answer", options: [], correct_answer: key, difficulty_level: 1,
        explanation: `Count by twos to check. Therefore the answer is ${key}`, subtopic_id: "1.1", blank_position: "", matching_pairs: [],
      } as never;
    });
    const t = await generatePromotionTestQuestions(syllabus(1), [], { ...GEN });
    expect(t.current).toHaveLength(35);
    expect(t.current.filter((q) => /even or odd/.test(q.question_text)).length).toBeGreaterThan(20);
    expect(levelTestShortfall(t)).toBeNull();
  }, 30_000);
});

// TerraTutor live test part 12 issue 6: a level 5 test's review section took the last four levels' topics oldest
// first, round-robin, so 10 questions over 17 topics gave level 4, the level just finished, none.
describe("the review section spreads its questions over the levels it reviews", () => {
  const level = (lv: number, topics: number) => ({
    level: lv, title: `Volcanoes level ${lv}`,
    subtopics: Array.from({ length: topics }, (_, i) => ({ id: `${lv}.${i + 1}`, title: `Volcano idea ${lv}.${i + 1}`, key_concepts: ["magma"] })),
  }) as unknown as Syllabus;

  // Each question is on the subtopic its prompt names, so the section's subtopic ids are what it asked about.
  // A batch call (a cloud provider) writes as many as its prompt asks for; batchCalls counts them per subtopic.
  let batchCalls = new Map<string, number>();
  async function reviewLevels(previous: Syllabus[], config: LLMConfig = GEN): Promise<number[]> {
    n = 0;
    batchCalls = new Map();
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (messages, _config, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] } as never;
      const content = messages.map((m) => m.content).join("\n");
      const id = /^- id="([^"]+)"/m.exec(content)?.[1] ?? "5.1";
      if (opts.toolName === "emit_quiz_questions") {
        batchCalls.set(id, (batchCalls.get(id) ?? 0) + 1);
        const count = Number(/^Generate (\d+) quiz question/m.exec(content)?.[1] ?? 1);
        return { questions: Array.from({ length: count }, () => question(id)) } as never;
      }
      return question(id) as never;
    });
    const t = await generatePromotionTestQuestions(level(5, 4), previous, { ...config });
    expect(t.review).toHaveLength(10);
    return t.review.map((q) => Number(String(q.subtopic_id).split(".")[0]));
  }
  const count = (levels: number[], lv: number) => levels.filter((l) => l === lv).length;

  it("gives the level just finished its share: 17 topics over levels 1-4, 10 questions", async () => {
    const levels = await reviewLevels([level(1, 4), level(2, 4), level(3, 4), level(4, 5)]);
    expect(levels[0]).toBe(4);
    for (const lv of [1, 2, 3, 4]) expect(count(levels, lv), `level ${lv}`).toBeGreaterThanOrEqual(2);
    expect(count(levels, 4)).toBe(3);
  }, 30_000);

  // The share follows the levels, not their topic counts: a level with one topic beside levels with 8 and 6
  // still gets its even share, and the newest goes first (4 of 10; by topic it would get 1).
  it("gives each level an even share whatever its topic count: one topic beside 8 and 6", async () => {
    const levels = await reviewLevels([level(1, 8), level(2, 6), level(3, 1)]);
    expect(levels[0]).toBe(3);
    expect([count(levels, 3), count(levels, 2), count(levels, 1)]).toEqual([4, 3, 3]);
  }, 30_000);

  it("batch path (a cloud provider): the same shares, one call per subtopic", async () => {
    const cloud = { provider: "openai", model: "gpt-4o-mini", modelTier: "medium" } as LLMConfig;
    const levels = await reviewLevels([level(1, 8), level(2, 6), level(3, 1)], cloud);
    expect([count(levels, 3), count(levels, 2), count(levels, 1)]).toEqual([4, 3, 3]);
    expect(batchCalls.get("3.1")).toBe(1);
    const spread = await reviewLevels([level(1, 4), level(2, 4), level(3, 4), level(4, 5)], cloud);
    expect([4, 3, 2, 1].map((lv) => count(spread, lv))).toEqual([3, 3, 2, 2]);
  }, 30_000);
});
