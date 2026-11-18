// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { Grade } from "../lib/grade";

// The real Notebook (NotesTab), its assistant's "Review this note" (NotesAssistant) and Review's "+ New card"
// (ReviewTab), on the real db.ts over the in-memory SQLite stand-in the db tests use (ported from TerraTutor
// #236). A note or card whose words read as a safety disclosure, with the learner's grade as the chat reads
// it, shows the safety notice as it is typed; the note is never sent to a model for review, and the card is
// never saved. Only the model call, the notebook index, the editor and the graph are stand-ins.

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
vi.mock("../lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/llm")>(),
  callLLMStructured: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    sent.push(messages[messages.length - 1].content);
    return { annotations: [] };
  }),
  detectModelTier: vi.fn(async () => "small"),
}));
vi.mock("../lib/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/store")>(),
  getChatConfig: vi.fn(async () => ({ provider: "ollama", model: "stand-in" })),
}));
vi.mock("../lib/notebook", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/notebook")>(),
  indexNote: vi.fn(async () => {}),
  reindexCourseNotes: vi.fn(async () => {}),
}));
vi.mock("./MarkdownEditor", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const { default: NotesAssistant } = await import("./NotesAssistant");
const { default: NotesTab } = await import("./NotesTab");
const { default: ReviewTab } = await import("./ReviewTab");
const { setActiveLearnerId, createCourse, createNote, getFlashcards } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");
const { SAFETY_NOTICE } = await import("../lib/child-safety");
const { NOTE_REVIEW_WITHHELD } = await import("../lib/notebook-assistant");
const { CARD_NOT_SAVED_DISCLOSURE } = await import("../lib/srs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

const DISCLOSED = "my dad hits me when I get my times tables wrong. 7x8=54";
const PREGNANT = "i think im pregnant. 7x8=56";

let courseId: string;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  }
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Times tables", "Times tables")).id;
  sent.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const notice = () => host.querySelector('[role="note"]')?.textContent ?? null;

/** Types into a box the way a keyboard does (React reads the native value setter). */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Notebook › Review this note", () => {
  async function review(noteContent: string, grade: Grade | null): Promise<void> {
    await act(async () => {
      root.render(createElement(NotesAssistant, {
        courseId, level: 1, grade, noteTitle: "Times tables", noteContent,
        annotations: [], onAnnotations: () => {}, onInsertSummary: () => {}, onRevealOffset: () => {},
      }));
    });
    await act(async () => button("Review this note")!.click());
    await vi.waitFor(() => { if (host.textContent?.includes("Reading your note")) throw new Error("still reviewing"); });
  }

  it("never sends a note that reads as a disclosure; it shows the notice and says why", async () => {
    await review(DISCLOSED, null);
    expect(sent).toEqual([]);
    expect(notice()).toContain(SAFETY_NOTICE);
    expect(host.textContent).toContain(NOTE_REVIEW_WITHHELD);
  });

  it("an ordinary note is sent as before, with no notice", async () => {
    await review("7x8=54", null);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("7x8=54");
    expect(notice()).toBeNull();
  });

  it("reads with the learner's grade: a pregnancy note is withheld with a K-12 grade, sent with none", async () => {
    await review(PREGNANT, 7);
    expect(sent).toEqual([]);
    expect(host.textContent).toContain(NOTE_REVIEW_WITHHELD);
    await review(PREGNANT, null);
    expect(sent).toHaveLength(1);
  });
});

describe("Notebook: the note editor", () => {
  async function openNote(title: string, content: string, grade: Grade | null): Promise<void> {
    await createNote(courseId, title, content, 1);
    await act(async () => { root.render(createElement(NotesTab, { courseId, level: 1, grade })); });
    const item = await vi.waitFor(() => {
      const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(title));
      if (!b) throw new Error("note not listed yet");
      return b;
    });
    await act(async () => item.click());
  }

  it("shows the safety notice above a note that reads as a disclosure", async () => {
    await openNote("Times tables", DISCLOSED, null);
    await vi.waitFor(() => expect(notice()).toContain(SAFETY_NOTICE));
  });

  it("and as a title is typed that reads as one", async () => {
    await openNote("Eights", "7x8=56", null);
    expect(notice()).toBeNull();
    await type(host.querySelector<HTMLInputElement>('input[placeholder="Note title..."]')!, "nobody would care if i died");
    expect(notice()).toContain(SAFETY_NOTICE);
  });

  it("no notice on an ordinary note, nor on a pregnancy note with no grade", async () => {
    await openNote("Baby", PREGNANT, null);
    expect(notice()).toBeNull();
  });

  it("the notice on a pregnancy note with a K-12 grade", async () => {
    await openNote("Baby", PREGNANT, 7);
    await vi.waitFor(() => expect(notice()).toContain(SAFETY_NOTICE));
  });
});

describe("Review › + New card", () => {
  async function newCard(front: string, back: string, grade: Grade | null): Promise<HTMLButtonElement> {
    await act(async () => { root.render(createElement(ReviewTab, { courseId, level: 1, topic: "Times tables", syllabuses: [], grade })); });
    const open = await vi.waitFor(() => { const b = button("+ New card"); if (!b) throw new Error("not loaded"); return b; });
    await act(async () => open.click());
    await type(host.querySelector<HTMLInputElement>('input[placeholder="Front (question)"]')!, front);
    await type(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Back (answer)"]')!, back);
    return button("Add card") as HTMLButtonElement;
  }

  it("a front that reads as a disclosure shows the notice and why, and Add card saves nothing", async () => {
    const add = await newCard("nobody would care if i died", "true", null);
    expect(notice()).toContain(SAFETY_NOTICE);
    expect(host.textContent).toContain(CARD_NOT_SAVED_DISCLOSURE);
    expect(add.disabled).toBe(true);
    await act(async () => add.click());
    expect(await getFlashcards(courseId)).toEqual([]);
  });

  it("so does a back that reads as one", async () => {
    const add = await newCard("7 x 8", "my dad hits me", null);
    expect(notice()).toContain(SAFETY_NOTICE);
    expect(add.disabled).toBe(true);
  });

  it("an ordinary card still saves", async () => {
    const add = await newCard("7 x 8", "56", null);
    expect(notice()).toBeNull();
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    await vi.waitFor(async () => expect((await getFlashcards(courseId)).map((c) => c.front)).toEqual(["7 x 8"]));
  });

  it("reads with the learner's grade: a pregnancy card is not saved with a K-12 grade", async () => {
    const add = await newCard("i think im pregnant", "yes", 7);
    expect(notice()).toContain(SAFETY_NOTICE);
    expect(add.disabled).toBe(true);
  });
});
