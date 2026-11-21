import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import libRs from "../../../src-tauri/src/lib.rs?raw";

// Mastery integrity sweep, ported from TerraTutor #289 (TerraTutor audit 2026-11-21, guardrails 2 and 5: "changes to
// mastery marking need a probe set run before merge"), run on OpenEdu's own kernel, tools and migrations. Every path that can mark a skill in chat, driven end to end through the real kernel
// (tutorEngine.run, the function ChatTab calls), the real ask_user.question and progress.mark_mastered tools,
// progress.ts and db.ts, against an in-memory SQLite built from the real migrations. Only the model is a stand-in.
//
// The cases are a generated matrix (path x prior turn x answer kind x who marks), not hand-picked rows. The expected
// outcome of each comes from the rule in docs/ARCHITECTURE.md, not from what the code does today:
//
//   a mark needs a first-try correct verdict on a question about that exact skill, asked by the tutor, with no
//   help before it (the learner's first message in the check, or the first after the skill was picked; a plain
//   "Yes" to "Does that make sense?" / "Are you ready?" uses no try), in a check still open, on a skill not
//   already mastered, on a turn that was not stopped, and never one the learner said no to on the card.
//
// "Who marks" is the app (appMark: the model makes no call) or the model's own progress.mark_mastered call. Every
// row runs on a "tiny" chat model (gemma4:e2b's tier, the default below 16 GB), where both can mark. A row whose
// outcome differs from the rule is a KNOWN row below (it.fails, so it flags when it starts to pass): a wrong mark
// that would need a phrase rule to fix, or a missed mark the code leaves out on purpose (conservative).
// The table in src/lib/eval/results/2026-11-21-mastery-mark-sweep.md is this file's run (SWEEP_OUT=<path> writes it).

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
  | { type: "done"; finishReason: "stop" | "tool_calls" }
  | { type: "stop" };
type Key = { question: string; working: string; answer: string };
let script: TurnEvent[][] = [];
let keyFor: (sent: Sent) => Key = () => NO_KEY;
let verdict: string | null = "correct";
let stopper: AbortController | null = null;
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* () {
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }] as TurnEvent[]) {
      // The learner pressed Stop while the reply streamed (ChatTab aborts ctx.abort).
      if (ev.type === "stop") { stopper?.abort(); continue; }
      yield ev;
    }
  }),
  callLLMStructured: vi.fn(async (messages: Sent, _config: unknown, opts: { toolName: string }) => {
    if (opts.toolName === "AnswerKey") return keyFor(messages);
    const text = messages.map((m) => m.content).join("\n");
    const answer = /Student's answer: (.*)/.exec(text)?.[1] ?? "";
    if (gradeBy) return { student_answer: answer, verdict: gradeBy(messages) };
    return verdict === null ? null : { student_answer: answer, verdict };
  }),
}));

import { tutorEngine } from "./TutorEngine";
import { chatTurnMode, chatTurnSkills } from "./chatSkills";
import { ASSESS_MESSAGE } from "./suggestions";
import { PICKER_QUESTION, NEXT_PICKER_QUESTION } from "./assessPicker";
import { VERDICT_FALLBACK } from "./replyClaims";
import { nonAnswerReply, hintAnswerBack, type AnswerCheck } from "./answerCheck";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, Subtopic, Syllabus } from "../../types";

registerBuiltinTools();

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}
const MIGRATIONS = [...migrations().values()];

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const sql of MIGRATIONS) sqlite.exec(sql);
}

// ── The course: three skills, two with similar titles ────────────────────────────────────────────

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });
const A = sub("1.1", "Equal Groups");
const B = sub("1.2", "Equal Groups with Arrays");
const C = sub("1.3", "Sharing Fairly");
const ALL = [A, B, C];
// What the course view loaded when it opened (ChatTab passes it as ctx.syllabus): nothing mastered.
const SNAPSHOT: Syllabus = {
  id: "s1", course_id: "c1", level: 1, title: "Level 1", description: "", learning_objectives: [],
  subtopics: ALL, assessment_criteria: [], estimated_hours: 1, generated_at: "2026-11-21 10:00:00",
};
const save = (mastered: string[]) => sqlite.prepare("UPDATE syllabuses SET subtopics = ?1 WHERE id = 's1'")
  .run(JSON.stringify(ALL.map((s) => (mastered.includes(s.id) ? { ...s, mastered: true, practiced: true } : s))));
const masteredInDb = (): string[] => (JSON.parse((sqlite.prepare("SELECT subtopics FROM syllabuses WHERE id = 's1'").all()[0] as { subtopics: string }).subtopics) as Subtopic[])
  .filter((s) => s.mastered).map((s) => s.id);

