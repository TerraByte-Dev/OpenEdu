import { describe, it, expect, vi, beforeEach } from "vitest";
import chatTabSource from "../../components/ChatTab.tsx?raw";

// A turn whose newest message is a safety disclosure (child-safety.ts isSafetyDisclosure, with the learner's
// grade) keeps nothing the learner said (ported from TerraTutor #220): no flashcard stage, and
// knowledge.update_map, notebook.ingest and flashcard.create refused like progress.mark_mastered; the result
// says it was one so ChatTab runs no knowledge reflection. Through the real kernel (tutorEngine.run, the
// function ChatTab calls), with the real tool registry, permissions and dispatch. Stand-ins: the model's
// reply stream (callLLMTurn), the structured calls (the flashcard stage), and the writes behind the three
// tools (db.ts and the notebook import). The conversations are written for this test; none comes from an
// eval set.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "aborted" };

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const requests: Sent[] = [];
let script: TurnEvent[][] = [];
let structuredCalls = 0;

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent, _config: unknown, opts: { signal?: AbortSignal }) {
    requests.push(messages.map((m) => ({ role: m.role, content: m.content })));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) {
      if (opts?.signal?.aborted) { yield { type: "done", finishReason: "aborted" }; return; }
      yield ev;
    }
  }),
  callLLMStructured: vi.fn(async () => { structuredCalls++; return { front: "What is 7 x 8?", back: "56" }; }),
}));

const cards: Array<{ front: string; back: string }> = [];
const instructions: Array<{ type: string; text: string }> = [];
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getSyllabus: vi.fn(async () => null),
  createFlashcard: vi.fn(async (c: { front: string; back: string }) => { cards.push({ front: c.front, back: c.back }); return { id: "f1", front: c.front }; }),
  flashcardExists: vi.fn(async () => false),
  getTutorInstructions: vi.fn(async () => ({})),
  saveTutorInstruction: vi.fn(async (_course: string, type: string, text: string) => { instructions.push({ type, text }); }),
}));

const notes: Array<{ title: string; text: string }> = [];
vi.mock("../notebook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notebook")>()),
  importTextAsNote: vi.fn(async (o: { title: string; text: string }) => { notes.push({ title: o.title, text: o.text }); return { note: { id: "n1" }, chunkCount: 1 }; }),
}));

import { tutorEngine, NOT_SAVED_DISCLOSURE, type TutorTurnResult } from "./TutorEngine";
import { registerBuiltinTools } from "../tools";
import { isSafetyDisclosure } from "../child-safety";
import type { LLMConfig } from "../../types";
import type { Grade } from "../grade";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const ABUSE = "my stepdad hits me when he drinks";
const HARM_AND_CARD = "this is too hard i wanna die. make me a flashcard for 7 x 8";
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];
const toolCall = (name: string, args: unknown): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name, args }, { type: "done", finishReason: "tool_calls" },
];

interface Run { result: TutorTurnResult; chips: string[] }

async function turn(text: string, grade: Grade | null = null): Promise<Run> {
  const chips: string[] = [];
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: text }],
      config: CONFIG, retrieval: "off", grade,
      onText: () => {},
      onToolEvent: (ev) => { chips.push(`${ev.kind}:${ev.name}`); },
    },
    {
      // No skill: every permitted tool is offered, so a refusal is the kernel's, not the skill gate's.
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill: null, domainSkill: null, supportsTools: true,
      confirmTool: async () => true,
    },
  );
  return { result, chips };
}

/** The tool result the model was sent back for the turn's first call. */
const toolResult = () => requests[1]?.find((m) => m.role === "tool")?.content;

beforeEach(() => {
  requests.length = 0;
  cards.length = 0;
  instructions.length = 0;
  notes.length = 0;
  script = [];
  structuredCalls = 0;
});

describe("the inputs are safety disclosures", () => {
  it("as child-safety.ts reads them", () => {
    expect(isSafetyDisclosure(ABUSE)).toBe(true);
    expect(isSafetyDisclosure(HARM_AND_CARD)).toBe(true);
    expect(isSafetyDisclosure("im 14 and pregnant", 8)).toBe(true);
    expect(isSafetyDisclosure("what is 7 x 8")).toBe(false);
  });
});

