// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";

// The real Review tab on the real db.ts, over the in-memory SQLite stand-in the db tests use. A double-click
// on a grade button grades the card once (one flashcard_reviews row, the schedule moved once), and its second
// click never lands on the next card's "Show answer", whether it comes while the grade saves or just after the
// next card is up. Ported from TerraTutor #234.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;
// While set, a write to flashcards waits for it: the grade is still saving.
let gate: Promise<void> | null = null;

const bind = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string, params: unknown[] = []) => sqlite.prepare(bind(sql)).all(...params),
      execute: async (sql: string, params: unknown[] = []) => {
        if (gate && /^\s*UPDATE flashcards/.test(sql)) await gate;
        sqlite.prepare(bind(sql)).run(...params);
      },
    }),
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn() } }));

const { default: ReviewTab } = await import("./ReviewTab");
const { setActiveLearnerId, createCourse, createFlashcard } = await import("../lib/db");
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

let root: Root;
let host: HTMLDivElement;

async function open(): Promise<void> {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  const courseId = (await createCourse("Animals", "Animals")).id;
  for (const id of ["a", "b", "c"]) await createFlashcard({ courseId, front: `Front ${id}`, back: `Back ${id}`, level: 1, source: "manual" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(ReviewTab, { courseId, level: 1, topic: "Animals", syllabuses: [] })); });
  await vi.waitFor(() => { if (!button("Show answer")) throw new Error("card not shown yet"); });
}

afterEach(async () => {
  gate = null;
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label)) ?? null;
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const reviews = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM flashcard_reviews").all() as Array<{ n: number }>)[0].n;
const repsOf = (front: string) => (sqlite.prepare("SELECT reps FROM flashcards WHERE front = ?").all(front) as Array<{ reps: number }>)[0].reps;
// The card on screen: its front, and whether its back shows.
const front = () => host.textContent?.match(/Front (\w)/)?.[1];
const backShown = () => /Back \w/.test(host.textContent ?? "");

describe("Review grades a card once", () => {
  it("a second click while the grade saves writes nothing more and leaves the next card hidden", async () => {
    await open();
    const first = front()!;
    await act(async () => { click(button("Show answer")!); });
    let save!: () => void;
    gate = new Promise<void>((r) => { save = r; });
    const good = button("Good")!;
    await act(async () => { click(good); click(good); });
    expect(good.disabled).toBe(true);
    await act(async () => { save(); });
    await vi.waitFor(() => { if (front() === first) throw new Error("next card not up yet"); });
    expect(reviews()).toBe(1);
    expect(repsOf(`Front ${first}`)).toBe(1);
    expect(backShown()).toBe(false);
  });

  it("a second click just after the next card is up does not reveal it; a later click does", async () => {
    await open();
    const first = front()!;
    await act(async () => { click(button("Show answer")!); });
    await act(async () => { click(button("Good")!); });
    await vi.waitFor(() => { if (front() === first) throw new Error("next card not up yet"); });
    // The double-click's second click lands where the grade was: now the next card's "Show answer".
    await act(async () => { click(button("Show answer")!); });
    expect(backShown()).toBe(false);
    expect(reviews()).toBe(1);

    vi.useFakeTimers({ now: Date.now() + 600, toFake: ["Date"] });
    await act(async () => { click(button("Show answer")!); });
    expect(backShown()).toBe(true);
  });
});