// Each skill's question, an easier one on the same answer (what a tutor asks after "help"), the key, and the
// answers of each kind. A right answer "by code" matches the key; "by model" is one only the grader can settle.
// `hint` is a hint's own question and `hintKey` its answer (the prior turn "the hint's own question answered").
const Q = {
  [A.id]: { q: "How many legs do 3 stools with 4 legs each have?", easier: "What is 4 + 4 + 4?", key: "12", code: "12", model: "a dozen legs", wrong: "11", partly: "you add the legs up", unsure: "lots maybe", explain: "Equal groups means every group has the same number in it.", hint: "Count by 4s. What is 4 + 4?", hintKey: "8" },
  [B.id]: { q: "An array has 3 rows of 5 dots. How many dots are there?", easier: "What is 5 + 5 + 5?", key: "15", code: "15", model: "the dots in all the rows counted together", wrong: "8", partly: "you count the rows", unsure: "a bunch", explain: "An array puts equal groups in rows.", hint: "Count by 5s. What is 5 + 5?", hintKey: "10" },
  [C.id]: { q: "If 12 cookies are shared fairly by 4 children, how many cookies does each child get?", easier: "What is 12 divided by 4?", key: "3", code: "3", model: "each child gets a third of a dozen", wrong: "4", partly: "you split them up", unsure: "some cookies", explain: "Sharing fairly means everyone gets the same amount.", hint: "If 4 cookies are shared by 2 children, how many does each get?", hintKey: "2" },
};
const NO_KEY: Key = { question: "", working: "", answer: "" };
const HINT_Q = Q[A.id].hint;
// The key call is sent the tutor's message the answer is to: the known question latest in it wins.
const KEYS: Key[] = Object.values(Q).flatMap((s) => [
  { question: s.q, working: "", answer: s.key }, { question: s.easier, working: "", answer: s.key }, { question: s.hint, working: "", answer: s.hintKey },
]);
const keyByQuestion = (sent: Sent): Key => {
  const text = sent.map((m) => m.content).join("\n");
  return KEYS.map((k) => [text.lastIndexOf(k.question), k] as const).sort((a, b) => b[0] - a[0]).find(([at]) => at >= 0)?.[1] ?? NO_KEY;
};

const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];
const markCall = (subtopic: string): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name: "progress.mark_mastered", args: { subtopic_id: subtopic, status: "mastered" } },
  { type: "done", finishReason: "tool_calls" },
];
const askCall = (question: string, labels: string[]): TurnEvent[] => [
  { type: "tool_call", id: "call_c", name: "ask_user.question", args: { question, choices: labels.map((l) => ({ label: l, value: l })) } },
  { type: "done", finishReason: "tool_calls" },
];
const picked = (question: string, label: string) => `${question}\n\n*You picked: ${label}*\n\n`;

// ── The matrix ─────────────────────────────────────────────────────────────────────────────────────

/** How the check got to the skill's question: who named the skill, and where. */
interface Path {
  name: string;
  /** The skill the question is on, as the rule reads it (the question asked is about it, whether or not code can
   *  tell: on "typed into the picker, no pick" it cannot, and code's miss there is a conservative known row). */
  skill: Subtopic;
  mastered: string[];
  /** The messages up to the tutor's first message on the skill, which `first` ends. */
  lead: (first: string) => Sent;
}
const OPEN: Sent = [{ role: "user", content: ASSESS_MESSAGE }];
const FIRST_SKILL_DONE: Sent = [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + Q[A.id].q }, { role: "user", content: Q[A.id].code }];
const PATHS: Path[] = [
  { name: "app picker", skill: A, mastered: [], lead: (f) => [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + f }] },
  { name: "app picker, chip text typed", skill: A, mastered: [], lead: (f) => [{ role: "user", content: "check if i've got this" }, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + f }] },
  { name: "app picker, similar title", skill: B, mastered: [], lead: (f) => [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, B.title) + f }] },
  { name: "app picker, then model card", skill: C, mastered: [], lead: (f) => [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + picked("Which part do you want to start with?", C.title) + f }] },
  { name: "one skill left, no picker", skill: A, mastered: [B.id, C.id], lead: (f) => [...OPEN, { role: "assistant", content: f }] },
  { name: "typed into the picker, no pick", skill: A, mastered: [C.id], lead: (f) => [...OPEN, { role: "assistant", content: `${PICKER_QUESTION}\n\n*You answered: not sure*\n\n${f}` }] },
  { name: "skill already mastered", skill: A, mastered: [A.id], lead: (f) => [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + f }] },
  { name: "app which-next card", skill: C, mastered: [A.id], lead: (f) => [...FIRST_SKILL_DONE, { role: "assistant", content: picked(NEXT_PICKER_QUESTION, C.title) + f }] },
  { name: "app which-next card after verdict line", skill: C, mastered: [A.id], lead: (f) => [...FIRST_SKILL_DONE, { role: "assistant", content: `${VERDICT_FALLBACK.correct}\n\n${picked(NEXT_PICKER_QUESTION, C.title)}${f}` }] },
  { name: "model's own which-next card", skill: C, mastered: [A.id], lead: (f) => [...FIRST_SKILL_DONE, { role: "assistant", content: `Yes, 12 is right. ${picked("Which topic do you want to try now?", C.title)}${f}` }] },
  { name: "next skill named in prose", skill: C, mastered: [A.id], lead: (f) => [...FIRST_SKILL_DONE, { role: "assistant", content: `Yes, 12 is right. Now let's check ${C.title}. ${f}` }] },
  // The first skill done and the other mastered before, so one title is left (TerraTutor's review of this sweep, MUST-FIX 1).
  { name: "last skill left, named in prose", skill: C, mastered: [A.id, B.id], lead: (f) => [...FIRST_SKILL_DONE, { role: "assistant", content: `Yes, 12 is right. Now let's check ${C.title}. ${f}` }] },
];

