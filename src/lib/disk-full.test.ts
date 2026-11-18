import { describe, it, expect, vi, beforeEach } from "vitest";
import chatTab from "../components/ChatTab.tsx?raw";
import app from "../App.tsx?raw";

// A full disk, through the REAL migrations and the REAL db.ts on an in-memory SQLite whose size is capped
// (PRAGMA max_page_count), so the write fails with SQLite's own SQLITE_FULL. The stand-in for
// tauri-plugin-sql rejects the way the plugin does: a string, sqlx's "error returned from database:
// (code: 13) database or disk is full". Then the sentence each screen shows for it (ported from
// TerraTutor #232). notes-save-error.test.ts shows it in the real Notebook.

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

import { migrations } from "./eval/headless/shims/plugin-sql";
import { createChatThread, createCourse, createLesson, createNote, getNotes, saveChatMessage, saveTutorInstruction, setActiveLearnerId, updateNote } from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { createNoteSaver } from "./note-autosave";
import { friendlyError, messageNotSaved, noteNotSaved, OUT_OF_SPACE } from "./plain-language";

let courseId = "";
let threadId = "";

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (e) { return e; }
  throw new Error("expected it to fail");
}

/** Caps the database at the pages it has now, so the next write that needs a page fails. */
function fillDisk(): void {
  const pages = (sqlite.prepare("PRAGMA page_count").all()[0] as { page_count: number }).page_count;
  sqlite.exec(`PRAGMA max_page_count = ${pages}`);
}

const BIG = "x".repeat(200_000);

beforeEach(async () => {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const all = migrations();
  for (const v of [...all.keys()].sort((a, b) => a - b)) sqlite.exec(all.get(v)!);
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  courseId = (await createCourse("Fractions", "fractions")).id;
  threadId = (await createChatThread(courseId, 1, "Halves")).id;
});

describe("a full disk", () => {
  it("the learner's chat message: not saved, not sent, still in the box, and why", async () => {
    fillDisk();
    const e = await caught(() => saveChatMessage(courseId, "user", `Why is 2/4 the same as 1/2? ${BIG}`, 1, threadId));

    expect(String(e)).toBe("error returned from database: (code: 13) database or disk is full");
    expect(messageNotSaved(e)).toBe(`Your message wasn't saved, so it wasn't sent. It's still in the box. ${OUT_OF_SPACE}`);
  });

  it("a note: says it wasn't saved, names it, and why", async () => {
    const note = await createNote(courseId, "Halves", "", 1);
    fillDisk();
    const e = await caught(() => updateNote(note.id, "Halves", BIG));

    expect(noteNotSaved("Halves", e)).toBe(`Your note “Halves” wasn't saved. Your words are still here. ${OUT_OF_SPACE}`);
  });

  it("a note through NotesTab's saver: the words are kept, and Save again writes them once there is room", async () => {
    const note = await createNote(courseId, "Halves", "", 1);
    const saver = createNoteSaver((d) => updateNote(d.id, d.title, d.content)); // NotesTab's write
    const words = `Half of 4 is 2. ${BIG}`;
    fillDisk();
    saver.edit({ id: note.id, courseId, title: "Halves", content: words }, note);

    expect(await saver.flush()).toEqual(new Set([note.id]));
    expect(saver.newest(note.id)?.content).toBe(words);
    const failure = saver.failure(note.id)!;
    expect(noteNotSaved(failure.title, failure.error)).toBe(`Your note “Halves” wasn't saved. Your words are still here. ${OUT_OF_SPACE}`);
    expect((await getNotes(courseId)).find((n) => n.id === note.id)?.content).toBe("");

    sqlite.exec("PRAGMA max_page_count = 1073741823"); // files deleted
    expect(await saver.flush()).toEqual(new Set());
    expect((await getNotes(courseId)).find((n) => n.id === note.id)?.content).toBe(words);
    expect(saver.failure(note.id)).toBeUndefined();
  });

  it("a course build, a lesson or a tutor reply: says the computer is out of space, not 'try again in a moment'", async () => {
    fillDisk();
    for (const write of [
      () => saveTutorInstruction(courseId, "concept_ledger", BIG), // a course build step
      () => createLesson(courseId, 1, "Halves", BIG, null), // a lesson
      () => saveChatMessage(courseId, "assistant", BIG, 1, threadId), // the tutor's reply
    ]) {
      const e = await caught(write);
      expect(friendlyError(e)).toBe(OUT_OF_SPACE);
      // Dashboard and LessonsTab pass the message on, wrapped or not.
      expect(friendlyError(new Error(`Course build failed at "instructions". Reason: ${String(e)}`))).toBe(OUT_OF_SPACE);
    }
  });

  it("a save that failed for another reason keeps the old words", () => {
    expect(messageNotSaved("error returned from database: (code: 5) database is locked")).toBe(
      "Your message wasn't saved, so it wasn't sent. It's still in the box. Try sending it again in a moment.",
    );
    expect(noteNotSaved("  ", "database is locked")).toBe("Your note wasn't saved. Your words are still here. Press Save again in a moment.");
  });
});

describe("the screens' wiring (a live click test covers the rest)", () => {
  const lf = (s: string) => s.replace(/\r\n?/g, "\n");
  it("ChatTab puts the words back in the box and says so", () => {
    expect(lf(chatTab)).toContain("setInput((cur) => (cur.trim() ? cur : userText));\n        setChatError(messageNotSaved(e));");
  });
  it("closing the window saves the notes first", () => {
    expect(lf(app)).toContain("onCloseRequested(async () => { await savePendingEdits(); await unloadOllamaModels(); })");
  });
});
