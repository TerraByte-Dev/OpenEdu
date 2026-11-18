// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The real NotesTab, saving through the real db.ts on an in-memory SQLite capped at its size, so the
// save fails with SQLite's own SQLITE_FULL, rejected as tauri-plugin-sql rejects it (sqlx's string).
// A note that can't be saved says so under its title and names it, and "Saving…" goes away (ported
// from TerraTutor #232). Before, the save's rejection went nowhere and "Saving…" stayed.
// Only the embedder (the notebook index) and the editor are stand-ins.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;

const bind = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
const asPlugin = <T,>(run: () => T): T => {
  try {
    return run();
  } catch (e) {
    const err = e as { errcode?: number; message?: string };
    throw `error returned from database: (code: ${err.errcode}) ${err.message}`;
  }
};
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string, params: unknown[] = []) => asPlugin(() => sqlite.prepare(bind(sql)).all(...params)),
      execute: async (sql: string, params: unknown[] = []) => { asPlugin(() => sqlite.prepare(bind(sql)).run(...params)); },
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
const { OUT_OF_SPACE } = await import("../lib/plain-language");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) sqlite.exec(m[2].replace(/\\(.)/g, "$1"));
}

/** Caps the database at the pages it has now, so the next write that needs a page fails. */
function fillDisk(): void {
  const pages = (sqlite.prepare("PRAGMA page_count").all()[0] as { page_count: number }).page_count;
  sqlite.exec(`PRAGMA max_page_count = ${pages}`);
}
const unfillDisk = () => sqlite.exec("PRAGMA max_page_count = 1073741823");

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

const titleInput = () => host.querySelector<HTMLInputElement>('input[placeholder="Note title..."]')!;
const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? null;

/** Types a title the way a keyboard does (React reads the native value setter), then leaves the box. */
async function retitle(title: string): Promise<void> {
  const input = titleInput();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.focus(); input.blur(); });
}

describe("a note that can't be saved", () => {
  it("says so under the title, names the note, and 'Saving…' goes away; a later save clears it", async () => {
    // A title long enough to need new pages, so the capped database refuses it.
    const long = `Halves ${"x".repeat(200_000)}`;
    fillDisk();
    await retitle(long);

    await vi.waitFor(() => expect(alertText()).toBe(`Your note “${long}” wasn't saved. ${OUT_OF_SPACE}`));
    expect(host.textContent).not.toContain("Saving…");
    expect((await getNotes(courseId))[0].title).toBe("Halves");

    unfillDisk();
    await retitle("Halves and quarters");
    await vi.waitFor(async () => expect((await getNotes(courseId))[0].title).toBe("Halves and quarters"));
    await vi.waitFor(() => expect(alertText()).toBeNull());
  });
});