/** What the learner did between the tutor's first message on the skill and the graded answer. */
interface Prior {
  name: string;
  /** True when this is help, a try or a request to be taught: the rule's "help before it". */
  helped: boolean;
  /** The tutor's first message on the skill, and the messages after it, up to the question the answer is to. */
  build: (s: typeof Q[string]) => { first: string; then: Sent; graded: "q" | "easier" };
}
const PRIORS: Prior[] = [
  { name: "first try", helped: false, build: (s) => ({ first: s.q, then: [], graded: "q" }) },
  { name: "\"Yes\" to \"Does that make sense?\"", helped: false, build: (s) => ({ first: `${s.explain} Does that make sense?`, then: [{ role: "user", content: "Yes" }, { role: "assistant", content: `Great. ${s.q}` }], graded: "q" }) },
  { name: "\"I'm ready!\" to \"Are you ready?\"", helped: false, build: (s) => ({ first: `${s.explain} Are you ready for a question?`, then: [{ role: "user", content: "I'm ready!" }, { role: "assistant", content: `Here it is. ${s.q}` }], graded: "q" }) },
  { name: "\"Yes but explain again\"", helped: true, build: (s) => ({ first: `${s.explain} Does that make sense?`, then: [{ role: "user", content: "Yes but can you explain it again?" }, { role: "assistant", content: `Sure. ${s.explain} ${s.q}` }], graded: "q" }) },
  { name: "hint", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "Give me a hint." }, { role: "assistant", content: `Think about the groups one at a time. ${s.q}` }], graded: "q" }) },
  { name: "help request", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "I'm stuck. Can you help me?" }, { role: "assistant", content: `Let's think about it together. ${s.q}` }], graded: "q" }) },
  { name: "help, then an easier question", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "help" }, { role: "assistant", content: `Let's make it smaller. ${s.easier}` }], graded: "easier" }) },
  { name: "\"I don't know\"", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "I don't know" }, { role: "assistant", content: `That's okay. ${s.q}` }], graded: "q" }) },
  { name: "wrong try", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: s.wrong }, { role: "assistant", content: `Not quite. Try again. ${s.q}` }], graded: "q" }) },
  { name: "meaning question", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "what does each mean?" }, { role: "assistant", content: `"Each" means every one of them. ${s.q}` }], graded: "q" }) },
  { name: "closed check (four answers before)", helped: true, build: (s) => ({ first: s.q, then: ["a", "b", "c", "d"].flatMap((w) => [{ role: "user", content: `${s.wrong}${w}` }, { role: "assistant", content: `Not quite. ${s.q}` }]), graded: "q" }) },
  // The messages the check counts as no try (answerCheck.ts freeInCheck), each with the reply code writes to it.
  { name: "answers nothing, code asks again", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "xyz" }, { role: "assistant", content: nonAnswerReply(s.q, { question: s.q } as AnswerCheck) }], graded: "q" }) },
  { name: "the hint's own question answered", helped: true, build: (s) => ({ first: s.q, then: [{ role: "user", content: "Give me a hint." }, { role: "assistant", content: `Think about it in steps. ${s.hint}` },
    { role: "user", content: s.hintKey }, { role: "assistant", content: `Yes, ${s.hintKey} is right!\n\n${hintAnswerBack(s.q, { on: "hint", checkQuestion: s.q } as AnswerCheck)}` }], graded: "q" }) },
  { name: "five hint requests", helped: true, build: (s) => ({ first: s.q, then: Array.from({ length: 5 }, (_, i) => [{ role: "user", content: "hint please" }, { role: "assistant", content: `Hint ${i + 1}: think about the groups one at a time. ${s.q}` }]).flat(), graded: "q" }) },
  // Closed by CHECK_MAX_MESSAGES of the learner's messages, all of them free (a hint request uses no try).
  { name: "closed check (twelve hint requests before)", helped: true, build: (s) => ({ first: s.q, then: Array.from({ length: 12 }, (_, i) => [{ role: "user", content: "hint please" }, { role: "assistant", content: `Hint ${i + 1}: think about the groups one at a time. ${s.q}` }]).flat(), graded: "q" }) },
];

type AnswerKind = "right by code" | "right by model" | "wrong" | "partly" | "unsure" | "answers nothing" | "a skill title" | "right, then stopped";
const RIGHT: ReadonlySet<AnswerKind> = new Set(["right by code", "right by model"]);
const ANSWERS: AnswerKind[] = ["right by code", "right by model", "wrong", "partly", "unsure", "answers nothing", "a skill title", "right, then stopped"];
const answerText = (kind: AnswerKind, s: typeof Q[string], other: Subtopic): string =>
  ({ "right by code": s.code, "right by model": s.model, wrong: s.wrong, partly: s.partly, unsure: s.unsure, "answers nothing": "xyz", "a skill title": other.title, "right, then stopped": s.code })[kind];
const verdictOf = (kind: AnswerKind): string | null =>
  ({ "right by code": "correct", "right by model": "correct", wrong: "incorrect", partly: "partly", unsure: null, "answers nothing": "incorrect", "a skill title": "incorrect", "right, then stopped": "correct" })[kind];

type Marker = "app" | "app, declined on the card" | "model's call" | "model's call, declined on the card" | "model's call on another skill";
const DECLINED: ReadonlySet<Marker> = new Set(["app, declined on the card", "model's call, declined on the card"]);