describe("the result says the turn was a disclosure", () => {
  it("on a turn the model answered", async () => {
    script = [reply("I'm so sorry. Please tell a grown-up you trust.")];
    const { result } = await turn(ABUSE);
    expect(result.disclosure).toBe(true);
  });
  it("on a pregnancy disclosure with a K-12 grade set", async () => {
    const { result } = await turn("im 14 and pregnant", 8);
    expect(result.disclosure).toBe(true);
  });
  it("and not on an ordinary turn", async () => {
    const { result } = await turn("what is 7 x 8");
    expect(result.disclosure).toBe(false);
  });
});

describe("a disclosure turn keeps nothing the learner said", () => {
  const cases: Array<[string, unknown, () => unknown[]]> = [
    ["knowledge.update_map", { content: "Student said their stepdad hits them." }, () => instructions],
    ["notebook.ingest", { title: "About home", text: "My stepdad hits me when he drinks." }, () => notes],
    ["flashcard.create", { front: "What happens at home?", back: "My stepdad hits me." }, () => cards],
  ];

  for (const [name, args, written] of cases) {
    it(`refuses ${name}: nothing runs or is shown, and the model is told it was not saved`, async () => {
      script = [toolCall(name, args), reply("Please tell a grown-up you trust.")];
      const { result, chips } = await turn(ABUSE);
      expect(written()).toEqual([]);
      expect(chips.filter((c) => c.endsWith(name))).toEqual([]);
      expect(toolResult()).toBe(`ERROR: ${NOT_SAVED_DISCLOSURE}`);
      expect(result.toolCalls).toEqual([{ name, args, ok: false }]);
      expect(result.usedKnowledgeUpdate).toBe(false);
      expect(result.disclosure).toBe(true);
    });

    it(`still runs ${name} on an ordinary turn (the same call, through the same dispatch)`, async () => {
      script = [toolCall(name, args), reply("Done.")];
      const { result } = await turn("can you save that for me");
      expect(written()).toHaveLength(1);
      expect(result.toolCalls).toEqual([{ name, args, ok: true }]);
      expect(result.disclosure).toBe(false);
    });
  }

  it("the refusal never sends the learner back to the work", () => {
    expect(NOT_SAVED_DISCLOSURE).not.toMatch(/back to (?:work|the student)|keep going with|go back to/i);
  });
});

describe("the app's flashcard stage does not run on a disclosure turn", () => {
  it("no card call, no card, no \"it is saved\" note", async () => {
    script = [reply("I'm sorry it feels that hard. Please tell a grown-up you trust.")];
    const { result, chips } = await turn(HARM_AND_CARD);
    expect(structuredCalls).toBe(0);
    expect(cards).toEqual([]);
    expect(chips.filter((c) => c.endsWith("flashcard.create"))).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    // The learner's text goes to the model as typed, with no flashcard note after it.
    expect(requests[0].filter((m) => m.role === "user").map((m) => m.content)).toEqual([HARM_AND_CARD]);
  });

  it("while the same request without the disclosure gets its card", async () => {
    await turn("make me a flashcard for 7 x 8");
    expect(structuredCalls).toBe(1);
    expect(cards).toEqual([{ front: "What is 7 x 8?", back: "56" }]);
  });
});

// ChatTab is DOM-coupled and is not rendered in vitest. This pins the chat's use of the result tested above.
describe("ChatTab wiring", () => {
  it("runs no knowledge reflection on a disclosure turn", () => {
    expect(chatTabSource).toContain("if (!result.usedKnowledgeUpdate && !partial && !result.disclosure) {");
    const gate = chatTabSource.indexOf("!result.disclosure) {");
    expect(chatTabSource.indexOf("updateKnowledgeFiles(courseId, userText", gate)).toBeGreaterThan(gate);
    expect(chatTabSource.match(/updateKnowledgeFiles\(/g)).toHaveLength(1);
  });
});
