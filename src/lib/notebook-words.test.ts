import { describe, it, expect, vi, beforeEach } from "vitest";

// The notes searched with no embedding model, the install a new computer usually is: the REAL
// searchNotebook, notebook.search tool and grounding stage (ground()), on the REAL db.ts and migrations
// (in-memory SQLite, the headless plugin-sql shim). Only the embedder is a stand-in: it fails the way
// llm.ts embed() does when the model isn't pulled, Ollama isn't running or the OpenAI key is missing, or
// returns letter-count vectors once it "is". Ported from TerraTutor #209.

vi.mock("@tauri-apps/plugin-sql", () => import("./eval/headless/shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

const MISSING = new Error('Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text');
const DOWN = new Error("Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.");
const NO_KEY = new Error("OpenAI API key not set — add it in Settings to use OpenAI embeddings.");
let embedder: "missing" | "down" | "nokey" | "broken" | "ready" = "missing";
const letters = (t: string) => {
  const v = new Array(26).fill(0);
  for (const ch of t.toLowerCase()) { const i = ch.charCodeAt(0) - 97; if (i >= 0 && i < 26) v[i]++; }
  return v;
};
const embed = vi.fn(async (texts: string[]) => {
  if (embedder === "missing") throw MISSING;
  if (embedder === "down") throw DOWN;
  if (embedder === "nokey") throw NO_KEY;
  if (embedder === "broken") throw new Error("Ollama embed error 500: unexpected input");
  return texts.map(letters);
});
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  embed: (texts: string[]) => embed(texts),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createCourse, createNote, setActiveLearnerId } from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { importTextAsNote, searchNotebook } from "./notebook";
import { ground, groundedIn } from "./kernel/ground";
import { budgetFor } from "./kernel/budget";
import { citationNote } from "./kernel/citation";
import { searchTool } from "./tools/notebook/SearchTool";
import type { ToolContext } from "./tools/EduTool";
import type { LLMConfig } from "../types";

const FRACTIONS = "The denominator is the bottom number of a fraction. It says how many equal parts the whole is cut into.";
const ROOTS = "Roots drink water from the soil and hold the plant in the ground.";
const TIMES = "5 times 3 is 15. I counted three groups of five blocks.";

let courseId = "";
beforeEach(async () => {
  embedder = "missing";
  embed.mockClear();
  setActiveLearnerId(DEFAULT_LEARNER_ID); // a fresh course per test keeps them apart
  courseId = (await createCourse("Maths and plants", "fractions, roots")).id;
  await createNote(courseId, "Fractions", FRACTIONS, 0, null, "learner");
  await createNote(courseId, "Roots", ROOTS, 0, null, "learner");
  await createNote(courseId, "Counting", TIMES, 0, null, "learner");
});

const ctx = (): ToolContext => ({
  courseId,
  level: 1,
  syllabus: null,
  modelTier: "tiny",
  config: { provider: "ollama", model: "gemma4:e2b" } as LLMConfig,
  permissionMode: "default",
  abort: new AbortController().signal,
} as ToolContext);

describe("searchNotebook with no embedder", () => {
  it("finds the note by its words, after trying the embedder", async () => {
    const hits = await searchNotebook({ courseId, query: "what does the bottom number of a fraction mean?" });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(hits.map((h) => h.document_title)).toEqual(["Fractions"]);
    expect(hits[0]).toMatchObject({ text: FRACTIONS, by: "words", ord: 0 });
    expect(hits[0].score).toBeGreaterThanOrEqual(0.4);
  });

  it("finds a note by its title, when Ollama isn't running and when the OpenAI key is missing too", async () => {
    embedder = "down";
    expect((await searchNotebook({ courseId, query: "roots" })).map((h) => h.document_title)).toEqual(["Roots"]);
    embedder = "nokey";
    expect((await searchNotebook({ courseId, query: "roots" })).map((h) => h.document_title)).toEqual(["Roots"]);
  });

  it("never matches on one common word, a help word or a number", async () => {
    for (const q of ["what is water made of?", "Can you help me with my homework?", "what is 5 times 7", "what is the right answer"]) {
      expect(await searchNotebook({ courseId, query: q }), q).toEqual([]);
    }
  });

  it("in a small notebook, a question of one word finds the one note that has it", async () => {
    // notebook-words.ts counts a word as rare when at most max(1, 15%) of the passages have it, so with
    // three notes a word in just one of them is rare, and a question that asks only that word matches.
    // Kept on purpose: in a learner's own few notes, that note is the one about it.
    expect((await searchNotebook({ courseId, query: "what is water?" })).map((h) => h.document_title)).toEqual(["Roots"]);
  });

  it("a note's title is its topic, even a generic one", async () => {
    // By design (topicWords): a title word is enough on its own unless NOT_A_TOPIC drops it, so a note
    // called "My homework" answers "help me with my homework". Not measured on real notebooks yet.
    await createNote(courseId, "My homework", "Spell the words cat, dog and fish.", 0, null, "learner");
    expect((await searchNotebook({ courseId, query: "help me with my homework" })).map((h) => h.document_title)).toEqual(["My homework"]);
  });

  it("searches only this course's notes", async () => {
    const other = (await createCourse("Birds", "nests")).id;
    expect(await searchNotebook({ courseId: other, query: "what does the bottom number of a fraction mean?" })).toEqual([]);
  });

  it("still fails on an embedder error that isn't about the embedder being unavailable", async () => {
    embedder = "broken";
    await expect(searchNotebook({ courseId, query: "bottom number of a fraction" })).rejects.toThrow(/error 500/);
  });

  it("uses the embedder unchanged when it is there", async () => {
    embedder = "ready";
    await importTextAsNote({ courseId, title: "Leaves", text: "Leaves catch sunlight to make food.", origin: "learner" });
    const hits = await searchNotebook({ courseId, query: "Leaves catch sunlight to make food.", topK: 1 });
    expect(hits[0]?.document_title).toBe("Leaves");
    expect(hits[0]?.by).toBeUndefined();
  });
});

describe("the tutor reads the notes with no embedder", () => {
  it("the grounding stage puts the note in front of the model, and the chip names the notes", async () => {
    const g = await ground("What does the bottom number of a fraction mean?", ctx(), budgetFor(8192));
    expect(g.hits.filter((h) => h.source === "note").map((h) => h.title)).toEqual(["Fractions"]);
    expect(g.block).toContain("[STUDENT NOTE: Fractions]");
    expect(g.trace).toMatchObject({ notesSearched: true, noteSearch: "words", noteCandidates: 1 });
    expect(g.trace.error).toBeUndefined();

    const quoting = "Your note says it: the denominator is the bottom number of a fraction. It says how many equal parts the whole is cut into.";
    expect(citationNote(g.hits, groundedIn(quoting, g.hits), g.trace)).toEqual({ kind: "quoted", titles: ["Fractions"] });
    expect(citationNote(g.hits, groundedIn("I'm not sure.", g.hits), g.trace))
      .toEqual({ kind: "ungrounded", label: "No passage quoted — your notes were searched" });
  });

  it("an unrelated question gets no note", async () => {
    const g = await ground("What is the boiling point of ethanol?", ctx(), budgetFor(8192));
    expect(g.hits.filter((h) => h.source === "note")).toEqual([]);
    expect(g.trace.notesSearched).toBe(true);
  });

  it("the notebook.search tool finds it too", async () => {
    let value: unknown;
    for await (const ev of searchTool.call({ query: "bottom number of a fraction" }, ctx())) if (ev.kind === "result") value = ev.value;
    const { results } = value as { results: Array<{ document_title: string }> };
    expect(results.map((r) => r.document_title)).toEqual(["Fractions"]);
    expect(searchTool.toModelText!({ results } as never)).toContain("[From the student's notes: Fractions]");
  });
});
