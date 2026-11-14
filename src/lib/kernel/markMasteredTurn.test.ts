import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../../src-tauri/src/lib.rs?raw";

// progress.mark_mastered through the real kernel (tutorEngine.run, the function ChatTab calls), the real
// tool, progress.ts and db.ts, against an in-memory SQLite built from the REAL migrations in lib.rs (the
// db-learners.test.ts harness). Only the model is a stand-in.
//
// The bug: on a course with no completed quiz, updateUserProgress computed a null quiz average and wrote
// it to user_progress.total_quiz_score_avg, which migration 1 declares REAL NOT NULL. The insert threw
// AFTER setSubtopicStatus had saved the mark, so the tool told the model it failed while the subtopic
// was in fact marked mastered. Course names and texts here are made up for the test.

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
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" };
const sent: Sent[] = [];
let script: TurnEvent[][] = [];
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
  // The assess answer check's key call (answerCheck.ts): the answer to the tutor's question is 12, so
  // the student's "12, because ..." is correct by code and a "mastered" mark may run.
  callLLMStructured: vi.fn(async () => ({ question: "How many legs do 3 stools with 4 legs each have?", working: "3 x 4 = 12", answer: "12" })),
}));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, Subtopic } from "../../types";

registerBuiltinTools();

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const sql of migrations().values()) sqlite.exec(sql);
}

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });
const SUBTOPICS = [sub("1.1", "Equal Groups"), sub("1.2", "Sharing Fairly")];

function seedCourse(): void {
  sqlite.exec(`INSERT INTO courses (id, title, topic, current_level) VALUES ('c1', 'Multiplication', 'multiplication', 1)`);
  sqlite.prepare(`INSERT INTO syllabuses (id, course_id, level, title, subtopics) VALUES ('s1', 'c1', 1, 'Level 1', ?1)`).run(JSON.stringify(SUBTOPICS));
}

const markCall = (status: "mastered" | "practiced"): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name: "progress.mark_mastered", args: { subtopic_id: "Equal Groups", status } },
  { type: "done", finishReason: "tool_calls" },
];
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];

async function assessTurn(): Promise<TutorTurnResult> {
  const { activeSkill, domainSkill } = chatTurnSkills("assess", "Multiplication", "tiny", true);
  return tutorEngine.run(
    {
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "Check if I've got this." },
        { role: "assistant", content: "How many legs do 3 stools with 4 legs each have?" },
        { role: "user", content: "12, because 3 groups of 4 is 12." },
      ],
      config: CONFIG, retrieval: "off", onText: () => {},
    },
    {
      courseId: "c1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async () => true,
    },
  );
}

const subtopicsInDb = (): Subtopic[] =>
  JSON.parse((sqlite.prepare("SELECT subtopics FROM syllabuses WHERE id = 's1'").all()[0] as { subtopics: string }).subtopics);
const progressRow = () => sqlite.prepare("SELECT * FROM user_progress WHERE course_id = 'c1'").all()[0] as
  { total_quiz_score_avg: number; knowledge_gaps: string } | undefined;
const progressContext = () => (sqlite.prepare("SELECT content FROM tutor_instructions WHERE course_id = 'c1' AND instruction_type = 'progress_context'").all()[0] as { content: string } | undefined)?.content;
// What the model was told the tool returned: the tool message in the request after the call.
const toolResultSeen = () => sent[1].find((m) => m.role === "tool")?.content ?? "";

beforeEach(async () => {
  sent.length = 0;
  script = [];
  await openDb();
  seedCourse();
});

describe("progress.mark_mastered on a course with no completed quiz", () => {
  it("saves the mark and reports success, not an error", async () => {
    script = [markCall("mastered"), reply("I have marked Equal Groups as mastered.")];
    const result = await assessTurn();

    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true, practiced: true });
    expect(result.toolCalls).toEqual([{ name: "progress.mark_mastered", args: { subtopic_id: "Equal Groups", status: "mastered" }, ok: true }]);
    expect(toolResultSeen()).not.toMatch(/^ERROR/);
    expect(toolResultSeen()).toContain("Equal Groups");
  });

  it("writes a number, not null, and the tutor's progress context quotes no quiz average", async () => {
    script = [markCall("mastered"), reply("Saved.")];
    await assessTurn();
    // 0 is the column's own default (migration 1); there is no average without a completed quiz.
    expect(progressRow()).toMatchObject({ total_quiz_score_avg: 0, knowledge_gaps: JSON.stringify(["1.2"]) });
    expect(progressContext()).toContain("Mastered subtopics: Equal Groups");
    expect(progressContext()).not.toMatch(/Quiz average/);
  });

  it("reports a practiced mark the same way", async () => {
    script = [markCall("practiced"), reply("Saved.")];
    const result = await assessTurn();
    expect(result.toolCalls[0].ok).toBe(true);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false, practiced: true });
  });

  it("still reports the saved mark when the progress refresh after it fails", async () => {
    sqlite.exec("DROP TABLE tutor_instructions"); // saveTutorInstruction now throws
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn();
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
    expect(result.toolCalls[0].ok).toBe(true);
    expect(toolResultSeen()).not.toMatch(/^ERROR/);
  });

  it("quotes the real average once a quiz is completed", async () => {
    sqlite.exec(`INSERT INTO quiz_attempts (id, course_id, level, quiz_type, score, started_at, completed_at)
      VALUES ('a1', 'c1', 1, 'practice', 80, datetime('now'), datetime('now'))`);
    script = [markCall("mastered"), reply("Saved.")];
    await assessTurn();
    expect(progressRow()?.total_quiz_score_avg).toBe(80);
    expect(progressContext()).toContain("Quiz average: 80%");
  });
});
