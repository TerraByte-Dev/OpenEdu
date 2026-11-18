import { describe, it, expect, vi, beforeEach } from "vitest";

// A safety disclosure a learner writes in a Notebook note or a hand-made flashcard (ported from TerraTutor
// #236), through the REAL notebook.ts (indexNote, importTextAsNote, reindexCourseNotes, searchNotebook), the
// REAL grounding stage and notebook.search tool, the REAL flashcard storage and flashcard.review_due tool, on
// the REAL db.ts and migrations (in-memory SQLite, the headless plugin-sql shim). Only the embedder is a
// stand-in: missing, or letter-count vectors once it "is". No model reads the learner's words: not the
// embedder, not the tutor's grounding, not the review_due tool, and spaced repetition never drills them back.
// Each check reads with the learner's grade, as the chat's notice does (ToolContext.grade).

vi.mock("@tauri-apps/plugin-sql", () => import("./eval/headless/shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

const MISSING = new Error('Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text');
let embedder: "missing" | "ready" = "missing";
const letters = (t: string) => {
  const v = new Array(26).fill(0);
  for (const ch of t.toLowerCase()) { const i = ch.charCodeAt(0) - 97; if (i >= 0 && i < 26) v[i]++; }
  return v;
};
const embed = vi.fn(async (texts: string[]) => {
  if (embedder === "missing") throw MISSING;
  return texts.map(letters);
});
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  embed: (texts: string[]) => embed(texts),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  countDueFlashcards, createCourse, createFlashcard, createNote, createNotebookChunk, createNotebookDocument,
  getDueFlashcards, getFlashcards, setActiveLearnerId, updateNote,
} from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { importTextAsNote, indexNote, reindexCourseNotes, searchNotebook } from "./notebook";
import { getEmbeddingConfig } from "./store";
import { encodeVec } from "./vec-codec";
import { ground } from "./kernel/ground";
import { budgetFor } from "./kernel/budget";
import { searchTool } from "./tools/notebook/SearchTool";
import { flashcardReviewDueTool } from "./tools/flashcard/ReviewDueTool";
import { cardIsDisclosure } from "./srs";
import { isSafetyDisclosure } from "./child-safety";
import type { Grade } from "./grade";
import type { ToolContext } from "./tools/EduTool";
import type { LLMConfig } from "../types";

// A disclosure and a times-tables fact in one note.
const DISCLOSED = "my dad hits me when I get my times tables wrong. 7 times 8 is 54";
const TIMES = "Times tables: 7 times 8 is 56. I check it by counting groups of eight.";
// A disclosure only with a K-12 grade set (child-safety.ts strongPregnancy).
const PREGNANT = "i think im pregnant. 7 times 8 is 56 in the times tables";

let courseId = "";
beforeEach(async () => {
  embedder = "missing";
  embed.mockClear();
  setActiveLearnerId(DEFAULT_LEARNER_ID); // migration 13's learner; a fresh course per test keeps them apart
  courseId = (await createCourse("Maths", "times tables")).id;
});

const ctx = (grade: Grade | null = null): ToolContext => ({
  courseId,
  level: 1,
  syllabus: null,
  modelTier: "tiny",
  config: { provider: "ollama", model: "gemma4:e2b" } as LLMConfig,
  permissionMode: "default",
  abort: new AbortController().signal,
  grade,
} as ToolContext);

const sawText = (t: string) => embed.mock.calls.some(([texts]) => texts.some((x) => x.includes(t)));
const Q = "what is 7 times 8 in the times tables?";

it("the note and card below read as safety disclosures (the chat's list), and the control does not", () => {
  expect(isSafetyDisclosure(DISCLOSED)).toBe(true);
  expect(isSafetyDisclosure("nobody would care if i died")).toBe(true);
  expect(isSafetyDisclosure(TIMES)).toBe(false);
  expect(isSafetyDisclosure(PREGNANT, 7)).toBe(true);
  expect(isSafetyDisclosure(PREGNANT, null)).toBe(false);
});

describe("a Notebook note that reads as a safety disclosure", () => {
  it("the same note without the disclosure is found, so the searches below would reach it", async () => {
    await createNote(courseId, "Times tables", "I get my times tables wrong. 7 times 8 is 54", 0, null, "learner");
    expect((await searchNotebook({ courseId, query: Q })).map((h) => h.document_title)).toEqual(["Times tables"]);
  });

  it("is never found by the word search, the tutor's grounding or notebook.search", async () => {
    await createNote(courseId, "Times tables", DISCLOSED, 0, null, "learner");
    await createNote(courseId, "Roots", "Roots drink water from the soil.", 0, null, "learner");

    expect(await searchNotebook({ courseId, query: Q })).toEqual([]);

    const g = await ground(Q, ctx(), budgetFor(8192));
    expect(g.block).not.toMatch(/dad|hits/);
    expect(g.hits.filter((h) => h.source === "note")).toEqual([]);

    let value: unknown;
    for await (const ev of searchTool.call({ query: "times tables 7 times 8" }, ctx())) if (ev.kind === "result") value = ev.value;
    expect((value as { results: unknown[] }).results).toEqual([]);
    expect(searchTool.toModelText!(value as never)).not.toMatch(/dad|hits/);
  });

  it("a title that is one keeps the whole note out", async () => {
    await createNote(courseId, "Times tables, my dad hits me", "7 times 8 is 56 in the times tables", 0, null, "learner");
    await createNote(courseId, "Times tables", "7 times 8 is 56 in the times tables", 0, null, "learner");
    expect((await searchNotebook({ courseId, query: Q })).map((h) => h.document_title)).toEqual(["Times tables"]);
  });

  it("a disclosure split by markdown emphasis is still caught (its plain text)", async () => {
    await createNote(courseId, "Times tables", "**my dad** hits me. 7 times 8 is 56 in the times tables", 0, null, "learner");
    expect(await searchNotebook({ courseId, query: Q })).toEqual([]);
  });

  it("reads with the learner's grade: with a K-12 grade a pregnancy note is kept from grounding and search; with none it is found", async () => {
    await createNote(courseId, "Times tables", PREGNANT, 0, null, "learner");

    const graded = await ground(Q, ctx(7), budgetFor(8192));
    expect(graded.block).not.toMatch(/pregnant/);
    let value: unknown;
    for await (const ev of searchTool.call({ query: "times tables 7 times 8" }, ctx(7))) if (ev.kind === "result") value = ev.value;
    expect((value as { results: unknown[] }).results).toEqual([]);

    const adult = await ground(Q, ctx(null), budgetFor(8192));
    expect(adult.hits.filter((h) => h.source === "note")).not.toEqual([]);
  });

  it("is never embedded, and a note that becomes one has its index dropped", async () => {
    embedder = "ready";
    const { note, chunkCount } = await importTextAsNote({ courseId, title: "Eights", text: TIMES, origin: "learner" });
    expect(chunkCount).toBe(1);
    expect((await searchNotebook({ courseId, query: TIMES, topK: 1 }))[0]?.document_title).toBe("Eights");

    // Saved again with a disclosure in it (NotesTab's embed-on-save calls indexNote).
    embed.mockClear();
    await updateNote(note.id, "Eights", `${TIMES}\n\n${DISCLOSED}`);
    expect(await indexNote({ courseId, noteId: note.id, title: "Eights", text: `${TIMES}\n\n${DISCLOSED}` }))
      .toEqual({ documentId: null, chunkCount: 0, skipped: false });
    expect(sawText("dad")).toBe(false);
    expect(await searchNotebook({ courseId, query: TIMES, topK: 3 })).toEqual([]);

    // Catch-up indexing skips it too, and reads with the grade NotesTab passes.
    await createNote(courseId, "Help", "nobody would care if i died", 0, null, "learner");
    await createNote(courseId, "Baby", PREGNANT, 0, null, "learner");
    embed.mockClear();
    await reindexCourseNotes(courseId, 7);
    expect(sawText("died")).toBe(false);
    expect(sawText("dad")).toBe(false);
    expect(sawText("pregnant")).toBe(false);
  });

  it("a passage left in an index from before this change is dropped from the results", async () => {
    embedder = "ready";
    await importTextAsNote({ courseId, title: "Eights", text: TIMES, origin: "learner" });
    const note = await createNote(courseId, "Times tables", DISCLOSED, 0, null, "learner");
    const cfg = await getEmbeddingConfig();
    const vec = letters(DISCLOSED);
    const documentId = await createNotebookDocument({
      courseId, noteId: note.id, title: "Times tables", sourceType: "note", sha256: "old", embeddingModel: cfg.model, dim: vec.length,
    });
    await createNotebookChunk({ documentId, ord: 0, text: DISCLOSED, tokenCount: 20, vecB64: encodeVec(vec) });

    const hits = await searchNotebook({ courseId, query: DISCLOSED, topK: 5 });
    expect(hits.map((h) => h.document_title)).toEqual(["Eights"]);
  });
});

describe("a hand-made flashcard that reads as a safety disclosure", () => {
  it("is never due: not in Review's queue, the chat's count or flashcard.review_due, which hands fronts to the model", async () => {
    await createFlashcard({ courseId, front: "nobody would care if i died", back: "true", level: 1, source: "manual" });
    await createFlashcard({ courseId, front: "7 x 8", back: "my dad hits me", level: 1, source: "manual" });
    await createFlashcard({ courseId, front: "6 x 7", back: "42", level: 1, source: "manual" });
    const now = new Date(Date.now() + 1000).toISOString();

    expect(await getFlashcards(courseId)).toHaveLength(3);
    expect((await getDueFlashcards(courseId, now, 50)).map((c) => c.front)).toEqual(["6 x 7"]);
    expect(await getDueFlashcards(courseId, now, 1)).toHaveLength(1);
    expect(await countDueFlashcards(courseId, now)).toBe(1);

    let value: { count: number; cards: Array<{ front: string }> } | undefined;
    for await (const ev of flashcardReviewDueTool.call({}, ctx())) if (ev.kind === "result") value = ev.value as typeof value;
    expect(value).toEqual({ count: 1, cards: [{ front: "6 x 7", subtopic_id: null }] });
  });

  it("reads with the learner's grade: a pregnancy card is due for an adult, never with a K-12 grade", async () => {
    await createFlashcard({ courseId, front: "i think im pregnant", back: "yes", level: 1, source: "manual" });
    const now = new Date(Date.now() + 1000).toISOString();
    expect(await countDueFlashcards(courseId, now, 7)).toBe(0);
    expect(await getDueFlashcards(courseId, now, 50, 7)).toEqual([]);
    expect(await countDueFlashcards(courseId, now, null)).toBe(1);

    let value: { count: number } | undefined;
    for await (const ev of flashcardReviewDueTool.call({}, ctx(7))) if (ev.kind === "result") value = ev.value as typeof value;
    expect(value?.count).toBe(0);
  });

  it("cardIsDisclosure reads both sides", () => {
    expect(cardIsDisclosure({ front: "i want to kill myself", back: "x" })).toBe(true);
    expect(cardIsDisclosure({ front: "x", back: "my uncle touches me" })).toBe(true);
    expect(cardIsDisclosure({ front: "kill the process", back: "Ctrl+C" })).toBe(false);
  });
});
