// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { TutorTurnResult } from "../lib/kernel";
import type { Syllabus } from "../types";

// The real ChatTab on the real db.ts (the in-memory SQLite stand-in the db tests use): "Check if I've got
// this" is not offered on any turn of a check that is already running, a hint or a question inside it
// included (the chip opened the topic picker in the middle of a check), nor under the reply to
// a safety disclosure, and "Ask again" on a saved "Check if I've got this." opens the check. Only the tutor
// turn itself is a stand-in. Ported from TerraTutor #247.

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
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getChatTurnConfig: vi.fn(async () => ({
    config: { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434", contextTokens: 8192 },
    profile: { tier: "tiny", contextTokens: 8192, supportsTools: false },
  })),
  getRetrievalMode: vi.fn(async () => "off"),
  getReadAloudAuto: vi.fn(async () => null),
}));
vi.mock("../lib/knowledge", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/knowledge")>(),
  updateKnowledgeFiles: vi.fn(async () => {}),
}));
Element.prototype.scrollIntoView = () => {}; // jsdom has no layout

const { default: ChatTab } = await import("./ChatTab");
const { setActiveLearnerId, createCourse, createChatThread, saveChatMessage } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { tutorEngine } = await import("../lib/kernel");
const { UNANSWERED_ASK_AGAIN } = await import("../lib/plain-language");

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
let courseId = "";
let threadId = "";

beforeEach(async () => {
  vi.restoreAllMocks();
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "fractions")).id;
  threadId = (await createChatThread(courseId, 1, "fractions")).id;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

// Part-way through the level: under a reply that asks something, the chip is offered outside a check.
const syllabus = {
  id: "s1", course_id: "c1", level: 1, title: "Level 1", description: "", learning_objectives: [],
  subtopics: [
    { id: "1.1", title: "Halves", key_concepts: [], practice_type: "", mastered: true },
    { id: "1.2", title: "Quarters", key_concepts: [], practice_type: "", mastered: false },
  ],
  assessment_criteria: [], estimated_hours: 1, generated_at: "",
} as unknown as Syllabus;

async function open(messages: ReadonlyArray<readonly ["user" | "assistant", string]>): Promise<void> {
  for (const [role, text] of messages) await saveChatMessage(courseId, role, text, 1, threadId);
  const course = { id: courseId, title: "Fractions", topic: "fractions", current_level: 1, status: "active" as const, generation_state: null, created_at: "", updated_at: "" };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(ChatTab, {
      courseId, course, level: 1, currentSyllabus: syllabus, threadId,
      onThreadCreated: () => {}, onThreadActivity: () => {}, learnerId: DEFAULT_LEARNER_ID, grade: null,
    }));
  });
  await vi.waitFor(() => { if (!host.textContent?.includes(messages[0][1])) throw new Error("transcript not loaded yet"); });
}

const result = (text: string): TutorTurnResult => ({
  text, stopReason: "complete", toolCalls: [], usedKnowledgeUpdate: false, grounding: { hits: [], trace: null },
  usedHits: [], replyChoices: null,
} as unknown as TutorTurnResult);

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim().endsWith(label)) ?? null;
const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Message to your tutor"]')!;

async function type(text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(): Promise<void> {
  await act(async () => { button("Send")!.click(); });
  // The turn has ended once the box takes input again.
  await vi.waitFor(() => { if (input().disabled || host.querySelector('button[aria-label="Stop generating"]')) throw new Error("turn still running"); });
}

describe("Chat: Check if I've got this inside a running check", () => {
  it("is not offered under a question-back or a hint turn of a check", async () => {
    const run = vi.spyOn(tutorEngine, "run")
      .mockResolvedValueOnce(result("Sure. Here it is again: what is 1/2 + 1/4 in quarters?"))
      .mockResolvedValueOnce(result("Think in quarters first. How many quarters make 1/2?"));
    await open([
      ["user", "Check if I've got this."],
      ["assistant", "Which one should we check first?"],
      ["user", "Quarters"],
      ["assistant", "What is 1/2 + 1/4?"],
    ]);
    // A question back runs as explain, not assess.
    await type("can you say it again?");
    await send();
    expect(run.mock.calls[0][1].activeSkill?.name).not.toBe("assess");
    expect(button("Give me a hint")).not.toBeNull();
    expect(button("Check if I've got this")).toBeNull();

    // The hint chip: a hint turn, still inside the check.
    await act(async () => { button("Give me a hint")!.click(); });
    await send();
    expect(run.mock.calls[1][1].activeSkill?.name).toBe("hint");
    expect(button("Walk me through it")).not.toBeNull();
    expect(button("Check if I've got this")).toBeNull();
  });

  it("is offered under a question when no check is running", async () => {
    vi.spyOn(tutorEngine, "run").mockResolvedValueOnce(result("A quarter is one of 4 equal parts. How many quarters make 1/2?"));
    await open([["user", "what is a half?"], ["assistant", "A half is one of 2 equal parts."]]);
    await type("can you say it again?");
    await send();
    expect(button("Check if I've got this")).not.toBeNull();
  });

  it("is not offered under the reply to a safety disclosure", async () => {
    vi.spyOn(tutorEngine, "run").mockResolvedValueOnce(result("Thank you for telling me. Is there a grown-up you trust?"));
    await open([["user", "what is a half?"], ["assistant", "A half is one of 2 equal parts."]]);
    await type("I keep hurting myself");
    await send();
    expect(button("Give me a hint")).not.toBeNull();
    expect(button("Check if I've got this")).toBeNull();
  });

  it("Ask again on a saved Check if I've got this. runs the turn in assess mode", async () => {
    const run = vi.spyOn(tutorEngine, "run").mockResolvedValueOnce(result("Which one should we check first?"));
    await open([["user", "Check if I've got this."]]);
    await act(async () => { button(UNANSWERED_ASK_AGAIN)!.click(); });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][1].activeSkill?.name).toBe("assess");
  });
});
