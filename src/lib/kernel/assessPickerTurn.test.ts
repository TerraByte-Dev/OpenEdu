import { describe, it, expect, vi, beforeEach } from "vitest";

// The topic picker that opens a mastery check (assessPicker.ts), through the real kernel (tutorEngine.run,
// the function ChatTab calls) and the real ask_user.question tool. Only the model is a stand-in, scripted
// per model call.
//
// TerraTutor click test 2026-11-19 (gemma4:e2b, fractions, "Check if I've got this."): in 6 tries the tutor
// never called ask_user.question, so no question card ever showed. The readiness runs measured the same
// thing (2 of 20, then 3 of 20). The level's unmastered subtopics are in the syllabus, so the app shows the
// card. Ported from TerraTutor #244.

type Sent = Array<{ role: string; content: string; tool_calls?: unknown[] }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" };

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const sent: Sent[] = [];
let script: Array<TurnEvent[] | Error> = [];
const structured: string[] = [];
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) })));
    const next = script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }];
    if (next instanceof Error) throw next;
    for (const ev of next) yield ev;
  }),
  callLLMStructured: vi.fn(async (_m: unknown, _c: unknown, opts: { toolName: string }) => {
    structured.push(opts.toolName);
    return { question: "", working: "", answer: "" };
  }),
}));
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getSyllabus: vi.fn(async () => null),
}));

import { tutorEngine, TutorTurnError, type TutorTurnResult } from "./TutorEngine";
import { friendlyError } from "../plain-language";
import { chatTurnSkills } from "./chatSkills";
import { ASSESS_MESSAGE } from "./suggestions";
import { PICKER_QUESTION } from "./assessPicker";
import { modelToolCalls } from "./modelToolCalls";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, Syllabus } from "../../types";
import type { AskChoice } from "../tools/EduTool";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const sub = (id: string, title: string, mastered = false) => ({ id, title, key_concepts: [], practice_type: "recall", mastered });
const syllabus = (...subtopics: ReturnType<typeof sub>[]) => ({ level: 1, subtopics }) as unknown as Syllabus;
const THREE = syllabus(sub("1.1", "Unit fractions"), sub("1.2", "Equal parts", true), sub("1.3", "Comparing fractions"), sub("1.4", "Fractions on a number line"));

const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];

interface Run { result: TutorTurnResult; cards: Array<{ question: string; choices: AskChoice[] }> }

async function open(opts: { message?: string; mode?: string; syllabus?: Syllabus; answer?: (choices: AskChoice[]) => string; supportsTools?: boolean; onText?: (chunk: string) => void } = {}): Promise<Run> {
  const { activeSkill, domainSkill } = chatTurnSkills(opts.mode ?? "assess", "Fractions", "tiny", opts.supportsTools ?? true);
  const cards: Run["cards"] = [];
  let streamed = "";
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: opts.message ?? ASSESS_MESSAGE }],
      config: CONFIG, retrieval: "off",
      onText: (chunk) => { streamed += chunk; opts.onText?.(chunk); },
    },
    {
      courseId: "c-1", level: 1, syllabus: opts.syllabus ?? THREE, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: opts.supportsTools ?? true, confirmTool: async () => true,
      askUser: async (question, choices) => { cards.push({ question, choices }); return (opts.answer ?? ((c) => c[0].value))(choices); },
    },
  );
  expect(streamed, "what streamed is what the turn returns").toBe(result.text);
  return { result, cards };
}

beforeEach(() => {
  sent.length = 0;
  script = [];
  structured.length = 0;
});

