import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Raise hand (raise-hand.ts) through the production path: the real migrations and db.ts on the in-memory
// SQLite stand-in the other db tests use, curriculum.ts generateLesson / lessonHelpFor / lessonWithHelp,
// and a fake model. Two promises are checked with canary strings in the learner's chats, notes, cards,
// knowledge files and name:
// 1. A Raise-hand session on stored help makes no model call and no network request.
// 2. Writing stuck points (with the lesson, or later for an older lesson) sends only the topic, the
//    syllabus subtopic and the lesson text: the request is the same for a fresh learner and one with a
//    history, so it can go to a cloud model at any age (TerraTutor docs/CLOUD-PRIVACY.md, lane 1).

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;

const bind = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string, params: unknown[] = []) => sqlite.prepare(bind(sql)).all(...params),
      execute: async (sql: string, params: unknown[] = []) => { sqlite.prepare(bind(sql)).run(...params); },
    }),
  },
}));
const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: httpFetch }));
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { callLLM, callLLMStreaming, callLLMStructured, detectModelTier } from "./llm";
import {
  setActiveLearnerId, createCourse, saveSyllabus, createLesson, getLesson, createNote, createChatThread,
  saveChatMessage, createFlashcard, saveTutorInstruction, setLearnerGrade,
} from "./db";
import { generateLesson, lessonHelpFor, lessonWithHelp } from "./curriculum";
import {
  buildStuckPointsPrompt, handStep, helpAsLesson, helpOrder, moreChoices, parseLessonHelp, stuckPointIssues,
  STUCK_POINTS_SCHEMA, type HandState, type HelpSurface, type LessonHelp,
} from "./raise-hand";
import { buildLessonReviewMessages } from "./content-review";
import { DEFAULT_LEARNER_ID } from "./learners";
import type { LLMConfig } from "../types";

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

async function openDb(upTo = 21): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const all = migrations();
  for (let v = 1; v <= upTo; v++) {
    const sql = all.get(v);
    if (!sql) throw new Error(`migration ${v} not found in lib.rs`);
    sqlite.exec(sql);
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TOPIC = "Fractions";
const SUB = { id: "1.1", title: "Comparing fractions", key_concepts: ["numerator", "denominator"] };
const LESSON_TEXT = "# Comparing fractions\n\nA fraction names equal parts of a whole.\n\n## Same denominator\n\nWith the same bottom number, the bigger top number is the bigger fraction.\n";

// The canaries: what a child might type or what the app knows about them.
const CANARY = {
  name: "Quill Placeholder",
  address: "42 Example Lane",
  phone: "555-0142",
  email: "quill@example.invalid",
  school: "Placeholder Elementary",
  chat: "my nana on Example Lane says the bigger bottom number wins",
  note: "secret note: I always mix up thirds and quarters at Placeholder Elementary",
  card: "Quill's own card: is 3/8 more than 1/2?",
  profile: "Likes dinosaurs; gets frustrated after two misses.",
};

const HELP: LessonHelp = {
  stuck_points: [
    { label: "What does denominator mean?", another_way: "The denominator is the bottom number. It says how many equal parts the whole is cut into.",
      example: "In 3/4 the denominator is 4, so the whole is cut into 4 equal parts. Answer: 4.", hint: "Look at the bottom number." },
    { label: "Why is 1/3 smaller than 1/2?", another_way: "Cut the same pizza into 3 parts or 2 parts. Three parts means each part is smaller.",
      example: "1/2 of 6 is 3 and 1/3 of 6 is 2. Since 2 is less than 3, 1/3 is smaller.", hint: "More pieces means smaller pieces." },
    { label: "I'm stuck on the example.", another_way: "When the bottom numbers match, compare the top numbers. The bigger top number wins.",
      example: "Compare 2/5 and 3/5. Both have 5 on the bottom. 3 is more than 2, so 3/5 is bigger.", hint: "Are the bottom numbers the same?" },
  ],
};
const LESSON_SECTIONS = { summary: "Fractions name equal parts of a whole thing.", sections: [
  { heading: "Same denominator", body: "With the same bottom number, the bigger top number is the bigger fraction." },
  { heading: "Halves and thirds", body: "Three equal parts make thirds, so one third is smaller than one half." },
], key_takeaways: ["Equal parts matter.", "More parts means smaller parts."] };

const GEN = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as LLMConfig;
// Lane 1's shape in TerraTutor: a cloud model writes. The key is a placeholder; nothing is sent anywhere.
const CLOUD_GEN = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key", modelTier: "large" } as LLMConfig;
const CLOUD_REVIEW = { provider: "anthropic", model: "cloud-reviewer", modelTier: "large" } as LLMConfig;

type Call = { tool: string; content: string; model: string };
let calls: Call[] = [];
let stuckReply: () => unknown = () => structuredClone(HELP);
function stubModel() {
  calls = [];
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (messages, config, opts) => {
    calls.push({ tool: opts.toolName ?? "", content: messages.map((m) => m.content).join("\n"), model: config.model });
    if (opts.toolName === "emit_lesson") return structuredClone(LESSON_SECTIONS) as never;
    if (opts.toolName === "emit_stuck_points") return stuckReply() as never;
    return { verdicts: [] } as never;
  });
}

