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
// Every save goes through lib/note-autosave.ts (ported from TerraTutor #235): a note saves a few seconds
// after the last keystroke, when the Notes tab is left and when the window closes, and a failed save on a
// switch keeps the note open with its words and a Save again button.
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
const { AUTOSAVE_DELAY_MS, savePendingEdits } = await import("../lib/note-autosave");

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
let halvesId: string;
let root: Root;
let host: HTMLDivElement;
let mounted = false;

beforeEach(async () => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  }
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "Fractions")).id;
  halvesId = (await createNote(courseId, "Halves", "One half is one of two equal parts.", 1)).id;
  await createNote(courseId, "Quarters", "A quarter is one of four equal parts.", 1);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(NotesTab, { courseId, level: 1, grade: null })); });
  mounted = true;
  const item = await listed("Halves");
  await act(async () => item.click());
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  mounted = false;
  host.remove();
});

const listed = (title: string) => vi.waitFor(() => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(title));
  if (!b) throw new Error(`${title} not listed yet`);
  return b;
});
const titleInput = () => host.querySelector<HTMLInputElement>('input[placeholder="Note title..."]')!;
const alertText = () => host.querySelector('[role="alert"] span')?.textContent ?? null;
const saveAgain = () =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find((b) => b.textContent?.includes("Save again"));
const halves = async () => (await getNotes(courseId)).find((n) => n.id === halvesId)!;

/** Types a title the way a keyboard does (React reads the native value setter), and stays in the box. */
async function type(title: string): Promise<void> {
  const input = titleInput();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types a title, then leaves the box. */
async function retitle(title: string): Promise<void> {
  await type(title);
  const input = titleInput();
  await act(async () => { input.focus(); input.blur(); });
}

describe("a note that can't be saved", () => {
  it("says so under the title, names the note, and 'Saving…' goes away; a later save clears it", async () => {
    // A title long enough to need new pages, so the capped database refuses it.
    const long = `Halves ${"x".repeat(200_000)}`;
    fillDisk();
    await retitle(long);

    await vi.waitFor(() => expect(alertText()).toBe(`Your note “${long}” wasn't saved. Your words are still here. ${OUT_OF_SPACE}`));
    expect(host.textContent).not.toContain("Saving…");
    expect((await halves()).title).toBe("Halves");

    unfillDisk();
    await retitle("Halves and quarters");
    await vi.waitFor(async () => expect((await halves()).title).toBe("Halves and quarters"));
    await vi.waitFor(() => expect(alertText()).toBeNull());
  });

  it("opening another note: the app stays on this one with its words, and Save again writes them", async () => {
    // Long enough to need new pages; short enough for the unlinked-mentions search once it is saved.
    const long = `Halves ${"x".repeat(20_000)}`;
    fillDisk();
    await type(long);
    const quarters = await listed("Quarters");
    await act(async () => quarters.click());

    // Still on Halves, its words in the box, and the banner over it says they are still here.
    await vi.waitFor(() => expect(alertText()).toBe(`Your note “${long}” wasn't saved. Your words are still here. ${OUT_OF_SPACE}`));
    expect(titleInput().value).toBe(long);
    expect(host.textContent).not.toContain("Keep it open");
    expect((await halves()).title).toBe("Halves");

    unfillDisk();
    await act(async () => saveAgain()!.click());
    await vi.waitFor(async () => expect((await halves()).title).toBe(long));
    await vi.waitFor(() => expect(alertText()).toBeNull());

    await act(async () => quarters.click());
    await vi.waitFor(() => expect(titleInput().value).toBe("Quarters"));
  });
});

describe("a note saves without leaving the box", () => {
  it("a few seconds after the last keystroke", async () => {
    await type("Halves, typed and left alone");
    expect((await halves()).title).toBe("Halves");
    await vi.waitFor(async () => expect((await halves()).title).toBe("Halves, typed and left alone"), { timeout: AUTOSAVE_DELAY_MS + 2000 });
  });

  it("when the Notes tab is left (no blur fires)", async () => {
    await type("Halves, then another tab");
    await act(async () => root.unmount());
    mounted = false;
    await vi.waitFor(async () => expect((await halves()).title).toBe("Halves, then another tab"));
  });

  it("when the window closes (App's onCloseRequested awaits savePendingEdits)", async () => {
    await type("Halves, then Alt+F4");
    await savePendingEdits();
    expect((await halves()).title).toBe("Halves, then Alt+F4");
  });
});
