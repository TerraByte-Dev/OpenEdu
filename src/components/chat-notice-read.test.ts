// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { Grade } from "../lib/grade";
import type { TutorTurnResult } from "../lib/kernel";

// The real ChatTab on the real db.ts (the in-memory SQLite stand-in the db tests use) and the real read-aloud
// hook over a recording speechSynthesis. A K-2 learner's safety disclosure has its notice, with the numbers,
// read aloud even when the turn ends with no reply to read it before: the tutor's instructions can't be read,
// the turn fails, or the learner stops it. Only the tutor turn itself is a stand-in.
// Ported from TerraTutor #234.

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

// What the voice was asked to say, in order.
const spoken: string[] = [];
class Utterance { text: string; voice: unknown = null; lang = ""; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
Object.assign(globalThis, { SpeechSynthesisUtterance: Utterance });
Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
Object.defineProperty(window, "speechSynthesis", {
  configurable: true,
  value: { cancel: vi.fn(), getVoices: () => [], speak: (u: Utterance) => { spoken.push(u.text); } },
});

const { default: ChatTab } = await import("./ChatTab");
const { setActiveLearnerId, createCourse } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { tutorEngine } = await import("../lib/kernel");
const { SAFETY_NOTICE } = await import("../lib/child-safety");
const { speakableText } = await import("../lib/speech");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DISCLOSURE = "I keep hurting myself";
const NOTICE = speakableText(SAFETY_NOTICE);

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

beforeEach(async () => {
  spoken.length = 0;
  vi.restoreAllMocks();
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "fractions")).id;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function open(grade: Grade | null): Promise<void> {
  const course = { id: courseId, title: "Fractions", topic: "fractions", current_level: 1, status: "active" as const, generation_state: null, created_at: "", updated_at: "" };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(ChatTab, {
      courseId, course, level: 1, currentSyllabus: null, threadId: null,
      onThreadCreated: () => {}, onThreadActivity: () => {}, learnerId: DEFAULT_LEARNER_ID, grade,
    }));
  });
}

async function send(text: string): Promise<void> {
  const input = host.querySelector("input[type=text]") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { (host.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click(); });
  // The turn has ended once the box takes input again.
  await vi.waitFor(() => { if (input.disabled || host.querySelector('button[aria-label="Stop generating"]')) throw new Error("turn still running"); });
}

const result = (over: Partial<TutorTurnResult>): TutorTurnResult => ({
  text: "", stopReason: "complete", toolCalls: [], usedKnowledgeUpdate: false, grounding: { hits: [], trace: null },
  usedHits: [], replyChoices: null, ...over,
} as unknown as TutorTurnResult);

describe("a K-2 safety disclosure's notice is read aloud when no reply comes", () => {
  it("the turn fails: the notice alone, once", async () => {
    vi.spyOn(tutorEngine, "run").mockRejectedValue(new Error("Failed to fetch"));
    await open(1);
    await send(DISCLOSURE);
    expect(spoken).toEqual([NOTICE]);
    // Read from the notice shown under the saved message, under its own speaker button.
    expect(host.querySelector('[role="note"]')?.textContent).toContain(SAFETY_NOTICE);
    expect(host.querySelector('[role="note"] button')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("the learner stops the turn before any reply: the notice alone", async () => {
    vi.spyOn(tutorEngine, "run").mockResolvedValue(result({ stopReason: "aborted" }));
    await open(0);
    await send(DISCLOSURE);
    expect(spoken).toEqual([NOTICE]);
  });

  it("the tutor's instructions can't be read: the notice alone", async () => {
    const run = vi.spyOn(tutorEngine, "run");
    await open(2);
    sqlite.exec("DROP TABLE tutor_instructions");
    await send(DISCLOSURE);
    expect(run).not.toHaveBeenCalled();
    expect(spoken).toEqual([NOTICE]);
  });

  it("a reply that comes reads the notice first, in the same utterance, and not again", async () => {
    vi.spyOn(tutorEngine, "run").mockResolvedValue(result({ text: "Please tell a grown-up you trust.", disclosure: true }));
    await open(1);
    await send(DISCLOSURE);
    expect(spoken).toEqual([`${NOTICE} Please tell a grown-up you trust.`]);
  });

  it("grade 3 and up, or no grade, reads nothing on its own", async () => {
    vi.spyOn(tutorEngine, "run").mockRejectedValue(new Error("Failed to fetch"));
    await open(3);
    await send(DISCLOSURE);
    expect(spoken).toEqual([]);
  });

  it("a message that is not a disclosure reads nothing when the turn fails", async () => {
    vi.spyOn(tutorEngine, "run").mockRejectedValue(new Error("Failed to fetch"));
    await open(1);
    await send("What is one half of 4?");
    expect(spoken).toEqual([]);
  });
});
