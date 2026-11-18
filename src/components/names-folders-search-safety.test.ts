// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { Grade } from "../lib/grade";

// The real Notebook (NotesTab) and the real learner menu (LearnerMenu), on the real db.ts over the in-memory
// SQLite stand-in the db tests use (ported from TerraTutor #237). A safety disclosure, with the learner's grade
// as the chat reads it, typed into the Notebook's search box shows the notice and never reaches searchNotebook
// (so never the embedder); one typed as a folder name shows the notice and is never saved; a file import whose
// name or text is one shows the notice at import (the note is still made); and one typed as the learner's new
// name shows the notice and is never saved. Only the notebook's search and import, the editor and the graph
// are stand-ins.

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
  detectModelTier: vi.fn(async () => "small"),
}));
const notebook = vi.hoisted(() => ({
  searchNotebook: vi.fn(async () => []),
  importTextAsNote: vi.fn(async () => ({ embedded: true })),
}));
vi.mock("../lib/notebook", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/notebook")>(),
  indexNote: vi.fn(async () => {}),
  reindexCourseNotes: vi.fn(async () => {}),
  searchNotebook: notebook.searchNotebook,
  importTextAsNote: notebook.importTextAsNote,
}));
vi.mock("./MarkdownEditor", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const { default: NotesTab } = await import("./NotesTab");
const { default: LearnerMenu } = await import("./LearnerMenu");
const { setActiveLearnerId, createCourse, createFolder, getFolders, listLearners } = await import("../lib/db");
const { DEFAULT_LEARNER_ID, LEARNER_NAME_DISCLOSURE } = await import("../lib/learners");
const { SAFETY_NOTICE } = await import("../lib/child-safety");
const { FOLDER_NAME_DISCLOSURE } = await import("../lib/plain-language");
const { noteIsDisclosure } = await import("../lib/notebook-assistant");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

const PREGNANT = "i think im pregnant";

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
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const notices = () => [...host.querySelectorAll('[role="note"]')].filter((n) => n.textContent?.includes(SAFETY_NOTICE));

/** Types into a box the way a keyboard does (React reads the native value setter). */
async function type(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(el: HTMLElement, k: string): Promise<void> {
  await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
}

describe("Notebook", () => {
  async function openNotes(grade: Grade | null = null): Promise<void> {
    await act(async () => { root.render(createElement(NotesTab, { courseId, level: 1, grade })); });
  }
  const searchBox = () => host.querySelector<HTMLInputElement>('input[placeholder="Search…"]')!;

  it("a search that reads as a safety disclosure shows the notice and is never searched (so never embedded)", async () => {
    await openNotes();
    await type(searchBox(), "i want to kill myself");
    expect(notices()).toHaveLength(1);
    await key(searchBox(), "Enter");
    expect(notebook.searchNotebook).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("matching passage");

    await type(searchBox(), "photosynthesis");
    expect(notices()).toHaveLength(0);
    await key(searchBox(), "Enter");
    expect(notebook.searchNotebook).toHaveBeenCalledExactlyOnceWith({ courseId, query: "photosynthesis", topK: 5, grade: null });
  });

  it("reads the search with the learner's grade: a pregnancy disclosure is held back with a K-12 grade only", async () => {
    await openNotes(7);
    await type(searchBox(), PREGNANT);
    expect(notices()).toHaveLength(1);
    await key(searchBox(), "Enter");
    expect(notebook.searchNotebook).not.toHaveBeenCalled();

    await openNotes(null);
    expect(notices()).toHaveLength(0);
    await key(searchBox(), "Enter");
    expect(notebook.searchNotebook).toHaveBeenCalledOnce();
  });

  it("a folder name that reads as one shows the notice and is not saved; an ordinary name is", async () => {
    const folder = await createFolder(courseId, "Maths", null);
    await openNotes();
    const rename = await vi.waitFor(() => {
      const b = host.querySelector<HTMLButtonElement>('button[title="Rename"]');
      if (!b) throw new Error("folder not listed yet");
      return b;
    });
    await act(async () => rename.click());
    const box = () => host.querySelector<HTMLInputElement>("input.bg-lcd")!;
    await type(box(), "nobody would care if i died");
    expect(notices()).toHaveLength(1);
    expect(host.textContent).toContain(FOLDER_NAME_DISCLOSURE);
    await key(box(), "Enter");
    await act(async () => { box().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); // blur commits too
    expect(box()).not.toBeNull(); // the box stays open
    expect((await getFolders(courseId)).find((f) => f.id === folder.id)?.name).toBe("Maths"); // the old name kept

    await type(box(), "Times tables");
    expect(notices()).toHaveLength(0);
    await key(box(), "Enter");
    await vi.waitFor(async () => expect((await getFolders(courseId)).find((f) => f.id === folder.id)?.name).toBe("Times tables"));
  });

  async function importFiles(files: File[], grade: Grade | null = null): Promise<void> {
    await openNotes(grade);
    const before = notebook.importTextAsNote.mock.calls.length;
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    // Every file was imported, and the import button is enabled again: the import has finished.
    await vi.waitFor(() => expect(notebook.importTextAsNote).toHaveBeenCalledTimes(before + files.length));
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button[title="Import .md/.txt as notes"]')!.disabled).toBe(false));
  }

  it("a file import whose text reads as one shows the notice at import, and the note is still made", async () => {
    await importFiles([new File(["my uncle touches me and says not to tell"], "diary.txt", { type: "text/plain" })]);
    expect(notebook.importTextAsNote).toHaveBeenCalledOnce();
    expect(notices()).toHaveLength(1);
  });

  it("so does one whose file name reads as one", async () => {
    await importFiles([
      new File(["7 x 8 = 56"], "times tables.md", { type: "text/markdown" }),
      new File(["spelling list"], "i want to die.txt", { type: "text/plain" }),
    ]);
    expect(notebook.importTextAsNote).toHaveBeenCalledTimes(2);
    expect(notices()).toHaveLength(1);
  });

  it.each(["i_want_to_die.txt", "i-want-to-die.md", "nobody_would_care_if_i_died.txt", "IWantToDie.txt"])(
    "so does a file name written with separators or camelCase (%s), and the note is titled in words",
    async (fileName) => {
      await importFiles([new File(["spelling list"], fileName, { type: "text/plain" })]);
      expect(notices()).toHaveLength(1);
      const title = (notebook.importTextAsNote.mock.calls[0] as unknown as [{ title: string }])[0].title;
      expect(title).not.toMatch(/[_-]/);
      expect(noteIsDisclosure(title, null)).toBe(true); // so the note is kept from every model by its title too
    },
  );

  it("reads the import with the learner's grade: a pregnancy note gets the notice with a K-12 grade only", async () => {
    await importFiles([new File([PREGNANT], "diary.txt", { type: "text/plain" })], 7);
    expect(notices()).toHaveLength(1);
    await act(async () => root.unmount());
    root = createRoot(host);
    await importFiles([new File([PREGNANT], "diary.txt", { type: "text/plain" })], null);
    expect(notices()).toHaveLength(0);
  });

  it("an ordinary import shows no notice, and its file name is kept as written", async () => {
    await importFiles([new File(["7 x 8 = 56"], "times_tables-Week2.md", { type: "text/markdown" })]);
    expect(notebook.importTextAsNote).toHaveBeenCalledOnce();
    expect(notebook.importTextAsNote).toHaveBeenCalledWith(expect.objectContaining({ title: "times_tables-Week2" }));
    expect(notices()).toHaveLength(0);
  });

  it("a later drop of only unsupported files clears the last import's notice", async () => {
    await importFiles([new File(["spelling list"], "i_want_to_die.txt", { type: "text/plain" })]);
    expect(notices()).toHaveLength(1);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "photo.png", { type: "image/png" })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("Only .md, .markdown, and .txt files are supported.");
    expect(notices()).toHaveLength(0);
  });
});

describe("the learner menu › Change my name", () => {
  async function renameTo(name: string): Promise<void> {
    const learners = await listLearners();
    const me = learners.find((l) => l.id === DEFAULT_LEARNER_ID)!;
    await act(async () => {
      root.render(createElement(LearnerMenu, {
        learner: me, learners, legacyUsageMode: null, busyReason: null,
        onClose: () => {}, onSwitch: () => {}, onChanged: () => {}, onDeleted: () => {},
      }));
    });
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Change my name")!;
    await act(async () => open.click());
    await type(host.querySelector<HTMLInputElement>("form input")!, name);
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  }

  it("a name that reads as a disclosure shows the notice and the plain line, and is not saved", async () => {
    const before = (await listLearners()).find((l) => l.id === DEFAULT_LEARNER_ID)!.name;
    await renameTo("i want to kill myself");
    expect(notices()).toHaveLength(1);
    expect(host.textContent).toContain(LEARNER_NAME_DISCLOSURE);
    expect(host.querySelector(".text-danger")).toBeNull(); // plain text, not the red error line
    expect((await listLearners()).find((l) => l.id === DEFAULT_LEARNER_ID)!.name).toBe(before);
  });

  it("an ordinary name is saved, with no notice", async () => {
    await renameTo("Cleo");
    expect(notices()).toHaveLength(0);
    await vi.waitFor(async () => expect((await listLearners()).find((l) => l.id === DEFAULT_LEARNER_ID)!.name).toBe("Cleo"));
  });
});
