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

  // TerraTutor #267's review: on the turn that opens the check, "help" typed into the check's question card
  // got no check, and the model's easier card after it, picked right, marked (5 of 7 phrasings). Code marks
  // on cards only when the first model card answered is the one checked.
  const HELP_TYPED = ["help", "I don't know", "idk", "Give me a hint", "can you explain?", "I'm stuck", "?"];
  const easierAfter = (first: string) => {
    keyOut = keyed({ "4 + 4 + 4": { question: "What is 4 + 4 + 4?", working: "4 + 4 + 4 = 12", answer: "12" } });
    script = [askCall(Q, ["10", "12"]), askCall("What is 4 + 4 + 4?", ["8", "12"]), reply("Yes, 4 + 4 + 4 is 12.")];
    return [first, "12"];
  };
  it.each(HELP_TYPED)("makes none for a right pick on an easier card after %j typed into the check's card", async (first) => {
    const result = await assessRun([{ role: "user", content: "Check if I've got this." }], OPENED_WITH, true, ["Equal Groups", ...easierAfter(first)]);
    expect(result.cardChecks.slice(-1)[0]).toMatchObject({ question: "What is 4 + 4 + 4?", verdict: "correct" });
    expect(result.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(confirms).toEqual([]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it.each(HELP_TYPED)("makes none on a one-skill level with no picker, after %j typed into the check's card", async (first) => {
    const oneLeft = { ...OPENED_WITH, subtopics: SUBTOPICS.map((s) => (s.id === "1.2" ? { ...s, mastered: true, practiced: true } : s)) };
    sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'").run(JSON.stringify(oneLeft.subtopics));
    const result = await assessRun([{ role: "user", content: "Check if I've got this." }], oneLeft, true, easierAfter(first));
    expect(result.cardChecks.slice(-1)[0]).toMatchObject({ question: "What is 4 + 4 + 4?", verdict: "correct" });
    expect(result.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: false });
  });

  it("still marks on a one-skill level with no picker when the check's card is answered right first", async () => {
    const oneLeft = { ...OPENED_WITH, subtopics: SUBTOPICS.map((s) => (s.id === "1.2" ? { ...s, mastered: true, practiced: true } : s)) };
    sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'").run(JSON.stringify(oneLeft.subtopics));
    script = [askCall(Q, ["10", "12"]), reply("Yes, 12.")];
    const result = await assessRun([{ role: "user", content: "Check if I've got this." }], oneLeft, true, ["12"]);
    expect(result.toolCalls.slice(-1)).toEqual([appMark]);
    expect(subtopicsInDb().find((s) => s.id === "1.1")).toMatchObject({ mastered: true });
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

// TerraTutor live test 2026-11-20 part 13, issue 6 (ported from TerraTutor #278; gemma4:e2b, a Romeo and Juliet course at level 1): the first skill was marked,
// then the model moved the check on in prose and showed no card, and the right answer on the next skill was
// not saved. The texts below are that run's (click16 s6-*.json), the next skill's question excepted: the live
// one ("What do you already know about life during the Elizabethan Era?") was keyed "Student's prior
// knowledge", which is that run's issue 3, not this one.
describe("the next skill in the same check", () => {
  const T = {
    world: sub("1.1", "The Elizabethan World: Context and Setting"),
    words: sub("1.2", "Decoding Archaic Language and Key Vocabulary"),
    people: sub("1.3", "Introducing the Main Characters and Their Initial Roles"),
    plot: sub("1.4", "Mapping the Basic Plot: Beginning, Middle, and End"),
  };
  const ALL = [T.world, T.words, T.people, T.plot];
  // What the course view loaded when the check started: nothing mastered (ChatTab's snapshot is not reloaded).
  const SNAPSHOT: Syllabus = { ...OPENED_WITH, subtopics: ALL };
  const save = (mastered: string[]) => sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'")
    .run(JSON.stringify(ALL.map((s) => (mastered.includes(s.id) ? { ...s, mastered: true, practiced: true } : s))));
  const masteredInDb = () => subtopicsInDb().filter((s) => s.mastered).map((s) => s.id);
  const chips = () => events.filter((e) => e.kind === "result").map((e) => (e.kind === "result" ? describeToolDone(e.name, e.value) : ""));
  const FIRST_Q = "Can you tell me what you think the initial conflict in the play is, based on the families mentioned?";
  const FOLLOW_Q = "How do you think Romeo and Juliet's relationship starts? Are they friendly, or is there something else happening between them when they first meet?";
  const NEXT_Q = "Who was the queen of England when Shakespeare wrote Romeo and Juliet?";
  const PROSE_Q = "What do you already know about life during the Elizabethan Era?";
  const NEXT_ANSWER = "Queen Elizabeth I ruled England, and people watched plays at the Globe Theatre.";
  const PLOT_Q = "What happens to Romeo and Juliet at the end of the play?";
  // The check up to the learner's request for another skill: picker, first skill (marked), the follow-up.
  const UP_TO_NEXT: Sent = [
    { role: "user", content: "Check if I've got this." },
    { role: "assistant", content: `Which one should we check first?\n\n*You picked: ${T.people.title}*\n\nThat is the right place to start. We have the young lovers, Romeo and Juliet, and the families they come from: the Capulets and the Montagues. ${FIRST_Q}` },
    { role: "user", content: "The Capulets and the Montagues are two families who hate each other, a long feud." },
    { role: "assistant", content: `That is exactly right. The core conflict at the very beginning of the play is the long-standing feud between the Capulets and the Montagues. ${FOLLOW_Q}` },
    { role: "user", content: "They fall in love at first sight at a party. I think I know this topic now, can we check another one?" },
  ];
  const pickedNext = (title: string, question = NEXT_Q) =>
    `Which one should we check next?\n\n*You picked: ${title}*\n\nYou are correct. Romeo and Juliet fall in love at first sight at a party. Now let's look at the world of the play. ${question}`;
  const keys: Record<string, Key> = {
    [FIRST_Q]: { question: FIRST_Q, working: "", answer: "The feud between the Capulets and the Montagues" },
    [FOLLOW_Q]: { question: FOLLOW_Q, working: "", answer: "They fall in love at first sight" },
    [NEXT_Q]: { question: NEXT_Q, working: "", answer: "Queen Elizabeth I" },
    "Which act": { question: "Which act does the balcony scene happen in?", working: "", answer: "Act 2" },
    [PLOT_Q]: { question: PLOT_Q, working: "", answer: "Romeo and Juliet both die" },
  };
  // The key call is sent the tutor's message the answer is to: the question latest in it wins.
  const keyFor = (sentToKey: Sent) => {
    const text = sentToKey.map((m) => m.content).join("\n");
    return Object.entries(keys).map(([q, k]) => [text.lastIndexOf(q), k] as const).sort((a, b) => b[0] - a[0]).find(([at]) => at >= 0)?.[1] ?? KEY_12;
  };
  const appMarkOf = (id: string) => ({ name: "progress.mark_mastered", args: { subtopic_id: id, status: "mastered" }, ok: true, byApp: true });
  const cardsShown: string[] = [];
  const run = (conversation: Sent, picks: string[] = [], modelTier: ModelTier = "tiny", canAsk = true) => {
    const { activeSkill, domainSkill } = chatTurnSkills("assess", "Romeo and Juliet", modelTier, true);
    return tutorEngine.run(
      { messages: [{ role: "system", content: "You are a tutor." }, ...conversation], config: CONFIG, retrieval: "off", onText: () => {}, onToolEvent: (ev) => events.push(ev) },
      {
        courseId: "c1", level: 1, syllabus: SNAPSHOT, modelTier, contextTokens: 8192, permissionMode: "default", config: CONFIG,
        abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
        confirmTool: async (tool) => { confirms.push(tool); return true; },
        ...(canAsk ? { askUser: async (question: string) => { cardsShown.push(question); return picks.shift() ?? ""; } } : {}),
      },
    );
  };
  beforeEach(() => {
    cardsShown.length = 0;
    keyOut = keyFor;
    gradeOut = { student_answer: "", verdict: "correct" };
    save([T.people.id]);
  });

  it("after the first skill is marked, the app asks which one is next and the model's question follows the pick", async () => {
    script = [reply(`You are correct. Now let's look at the world of the play. ${NEXT_Q}`)];
    const result = await run(UP_TO_NEXT, [T.world.title]);
    expect(cardsShown).toEqual(["Which one should we check next?"]);
    // The choices are the subtopics still not mastered in the saved syllabus, not the course view's snapshot.
    const card = result.toolCalls.find((c) => c.name === "ask_user.question");
    expect(card).toMatchObject({ byApp: true, ok: true, args: { question: "Which one should we check next?", choices: [T.world, T.words, T.plot].map((s) => ({ label: s.title, value: s.title })) } });
    expect(result.text).toContain(`*You picked: ${T.world.title}*`);
    // The follow-up on the skill already mastered is graded, and marks nothing.
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls.map((c) => c.name)).toEqual(["ask_user.question"]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  it("marks the next skill on a first-try right answer to its question, through the same card and chip", async () => {
    script = [reply("Yes, Queen Elizabeth I.")];
    const result = await run([...UP_TO_NEXT, { role: "assistant", content: pickedNext(T.world.title) }, { role: "user", content: NEXT_ANSWER }]);
    expect(result.answerCheck).toMatchObject({ question: NEXT_Q, verdict: "correct" });
    expect(result.toolCalls).toEqual([appMarkOf(T.world.id)]);
    expect(confirms).toEqual(["progress.mark_mastered"]);
    expect(chips()).toEqual([`Marked “${T.world.title}” as learned`]);
    expect(masteredInDb()).toEqual([T.world.id, T.people.id]);
    // The skill just picked is not mastered, so no "which next?" card on this turn.
    expect(cardsShown).toEqual([]);
  });

  it("marks it the same way when the claim filter put a verdict line in front of the card", async () => {
    script = [reply("Yes, Queen Elizabeth I.")];
    const result = await run([...UP_TO_NEXT, { role: "assistant", content: `That's right.

${pickedNext(T.world.title)}` }, { role: "user", content: NEXT_ANSWER }]);
    expect(result.toolCalls).toEqual([appMarkOf(T.world.id)]);
    expect(masteredInDb()).toEqual([T.world.id, T.people.id]);
  });

  // Review 2026-11-20, P6/P10: code cannot tell from the saved text whether the turn the model showed its own
  // card on was helped (a hint, a wrong try), so only a pick on the app's own card counts.
  it("makes none for a skill picked on the model's own card, or on a card after the app's", async () => {
    script = [reply("Yes, Queen Elizabeth I."), reply("Yes, Queen Elizabeth I.")];
    const own = pickedNext(T.world.title).replace("Which one should we check next?", "Great! Which topic do you want to try now?");
    const ownRun = await run([...UP_TO_NEXT, { role: "assistant", content: own }, { role: "user", content: NEXT_ANSWER }]);
    expect(ownRun.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    const after = pickedNext(T.words.title).replace(NEXT_Q, `Which part should we start with?

*You picked: ${T.world.title}*

${NEXT_Q}`);
    const afterRun = await run([...UP_TO_NEXT, { role: "assistant", content: after }, { role: "user", content: NEXT_ANSWER }]);
    expect(afterRun.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(confirms).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  // Review 2026-11-20, P2/P3/P4/P9: the learner's message on the turn the card would show was a hint or help
  // request, a wrong answer or "I don't know". The tutor's turn before it is the live run's (s6-next), asking
  // the next skill's question in prose. The card stays away, so the answer after the hint or after the answer
  // was given away is no first try and marks nothing, through both turns as ChatTab sends them.
  const PROSE_NEXT = `You are correct. Romeo and Juliet fall in love at first sight at a party. That shows you have a good grasp of their initial connection. Now, let's move on to the next area we need to check for this level. We still need to solidify our understanding of ${T.world.title}. This means learning a little bit about what life was like in the 16th century, which helps us understand why Shakespeare wrote the play the way he did. ${NEXT_Q}`;
  it.each([
    ["a hint request", "Give me a hint.", null, `Think about whose name the era carries. ${NEXT_Q}`],
    ["a wrong answer, then the answer given", "King Henry", { student_answer: "King Henry", verdict: "incorrect" }, `Not quite: it was Queen Elizabeth I. ${NEXT_Q}`],
    ["a help request", "can you explain it?", null, `The era is named after the queen who ruled then. ${NEXT_Q}`],
    ["\"I don't know\"", "I don't know", null, `That's okay. The era is named after the queen who ruled then. ${NEXT_Q}`],
  ])("shows no next card after %s, and the answer after it marks nothing", async (_, said, grade, tutorAfter) => {
    if (grade) gradeOut = grade;
    script = [reply(tutorAfter)];
    const before: Sent = [...UP_TO_NEXT, { role: "assistant", content: PROSE_NEXT }, { role: "user", content: said }];
    const pickTurn = await run(before, [T.world.title]);
    expect(cardsShown).toEqual([]);
    expect(pickTurn.toolCalls.map((c) => c.name)).toEqual([]);
    gradeOut = { student_answer: "", verdict: "correct" };
    script = [reply("Yes, Queen Elizabeth I.")];
    const answerTurn = await run([...before, { role: "assistant", content: pickTurn.text }, { role: "user", content: NEXT_ANSWER }], [], "tiny", false);
    expect(answerTurn.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(confirms).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  // Review 2026-11-20, P12: a question or a flashcard request right after the mark gets its answer, not the card.
  it.each([
    ["a meaning question", "what does archaic mean?"],
    ["a flashcard request", "Make me a flashcard about archaic words."],
  ])("shows no next card for %s right after the mark", async (_, said) => {
    script = [reply("Archaic means old and no longer in everyday use."), reply("Archaic means old and no longer in everyday use.")];
    const result = await run([...UP_TO_NEXT.slice(0, -1), { role: "user", content: said }], [T.world.title]);
    expect(cardsShown).toEqual([]);
    expect(result.toolCalls.map((c) => c.name)).not.toContain("ask_user.question");
  });

  // The live run's own path: the model named the next skill in prose and showed no card.
  it("makes none for a right answer on a skill the model only named in prose", async () => {
    script = [reply("Those are very important parts of the historical backdrop.")];
    const result = await run([
      ...UP_TO_NEXT,
      { role: "assistant", content: `You are correct. Now, let's move on to the next area we need to check for this level. We still need to solidify our understanding of ${T.world.title}. ${PROSE_Q}` },
      { role: "user", content: NEXT_ANSWER },
    ], [], "tiny", false);
    expect(result.toolCalls).toEqual([]);
    expect(confirms).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  it.each([
    ["a wrong answer", { student_answer: "", verdict: "incorrect" }],
    ["a partly right answer", { student_answer: "", verdict: "partly" }],
  ])("makes none for %s on the next skill", async (_, grade) => {
    gradeOut = grade;
    script = [reply("Not quite.")];
    const result = await run([...UP_TO_NEXT, { role: "assistant", content: pickedNext(T.world.title) }, { role: "user", content: "King Henry" }]);
    expect(result.toolCalls).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  it("makes none for a right answer after a hint on the next skill's question", async () => {
    script = [reply("Yes, Queen Elizabeth I.")];
    const result = await run([
      ...UP_TO_NEXT,
      { role: "assistant", content: pickedNext(T.world.title) },
      { role: "user", content: "Give me a hint." },
      { role: "assistant", content: `Think about whose name the era carries. ${NEXT_Q}` },
      { role: "user", content: NEXT_ANSWER },
    ]);
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  // Review of this port, nit 2: a right answer to a hint's own question re-asks the old question after the
  // reply ("Now back to the question:"). The card there would let the next right answer, to that old
  // question, mark the skill picked on it.
  it("shows no next card after a right answer to the hint's own question, once the first skill is marked", async () => {
    const HINT_Q = "Where do Romeo and Juliet first meet?";
    keyOut = (sentToKey: Sent) => (sentToKey.map((m) => m.content).join("\n").includes(HINT_Q) ? { question: HINT_Q, working: "", answer: "At a party" } : keyFor(sentToKey));
    // Not the check's answer to the grader; code's match puts it on the hint's question.
    gradeOut = { student_answer: "At a party", verdict: "incorrect" };
    script = [reply("Yes, at a party.")];
    const result = await run([
      ...UP_TO_NEXT.slice(0, -1),
      { role: "user", content: "Give me a hint." },
      { role: "assistant", content: `Think about the big feast at the Capulets' house. ${HINT_Q}` },
      { role: "user", content: "At a party" },
    ], [T.world.title]);
    expect(result.answerCheck).toMatchObject({ question: HINT_Q, verdict: "correct", on: "hint", checkQuestion: FOLLOW_Q });
    expect(result.text.startsWith("Yes, at a party.\n\nNow back to the question:\n\n")).toBe(true);
    expect(result.text.endsWith(FOLLOW_Q)).toBe(true);
    expect(cardsShown).toEqual([]);
    expect(result.toolCalls.map((c) => c.name)).toEqual([]);
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  it("makes none for a skill already tried in this check, picked again", async () => {
    save([]);
    script = [reply("Yes, Queen Elizabeth I.")];
    const result = await run([
      { role: "user", content: "Check if I've got this." },
      { role: "assistant", content: `Which one should we check first?\n\n*You picked: ${T.world.title}*\n\n${NEXT_Q}` },
      { role: "user", content: "King Henry" },
      { role: "assistant", content: pickedNext(T.world.title) },
      { role: "user", content: NEXT_ANSWER },
    ]);
    expect(result.answerCheck).toMatchObject({ verdict: "correct" });
    expect(result.toolCalls).toEqual([]);
    expect(masteredInDb()).toEqual([]);
  });

  it("makes none when the learner typed into the next card instead of picking, or a card was answered after the pick", async () => {
    script = [reply("Yes, Queen Elizabeth I."), reply("Yes, Act 2.")];
    const typed = pickedNext(T.world.title).replace(`*You picked: ${T.world.title}*`, "*You answered: the queen one*");
    const typedRun = await run([...UP_TO_NEXT, { role: "assistant", content: typed }, { role: "user", content: NEXT_ANSWER }]);
    expect(typedRun.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    const cardAfter = `${pickedNext(T.world.title)}\n\n*You picked: Act 1*\n\nNot quite. Which act does the balcony scene happen in?`;
    const cardRun = await run([...UP_TO_NEXT, { role: "assistant", content: cardAfter }, { role: "user", content: "Act 2" }]);
    expect(cardRun.answerCheck).toMatchObject({ verdict: "correct" });
    expect(cardRun.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(masteredInDb()).toEqual([T.people.id]);
  });

  // A third skill, after two picks: words typed into the card are no pick, even when they are a skill's title.
  it("makes none when the words typed into the next card are a skill's title", async () => {
    save([T.world.id, T.people.id]);
    script = [reply("Yes, they both die.")];
    const typed = `Yes, Queen Elizabeth I.

Which one should we check next?

*You answered: ${T.plot.title}*

${PLOT_Q}`;
    const result = await run([...UP_TO_NEXT, { role: "assistant", content: pickedNext(T.world.title) }, { role: "user", content: NEXT_ANSWER }, { role: "assistant", content: typed }, { role: "user", content: "They both die." }]);
    expect(result.answerCheck).toMatchObject({ question: PLOT_Q, verdict: "correct" });
    expect(result.toolCalls.map((c) => c.name)).not.toContain("progress.mark_mastered");
    expect(masteredInDb()).toEqual([T.world.id, T.people.id]);
  });

  it("shows the next card once: not again after the learner typed into it", async () => {
    script = [reply("Okay, let's keep going.")];
    const typed = `Which one should we check next?\n\n*You answered: not sure*\n\nThat is okay. ${FOLLOW_Q}`;
    const result = await run([...UP_TO_NEXT, { role: "assistant", content: typed }, { role: "user", content: "They are enemies at first" }]);
    expect(cardsShown).toEqual([]);
    expect(result.toolCalls.map((c) => c.name)).not.toContain("ask_user.question");
  });

  it.each([
    ["a medium chat model", "medium" as ModelTier, () => {}],
    ["one subtopic left", "tiny" as ModelTier, () => save([T.people.id, T.words.id, T.plot.id])],
    ["the first skill not mastered (the learner said no to the mark)", "tiny" as ModelTier, () => save([])],
  ])("shows no next card with %s", async (_, tier, setUp) => {
    setUp();
    script = [reply("You are correct.")];
    const result = await run(UP_TO_NEXT, [T.world.title], tier);
    expect(cardsShown).toEqual([]);
    expect(result.toolCalls.map((c) => c.name)).not.toContain("ask_user.question");
  });

  it("shows no next card when the check would close before the answer to it", async () => {
    // Two more answers on the first skill: the answer after a pick now would be the check's fifth (ASSESS_LOOKBACK).
    const more = ["They meet at a party.", "They like each other."].flatMap((a) => [{ role: "user", content: a }, { role: "assistant", content: FOLLOW_Q }]);
    const long = [...UP_TO_NEXT.slice(0, -1), ...more, UP_TO_NEXT[UP_TO_NEXT.length - 1]];
    script = [reply("You are correct.")];
    await run(long, [T.world.title]);
    expect(cardsShown).toEqual([]);
  });
});