interface Case {
  id: string;
  path: string;
  prior: string;
  answer: string;
  marker: Marker;
  conversation: Sent;
  mastered: string[];
  script: TurnEvent[][];
  picks?: string[];
  key?: (sent: Sent) => Key;
  verdict: string | null;
  stop?: boolean;
  /** The skill ids the rule says this turn marks. */
  expected: string[];
}

const modelScript = (marker: Marker, skill: Subtopic, other: Subtopic, text: string, stop = false): TurnEvent[][] => {
  const tail = stop ? [[{ type: "text", delta: text }, { type: "stop" }, { type: "done", finishReason: "stop" }] as TurnEvent[]] : [reply(text)];
  if (marker === "app" || marker === "app, declined on the card") return tail;
  return [markCall(marker === "model's call on another skill" ? other.title : skill.title), ...tail];
};

function typedCase(path: Path, prior: Prior, kind: AnswerKind, marker: Marker): Case {
  const s = Q[path.skill.id];
  // Another skill not mastered where there is one (a mark of a mastered one changes nothing), else any other.
  const other = [C, A, B].find((o) => o.id !== path.skill.id && !path.mastered.includes(o.id)) ?? (path.skill.id === A.id ? C : A);
  const { first, then, graded } = prior.build(s);
  const conversation: Sent = [...path.lead(first), ...then, { role: "user", content: answerText(kind, s, other) }];
  const ruled = RIGHT.has(kind) && !prior.helped && !path.mastered.includes(path.skill.id) && !DECLINED.has(marker);
  return {
    id: "", path: path.name, prior: prior.name, answer: kind, marker, conversation, mastered: path.mastered,
    script: modelScript(marker, path.skill, other, graded === "q" ? "Yes, that's it." : "Yes.", kind === "right, then stopped"),
    verdict: verdictOf(kind), stop: kind === "right, then stopped", expected: ruled ? [path.skill.id] : [],
  };
}

const CASES: Case[] = [];
// 1. Every path x every prior turn, a right answer the app marks.
for (const path of PATHS) for (const prior of PRIORS) CASES.push(typedCase(path, prior, "right by code", "app"));
// 2. Every path x every answer kind, on a first try, the app marking.
for (const path of PATHS) for (const kind of ANSWERS) if (kind !== "right by code") CASES.push(typedCase(path, PRIORS[0], kind, "app"));
// 3. The model's own call (accepted, declined on the "Is that okay?" card, on another skill) and the app's mark
// declined, x every path x every prior turn, a right and a wrong answer.
for (const path of PATHS) for (const marker of ["model's call", "model's call, declined on the card", "model's call on another skill", "app, declined on the card"] as Marker[])
  for (const prior of PRIORS) for (const kind of ["right by code", "wrong"] as AnswerKind[]) CASES.push(typedCase(path, prior, kind, marker));

// 4. Credits code tags: the hint's own question (on: "hint"), the check's first question after the tutor moved on
// (on: "earlier"), and the first question asked again in other words (reworded). Each follows help, so no mark.
const FIRST_Q = "Can you tell me what an equal group is?";
const MOVED_ON_Q = "Now, how many groups of 2 make 6?";
const AGAIN_Q = "So, what makes groups equal?";
const credits: Array<{ name: string; conversation: Sent; key: (sent: Sent) => Key; verdict: (sent: Sent) => string }> = [
  {
    name: "the hint's own question (on: hint)",
    conversation: [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + Q[A.id].q }, { role: "user", content: "Give me a hint." }, { role: "assistant", content: HINT_Q }, { role: "user", content: "8" }],
    key: keyByQuestion, verdict: () => "correct",
  },
  {
    name: "the first question after the tutor moved on (on: earlier)",
    conversation: [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + FIRST_Q }, { role: "user", content: "I don't know" },
      { role: "assistant", content: `An equal group has the same number in each group. ${MOVED_ON_Q}` }, { role: "user", content: "An equal group has the same number of things as the others." }],
    key: (sent) => (sent.map((m) => m.content).join("\n").includes(MOVED_ON_Q) ? { question: MOVED_ON_Q, working: "6 / 2 = 3", answer: "3" } : { question: FIRST_Q, working: "", answer: "A group with the same number of things as the others" }),
    verdict: (sent) => (sent.map((m) => m.content).join("\n").includes(`Question: ${FIRST_Q}\n`) ? "correct" : "incorrect"),
  },
  {
    name: "the first question asked again in other words (reworded)",
    conversation: [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + FIRST_Q }, { role: "user", content: "I don't know" },
      { role: "assistant", content: `Think of plates with cookies. ${AGAIN_Q}` }, { role: "user", content: "they all have the same number" }],
    key: (sent) => (sent.map((m) => m.content).join("\n").includes(AGAIN_Q) ? { question: AGAIN_Q, working: "", answer: "They have the same number of things" } : { question: FIRST_Q, working: "", answer: "A group with the same number of things" }),
    verdict: (sent) => (sent.map((m) => m.content).join("\n").includes(`Question: ${FIRST_Q}\n`) ? "correct" : "partly"),
  },
];
let gradeBy: ((sent: Sent) => string) | null = null;
const creditVerdicts = new Map<string, (sent: Sent) => string>();
for (const c of credits) for (const marker of ["app", "model's call"] as Marker[]) {
  const id = `credit ${c.name} / ${marker}`;
  creditVerdicts.set(id, c.verdict);
  CASES.push({ id, path: "app picker", prior: "help (credit)", answer: c.name, marker, conversation: c.conversation, mastered: [], script: modelScript(marker, A, C, "Yes, that's it."), key: c.key, verdict: "correct", expected: [] });
}

