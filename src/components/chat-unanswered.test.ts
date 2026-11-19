// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { TutorTurnResult } from "../lib/kernel";

// The real ChatTab on the real db.ts (the in-memory SQLite stand-in the db tests use): a conversation opened
// on the learner's own message with no reply after it (the chat closed while the reply was starting, or
// Ollama was not running) says so under it, and "Ask again" runs the reply to that same saved message
// without saving it twice. Only the tutor turn itself is a stand-in. Ported from TerraTutor #247.

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
const { setActiveLearnerId, createCourse, createChatThread, saveChatMessage, getChatMessages } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { tutorEngine } = await import("../lib/kernel");
const { UNANSWERED_ASK_AGAIN, UNANSWERED_TURN } = await import("../lib/plain-language");

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
  courseId = (await createCourse("Cells", "cells")).id;
  threadId = (await createChatThread(courseId, 1, "what is a cell?")).id;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function open(messages: ReadonlyArray<readonly ["user" | "assistant", string]>): Promise<void> {
  for (const [role, text] of messages) await saveChatMessage(courseId, role, text, 1, threadId);
  const course = { id: courseId, title: "Cells", topic: "cells", current_level: 1, status: "active" as const, generation_state: null, created_at: "", updated_at: "" };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(ChatTab, {
      courseId, course, level: 1, currentSyllabus: null, threadId,
      onThreadCreated: () => {}, onThreadActivity: () => {}, learnerId: DEFAULT_LEARNER_ID, grade: null,
    }));
  });
  await vi.waitFor(() => { if (!host.textContent?.includes(messages[0][1])) throw new Error("transcript not loaded yet"); });
}

const askAgain = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === UNANSWERED_ASK_AGAIN) ?? null;

const REPLY = "A cell is the smallest living part of you.";
const result = (text: string): TutorTurnResult => ({
  text, stopReason: "complete", toolCalls: [], usedKnowledgeUpdate: false, grounding: { hits: [], trace: null },
  usedHits: [], replyChoices: null,
} as unknown as TutorTurnResult);

describe("Chat: a question left with no reply", () => {
  it("says so under the learner's message when the conversation opens on it", async () => {
    await open([["user", "what is a cell?"]]);
    expect(host.textContent).toContain(UNANSWERED_TURN);
    expect(askAgain()).not.toBeNull();
  });

  it("says nothing when the conversation ends on a reply", async () => {
    await open([["user", "what is a cell?"], ["assistant", REPLY]]);
    expect(host.textContent).not.toContain(UNANSWERED_TURN);
    expect(askAgain()).toBeNull();
  });

  it("Ask again runs the reply to the same message, saves only the reply, and the note goes", async () => {
    const run = vi.spyOn(tutorEngine, "run").mockResolvedValue(result(REPLY));
    await open([["user", "what is a cell?"]]);
    await act(async () => { askAgain()!.click(); });
    await vi.waitFor(() => { if (!host.textContent?.includes(REPLY)) throw new Error("reply not shown yet"); });

    expect(run).toHaveBeenCalledTimes(1);
    const sent = run.mock.calls[0][0].messages;
    expect(sent[sent.length - 1]).toMatchObject({ role: "user", content: "what is a cell?" });
    expect(sent.filter((m) => m.role === "user")).toHaveLength(1);
    expect((await getChatMessages(threadId)).map((m) => [m.role, m.content])).toEqual([["user", "what is a cell?"], ["assistant", REPLY]]);
    expect(host.textContent).not.toContain(UNANSWERED_TURN);
  });

  // Ported from TerraTutor #250 (this repo's #393 follow-up): Ask again cleared its note before sending, so a
  // retry that failed (Ollama still down) left the question with no reply, the error, and no way to ask
  // again until the conversation was reopened.
  it("a retry that fails keeps the note and Ask again, and asking again then works", async () => {
    const run = vi.spyOn(tutorEngine, "run")
      .mockRejectedValueOnce(new Error("Ollama unreachable"))
      .mockResolvedValueOnce(result(REPLY));
    await open([["user", "what is a cell?"]]);

    await act(async () => { askAgain()!.click(); });
    await vi.waitFor(() => { if (run.mock.calls.length < 1 || !askAgain()) throw new Error("retry not finished yet"); });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await getChatMessages(threadId)).map((m) => m.role)).toEqual(["user"]);
    expect(host.textContent).toContain(UNANSWERED_TURN);

    await act(async () => { askAgain()!.click(); });
    await vi.waitFor(() => { if (!host.textContent?.includes(REPLY)) throw new Error("reply not shown yet"); });
    expect(run).toHaveBeenCalledTimes(2);
    const sent = run.mock.calls[1][0].messages;
    expect(sent.filter((m) => m.role === "user")).toEqual([{ role: "user", content: "what is a cell?" }]);
    expect((await getChatMessages(threadId)).map((m) => [m.role, m.content])).toEqual([["user", "what is a cell?"], ["assistant", REPLY]]);
    expect(host.textContent).not.toContain(UNANSWERED_TURN);
  });

  it("a retry stopped before any reply keeps the note and Ask again", async () => {
    const run = vi.spyOn(tutorEngine, "run").mockResolvedValue({ ...result(""), stopReason: "aborted" });
    await open([["user", "what is a cell?"]]);
    await act(async () => { askAgain()!.click(); });
    await vi.waitFor(() => { if (run.mock.calls.length < 1 || !askAgain()) throw new Error("retry not finished yet"); });
    expect((await getChatMessages(threadId)).map((m) => m.role)).toEqual(["user"]);
    expect(host.textContent).toContain(UNANSWERED_TURN);
  });
});