describe("the app's topic picker", () => {
  it("opens the check with the unmastered subtopics before any model call, and the model replies to the pick", async () => {
    script = [reply("Great. What is 1/3 as a picture?")];
    const { result, cards } = await open({ answer: (c) => c[1].value });
    expect(cards).toEqual([{
      question: PICKER_QUESTION,
      choices: [
        { label: "Unit fractions", value: "Unit fractions" },
        { label: "Comparing fractions", value: "Comparing fractions" },
        { label: "Fractions on a number line", value: "Fractions on a number line" },
      ],
    }]);
    // One model call, after the pick: it reads the card as its own call and the learner's answer.
    expect(sent).toHaveLength(1);
    const call = sent[0].find((m) => m.role === "assistant" && m.tool_calls);
    expect(call?.tool_calls).toEqual([{ id: "app_picker", name: "ask_user.question", args: cards[0] }]);
    expect(sent[0].find((m) => m.role === "tool")?.content).toBe('The student picked "Comparing fractions". Reply to the student now, following on from their answer.');
    expect(result.text).toBe(`${PICKER_QUESTION}\n\n*You picked: Comparing fractions*\n\nGreat. What is 1/3 as a picture?`);
    expect(result.toolCalls).toEqual([{ name: "ask_user.question", args: cards[0], ok: true, byApp: true }]);
    // The eval runners still count only the model's own calls.
    expect(modelToolCalls(result.toolCalls)).toEqual([]);
    // A topic pick has no right answer: no key call is spent on it.
    expect(structured).toEqual([]);
    expect(result.cardChecks).toEqual([]);
    expect(result.stopReason).toBe("complete");
  });

  it("a list of choices in the reply after the pick still gets buttons", async () => {
    script = [reply("Which fraction is bigger?\n\n1. 1/2\n2. 1/4")];
    const { result } = await open();
    expect(result.replyChoices?.choices.map((c) => c.label)).toEqual(["1/2", "1/4"]);
  });

  it("an empty reply after the pick is asked again, then gets the plain line", async () => {
    script = [[{ type: "done", finishReason: "stop" }], [{ type: "done", finishReason: "stop" }]];
    const { result } = await open();
    expect(sent).toHaveLength(2);
    expect(result.text.startsWith(`${PICKER_QUESTION}\n\n*You picked: Unit fractions*\n\n`)).toBe(true);
    expect(result.text.length).toBeGreaterThan(`${PICKER_QUESTION}\n\n*You picked: Unit fractions*\n\n`.length);
  });

  it("a safety disclosure typed into it is handed back as the learner's own message, and no model call runs", async () => {
    const { result } = await open({ answer: () => "i want to kill myself" });
    expect(result.cardMessage).toBe("i want to kill myself");
    expect(result.text).toBe(PICKER_QUESTION);
    expect(sent).toHaveLength(0);
  });

  // TerraTutor review of 2026-11-19: with Ollama stopped, the picker showed with no model, and the failed
  // model call after the pick was kept as a stalled turn: the learner was told to close programs, and the
  // card and pick were saved as a tutor reply that "Notes from last chat" then summarised. Now that call
  // fails the turn, so ChatTab shows the plain Ollama line (friendlyError) and saves no reply.
  it("Ollama stopped: the model call after the pick fails the turn with the Ollama line, nothing kept", async () => {
    const DOWN = "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.";
    script = [new Error(DOWN)];
    let streamed = "";
    const turn = open({ onText: (c) => { streamed += c; } });
    const err = await turn.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TutorTurnError);
    expect(friendlyError((err as Error).message)).toBe(DOWN);
    expect(sent).toHaveLength(1);
    // The card was on screen; the chat drops the stream and shows the error instead (ChatTab).
    expect(streamed.startsWith(PICKER_QUESTION)).toBe(true);
  });

  it("a model call that fails after the model already replied still keeps the turn as stalled", async () => {
    script = [
      [{ type: "text", delta: "Good pick. Let me look that up." }, { type: "tool_call", id: "call_0", name: "notebook.search", args: { query: "unit fractions" } }, { type: "done", finishReason: "tool_calls" }],
      new Error("Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again."),
    ];
    const { result } = await open();
    expect(result.stopReason).toBe("stalled");
    expect(result.text).toContain("Good pick. Let me look that up.");
  });

  it("the same request typed in assess mode opens it too", async () => {
    const { cards } = await open({ message: "Can you check if I mastered fractions?" });
    expect(cards).toHaveLength(1);
  });

  it("shows at most five choices", async () => {
    const many = syllabus(...Array.from({ length: 7 }, (_, i) => sub(`1.${i + 1}`, `Part ${i + 1}`)));
    const { cards } = await open({ syllabus: many });
    expect(cards[0].choices.map((c) => c.label)).toEqual(["Part 1", "Part 2", "Part 3", "Part 4", "Part 5"]);
  });

  it.each([
    ["one subtopic left to check", { syllabus: syllabus(sub("1.1", "Unit fractions"), sub("1.2", "Equal parts", true)) }],
    ["every subtopic mastered", { syllabus: syllabus(sub("1.1", "Unit fractions", true), sub("1.2", "Equal parts", true)) }],
    ["a message that does not open a check", { message: "Give me a hint." }],
    ["the quiz chip's check, which runs in the default mode", { mode: "explain" }],
    ["a model with no tools", { supportsTools: false }],
  ] as const)("no picker with %s: the model is called as before", async (_name, opts) => {
    script = [reply("Here is a question: what is 1/2 of 4?")];
    const { result, cards } = await open(opts);
    expect(cards).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0].some((m) => m.tool_calls)).toBe(false);
    expect(result.text).toBe("Here is a question: what is 1/2 of 4?");
  });
});