// 5. Cards on the turn that opens the check: the app's picker, then the model's question card, answered by a pick.
const cardRows: Array<{ name: string; mastered: string[]; script: (marker: Marker) => TurnEvent[][]; picks: string[]; right: boolean; skill: Subtopic }> = [
  { name: "picker, model's question card picked right", mastered: [], picks: [A.title, "12"], right: true, skill: A, script: (m) => [askCall(Q[A.id].q, ["10", "12"]), ...modelScript(m, A, C, "Yes, 12.")] },
  { name: "picker, model's question card picked wrong", mastered: [], picks: [A.title, "10"], right: false, skill: A, script: (m) => [askCall(Q[A.id].q, ["10", "12"]), ...modelScript(m, A, C, "Not quite.")] },
  { name: "picker, \"help\" typed into the card, easier card picked right", mastered: [], picks: [A.title, "help", "12"], right: false, skill: A, script: (m) => [askCall(Q[A.id].q, ["10", "12"]), askCall(Q[A.id].easier, ["8", "12"]), ...modelScript(m, A, C, "Yes, 12.")] },
  { name: "one skill left, model's question card picked right", mastered: [B.id, C.id], picks: ["12"], right: true, skill: A, script: (m) => [askCall(Q[A.id].q, ["10", "12"]), ...modelScript(m, A, C, "Yes, 12.")] },
  { name: "one skill left, \"I don't know\" typed into the card, easier card picked right", mastered: [B.id, C.id], picks: ["I don't know", "12"], right: false, skill: A, script: (m) => [askCall(Q[A.id].q, ["10", "12"]), askCall(Q[A.id].easier, ["8", "12"]), ...modelScript(m, A, C, "Yes, 12.")] },
];
for (const r of cardRows) for (const marker of ["app", "model's call", "model's call on another skill"] as Marker[])
  CASES.push({ id: "", path: "card on the opening turn", prior: r.name, answer: r.right ? "right card pick" : "card pick after help or wrong", marker, conversation: OPEN, mastered: r.mastered, script: r.script(marker), picks: [...r.picks], verdict: "correct", expected: r.right ? [r.skill.id] : [] });

// 6. The model wrote the app's card again as prose (TerraTutor live test part 14, issue 1), and the learner typed a title.
const copyOf = (question: string, titles: string[]) => `That is right.\n\n${question}\n\n${titles.map((t) => `*${t}*`).join("\n")}`;
const proseCopies: Array<{ name: string; lead: Sent; mastered: string[]; question: string; typed: string }> = [
  { name: "copy of the first card, the picked title typed", lead: [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + copyOf(PICKER_QUESTION, [A.title, C.title]) }], mastered: [], question: PICKER_QUESTION, typed: A.title },
  { name: "copy of the first card, another title typed", lead: [...OPEN, { role: "assistant", content: picked(PICKER_QUESTION, A.title) + copyOf(PICKER_QUESTION, [A.title, C.title]) }], mastered: [], question: PICKER_QUESTION, typed: C.title },
  { name: "copy of the next card, the picked title typed", lead: [...FIRST_SKILL_DONE, { role: "assistant", content: picked(NEXT_PICKER_QUESTION, C.title) + copyOf(NEXT_PICKER_QUESTION, [B.title, C.title]) }], mastered: [A.id], question: NEXT_PICKER_QUESTION, typed: C.title },
  { name: "copy of the next card, the similar title typed", lead: [...FIRST_SKILL_DONE, { role: "assistant", content: picked(NEXT_PICKER_QUESTION, C.title) + copyOf(NEXT_PICKER_QUESTION, [B.title, C.title]) }], mastered: [A.id], question: NEXT_PICKER_QUESTION, typed: B.title },
];
for (const r of proseCopies) for (const marker of ["app", "model's call"] as Marker[]) {
  const skill = ALL.find((s) => s.title === r.typed)!;
  CASES.push({ id: "", path: "model's prose copy of a card", prior: r.name, answer: "a skill title", marker, conversation: [...r.lead, { role: "user", content: r.typed }], mastered: r.mastered,
    script: modelScript(marker, skill, skill, `Okay, ${r.typed} next.`), key: () => ({ question: r.question, working: "", answer: r.typed }), verdict: "correct", expected: [] });
}

CASES.forEach((c, i) => { if (!c.id) c.id = `${c.path} / ${c.prior} / ${c.answer} / ${c.marker}`; c.id = `#${String(i + 1).padStart(3, "0")} ${c.id}`; });

