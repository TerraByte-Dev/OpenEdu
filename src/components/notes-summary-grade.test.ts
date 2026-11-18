// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { Grade } from "../lib/grade";

// The real Notebook › assistant › "Notes from last chat", reading the chat through the real db.ts on the
// in-memory SQLite stand-in the db tests use. Only the model call is a stand-in: it records the transcript it
// was sent and returns the summary the test gives it. The panel reads disclosures with the learner's grade, as
// the chat's own notice does (ChatTab isSafetyDisclosure(msg.content, grade)): with a K-12 grade a strong
// pregnancy self-disclosure is left out of the transcript, and a summary that reads as one gets the safety
// notice in its place; with no grade (an adult) neither is a disclosure.

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

const sent: string[] = [];
let modelSummary = "";
vi.mock("../lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/llm")>(),
  callLLMStructured: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    sent.push(messages[messages.length - 1].content);
    return { markdown: modelSummary };
  }),
}));
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getChatConfig: vi.fn(async () => ({ provider: "ollama", model: "stand-in" })),
}));

const { default: NotesAssistant } = await import("./NotesAssistant");
const { setActiveLearnerId, createCourse, createChatThread, saveChatMessage } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { SAFETY_NOTICE } = await import("../lib/child-safety");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

const DISCLOSURE = "i think im pregnant";
let courseId: string;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Times tables", "Times tables")).id;
  const thread = await createChatThread(courseId, 1, "what is 7 x 8");
  for (const [role, text] of [
    ["user", "what is 7 x 8"], ["assistant", "7 x 8 = 56."],
    ["user", DISCLOSURE], ["assistant", "Thank you for telling me. Please talk to a grown-up you trust."],
    ["user", "and 6 x 7?"], ["assistant", "6 x 7 = 42."],
  ] as const) await saveChatMessage(courseId, role, text, 1, thread.id);
  sent.length = 0;
  modelSummary = "## Times tables\n- 7 x 8 = 56\n- 6 x 7 = 42";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function notesFromLastChat(grade: Grade | null): Promise<void> {
  await act(async () => {
    root.render(createElement(NotesAssistant, {
      courseId, level: 1, grade, noteTitle: "Times tables", noteContent: "",
      annotations: [], onAnnotations: () => {}, onInsertSummary: () => {}, onRevealOffset: () => {},
    }));
  });
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Notes from last chat")!;
  await act(async () => button.click());
  await vi.waitFor(() => {
    if (host.textContent?.includes("Reading the conversation")) throw new Error("still summarising");
  });
}

const insert = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Insert into note"));

describe("Notes from last chat reads disclosures with the learner's grade", () => {
  // Nor does anything after it (TerraTutor #238): the tutor still reads the disclosure on later turns.
  it("with a K-12 grade, a strong pregnancy self-disclosure and everything after it never reach the summariser", async () => {
    await notesFromLastChat(7);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Student: what is 7 x 8");
    expect(sent[0]).not.toContain("and 6 x 7?");
    expect(sent[0]).not.toMatch(/pregnant|grown-up/);
    expect(insert()).toBeTruthy();
  });

  it("with no grade (an adult), the same message is not a disclosure and stays in", async () => {
    await notesFromLastChat(null);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`Student: ${DISCLOSURE}`);
  });

  it("with a K-12 grade, a summary that reads as a pregnancy self-disclosure gets the safety notice, no Insert", async () => {
    modelSummary = "## Today\n- I think I'm pregnant.";
    await notesFromLastChat(10);
    expect(host.querySelector('[role="note"]')?.textContent).toContain(SAFETY_NOTICE);
    expect(insert()).toBeUndefined();
    expect(host.textContent).not.toContain("I think I'm pregnant");
  });

  it("with no grade, that summary is offered as written", async () => {
    modelSummary = "## Today\n- I think I'm pregnant.";
    await notesFromLastChat(null);
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(insert()).toBeTruthy();
  });
});