const fetchSpy = vi.fn();
beforeEach(() => {
  stuckReply = () => structuredClone(HELP);
  stubModel();
  vi.mocked(callLLM).mockClear();
  vi.mocked(callLLMStreaming).mockClear();
  vi.mocked(detectModelTier).mockClear();
  httpFetch.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

/** A course with one level; with `history`, a learner who has used it a lot. Returns the course id. */
async function seed(history: boolean): Promise<string> {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  const course = await createCourse(TOPIC, TOPIC);
  await saveSyllabus({
    course_id: course.id, level: 1, title: "Fractions basics", description: "", learning_objectives: [],
    subtopics: [{ ...SUB, practice_type: "reading", mastered: history, practiced: history }], assessment_criteria: [], estimated_hours: 1,
  });
  if (history) {
    sqlite.prepare("UPDATE learners SET name = ?1 WHERE id = ?2").run(CANARY.name, DEFAULT_LEARNER_ID);
    await setLearnerGrade(DEFAULT_LEARNER_ID, 1);
    const thread = await createChatThread(course.id, 1, "fractions");
    for (const c of [CANARY.chat, `I live at ${CANARY.address}, call ${CANARY.phone} or ${CANARY.email}`, `I go to ${CANARY.school}`]) {
      await saveChatMessage(course.id, "user", c, 1, thread.id);
    }
    await saveChatMessage(course.id, "assistant", `Hi ${CANARY.name}!`, 1, thread.id);
    await createNote(course.id, "My note", CANARY.note, 1, null, "learner");
    await createFlashcard({ courseId: course.id, front: CANARY.card, back: "no", subtopicId: SUB.id, level: 1, source: "manual" });
    await saveTutorInstruction(course.id, "learning_profile", CANARY.profile);
    await saveTutorInstruction(course.id, "misconceptions", `${CANARY.name} thinks a bigger denominator means a bigger fraction.`);
  }
  return course.id;
}

function assertNoCanary(payloads: string[]) {
  const all = payloads.join("\n");
  for (const c of Object.values(CANARY)) expect(all).not.toContain(c);
  // and no run of 5+ words from anything the learner typed
  for (const typed of [CANARY.chat, CANARY.note, CANARY.card]) {
    const w = typed.split(/\s+/);
    for (let i = 0; i + 5 <= w.length; i++) expect(all).not.toContain(w.slice(i, i + 5).join(" "));
  }
}

const noModelOrNetwork = () => {
  expect(callLLMStructured).not.toHaveBeenCalled();
  expect(callLLM).not.toHaveBeenCalled();
  expect(callLLMStreaming).not.toHaveBeenCalled();
  expect(detectModelTier).not.toHaveBeenCalled();
  expect(httpFetch).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
};

// ─── The panel's steps ──────────────────────────────────────────────────────────

function run(surface: HelpSurface, events: Parameters<typeof handStep>[1][]): HandState[] {
  const out: HandState[] = [];
  let s: HandState = { at: "pick" };
  for (const e of events) { s = handStep(s, e, surface); out.push(s); }
  return out;
}

describe("Raise hand's steps", () => {
  it("lesson: another way, then an example; two Nos offer one more way or typing", () => {
    const s = run("lesson", [{ type: "pick", point: 1 }, { type: "no" }, { type: "no" }]);
    expect(s[0]).toEqual({ at: "help", point: 1, tried: ["another_way"] });
    expect(s[1]).toEqual({ at: "help", point: 1, tried: ["another_way", "example"] });
    expect(s[2]).toEqual({ at: "more", point: 1, tried: ["another_way", "example"] });
    expect(moreChoices(s[2], "lesson", false)).toEqual(["one_more", "type_to_tutor"]);
    expect(moreChoices(s[2], "lesson", true)).toEqual(["one_more", "ask_grown_up", "type_to_tutor"]);
  });

  it("practice starts with a hint; the third kind is offered once, then only the people options", () => {
    expect(helpOrder("practice")[0]).toBe("hint");
    const s = run("practice", [{ type: "pick", point: 0 }, { type: "no" }, { type: "no" }, { type: "one_more" }, { type: "no" }]);
    expect(s[3]).toEqual({ at: "help", point: 0, tried: ["hint", "another_way", "example"] });
    expect(s[4]).toEqual({ at: "more", point: 0, tried: ["hint", "another_way", "example"] });
    expect(moreChoices(s[4], "practice", false)).toEqual(["type_to_tutor"]);
  });

  it("Yes ends it; 'something else' goes straight to the people options; again starts over", () => {
    const s = run("lesson", [{ type: "pick", point: 2 }, { type: "yes" }, { type: "again" }, { type: "something_else" }]);
    expect(s[1]).toEqual({ at: "helped", point: 2 });
    expect(s[2]).toEqual({ at: "pick" });
    expect(s[3]).toEqual({ at: "more", point: null, tried: [] });
    expect(moreChoices(s[3], "lesson", false)).toEqual(["type_to_tutor"]);
  });
});

describe("stored help", () => {
  it("parses only usable stuck points", () => {
    expect(parseLessonHelp(null)).toBeNull();
    expect(parseLessonHelp("not json")).toBeNull();
    expect(parseLessonHelp(JSON.stringify({ stuck_points: [] }))).toBeNull();
    const mixed = { stuck_points: [HELP.stuck_points[0], { label: "half", another_way: "" }, "x"] };
    expect(parseLessonHelp(JSON.stringify(mixed))).toEqual({ stuck_points: [HELP.stuck_points[0]] });
  });

  it("asks for 3-5 stuck points and flags repeated, long or cut-off ones", () => {
    expect(STUCK_POINTS_SCHEMA.properties.stuck_points).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(stuckPointIssues(HELP)).toEqual([]);
    const bad: LessonHelp = { stuck_points: [
      HELP.stuck_points[0], { ...HELP.stuck_points[0] },
      { ...HELP.stuck_points[1], label: "I really do not understand what this whole part is about" },
      { ...HELP.stuck_points[2], example: "Compare 2/5 and 3/5 and then you" },
    ] };
    const issues = stuckPointIssues(bad);
    expect(issues).toHaveLength(3);
    expect(issues.join(" ")).toMatch(/different label/);
    expect(issues.join(" ")).toMatch(/at most 8/);
    expect(issues.join(" ")).toMatch(/mid-sentence/);
  });
});

// ─── Written with the lesson ────────────────────────────────────────────────────

describe("stuck points are written with the lesson", () => {
  it("generateLesson stores them on the lesson row, from the lesson's own text", async () => {
    const courseId = await seed(false);
    const lesson = await generateLesson(courseId, 1, SUB, TOPIC, { ...GEN });
    expect(parseLessonHelp((await getLesson(lesson.id))!.help_json)).toEqual(HELP);
    const ask = calls.find((c) => c.tool === "emit_stuck_points")!;
    expect(ask.content).toBe(buildStuckPointsPrompt(TOPIC, SUB, lesson.content));
    expect(ask.model).toBe(GEN.model);
  });

  it("a failed stuck-point call keeps the lesson, without help", async () => {
    const courseId = await seed(false);
    stuckReply = () => { throw new Error("model down"); };
    const lesson = await generateLesson(courseId, 1, SUB, TOPIC, { ...GEN });
    expect((await getLesson(lesson.id))!.content).toContain("Same denominator");
    expect((await getLesson(lesson.id))!.help_json).toBeNull();
  });

  it("with a Checking model, a stuck point with a flagged fact is dropped", async () => {
    const courseId = await seed(false);
    vi.mocked(callLLMStructured).mockImplementation(async (messages, config, opts) => {
      const content = messages.map((m) => m.content).join("\n");
      calls.push({ tool: opts.toolName ?? "", content, model: config.model });
      if (opts.toolName === "emit_lesson") return structuredClone(LESSON_SECTIONS) as never;
      if (opts.toolName === "emit_stuck_points") return structuredClone(HELP) as never;
      // Part 4 is stuck point 1's another_way (part 0 names the help, then three parts per point).
      if (content.includes("Help for a learner")) return { verdicts: [{ index: 4, verdict: "false_fact", sentence: "Three parts means each part is smaller.", reason: "", statement_is_false: true }] } as never;
      return { verdicts: [] } as never;
    });
    const lesson = await generateLesson(courseId, 1, SUB, TOPIC, { ...GEN }, undefined, { ...CLOUD_REVIEW });
    expect(parseLessonHelp(lesson.help_json)!.stuck_points.map((p) => p.label)).toEqual([HELP.stuck_points[0].label, HELP.stuck_points[2].label]);
  });
});

// ─── Privacy ────────────────────────────────────────────────────────────────────

describe("a Raise-hand session sends nothing", () => {
  it("on a lesson with stored help: no model call, no network request, and the configs are never read", async () => {
    const courseId = await seed(true);
    const stored = await createLesson(courseId, 1, SUB.title, LESSON_TEXT, SUB.id, JSON.stringify(HELP));
    stubModel();
    const configs = vi.fn(async () => ({ config: { ...CLOUD_GEN }, review: { ...CLOUD_REVIEW } }));

    // Lessons tab: the reader's Raise hand.
    const help = await lessonHelpFor((await getLesson(stored.id))!, SUB, TOPIC, configs);
    expect(help).toEqual(HELP);
    // Practice: the card's subtopic has a saved lesson.
    expect((await lessonWithHelp(courseId, 1, SUB, TOPIC, configs)).help).toEqual(HELP);
    // A whole session: pick, No, No, one more way, Yes, then something else.
    const s = run("practice", [{ type: "pick", point: 1 }, { type: "no" }, { type: "no" }, { type: "one_more" }, { type: "yes" }, { type: "again" }, { type: "something_else" }]);
    expect(s.map((x) => x.at)).toEqual(["help", "help", "more", "help", "helped", "pick", "more"]);

    expect(configs).not.toHaveBeenCalled();
    noModelOrNetwork();
    expect(calls).toHaveLength(0);
  });
});

describe("writing stuck points carries no learner data", () => {
  // Lane 1's cloud shape: a cloud model writes and a cloud model checks.
  const cloud = async () => ({ config: { ...CLOUD_GEN }, review: { ...CLOUD_REVIEW } });

  async function lazyPayloads(history: boolean, via: "lesson" | "practice"): Promise<string[]> {
    const courseId = await seed(history);
    // An older lesson, written before Raise hand: no help stored.
    const old = await createLesson(courseId, 1, SUB.title, LESSON_TEXT, SUB.id);
    stubModel();
    const help = via === "lesson"
      ? await lessonHelpFor(old, SUB, TOPIC, cloud)
      : (await lessonWithHelp(courseId, 1, SUB, TOPIC, cloud)).help;
    expect(help).toEqual(HELP);
    // Saved, so the next Raise hand reads it.
    expect(parseLessonHelp((await getLesson(old.id))!.help_json)).toEqual(HELP);
    return calls.map((c) => c.content);
  }

  for (const via of ["lesson", "practice"] as const) {
    it(`an older lesson's first Raise hand (${via}): identical for a fresh learner and one with a history`, async () => {
      const fresh = await lazyPayloads(false, via);
      const history = await lazyPayloads(true, via);
      expect(history).toEqual(fresh);
      // Exactly two requests: the stuck points, from the topic, subtopic and lesson text; and their review.
      expect(history).toEqual([
        buildStuckPointsPrompt(TOPIC, SUB, LESSON_TEXT),
        buildLessonReviewMessages(TOPIC, SUB.title, helpAsLesson(SUB.title, HELP)).map((m) => m.content).join("\n"),
      ]);
      assertNoCanary(history);
      expect(httpFetch).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("practice with no saved lesson writes the lesson and its stuck points: identical for both learners", async () => {
    const payloads = async (history: boolean) => {
      const courseId = await seed(history);
      stubModel();
      const { lesson, help } = await lessonWithHelp(courseId, 1, SUB, TOPIC, cloud);
      expect(help).toEqual(HELP);
      expect(lesson.subtopic_id).toBe(SUB.id);
      return calls.map((c) => c.content);
    };
    const fresh = await payloads(false);
    const history = await payloads(true);
    expect(calls.map((c) => c.tool)).toEqual(["emit_lesson", "emit_lesson_review", "emit_stuck_points", "emit_lesson_review"]);
    expect(history).toEqual(fresh);
    assertNoCanary(history);
  });
});
