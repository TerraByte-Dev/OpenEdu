import { describe, it, expect, vi, beforeEach } from "vitest";

// A grounded turn through the real kernel (tutorEngine.run, the function ChatTab calls), on a thread
// longer than the window. The grounding block is merged into the student's newest message, and
// fitMessages charges that message in full, so the block must not ALSO come off the history
// allowance. Charged twice, a grounded turn dropped up to budget.grounding tokens of history it had
// room for and told the tutor to ask the student to restate it.
// Stand-ins: the model call (callLLMTurn, which records what it was sent) and the notebook search
// (returns passages, so the turn is grounded). The library is not loaded in tests, so it adds nothing.

type Sent = Array<{ role: string; content: string }>;

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const sent: Sent[] = [];
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "text" as const, delta: "Leaves use sunlight to make sugar." };
    yield { type: "done" as const, finishReason: "stop" as const };
  }),
  callLLMStructured: vi.fn(async () => { throw new Error("no structured call expected"); }),
}));

const PASSAGE = "Photosynthesis happens in the leaves of a plant. Chlorophyll catches sunlight, and the plant uses that energy to turn water and carbon dioxide into sugar and oxygen. ".repeat(6);
let noteRows = 0;
vi.mock("../notebook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notebook")>()),
  searchNotebook: vi.fn(async () => Array.from({ length: noteRows }, (_, i) => ({
    chunk_id: `chunk-${i}`, document_id: `doc-${i}`, document_title: `Leaves ${i}`, ord: 0, text: PASSAGE, score: 0.9,
  }))),
}));

import { tutorEngine } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { budgetFor, estTokens, isElisionNote } from "./budget";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, Syllabus } from "../../types";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const SYLLABUS = { level: 1, subtopics: [{ id: "1.1", title: "Plants", key_concepts: [], practice_type: "recall", mastered: false }] } as unknown as Syllabus;
const CONTEXT_TOKENS = 8192;
const budget = budgetFor(CONTEXT_TOKENS);

// 80 earlier messages of exactly 100 estimated tokens each: 8,000 tokens, more than the window holds.
const LINE = "We talked about how plants grow toward the light and need water in the soil. ";
const turnText = (i: number) => `${i}: ${LINE.repeat(10)}`.slice(0, 400);
const HISTORY: Sent = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: turnText(i) }));
const QUESTION = "How do leaves make sugar from sunlight?";

async function firstCall(): Promise<Sent> {
  const { activeSkill, domainSkill } = chatTurnSkills("explain", "Science", "tiny", true);
  await tutorEngine.run(
    { messages: [{ role: "system", content: "You are a tutor." }, ...HISTORY, { role: "user", content: QUESTION }], config: CONFIG, retrieval: "always", onText: () => {} },
    {
      courseId: "c-1", level: 1, syllabus: SYLLABUS, modelTier: "tiny", contextTokens: CONTEXT_TOKENS, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
      confirmTool: async () => true, askUser: async () => "",
    },
  );
  return sent[0];
}

// What fitMessages charged for the messages it kept: the pinned system head plus every kept message
// (the elision note is not charged against the allowance).
function charged(messages: Sent): number {
  return messages.filter((m) => !isElisionNote(m)).reduce((n, m) => n + estTokens(m.content), 0);
}

beforeEach(() => { sent.length = 0; });

describe("a grounded turn's history budget (tutorEngine.run → fitMessages)", () => {
  it("charges the grounding block once, so the window stays full of history", async () => {
    noteRows = 3;
    const messages = await firstCall();
    const question = messages[messages.length - 1];
    expect(question.content, "the turn is grounded").toContain("<context>");
    const blockTokens = estTokens(question.content) - estTokens(QUESTION);
    expect(blockTokens, "a block big enough that a double charge would cost history").toBeGreaterThan(500);
    expect(messages.some(isElisionNote), "the thread is longer than the window").toBe(true);

    const room = budget.total - budget.reserve;
    const used = charged(messages);
    expect(used).toBeLessThanOrEqual(room);
    // The next older message (100 tokens) is the one that did not fit. Charged twice, the block left
    // more than 500 tokens of that room empty and dropped five or more messages that fit.
    expect(used + 100, "the window is full: one more message would not fit").toBeGreaterThan(room);
  });

  it("keeps as much history as an ungrounded turn, less the block itself", async () => {
    noteRows = 0;
    const plain = await firstCall();
    expect(plain[plain.length - 1].content).not.toContain("<context>");
    sent.length = 0;
    noteRows = 3;
    const grounded = await firstCall();
    const keptTurns = (m: Sent) => m.filter((x) => x.role !== "system").length;
    const blockTokens = estTokens(grounded[grounded.length - 1].content) - estTokens(plain[plain.length - 1].content);
    // The block displaces history once: ceil(block / 100) messages at most, never block * 2.
    expect(keptTurns(plain) - keptTurns(grounded)).toBeLessThanOrEqual(Math.ceil(blockTokens / 100));
  });
});
