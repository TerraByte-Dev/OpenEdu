// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The real new-course screen (Dashboard), on the in-memory SQLite stand-in the db tests use. A safety
// disclosure typed as the topic would be the course's title on every screen, and would go to the model and
// web search: no click of Create makes a course from it (TerraTutor #215, audit 8 #10). Only the model check
// is fake: it stops an ordinary topic at step 0, which shows that topic's Create went on to build.

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
vi.mock("../lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/llm")>(),
  preflightStructuredOutput: vi.fn(async () => ({ ok: false, reason: "stopped by the test" })),
}));
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getGenerationConfig: vi.fn(async () => ({ provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" })),
  getTavilyApiKey: vi.fn(async () => null),
  systemMemoryBytes: vi.fn(async () => null),
}));

const { default: Dashboard } = await import("./Dashboard");
const { preflightStructuredOutput } = await import("../lib/llm");
const { setActiveLearnerId, getCourses } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { SAFETY_NOTICE, SAFETY_TOPIC_COURSE_LINE } = await import("../lib/child-safety");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  vi.mocked(preflightStructuredOutput).mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Dashboard, { onCancel: () => {}, onCourseCreated: () => {}, grade: 8 }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function type(text: string) {
  const input = host.querySelector<HTMLInputElement>("input[type=text]")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const create = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Create course")!;
async function clickCreate() {
  await act(async () => create().click());
}

describe("a safety disclosure typed as a new course's topic", () => {
  it("shows the notice and the line on every Create, and makes no course and checks no model", async () => {
    for (const topic of ["my dad hits me what do I do", "i want to die", "im 14 and pregnant"]) {
      await type(topic);
      for (let click = 0; click < 3; click++) {
        await clickCreate();
        expect(host.textContent).toContain(SAFETY_NOTICE);
        expect(host.textContent).toContain(SAFETY_TOPIC_COURSE_LINE);
        expect(create()).toBeTruthy(); // still the form: nothing started building
      }
    }
    expect(preflightStructuredOutput).not.toHaveBeenCalled();
    expect(await getCourses()).toEqual([]);
  });

  it("an ordinary topic still goes on to build on its first Create", async () => {
    await type("Romeo and Juliet");
    await clickCreate();
    await vi.waitFor(() => expect(preflightStructuredOutput).toHaveBeenCalledTimes(1));
    expect(host.textContent).not.toContain(SAFETY_NOTICE);
    expect(host.textContent).not.toContain(SAFETY_TOPIC_COURSE_LINE);
  });

  // The review of #372: a science topic that tripped the touching patterns as first ported.
  it("a science topic about plants that fold when people touch them is not refused", async () => {
    await type("why mimosa leaves fold up when people touch them");
    await clickCreate();
    await vi.waitFor(() => expect(preflightStructuredOutput).toHaveBeenCalledTimes(1));
    expect(host.textContent).not.toContain(SAFETY_NOTICE);
    expect(host.textContent).not.toContain(SAFETY_TOPIC_COURSE_LINE);
  });
});
