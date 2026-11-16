import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// "Checked" under a lesson only when a cloud Checking model actually reviewed it when it was written
// (from TerraTutor #144, Fable's decision 2026-11-16; migration 22, lesson_checks). Run for real: every
// migration parsed out of lib.rs, the real curriculum.ts generateLesson with only the model call stubbed,
// the real db.ts writes and reads on an in-memory SQLite, the real store.ts getLessonConfigs the Lessons
// tab and the Settings note read, and the status line the lesson reader draws from them.

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
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  detectModelProfile: vi.fn(async () => ({ tier: "tiny", contextTokens: 8192, supportsTools: true })),
  getOllamaModels: vi.fn(async () => ({ models: ["gemma4:e2b"] })),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// The settings the lesson's models are resolved from (store.ts), in memory. Nothing is sent anywhere.
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn(async () => { throw new Error("no network in this test"); }) }));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

import { callLLMStructured } from "./llm";
import { generateLesson } from "./curriculum";
import { createCourse, createLesson, deleteCourse, lessonWasChecked, setActiveLearnerId } from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { getLessonConfigs } from "./store";
import { STORE_FILE, STORE_KEYS, apiKeyStoreKey } from "./store-keys";
import { Store } from "./eval/headless/shims/plugin-store";
import {
  LESSONS_NOTE_CHECKED, LESSONS_NOTE_UNCHECKED, LESSON_STATUS_CHECKED, LESSON_STATUS_UNCHECKED, lessonStatusLine, lessonsNote,
} from "./ai-notice";
import type { LessonContent } from "./lesson-format";
import type { ReviewReply } from "./content-review";
import type { LLMConfig } from "../types";

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
}

// Every migration from `from` to `upTo`, in order, as the app applies them.
function migrate(upTo: number, from = 1): void {
  const all = migrations();
  for (const v of [...all.keys()].filter((v) => v >= from && v <= upTo).sort((a, b) => a - b)) sqlite.exec(all.get(v)!);
}
const LATEST = 999;

const GEN = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as LLMConfig;
const CLOUD_REVIEW = { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", modelTier: "large" } as LLMConfig;
const LOCAL_REVIEW = { provider: "ollama", model: "qwen3.5:27b", modelTier: "large" } as LLMConfig;

const LESSON: LessonContent = {
  summary: "Water is made of hydrogen and oxygen. Here we look at how it forms.",
  sections: [
    { heading: "Making water", body: "When hydrogen burns in oxygen, it produces water and nothing else. This reaction gives off a lot of heat." },
    { heading: "Counting atoms", body: "Two hydrogen molecules react with one oxygen molecule. Counting atoms on each side shows the equation is balanced." },
  ],
  key_takeaways: ["Hydrogen and oxygen react to make water.", "Atoms are conserved in a reaction."],
};
// A pass: one "ok" per part (lessonParts: the summary, 2 sections, 2 takeaways).
const okOn = (indexes: number[]): ReviewReply => ({ verdicts: indexes.map((index) => ({ index, verdict: "ok", sentence: "", reason: "", statement_is_false: false })) });
const OK = okOn([0, 1, 2, 3, 4]);
const FLAG: ReviewReply = { verdicts: [{ index: 1, verdict: "false_fact", sentence: "When hydrogen burns in oxygen, it produces water and nothing else.", reason: "x", statement_is_false: true }] };

/** Stub the model by tool: the lesson, its stuck points (none: best-effort) and the reviews in order (an Error throws). */
function stub(reviews: Array<ReviewReply | Error>) {
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (_m, _c, opts) => {
    if (opts.toolName === "emit_lesson") return LESSON as never;
    if (opts.toolName === "emit_lesson_review") {
      const r = reviews.shift();
      if (!r || r instanceof Error) throw r ?? new Error("no review stubbed");
      return r as never;
    }
    throw new Error("stuck points not stubbed");
  });
}

let courseId = "";
const SUB = { id: "s1", title: "Making water", key_concepts: ["combustion"] };
const write = (review: LLMConfig | null) => generateLesson(courseId, 1, SUB, "Chemistry", { ...GEN }, undefined, review && { ...review });
const checkRows = () => sqlite.prepare("SELECT lesson_id, checked_by FROM lesson_checks").all() as Array<{ lesson_id: string; checked_by: string }>;

// store.ts keeps the Store it loaded first, so each test rewrites that same settings file in place.
async function seedSettings(values: Record<string, unknown>): Promise<void> {
  const s = await Store.load(STORE_FILE);
  await s.clear();
  for (const [k, v] of Object.entries(values)) await s.set(k, v);
}

beforeEach(async () => {
  await seedSettings({});
  await openDb();
  migrate(LATEST);
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Chemistry", "chemistry")).id;
});

