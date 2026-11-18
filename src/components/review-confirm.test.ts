// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import libRs from "../../src-tauri/src/lib.rs?raw";
import type { Grade } from "../lib/grade";

// The real ReviewTab on the real db.ts, over the in-memory SQLite stand-in the db tests use (ported from
// TerraTutor #231). The grade hints are full-strength --ink-dim at 14px or larger (they were 10px at
// opacity 0.7), and "Delete this card?" reads at 14px or larger with .btn 44px pills, Delete in the
// danger colour. A K-2 learner gets the larger card size there too.

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

async function open(grade: Grade | null): Promise<void> {
  await openDb();
  setActiveLearnerId(DEFAULT_LEARNER_ID);
  const courseId = (await createCourse("Fractions", "Fractions")).id;
  await createFlashcard({ courseId, front: "What is one half of 4?", back: "2", level: 1, source: "manual" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(ReviewTab, { courseId, level: 1, topic: "Fractions", syllabuses: [], grade })); });
  await vi.waitFor(() => { if (!button("Show answer")) throw new Error("card not shown yet"); });
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const question = () => host.querySelector('[role="group"][aria-label="Delete this card?"]')!;
const inQuestion = (label: string) => [...question().querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const hint = (text: string) => [...host.querySelectorAll("button span")].find((s) => s.textContent === text)!;

describe("Review: the grade hints", () => {
  it("are full-strength secondary ink at 14px, not 10px and faded", async () => {
    await open(null);
    await act(async () => button("Show answer").click());
    for (const h of ["forgot", "barely", "got it", "too easy"]) {
      expect(hint(h).className).toContain("text-[var(--ink-dim)]");
      expect(hint(h).className).toMatch(/\btext-sm\b/);
      expect(hint(h).className).not.toMatch(/opacity-|text-\[10px\]/);
    }
  });

  it("are text-base for a K-2 learner", async () => {
    await open(0);
    await act(async () => button("Show answer").click());
    expect(hint("forgot").className).toMatch(/\btext-base\b/);
  });
});

describe("Review: Delete card asks with pills", () => {
  it("at 14px, with Delete in the danger colour inline and Keep it focused", async () => {
    await open(null);
    await act(async () => button("Delete card").click());
    expect(question().querySelector("span")!.className).toMatch(/\btext-sm\b/);
    // Inline: .btn's colour and font are unlayered CSS and beat utilities (CLAUDE.md › Design system).
    expect(inQuestion("Delete").classList.contains("btn")).toBe(true);
    expect(inQuestion("Delete").style.color).toBe("var(--danger)");
    expect(inQuestion("Delete").style.borderColor).toBe("var(--danger)");
    expect(inQuestion("Delete").style.fontSize).toBe("0.9rem");
    expect(inQuestion("Keep it").classList.contains("btn")).toBe(true);
    expect(inQuestion("Keep it").style.color).toBe("");
    expect(document.activeElement).toBe(inQuestion("Keep it"));
  });

  it("at the card's larger size for a K-2 learner", async () => {
    await open(1);
    await act(async () => button("Delete card").click());
    expect(question().querySelector("span")!.className).toMatch(/\btext-lg\b/);
    expect(inQuestion("Delete").style.fontSize).toBe("1.125rem");
    expect(inQuestion("Keep it").style.fontSize).toBe("1.125rem");
  });
});
