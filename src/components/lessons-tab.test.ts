// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The real LessonsTab, keyed by course and level as CourseView mounts it, writing through the real
// curriculum.ts writeLessonOnce / generateLesson and db.ts on the in-memory SQLite stand-in the db tests
// use. Only the model is fake, and it holds the lesson until the test lets it go. A lesson being written
// must survive the tab being remounted (a level change and back, or leaving the tab and coming back):
// still shown as "Writing…", never offered to be written again, and saved once.

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
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn() } }));
vi.mock("../lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/llm")>(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
}));
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getLessonConfigs: vi.fn(async () => ({ config: { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" }, review: null })),
}));

const { default: LessonsTab } = await import("./LessonsTab");
const { callLLMStructured } = await import("../lib/llm");
const { getLessonConfigs } = await import("../lib/store");
const { setActiveLearnerId, createCourse, saveSyllabus, getLessons, createLesson } = await import("../lib/db");
const { lessonWithHelp } = await import("../lib/curriculum");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
import type { Syllabus } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

const TOPIC = "Fractions";
const syllabus = (courseId: string, level: number, ids: string[]): Syllabus => ({
  id: `syl-${level}`, generated_at: "", course_id: courseId, level, title: `Level ${level}`, description: "", learning_objectives: [],
  subtopics: ids.map((id) => ({ id, title: `Subtopic ${id}`, key_concepts: ["parts"], practice_type: "reading", mastered: false, practiced: false })),
  assessment_criteria: [], estimated_hours: 1,
});
const LESSON = { summary: "Fractions name equal parts of a whole thing.", sections: [
  { heading: "Same denominator", body: "With the same bottom number, the bigger top number is the bigger fraction." },
  { heading: "Halves and thirds", body: "Three equal parts make thirds, so one third is smaller than one half." },
], key_takeaways: ["Equal parts matter.", "More parts means smaller parts."] };

let lessonCalls = 0;
let release!: () => void;
let courseId: string;
let levels: Record<number, Syllabus>;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse(TOPIC, TOPIC)).id;
  levels = { 2: syllabus(courseId, 2, ["2.3"]), 3: syllabus(courseId, 3, ["3.1"]) };
  for (const s of Object.values(levels)) await saveSyllabus(s);
  lessonCalls = 0;
  const gate = new Promise<void>((r) => { release = r; });
  vi.mocked(getLessonConfigs).mockClear();
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (_messages, _config, opts) => {
    if (opts.toolName === "emit_lesson") { lessonCalls++; await gate; return structuredClone(LESSON) as never; }
    throw new Error("no stuck points in this test"); // the lesson is saved without them
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** The Lessons tab on this level, as CourseView renders it (`null`: another tab is open). */
async function show(level: number | null) {
  await act(async () => {
    root.render(level === null ? createElement("div") : createElement(LessonsTab, {
      key: `${courseId}:${level}`, courseId, level, topic: TOPIC, currentSyllabus: levels[level],
    }));
  });
  if (level !== null) await vi.waitFor(() => expect(host.textContent).not.toContain("Loading lessons"));
}
const row = (id: string) => [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(`Subtopic ${id}`))!;
const button = (id: string) => row(id).querySelector("button")!;
const rows = async (level: number, id: string) => (await getLessons(courseId, level)).filter((l) => l.subtopic_id === id);
async function finish() {
  await act(async () => { release(); });
  await vi.waitFor(async () => expect(await rows(2, "2.3")).toHaveLength(1));
}

describe("a lesson being written survives the Lessons tab remounting", () => {
  it("level 2 → level 3 → level 2 before it is done: still Writing…, then saved once and shown as written", async () => {
    await show(2);
    expect(button("2.3").textContent).toBe("Write it for me");
    await act(async () => button("2.3").click());
    await vi.waitFor(() => expect(lessonCalls).toBe(1));

    await show(3);
    expect(button("3.1").textContent).toBe("Write it for me");
    expect(button("3.1").disabled).toBe(false);
    await show(2);
    expect(button("2.3").textContent).toBe("Writing…");
    expect(button("2.3").disabled).toBe(true);

    await finish();
    await vi.waitFor(() => expect(button("2.3").textContent).toBe("Open"));
    expect(row("2.3").textContent).toContain("Ready to read");
    expect(lessonCalls).toBe(1);
  });

  it("finishing while level 3 is shown opens nothing over it; level 2 then lists it", async () => {
    await show(2);
    await act(async () => button("2.3").click());
    await vi.waitFor(() => expect(lessonCalls).toBe(1));
    await show(3);
    await finish();
    expect(host.querySelector("h2")?.textContent).toBe("Lessons");
    expect(button("3.1").textContent).toBe("Write it for me");
    await show(2);
    expect(button("2.3").textContent).toBe("Open");
  });

  it("leaving the tab and coming back: still Writing…, and Review's Raise hand joins the same write", async () => {
    await show(2);
    await act(async () => button("2.3").click());
    await vi.waitFor(() => expect(lessonCalls).toBe(1));
    await show(null);
    const practice = lessonWithHelp(courseId, 2, levels[2].subtopics[0], TOPIC, getLessonConfigs);
    await show(2);
    expect(button("2.3").textContent).toBe("Writing…");

    await finish();
    expect((await practice).lesson.id).toBe((await rows(2, "2.3"))[0].id);
    await vi.waitFor(() => expect(button("2.3").textContent).toBe("Open"));
    expect(lessonCalls).toBe(1);
  });

  it("a write that fails is not joined later: the next tap writes it", async () => {
    vi.mocked(callLLMStructured).mockImplementationOnce(async () => { lessonCalls++; throw new Error("model down"); });
    await show(2);
    await act(async () => button("2.3").click());
    await vi.waitFor(() => expect(host.textContent).toContain("Couldn't make that lesson"));
    expect(button("2.3").textContent).toBe("Write it for me");
    release();
    await act(async () => button("2.3").click());
    await vi.waitFor(async () => expect(await rows(2, "2.3")).toHaveLength(1));
    expect(lessonCalls).toBe(2);
  });
});

describe("a lesson that finishes writing while another is open", () => {
  const OTHER = "Thirds are three equal parts of one whole.";
  const reading = () => host.textContent ?? "";

  beforeEach(async () => {
    levels[4] = syllabus(courseId, 4, ["4.1", "4.2"]);
    await saveSyllabus(levels[4]);
    await createLesson(courseId, 4, "Subtopic 4.2", OTHER, "4.2");
  });

  it("does not replace the lesson the learner opened while it was being written", async () => {
    await show(4);
    await act(async () => button("4.1").click());
    await vi.waitFor(() => expect(lessonCalls).toBe(1));
    expect(button("4.2").textContent).toBe("Open");
    await act(async () => button("4.2").click());
    await vi.waitFor(() => expect(reading()).toContain(OTHER));

    await act(async () => { release(); });
    await vi.waitFor(async () => expect(await rows(4, "4.1")).toHaveLength(1));
    await act(async () => {});
    expect(reading()).toContain(OTHER);
    expect(reading()).not.toContain(LESSON.summary);
  });

  it("opens the lesson it wrote when nothing else was opened meanwhile", async () => {
    await show(4);
    await act(async () => button("4.1").click());
    await vi.waitFor(() => expect(lessonCalls).toBe(1));
    await act(async () => { release(); });
    await vi.waitFor(() => expect(reading()).toContain(LESSON.summary));
  });
});