describe("a lesson is stored as checked only when a cloud Checking model reviewed it", () => {
  it("a cloud review that ran and passed it: checked, by that model, and the reader says so", async () => {
    stub([OK]);
    const lesson = await write(CLOUD_REVIEW);
    expect(checkRows()).toEqual([{ lesson_id: lesson.id, checked_by: "anthropic:claude-sonnet-5-5" }]);
    expect(lessonStatusLine({ checked: await lessonWasChecked(lesson.id), grade: 5 })).toBe(LESSON_STATUS_CHECKED);
  });

  it("flagged, rewritten and reviewed again: checked, since the reviewer read the text that was saved", async () => {
    stub([FLAG, OK]);
    const lesson = await write(CLOUD_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(true);
    expect(vi.mocked(callLLMStructured).mock.calls.filter(([, , o]) => o.toolName === "emit_lesson")).toHaveLength(2);
  });

  it("a cloud review that returned no verdicts at all: not checked", async () => {
    stub([{ verdicts: [] }]);
    const lesson = await write(CLOUD_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
    expect(checkRows()).toEqual([]);
  });

  it("a cloud review that judged only some parts, or parts the lesson does not have: not checked", async () => {
    for (const reply of [okOn([0]), okOn([0, 1, 2, 3]), okOn([0, 1, 2, 3, 5]), okOn([0, 0, 1, 2, 3])]) {
      stub([reply]);
      const lesson = await write(CLOUD_REVIEW);
      expect(await lessonWasChecked(lesson.id)).toBe(false);
    }
    expect(checkRows()).toEqual([]);
  });

  it("flagged, rewritten, and the second review skipped a part: not checked", async () => {
    stub([FLAG, okOn([0, 1, 2, 3])]);
    const lesson = await write(CLOUD_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
  });

  it("a cloud review whose call failed: not checked", async () => {
    stub([new Error("timeout")]);
    const lesson = await write(CLOUD_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
    expect(checkRows()).toEqual([]);
  });

  it("flagged, rewritten, and the second review failed: not checked (nobody read the new text)", async () => {
    stub([FLAG, new Error("timeout")]);
    const lesson = await write(CLOUD_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
  });

  it("a Checking model on this computer, however big: not checked", async () => {
    stub([OK]);
    const lesson = await write(LOCAL_REVIEW);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
  });

  it("no review (lesson checking off, or the tiny and small tiers' default): not checked", async () => {
    stub([]);
    const lesson = await write(null);
    expect(lessonStatusLine({ checked: await lessonWasChecked(lesson.id), grade: null })).toBe(LESSON_STATUS_UNCHECKED);
  });

  it("goes with its course", async () => {
    stub([OK]);
    const lesson = await write(CLOUD_REVIEW);
    await deleteCourse(courseId);
    expect(checkRows()).toEqual([]);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
  });
});

describe("through the saved settings (store.ts getLessonConfigs), as the Lessons tab and Settings read them", () => {
  const LOCAL_SETUP = { [STORE_KEYS.provider]: "ollama", [STORE_KEYS.genModel]: "gemma4:e2b" };
  const CLOUD_CHECKER = {
    ...LOCAL_SETUP,
    [STORE_KEYS.reviewModel]: "anthropic:claude-haiku-5-5", [apiKeyStoreKey("anthropic")]: "test-key", [STORE_KEYS.cloudNoticesSeen]: ["anthropic"],
  };
  const writeAsLessonsTab = async () => {
    const { config, review } = await getLessonConfigs();
    return generateLesson(courseId, 1, SUB, "Chemistry", config, undefined, review);
  };

  it("an 8 GB machine on its defaults: no review runs, the lesson is unchecked, and the note says so", async () => {
    await seedSettings(LOCAL_SETUP);
    stub([]);
    const lesson = await writeAsLessonsTab();
    expect(vi.mocked(callLLMStructured).mock.calls.some(([, , o]) => o.toolName === "emit_lesson_review")).toBe(false);
    expect(await lessonWasChecked(lesson.id)).toBe(false);
    expect(lessonsNote((await getLessonConfigs()).review)).toEqual({ checked: false, title: "About the lessons", body: LESSONS_NOTE_UNCHECKED });
  });

  it("a cloud Checking model saved with its key and its one-time notice: the lesson is checked, and the note says so", async () => {
    await seedSettings(CLOUD_CHECKER);
    stub([OK]);
    const lesson = await writeAsLessonsTab();
    expect(checkRows()).toEqual([{ lesson_id: lesson.id, checked_by: "anthropic:claude-haiku-5-5" }]);
    expect(lessonsNote((await getLessonConfigs()).review)).toMatchObject({ checked: true, body: LESSONS_NOTE_CHECKED });
  });

  it("the key saved but its notice never confirmed: the cloud checker does not resolve, nothing is checked", async () => {
    await seedSettings({ ...CLOUD_CHECKER, [STORE_KEYS.cloudNoticesSeen]: [] });
    stub([OK]);
    const lesson = await writeAsLessonsTab();
    expect(await lessonWasChecked(lesson.id)).toBe(false);
    expect(lessonsNote((await getLessonConfigs()).review).checked).toBe(false);
  });
});

describe("migration 22 on an existing install", () => {
  it("leaves every older lesson unchecked", async () => {
    await openDb();
    migrate(21);
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    courseId = (await createCourse("History", "history")).id;
    const old = await createLesson(courseId, 1, "Egypt", "The Nile flooded every year.", "s1");
    migrate(LATEST, 22);
    expect(await lessonWasChecked(old.id)).toBe(false);
  });
});
