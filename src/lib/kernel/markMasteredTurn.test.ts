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
const events: ToolUIEvent[] = [];
// The tools an "Is that okay?" card was shown for (ctx.confirmTool), in order.
const confirms: string[] = [];
let script: TurnEvent[][] = [];
// The assess answer check's calls (answerCheck.ts): the key call, then the grading call when code cannot
// settle the answer. By default the answer to the tutor's question is 12, so the student's "12, because
// ..." is correct by code and a "mastered" mark may run.
const KEY_12 = { question: "How many legs do 3 stools with 4 legs each have?", working: "3 x 4 = 12", answer: "12" };
type Key = { question: string; working: string; answer: string };
// A key can be worked out from what the key call was sent (a hint's question gets its own key).
let keyOut: Key | ((sent: Sent) => Key) = KEY_12;
let gradeOut: { student_answer: string; verdict: string } | null = null;
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
  callLLMStructured: vi.fn(async (_messages: unknown, _config: unknown, opts: { toolName: string }) =>
    (opts.toolName === "AnswerKey" ? (typeof keyOut === "function" ? keyOut(_messages as Sent) : keyOut) : gradeOut)),
}));

import { tutorEngine, MASTERY_REFUSED, MASTERY_REFUSED_UNCHECKED, type TutorTurnResult } from "./TutorEngine";
import type { ToolUIEvent } from "./toolDispatch";
import { describeToolDone } from "../plain-language";
import { chatTurnMode, chatTurnSkills } from "./chatSkills";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, ModelTier, Subtopic, Syllabus } from "../../types";

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

const markCall = (status: "mastered" | "practiced", subtopic = "Equal Groups"): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name: "progress.mark_mastered", args: { subtopic_id: subtopic, status } },
  { type: "done", finishReason: "tool_calls" },
];
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];

// What the course view loaded when it opened (ChatTab passes it as ctx.syllabus): nothing mastered yet.
const OPENED_WITH: Syllabus = {
  id: "s1", course_id: "c1", level: 1, title: "Level 1", description: "", learning_objectives: [],
  subtopics: SUBTOPICS, assessment_criteria: [], estimated_hours: 1, generated_at: "2026-11-18 10:00:00",
};

// The child tapped "Check if I've got this", the tutor asked in text, and the child typed the answer. The
// chip's mode was used up by the first send, so the answer turn runs in the mode ChatTab derives
// (chatTurnMode with no chip picked), the same call ChatTab makes.
const CHECK_ANSWER = [
  { role: "user", content: "Check if I've got this." },
  { role: "assistant", content: "How many legs do 3 stools with 4 legs each have?" },
  { role: "user", content: "12, because 3 groups of 4 is 12." },
];

async function assessTurn(syllabus: Syllabus | null = null, conversation = CHECK_ANSWER, modelTier: ModelTier = "tiny"): Promise<TutorTurnResult> {
  const { activeSkill, domainSkill } = chatTurnSkills(chatTurnMode(null, conversation), "Multiplication", modelTier, true);
  return tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, ...conversation],
      config: CONFIG, retrieval: "off", onText: () => {}, onToolEvent: (ev) => events.push(ev),
    },
    {
      courseId: "c1", level: 1, syllabus, modelTier, contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async (tool) => { confirms.push(tool); return true; },
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
  events.length = 0;
  confirms.length = 0;
  script = [];
  keyOut = KEY_12;
  gradeOut = null;
  await openDb();
  seedCourse();
});