// ── Known rows: the outcome differs from the rule, and the fix is not a structural gate ─────────────
// Filled from the sweep's run on OpenEdu (the same rows as TerraTutor's); each says why it stays. Keyed by the case
// id without its number.
const MODEL_CARD = "missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288";
const PROSE = "missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks";
const LAST_PROSE = "missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288";
const NO_PICK = "missed (conservative): two or more not mastered and no pick, so code knows no exact skill and makes no mark";
const HINT_MODEL = "wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285";
const NO_PICK_MODEL = "wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285";
const KNOWN = new Map<string, string>([
  ["typed into the picker, no pick / first try / right by code / app", NO_PICK],
  ["typed into the picker, no pick / \"Yes\" to \"Does that make sense?\" / right by code / app", NO_PICK],
  ["typed into the picker, no pick / \"I'm ready!\" to \"Are you ready?\" / right by code / app", NO_PICK],
  ["model's own which-next card / first try / right by code / app", MODEL_CARD],
  ["model's own which-next card / \"Yes\" to \"Does that make sense?\" / right by code / app", MODEL_CARD],
  ["model's own which-next card / \"I'm ready!\" to \"Are you ready?\" / right by code / app", MODEL_CARD],
  ["next skill named in prose / first try / right by code / app", PROSE],
  ["next skill named in prose / \"Yes\" to \"Does that make sense?\" / right by code / app", PROSE],
  ["next skill named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / app", PROSE],
  ["last skill left, named in prose / first try / right by code / app", LAST_PROSE],
  ["last skill left, named in prose / \"Yes\" to \"Does that make sense?\" / right by code / app", LAST_PROSE],
  ["last skill left, named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / app", LAST_PROSE],
  ["typed into the picker, no pick / first try / right by model / app", NO_PICK],
  ["model's own which-next card / first try / right by model / app", MODEL_CARD],
  ["next skill named in prose / first try / right by model / app", PROSE],
  ["last skill left, named in prose / first try / right by model / app", LAST_PROSE],
  ["app picker / hint / right by code / model's call", HINT_MODEL],
  ["app picker / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["app picker / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["app picker / five hint requests / right by code / model's call", HINT_MODEL],
  ["app picker, chip text typed / hint / right by code / model's call", HINT_MODEL],
  ["app picker, chip text typed / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["app picker, chip text typed / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["app picker, chip text typed / five hint requests / right by code / model's call", HINT_MODEL],
  ["app picker, similar title / hint / right by code / model's call", HINT_MODEL],
  ["app picker, similar title / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["app picker, similar title / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["app picker, similar title / five hint requests / right by code / model's call", HINT_MODEL],
  ["app picker, then model card / hint / right by code / model's call", HINT_MODEL],
  ["app picker, then model card / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["app picker, then model card / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["app picker, then model card / five hint requests / right by code / model's call", HINT_MODEL],
  ["one skill left, no picker / hint / right by code / model's call", HINT_MODEL],
  ["one skill left, no picker / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["one skill left, no picker / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["one skill left, no picker / five hint requests / right by code / model's call", HINT_MODEL],
  ["typed into the picker, no pick / hint / right by code / model's call", HINT_MODEL],
  ["typed into the picker, no pick / answers nothing, code asks again / right by code / model's call", HINT_MODEL],
  ["typed into the picker, no pick / the hint's own question answered / right by code / model's call", HINT_MODEL],
  ["typed into the picker, no pick / five hint requests / right by code / model's call", HINT_MODEL],
  ["typed into the picker, no pick / first try / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / \"Yes\" to \"Does that make sense?\" / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / hint / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / answers nothing, code asks again / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / the hint's own question answered / right by code / model's call on another skill", NO_PICK_MODEL],
  ["typed into the picker, no pick / five hint requests / right by code / model's call on another skill", NO_PICK_MODEL],
  ["model's own which-next card / first try / right by code / model's call", MODEL_CARD],
  ["model's own which-next card / \"Yes\" to \"Does that make sense?\" / right by code / model's call", MODEL_CARD],
  ["model's own which-next card / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call", MODEL_CARD],
  ["model's own which-next card / first try / right by code / model's call on another skill", MODEL_CARD],
  ["model's own which-next card / \"Yes\" to \"Does that make sense?\" / right by code / model's call on another skill", MODEL_CARD],
  ["model's own which-next card / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call on another skill", MODEL_CARD],
  ["next skill named in prose / first try / right by code / model's call", PROSE],
  ["next skill named in prose / \"Yes\" to \"Does that make sense?\" / right by code / model's call", PROSE],
  ["next skill named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call", PROSE],
  ["next skill named in prose / first try / right by code / model's call on another skill", PROSE],
  ["next skill named in prose / \"Yes\" to \"Does that make sense?\" / right by code / model's call on another skill", PROSE],
  ["next skill named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call on another skill", PROSE],
  ["last skill left, named in prose / first try / right by code / model's call", LAST_PROSE],
  ["last skill left, named in prose / \"Yes\" to \"Does that make sense?\" / right by code / model's call", LAST_PROSE],
  ["last skill left, named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call", LAST_PROSE],
  ["last skill left, named in prose / first try / right by code / model's call on another skill", LAST_PROSE],
  ["last skill left, named in prose / \"Yes\" to \"Does that make sense?\" / right by code / model's call on another skill", LAST_PROSE],
  ["last skill left, named in prose / \"I'm ready!\" to \"Are you ready?\" / right by code / model's call on another skill", LAST_PROSE],
]);

// ── The run ────────────────────────────────────────────────────────────────────────────────────────

interface Outcome { marked: string[]; verdict: string | null; on: string | null; text: string; cards: Array<{ question: string; choices: string[] }> }
/** One turn of `c` through tutorEngine.run. `fresh` false keeps the database the last turn left (a second turn). */
async function runCase(c: Case, fresh = true): Promise<Outcome> {
  if (fresh) {
    await openDb();
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level) VALUES ('c1', 'Multiplication', 'multiplication', 1)`);
    sqlite.prepare(`INSERT INTO syllabuses (id, course_id, level, title, subtopics) VALUES ('s1', 'c1', 1, 'Level 1', ?1)`).run(JSON.stringify(ALL));
    save(c.mastered);
  }
  const cards: Outcome["cards"] = [];
  script = c.script.map((s) => [...s]);
  keyFor = c.key ?? keyByQuestion;
  verdict = c.verdict;
  gradeBy = creditVerdicts.get(c.id.replace(/^#\d+ /, "")) ?? null;
  const abort = new AbortController();
  stopper = c.stop ? abort : null;
  const picks = [...(c.picks ?? [])];
  const before = masteredInDb();
  // The mode ChatTab derives for the turn (chatTurnMode with no chip picked: the chip's text is the assess chip's).
  const { activeSkill, domainSkill } = chatTurnSkills(chatTurnMode(null, c.conversation), "Multiplication", "tiny", true);
  const result = await tutorEngine.run(
    { messages: [{ role: "system", content: "You are a tutor." }, ...c.conversation], config: CONFIG, retrieval: "off", onText: () => {} },
    {
      // The course view's snapshot (ctx.syllabus) holds what was saved when it opened: stale only on the path whose
      // skill was mastered since then.
      courseId: "c1", level: 1, syllabus: c.path === "skill already mastered" ? SNAPSHOT : { ...SNAPSHOT, subtopics: ALL.map((s) => (c.mastered.includes(s.id) ? { ...s, mastered: true, practiced: true } : s)) }, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: abort.signal, activeSkill, domainSkill, supportsTools: true,
      confirmTool: async () => !DECLINED.has(c.marker),
      // A card the test did not script (the app's "which next?" after a right answer) gets its first choice.
      askUser: async (q, choices) => { cards.push({ question: q, choices: choices.map((x) => x.label) }); return picks.shift() ?? choices[0].value; },
    },
  );
  const check = result.answerCheck ?? result.cardChecks[result.cardChecks.length - 1] ?? null;
  return { marked: masteredInDb().filter((id) => !before.includes(id)), verdict: check?.verdict ?? null, on: check?.on ?? (check?.reworded ? "reworded" : null), text: result.text, cards };
}

interface TableRow { c: Case; got: Outcome; known?: string }
const table: TableRow[] = [];

beforeEach(() => {
  script = [];
  verdict = "correct";
  gradeBy = null;
});

describe("mastery mark sweep: every path that can mark a skill in chat", () => {
  it("has at least 150 generated cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  for (const c of CASES) {
    const known = KNOWN.get(c.id.replace(/^#\d+ /, ""));
    (known ? it.fails : it)(`${c.id} marks ${c.expected.length ? c.expected.join(", ") : "nothing"}${known ? ` (known: ${known})` : ""}`, async () => {
      const got = await runCase(c);
      table.push({ c, got, known });
      expect(got.marked).toEqual(c.expected);
    }, 30_000);
  }

  // The next skill named only in prose (TerraTutor's review of this sweep, MUST-FIX 1). With two or more titles left, the right
  // answer there marks nothing, but it brings up the app's "which next?" card, and the first answer after its pick
  // marks the skill, by the app or by the model.
  for (const marker of ["app", "model's call"] as Marker[]) {
    it(`next skill named in prose: the which-next card on that turn, then the next right answer marks 1.3 (${marker})`, async () => {
      const path = PATHS.find((p) => p.name === "next skill named in prose")!;
      const first = { ...typedCase(path, PRIORS[0], "right by code", marker), picks: [C.title] };
      first.script = modelScript(marker, C, B, `Yes, 3 is right. ${Q[C.id].q}`);
      const one = await runCase(first);
      expect(one.marked).toEqual([]);
      expect(one.cards).toEqual([{ question: NEXT_PICKER_QUESTION, choices: [B.title, C.title] }]);
      const conversation: Sent = [...first.conversation, { role: "assistant", content: one.text }, { role: "user", content: Q[C.id].code }];
      const two = await runCase({ ...first, conversation, script: modelScript(marker, C, B, "Yes, that's it.") }, false);
      expect(two.marked).toEqual([C.id]);
    }, 30_000);
  }

  // KNOWN REGRESSIONS (TerraTutor's review of this sweep, MUST-FIX 1; TerraTutor issue #288). On master the model's own mark of the next skill
  // landed on these two paths. Held to code's gate it is refused, because the answer is not the check's first try and
  // no pick on the app's own card says where the next skill started. Nothing in that check can mark it then:
  // - with one title left, the app shows no "which next?" card (nextPickerCard wants two or more, and the card's
  //   tool takes 2 to 5 choices);
  // - after a pick on the model's own card, the check's skill reads as the one picked there (checkedSubtopic), which
  //   is not mastered, so the app's card never comes up.
  // A new check marks it on its first answer: with one skill left there is no picker and checkedSubtopic is that
  // skill; with two, the app's picker comes back.
  for (const name of ["last skill left, named in prose", "model's own which-next card"]) for (const marker of ["app", "model's call"] as Marker[]) {
    it(`${name}: no mark and no app card in that check; a new check marks 1.3 on its first answer (${marker})`, async () => {
      const path = PATHS.find((p) => p.name === name)!;
      const first = typedCase(path, PRIORS[0], "right by code", marker);
      const one = await runCase(first);
      expect(one.marked).toEqual([]);
      expect(one.cards).toEqual([]);
      const reopened: Sent = [...first.conversation, { role: "assistant", content: one.text }, { role: "user", content: ASSESS_MESSAGE }];
      const two = await runCase({ ...first, conversation: reopened, picks: [C.title], script: [reply(`Let's check ${C.title}. ${Q[C.id].q}`)] }, false);
      expect(two.marked).toEqual([]);
      expect(two.cards).toEqual(path.mastered.length === 2 ? [] : [{ question: PICKER_QUESTION, choices: [B.title, C.title] }]);
      const answered: Sent = [...reopened, { role: "assistant", content: two.text }, { role: "user", content: Q[C.id].code }];
      const three = await runCase({ ...first, conversation: answered, script: modelScript(marker, C, B, "Yes, that's it.") }, false);
      expect(three.marked).toEqual([C.id]);
    }, 30_000);
  }

  // The app's which-next card picks 1.2, then the tutor moves to 1.3 in prose and asks its question (OpenEdu review of
  // this port, 2026-11-21, MUST-FIX 1). Code no longer knows which skill the question was on, so the app marks
  // nothing and the model's own mark stands. Before: 1.2 saved by the app, and the model's right mark of 1.3 refused.
  const pickB = (tail: string): Sent => [...FIRST_SKILL_DONE, { role: "assistant", content: `${VERDICT_FALLBACK.correct}\n\n${picked(NEXT_PICKER_QUESTION, B.title)}${tail}` }];
  const switchSame: Sent = [...pickB(`Actually, let's do ${C.title} first. ${Q[C.id].q}`), { role: "user", content: Q[C.id].code }];
  const switchReady: Sent = [...pickB(`Actually, let's do ${C.title} first. ${Q[C.id].explain} Are you ready for a question?`), { role: "user", content: "Yes" }, { role: "assistant", content: `Here it is. ${Q[C.id].q}` }, { role: "user", content: Q[C.id].code }];
  for (const [name, conversation] of [["in the same message", switchSame], ["then a ready yes", switchReady]] as const) {
    it(`which-next pick of 1.2, the tutor switches to 1.3 ${name}: the app marks nothing`, async () => {
      const got = await runCase({ id: "switch app", path: "p", prior: "p", answer: "p", marker: "app", conversation, mastered: [A.id], script: [reply("Yes, that's it.")], verdict: "correct", expected: [] });
      expect(got.verdict).toBe("correct");
      expect(got.marked).toEqual([]);
    }, 30_000);
    it(`which-next pick of 1.2, the tutor switches to 1.3 ${name}: the model's mark of 1.3 stands`, async () => {
      const got = await runCase({ id: "switch model", path: "p", prior: "p", answer: "p", marker: "model's call", conversation, mastered: [A.id], script: [markCall(C.title), reply("Yes, that's it.")], verdict: "correct", expected: [C.id] });
      expect(got.marked).toEqual([C.id]);
    }, 30_000);
  }
  it("which-next pick of 1.2, a ready yes, then 1.2's question: the app marks 1.2", async () => {
    const conversation: Sent = [...pickB(`${Q[B.id].explain} Are you ready for a question?`), { role: "user", content: "Yes" }, { role: "assistant", content: `Here it is. ${Q[B.id].q}` }, { role: "user", content: Q[B.id].code }];
    const got = await runCase({ id: "ready app", path: "p", prior: "p", answer: "p", marker: "app", conversation, mastered: [A.id], script: [reply("Yes, that's it.")], verdict: "correct", expected: [B.id] });
    expect(got.marked).toEqual([B.id]);
  }, 30_000);
});

// The results table (SWEEP_OUT=<path> npx vitest run src/lib/kernel/masteryMarkSweep.test.ts).
afterAll(async () => {
  const out = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SWEEP_OUT;
  if (!out) return;
  const spec = "node:fs";
  const fs = await import(/* @vite-ignore */ spec);
  const wrong = (r: TableRow) => r.got.marked.some((id) => !r.c.expected.includes(id));
  const missed = (r: TableRow) => r.c.expected.some((id) => !r.got.marked.includes(id));
  const paths = [...new Set(table.map((r) => r.c.path))];
  const lines = [
    "| Path | Cases | Rule marks | Code marks | Wrong marks | Missed marks |",
    "|---|---|---|---|---|---|",
    ...paths.map((p) => {
      const rows = table.filter((r) => r.c.path === p);
      return `| ${p} | ${rows.length} | ${rows.filter((r) => r.c.expected.length).length} | ${rows.filter((r) => r.got.marked.length).length} | ${rows.filter(wrong).length} | ${rows.filter(missed).length} |`;
    }),
    `| **All** | **${table.length}** | **${table.filter((r) => r.c.expected.length).length}** | **${table.filter((r) => r.got.marked.length).length}** | **${table.filter(wrong).length}** | **${table.filter(missed).length}** |`,
    "",
    "| Case | Rule | Code | Verdict | Tag | Why it stays |",
    "|---|---|---|---|---|---|",
    ...table.filter((r) => wrong(r) || missed(r)).sort((a, b) => a.c.id.localeCompare(b.c.id))
      .map((r) => `| ${r.c.id.replace(/\|/g, "/")} | ${r.c.expected.join(", ") || "none"} | ${r.got.marked.join(", ") || "none"} | ${r.got.verdict ?? "none"} | ${r.got.on ?? ""} | ${r.known ?? "not known: fix it"} |`),
  ];
  fs.writeFileSync(out, `${lines.join("\n")}\n`);
});
