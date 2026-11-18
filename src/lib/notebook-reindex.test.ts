import { describe, it, expect, vi, beforeEach } from "vitest";

// Notes that couldn't be embedded when they were imported, through the REAL notebook.ts
// (importTextAsNote, reindexCourseNotes, searchNotebook), the REAL db.ts on the REAL migrations
// (in-memory SQLite, the headless plugin-sql shim) and the import message NotesTab shows
// (ingestResultSummary). Only the embedder is a stand-in: it fails the way llm.ts embed() does when
// the embedding model isn't pulled, or returns letter-count vectors once it "is".

vi.mock("@tauri-apps/plugin-sql", () => import("./eval/headless/shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

const MISSING = new Error('Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text');
const DOWN = new Error("Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.");
// llm.ts embed() with the OpenAI embedder picked and no key saved.
const NO_KEY = new Error("OpenAI API key not set — add it in Settings to use OpenAI embeddings.");
let embedder: "missing" | "down" | "nokey" | "ready" = "missing";
// Text the embedder rejects on its own (a server error for that one input), with the embedder otherwise up.
const BAD_NOTE = "this one note breaks the embedder";
const letters = (t: string) => {
  const v = new Array(26).fill(0);
  for (const ch of t.toLowerCase()) { const i = ch.charCodeAt(0) - 97; if (i >= 0 && i < 26) v[i]++; }
  return v;
};
const embed = vi.fn(async (texts: string[]) => {
  if (embedder === "missing") throw MISSING;
  if (embedder === "down") throw DOWN;
  if (embedder === "nokey") throw NO_KEY;
  if (texts.some((t) => t.includes(BAD_NOTE))) throw new Error("Ollama embed error 500: unexpected input");
  return texts.map(letters);
});
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  embed: (texts: string[]) => embed(texts),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import Database from "./eval/headless/shims/plugin-sql";
import { createCourse, deleteNote, setActiveLearnerId, updateNote } from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { importTextAsNote, reindexCourseNotes, searchNotebook } from "./notebook";
import { ingestResultSummary } from "./ingest-format";

const docsFor = async (courseId: string) =>
  (await (await Database.load("sqlite:openedu.db")).select(
    "SELECT note_id FROM notebook_documents WHERE course_id = $1 ORDER BY note_id", [courseId],
  )) as Array<{ note_id: string }>;

let courseId = "";
beforeEach(async () => {
  embedder = "missing";
  embed.mockClear();
  setActiveLearnerId(DEFAULT_LEARNER_ID); // migration 13's learner; a fresh course per test keeps them apart
  courseId = (await createCourse("Plants", "how plants grow")).id;
});

// What NotesTab.ingestFiles does per file, and the message it shows after.
async function importAll(files: Array<{ title: string; text: string }>) {
  let imported = 0, pending = 0;
  let reason: string | undefined;
  const ids: string[] = [];
  for (const f of files) {
    const res = await importTextAsNote({ courseId, title: f.title, text: f.text, sourceType: "md", folderId: null, origin: "import" });
    imported++;
    ids.push(res.note.id);
    if (!res.embedded) { pending++; reason ??= res.indexError; }
  }
  return { ids, summary: ingestResultSummary({ imported, pending, failed: 0, reason }) };
}

describe("importing notes with no embedding model on the computer", () => {
  it("says what's missing and where it's added, and doesn't promise an open-and-save", async () => {
    const { summary } = await importAll([
      { title: "Roots", text: "Roots drink water from the soil." },
      { title: "Leaves", text: "Leaves catch sunlight to make food." },
    ]);
    expect(summary.kind).toBe("warn");
    expect(summary.message).toContain("2 notes couldn't be added to notebook search yet");
    expect(summary.message).toContain("Settings › Provider & Models");
    expect(summary.message).toContain("tries again each time you open Notes");
    expect(summary.message).not.toMatch(/open and save/);
    expect(await docsFor(courseId)).toEqual([]);
  });

  it("indexes them on the next open once the model is there, with nobody editing them", async () => {
    const { ids } = await importAll([
      { title: "Roots", text: "Roots drink water from the soil." },
      { title: "Leaves", text: "Leaves catch sunlight to make food." },
    ]);

    // Still missing: the catch-up stops at the first failure instead of trying every note.
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 0, error: MISSING.message });
    expect(embed).toHaveBeenCalledTimes(1);

    embedder = "ready";
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 2 });
    expect((await docsFor(courseId)).map((d) => d.note_id).sort()).toEqual([...ids].sort());
    const hits = await searchNotebook({ courseId, query: "Roots drink water from the soil.", topK: 1 });
    expect(hits[0]?.text).toContain("Roots drink water");

    // Already indexed: the next open embeds nothing.
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 0 });
    expect(embed).not.toHaveBeenCalled();
  });

  it("re-indexes a note saved while the embedder was down, and leaves deleted notes out", async () => {
    embedder = "ready";
    const { ids: [roots, leaves] } = await importAll([
      { title: "Roots", text: "Roots drink water." },
      { title: "Leaves", text: "Leaves catch sunlight." },
    ]);
    embedder = "missing";
    await updateNote(roots, "Roots", "Roots drink water and hold the plant in the ground.");
    await deleteNote(leaves);
    embedder = "ready";
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 1 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(await docsFor(courseId)).toEqual([{ note_id: roots }]);
  });

  it("stops when Ollama isn't running, and skips past a note that fails on its own", async () => {
    await importAll([
      { title: "Roots", text: "Roots drink water." },
      { title: "Odd", text: BAD_NOTE },
      { title: "Leaves", text: "Leaves catch sunlight." },
    ]);

    embedder = "down";
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 0, error: DOWN.message });
    expect(embed).toHaveBeenCalledTimes(1);

    // OpenEdu can embed through OpenAI: no key stops the pass the same way.
    embedder = "nokey";
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 0, error: NO_KEY.message });
    expect(embed).toHaveBeenCalledTimes(1);

    // The embedder works; one note's own failure doesn't keep the notes after it out of search.
    embedder = "ready";
    embed.mockClear();
    expect(await reindexCourseNotes(courseId)).toEqual({ indexed: 2, error: "Ollama embed error 500: unexpected input" });
    expect(embed).toHaveBeenCalledTimes(3);
    expect(await docsFor(courseId)).toHaveLength(2);
  });
});