describe("the typed answer to a mastery check's question", () => {
  it("runs in assess, so the mark is offered and saved", async () => {
    expect(chatTurnMode(null, CHECK_ANSWER)).toBe("assess");
    script = [markCall("mastered"), reply("You've got it!")];
    const result = await assessTurn();
    expect(result.toolCalls).toEqual([{ name: "progress.mark_mastered", args: { subtopic_id: "Equal Groups", status: "mastered" }, ok: true }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
  });

});

// #229: on a check's answer turn a "mastered" mark needs the answer check's correct verdict. The check
// gives none when the tutor's message asks nothing with one right answer (the key comes back empty), or
// does not run when the child's message asks what a word means; a small model could then mark a skill
// learned on a turn nothing checked.
describe("a \"mastered\" mark on a check's answer turn", () => {
  const mark = (status: "mastered" | "practiced") => ({ name: "progress.mark_mastered", args: { subtopic_id: "Equal Groups", status } });

  it("with no verdict (the tutor's message asked nothing with one right answer) is refused; nothing is saved and the model is told", async () => {
    // An empty answer is how the key call says "none" (answerKey), so checkAnswer gives no verdict.
    keyOut = { question: "", working: "", answer: "" };
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn();
    expect(result.answerCheck).toBeNull();
    expect(result.toolCalls).toEqual([{ ...mark("mastered"), ok: false }]);
    expect(toolResultSeen()).toBe(`ERROR: ${MASTERY_REFUSED_UNCHECKED}`);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("with no verdict because the child asked what a word means is refused", async () => {
    const meaning = [...CHECK_ANSWER.slice(0, 2), { role: "user", content: "12. Meaning of groups?" }];
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn(null, meaning);
    expect(result.answerCheck).toBeNull();
    expect(result.toolCalls).toEqual([{ ...mark("mastered"), ok: false }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("with no verdict, a \"practiced\" mark still saves, as on a wrong answer", async () => {
    keyOut = { question: "", working: "", answer: "" }; // the key call's "none", as above
    script = [markCall("practiced"), reply("Saved.")];
    const result = await assessTurn();
    expect(result.toolCalls).toEqual([{ ...mark("practiced"), ok: true }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false, practiced: true });
  });

  it("with a correct verdict is saved", async () => {
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn();
    expect(result.answerCheck).toMatchObject({ key: "12", verdict: "correct" });
    expect(result.toolCalls).toEqual([{ ...mark("mastered"), ok: true }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
  });

  it("with a wrong verdict is refused as before", async () => {
    gradeOut = { student_answer: "11", verdict: "incorrect" };
    const wrong = [...CHECK_ANSWER.slice(0, 2), { role: "user", content: "11" }];
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn(null, wrong);
    expect(result.answerCheck).toMatchObject({ key: "12", verdict: "incorrect" });
    expect(result.toolCalls).toEqual([{ ...mark("mastered"), ok: false }]);
    expect(toolResultSeen()).toBe(`ERROR: ${MASTERY_REFUSED}`);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });
});

// A typed "quiz me" with no chip runs in the default mode, as on master: assess drops the domain skill's
// drawing tools, and assess.md ends the check when every subtopic is mastered, so in assess the quiz
// lost its pictures and, on a mastered course, never came.
describe("a typed request for a quiz, with no chip tapped", () => {
  const QUIZ_ME = [{ role: "user", content: "quiz me on fractions" }];
  const drawCall: TurnEvent[] = [
    { type: "tool_call", id: "call_0", name: "math.render", args: { latex: "\\frac{1}{2} \\text{ of } 8 = ?" } },
    { type: "done", finishReason: "tool_calls" },
  ];

  it("runs in the default mode, which keeps the drawing tools", async () => {
    expect(chatTurnMode(null, QUIZ_ME)).toBe("explain");
    script = [drawCall, reply("What is half of 8?")];
    const result = await assessTurn(null, QUIZ_ME);
    expect(result.toolCalls[0]).toMatchObject({ name: "math.render", ok: true });
  });

  it("its answers run in the default mode too, which offers no mark", async () => {
    const answered = [...QUIZ_ME, ...CHECK_ANSWER.slice(1)];
    expect(chatTurnMode(null, answered)).toBe("explain");
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn(null, answered);
    expect(result.toolCalls[0]).toMatchObject({ name: "progress.mark_mastered", ok: false });
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("an answer to the quiz chip's question still runs in the default mode, which offers no mark", async () => {
    const quiz = [{ role: "user", content: "Quiz me on this." }, ...CHECK_ANSWER.slice(1)];
    expect(chatTurnMode(null, quiz)).toBe("explain");
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn(null, quiz);
    expect(result.toolCalls[0]).toMatchObject({ name: "progress.mark_mastered", ok: false });
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });
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

  it("the chip under the reply says what was saved, practiced or learned (ChatTab ToolChip)", async () => {
    script = [markCall("practiced"), reply("Saved."), markCall("mastered", "Sharing Fairly"), reply("Saved.")];
    await assessTurn();
    await assessTurn();
    const chips = events.filter((e) => e.kind === "result").map((e) => e.kind === "result" ? describeToolDone(e.name, e.value) : "");
    expect(chips).toEqual(["Marked “Equal Groups” as practiced", "Marked “Sharing Fairly” as learned"]);
  });

  it("still reports the saved mark when the progress refresh after it fails", async () => {
    sqlite.exec("DROP TABLE tutor_instructions"); // saveTutorInstruction now throws
    script = [markCall("mastered"), reply("Saved.")];
    const result = await assessTurn();
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
    expect(result.toolCalls[0].ok).toBe(true);
    expect(toolResultSeen()).not.toMatch(/^ERROR/);
  });

  it("a second mark in the same visit keeps the first, though the view's syllabus predates both", async () => {
    script = [markCall("mastered"), reply("Saved."), markCall("mastered", "Sharing Fairly"), reply("Saved.")];
    await assessTurn(OPENED_WITH);
    await assessTurn(OPENED_WITH);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", true]]);
  });

  it("a mark keeps a quiz's mastery saved after the view opened", async () => {
    const quizzed = SUBTOPICS.map((s) => (s.id === "1.2" ? { ...s, mastered: true, practiced: true } : s));
    sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'").run(JSON.stringify(quizzed));
    script = [markCall("practiced"), reply("Saved.")];
    await assessTurn(OPENED_WITH);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered, s.practiced])).toEqual([["1.1", false, true], ["1.2", true, true]]);
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

// TerraTutor live tests 2026-11-19 parts 7 and 8, 2026-11-20 part 9: gemma4:e2b, the default model below
// 16 GB, never called progress.mark_mastered after a check answer graded correct (4 of 4 turns in part 9), so
// a check never moved mastery. Code now makes the mark the model's call would, under the same gate, through
// the same tool: the "Is that okay?" card, the chip, the saved mark and its subtopic_events row (ported from
// TerraTutor #266).
describe("the mark code makes after a correct check answer", () => {
  const Q = "How many legs do 3 stools with 4 legs each have?";
  const PICKED = `Which one should we check first?\n\n*You picked: Equal Groups*\n\n${Q}`;
  const picked = (answer: string, hint?: string) => [
    { role: "user", content: "Check if I've got this." },
    { role: "assistant", content: PICKED },
    ...(hint ? [{ role: "user", content: "Give me a hint." }, { role: "assistant", content: hint }] : []),
    { role: "user", content: answer },
  ];
  const appMark = { name: "progress.mark_mastered", args: { subtopic_id: "1.1", status: "mastered" }, ok: true, byApp: true };
  const modelMark = { name: "progress.mark_mastered", args: { subtopic_id: "Equal Groups", status: "mastered" } };
  const recordEvents = () => sqlite.prepare("SELECT subtopic_id, event, source FROM subtopic_events WHERE course_id = 'c1' ORDER BY id").all();
  const chips = () => events.filter((e) => e.kind === "result").map((e) => (e.kind === "result" ? describeToolDone(e.name, e.value) : ""));
  // A turn in assess mode, as an eval runner sends it (or ChatTab after the assess chip), with the learner's
  // answer on the "Is that okay?" card and their picks on question cards, in order.
  const assessRun = async (conversation: Sent, syllabus: Syllabus, yes = true, picks: string[] = []) => {
    const { activeSkill, domainSkill } = chatTurnSkills("assess", "Multiplication", "tiny", true);
    return tutorEngine.run(
      { messages: [{ role: "system", content: "You are a tutor." }, ...conversation], config: CONFIG, retrieval: "off", onText: () => {}, onToolEvent: (ev) => events.push(ev) },
      {
        courseId: "c1", level: 1, syllabus, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
        abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
        confirmTool: async (tool) => { confirms.push(tool); return yes; },
        askUser: async () => picks.shift() ?? "",
      },
    );
  };
  const askCall = (question: string, labels: string[]): TurnEvent[] => [
    { type: "tool_call", id: "call_0", name: "ask_user.question", args: { question, choices: labels.map((l) => ({ label: l, value: l })) } },
    { type: "done", finishReason: "tool_calls" },
  ];
  // The key call on a card that asks nothing with one right answer ("Which one next?") finds no key.
  const NO_KEY: Key = { question: "", working: "", answer: "" };
  const keyed = (byQuestion: Record<string, Key>) => (sentToKey: Sent) =>
    Object.entries(byQuestion).find(([q]) => sentToKey.some((m) => m.content.includes(q)))?.[1] ?? KEY_12;

  it("marks the picked subtopic when the model makes no tool call", async () => {
    script = [reply("Yes, 3 groups of 4 is 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12, because 3 groups of 4 is 12."));
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([appMark]);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", false]]);
    // Shown as the model's mark is: the card asks first, the chip says it, subtopic_events keeps the tutor's mark.
    expect(confirms).toEqual(["progress.mark_mastered"]);
    expect(chips()).toEqual(["Marked “Equal Groups” as learned"]);
    expect(recordEvents()).toEqual([{ subtopic_id: "1.1", event: "practiced", source: "tutor" }, { subtopic_id: "1.1", event: "mastered", source: "tutor" }]);
    expect(progressContext()).toContain("Mastered subtopics: Equal Groups");
    // It comes under the reply, which was not told of it and claims nothing.
    expect(result.text).toBe("Yes, 3 groups of 4 is 12.");
  });

  // Only where the model's own call is unreliable (e2b: TerraTutor B9 0/20, live part 9 4/4; e4b is "small" by
  // tier, unmeasured). A "medium" or "large" model keeps its own judgement: assess.md asks for about 90%
  // (ported from TerraTutor #267).
  it.each([["tiny", true], ["small", true], ["medium", false], ["large", false]] as const)(
    "on a %s chat model, marks: %s", async (tier, marks) => {
      script = [reply("Yes, 3 groups of 4 is 12.")];
      const result = await assessTurn(OPENED_WITH, picked("12, because 3 groups of 4 is 12."), tier);
      expect(result.answerCheck).toMatchObject({ verdict: "correct" });
      expect(result.toolCalls).toEqual(marks ? [appMark] : []);
      expect(confirms).toEqual(marks ? ["progress.mark_mastered"] : []);
      expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: marks });
    },
  );

  it("on a medium chat model, still saves the model's own mark", async () => {
    script = [markCall("mastered"), reply("Yes, 3 groups of 4 is 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12, because 3 groups of 4 is 12."), "medium");
    expect(result.toolCalls).toEqual([{ ...modelMark, ok: true }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
  });

  it("makes no second mark when the model marked it already", async () => {
    script = [markCall("mastered"), reply("Yes, 3 groups of 4 is 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12, because 3 groups of 4 is 12."));
    expect(result.toolCalls).toEqual([{ ...modelMark, ok: true }]);
    expect(confirms).toEqual(["progress.mark_mastered"]);
    expect(recordEvents()).toHaveLength(2);
  });

  it("asks nothing again after the learner said no to the model's mark", async () => {
    script = [markCall("mastered"), reply("Okay.")];
    const result = await assessRun(picked("12"), OPENED_WITH, false);
    expect(result.toolCalls).toEqual([{ ...modelMark, ok: false }]);
    expect(confirms).toEqual(["progress.mark_mastered"]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it.each([
    ["partly right", { student_answer: "3 groups of 4", verdict: "partly" }, "3 groups of 4", "partly"],
    ["unsure (the grading call failed)", null, "a dozen legs I think", "unsure"],
    ["wrong", { student_answer: "11", verdict: "incorrect" }, "11", "incorrect"],
  ])("makes none for an answer that is %s", async (_, grade, answer, verdict) => {
    gradeOut = grade;
    script = [reply("Let's look at it again.")];
    const result = await assessTurn(OPENED_WITH, picked(answer));
    expect(result.answerCheck?.verdict).toBe(verdict);
    expect(result.toolCalls).toEqual([]);
    expect(confirms).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("makes none for a right answer to a hint's own question", async () => {
    keyOut = (sentToKey) => (sentToKey.some((m) => m.content.includes("Count by 4s"))
      ? { question: "What is 4 + 4?", working: "4 + 4 = 8", answer: "8" } : KEY_12);
    script = [reply("Yes, 4 + 4 is 8.")];
    const result = await assessTurn(OPENED_WITH, picked("8", "Count by 4s. What is 4 + 4?"));
    expect(result.answerCheck).toMatchObject({ verdict: "correct", on: "hint" });
    expect(result.toolCalls).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("makes none when two subtopics are not mastered and none was picked: code does not guess", async () => {
    script = [reply("Yes, 12.")];
    const result = await assessTurn(OPENED_WITH);
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
  });

  it("marks the level's one subtopic not mastered when no picker was shown", async () => {
    const oneLeft = { ...OPENED_WITH, subtopics: SUBTOPICS.map((s) => (s.id === "1.2" ? { ...s, mastered: true, practiced: true } : s)) };
    sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'").run(JSON.stringify(oneLeft.subtopics));
    script = [reply("Yes, 12.")];
    const result = await assessTurn(oneLeft);
    expect(result.toolCalls).toEqual([appMark]);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", true]]);
  });

  it("makes none for a subtopic already mastered, read from the saved syllabus, not the course view's snapshot", async () => {
    // Saved as mastered since the course view opened: its snapshot (ctx.syllabus) still says not mastered.
    const saved = SUBTOPICS.map((s) => (s.id === "1.1" ? { ...s, mastered: true, practiced: true } : s));
    sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'").run(JSON.stringify(saved));
    script = [reply("Yes, 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12"));
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
    expect(confirms).toEqual([]);
    expect(chips()).toEqual([]);
  });

  // TerraTutor #266's review: the pick on the model's "which one next?" card after a right answer won over the
  // skill the question was on, and marked "Sharing Fairly", on which nothing had been asked.
  it("marks the skill the answer was on, not one picked on a card after it", async () => {
    keyOut = keyed({ "check next": NO_KEY });
    script = [askCall("Which one should we check next?", ["Sharing Fairly", "Equal Groups"]), reply("Okay, Sharing Fairly next.")];
    const result = await assessRun(picked("12"), OPENED_WITH, true, ["Sharing Fairly"]);
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.text).toContain("*You picked: Sharing Fairly*");
    expect(result.toolCalls.slice(-1)).toEqual([appMark]);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", false]]);
    expect(chips().slice(-1)).toEqual(["Marked “Equal Groups” as learned"]);
  });

  it("marks the skill the typed answer was on when a card after it has skill titles as its choices", async () => {
    keyOut = keyed({ "splitting 12 cookies": { question: "Which skill is splitting 12 cookies among 3?", working: "", answer: "Sharing Fairly" } });
    script = [askCall("Which skill is splitting 12 cookies among 3?", ["Sharing Fairly", "Equal Groups"]), reply("Yes, that is sharing.")];
    const result = await assessRun(picked("12"), OPENED_WITH, true, ["Sharing Fairly"]);
    expect(result.cardChecks).toMatchObject([{ verdict: "correct" }]);
    expect(result.toolCalls.slice(-1)).toEqual([appMark]);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", false]]);
  });

  it("on the turn that opens the check, marks the skill picked before the card answered right, not one picked after", async () => {
    keyOut = keyed({ "check next": NO_KEY });
    script = [
      askCall(Q, ["10", "12"]),
      askCall("Which one should we check next?", ["Sharing Fairly", "Equal Groups"]),
      reply("Okay, Sharing Fairly next."),
    ];
    // The app's topic picker first (two not mastered), then the model's question card, then its "next" card.
    const result = await assessRun([{ role: "user", content: "Check if I've got this." }], OPENED_WITH, true, ["Equal Groups", "12", "Sharing Fairly"]);
    expect(result.answerCheck).toBeNull();
    expect(result.cardChecks).toMatchObject([{ verdict: "correct" }]);
    expect(result.toolCalls.slice(-1)).toEqual([appMark]);
    expect(subtopicsInDb().map((s) => [s.id, s.mastered])).toEqual([["1.1", true], ["1.2", false]]);
  });

  // The session's rule: a hint answer never awards mastery, also when the hint's key is the check's.
  it("makes none for a right answer given right after a hint, even one whose key is the check's", async () => {
    script = [reply("Yes, 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12", "Count by 4s: 4, 8, what comes next?"));
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.answerCheck?.on).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  // Review of the port: only a learner message with the word "hint" counted as a hint, so a help request or a
  // wrong answer, then the tutor's easier question answered right, was graded on that question and marked.
  // Code marks only on the learner's first message since the check opened.
  it.each([
    "I'm stuck. Can you help me?", "I don't get it", "help", "Give me a clue please", "I don't know", "10",
  ])("makes none for a right answer to an easier question asked after %j", async (first) => {
    keyOut = keyed({ "4 + 4 + 4": { question: "What is 4 + 4 + 4?", working: "4 + 4 + 4 = 12", answer: "12" } });
    script = [reply("Yes, 4 + 4 + 4 is 12.")];
    const result = await assessTurn(OPENED_WITH, [
      { role: "user", content: "Check if I've got this." },
      { role: "assistant", content: PICKED },
      { role: "user", content: first },
      { role: "assistant", content: "Let's make it smaller. What is 4 + 4 + 4?" },
      { role: "user", content: "12" },
    ]);
    expect(result.answerCheck).toMatchObject({ question: "What is 4 + 4 + 4?", verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
    expect(confirms).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("makes none for a right pick on a card that answered a hint request", async () => {
    keyOut = keyed({ "4 + 4 + 4": { question: "What is 4 + 4 + 4?", working: "", answer: "12" } });
    script = [askCall("What is 4 + 4 + 4?", ["8", "12"]), reply("Yes, 12.")];
    const result = await assessRun([...picked("Give me a hint.")], OPENED_WITH, true, ["12"]);
    expect(result.cardChecks).toMatchObject([{ verdict: "correct" }]);
    expect(result.toolCalls.map((c) => c.name)).toEqual(["ask_user.question"]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("still marks when the model's own mark failed on a wrong id", async () => {
    script = [markCall("mastered", "Nonsense Topic"), reply("Yes, 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12"));
    expect(result.toolCalls).toEqual([{ ...modelMark, args: { subtopic_id: "Nonsense Topic", status: "mastered" }, ok: false }, appMark]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
  });

  it("makes none when the model marked the skill practiced: its call is the turn's mark", async () => {
    script = [markCall("practiced"), reply("Yes, 12.")];
    const result = await assessTurn(OPENED_WITH, picked("12"));
    expect(result.toolCalls).toEqual([{ ...modelMark, args: { subtopic_id: "Equal Groups", status: "practiced" }, ok: true }]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("makes none once the check has closed", async () => {
    // Four answers used the check up (answerCheck.ts ASSESS_LOOKBACK). The fifth still runs in assess, as an
    // eval runner sends it, and is graded, but no check is open, so code knows no subtopic.
    const closed = [...picked("10")];
    for (const wrong of ["11", "13", "14"]) closed.push({ role: "assistant", content: Q }, { role: "user", content: wrong });
    closed.push({ role: "assistant", content: Q }, { role: "user", content: "12" });
    script = [reply("Yes, 12.")];
    const result = await assessRun(closed, OPENED_WITH);
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });
});
