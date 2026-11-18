// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The real NotesTab, deleting through the real db.ts on the in-memory SQLite stand-in the db tests use.
// The trash button only asks: "Delete this note?" opens on its own row, so a double-click on the trash
// (both clicks land on the trash) can't delete the note (ported from TerraTutor #218). Before, the trash
// became "Click again to delete" in the same place and the second click of a double-click deleted it.
// Only the embedder (the notebook index) and the editor are stand-ins.

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
vi.mock("../lib/notebook", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/notebook")>(),
  indexNote: vi.fn(async () => {}),
  reindexCourseNotes: vi.fn(async () => {}),
}));
vi.mock("./MarkdownEditor", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const { default: NotesTab } = await import("./NotesTab");
const { setActiveLearnerId, createCourse, createNote, getNotes } = await import("../lib/db");
const { DEFAULT_LEARNER_ID } = await import("../lib/learners");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

let courseId: string;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  }
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "Fractions")).id;
  await createNote(courseId, "Halves", "One half is one of two equal parts.", 1);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(NotesTab, { courseId, level: 1, grade: null })); });
  // Open the note from the list.
  const item = await vi.waitFor(() => {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes("Halves"));
    if (!b) throw new Error("note not listed yet");
    return b;
  });
  await act(async () => item.click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const trash = () => host.querySelector<HTMLButtonElement>('button[aria-label="Delete note"]')!;
const question = () => host.querySelector('[role="group"][aria-label="Delete this note?"]');
const inQuestion = (label: string) => [...(question()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label)!;

describe("deleting a note in the Notebook", () => {
  it("a double-click on the trash only asks; the note stays", async () => {
    // Both clicks land on the same button, as a double-click's do.
    const t = trash();
    expect(t).toBeTruthy();
    await act(async () => { t.click(); });
    await act(async () => { t.click(); t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await new Promise((r) => setTimeout(r, 20)); // let any delete the clicks started reach the db
    expect(await getNotes(courseId)).toHaveLength(1);
    expect(question()?.textContent).toContain("Delete this note? It cannot be brought back.");
    expect(document.activeElement).toBe(inQuestion("Keep it"));
  });

  it("Keep it closes the question; Delete deletes the note", async () => {
    await act(async () => trash().click());
    await act(async () => inQuestion("Keep it").click());
    expect(question()).toBeNull();
    expect(await getNotes(courseId)).toHaveLength(1);

    await act(async () => trash().click());
    await act(async () => inQuestion("Delete").click());
    await vi.waitFor(async () => expect(await getNotes(courseId)).toHaveLength(0));
  });
});
