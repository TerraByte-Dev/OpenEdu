import { describe, it, expect, vi, beforeEach } from "vitest";

// The two write paths that no longer wait for a small model to choose a tool, through the real kernel
// (tutorEngine.run, the function ChatTab and the eval runners call):
//   - reply choices: a reply that writes its choices as a trailing list, without calling
//     ask_user.question, carries them in `replyChoices` for the chat to show as buttons;
//   - the flashcard stage: a student who asks for a card gets one saved through flashcard.create's own
//     dispatch (permission confirm, chip), and the model is told in a note instead of being offered
//     the tool again.
// Stand-ins: the model calls (callLLMTurn, callLLMStructured) and the database write (createFlashcard).
// Nothing here comes from an eval set.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" };

// The headless store: every setting reads as on a fresh install, so the permission rules are the
// defaults (flashcard.create asks first) and the library tools read their switch without Tauri.
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const sent: Array<{ messages: Sent; tools: string[] }> = [];
let script: TurnEvent[][] = [];
let card: unknown = null;
let cardError: Error | null = null;

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent, _config: unknown, opts: { tools?: Array<{ name: string }> }) {
    sent.push({ messages: messages.map((m) => ({ role: m.role, content: m.content })), tools: (opts.tools ?? []).map((t) => t.name) });
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
  callLLMStructured: vi.fn(async () => {
    if (cardError) throw cardError;
    return card;
  }),
}));

const created: Array<Record<string, unknown>> = [];
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  createFlashcard: vi.fn(async (input: Record<string, unknown>) => {
    created.push(input);
    return { id: `card-${created.length}`, front: input.front };
  }),
}));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { flashcardNote } from "./flashcardRequest";
import { callLLMStructured } from "../llm";
import { registerBuiltinTools } from "../tools";
import type { ToolUIEvent } from "./toolDispatch";
import type { ToolContext } from "../tools/EduTool";
import type { LLMConfig } from "../../types";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const SYSTEM = { role: "system", content: "You are a tutor." };

async function run(
  mode: string,
  history: Sent,
  extra: Partial<ToolContext> = {},
): Promise<{ result: TutorTurnResult; events: ToolUIEvent[] }> {
  const { activeSkill, domainSkill } = chatTurnSkills(mode, "Arithmetic", "tiny", true);
  const events: ToolUIEvent[] = [];
  const result = await tutorEngine.run(
    { messages: [SYSTEM, ...history], config: CONFIG, retrieval: "off", onText: () => {}, onToolEvent: (ev) => events.push(ev) },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, ...extra,
    },
  );
  return { result, events };
}

const LIST_REPLY = "Let's check what you know.\n\nWhich topic would you like to start with?\n\n1. Equal groups\n2. Facts to 10\n3. Sharing";
const last = (messages: Sent) => messages[messages.length - 1];
const reply = (text: string, finishReason: "stop" | "length" = "stop"): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason }];

beforeEach(() => {
  sent.length = 0;
  created.length = 0;
  script = [];
  card = null;
  cardError = null;
  vi.mocked(callLLMStructured).mockClear();
});

describe("reply choices through tutorEngine.run", () => {
  it("carries a trailing choice list the model wrote instead of calling ask_user.question", async () => {
    script = [reply(LIST_REPLY)];
    const { result } = await run("assess", [{ role: "user", content: "I'm ready for my mastery check." }]);
    expect(sent[0].tools).toContain("ask_user.question");
    expect(result.text).toBe(LIST_REPLY); // the reply itself is unchanged
    expect(result.replyChoices).toEqual({
      question: "Which topic would you like to start with?",
      choices: ["Equal groups", "Facts to 10", "Sharing"].map((label) => ({ label, value: label })),
    });
  });

  it("carries none when the turn asked through ask_user.question", async () => {
    script = [
      [{ type: "tool_call", id: "call_0", name: "ask_user.question", args: { question: "Which topic?", choices: [{ label: "A", value: "a" }, { label: "B", value: "b" }] } }, { type: "done", finishReason: "tool_calls" }],
      reply(LIST_REPLY),
    ];
    const askUser = vi.fn(async () => "a");
    const { result } = await run("assess", [{ role: "user", content: "I'm ready for my mastery check." }], { askUser });
    expect(askUser).toHaveBeenCalledOnce();
    expect(result.replyChoices).toBeNull();
  });

  it("carries none on a reply cut off at the output cap, or with no list", async () => {
    script = [reply(LIST_REPLY, "length")];
    expect((await run("assess", [{ role: "user", content: "Check me." }])).result.replyChoices).toBeNull();
    script = [reply("Great work. Which topic next?")];
    expect((await run("assess", [{ role: "user", content: "Check me." }])).result.replyChoices).toBeNull();
  });
});

describe("the flashcard stage through tutorEngine.run", () => {
  const REQUEST = "Make me a flashcard: 6 x 7 = 42.";
  const CARD = { front: "What is 6 x 7?", back: "42" };

  it("saves the card through flashcard.create, after the learner's confirm, and tells the model", async () => {
    card = CARD;
    const confirmTool = vi.fn(async () => true);
    const { result, events } = await run("review", [{ role: "user", content: REQUEST }], { confirmTool });

    expect(confirmTool).toHaveBeenCalledWith("flashcard.create", "The card: “What is 6 x 7?”");
    expect(created).toEqual([expect.objectContaining({ courseId: "c-1", front: "What is 6 x 7?", back: "42", level: 1, source: "tutor" })]);
    expect(events).toContainEqual(expect.objectContaining({ kind: "result", name: "flashcard.create" }));
    expect(result.toolCalls).toEqual([{ name: "flashcard.create", args: CARD, ok: true, byApp: true }]);

    // One reply call: the student's words, then the note; the tool is no longer offered.
    expect(sent).toHaveLength(1);
    expect(last(sent[0].messages)).toEqual({ role: "user", content: `${REQUEST}\n\n${flashcardNote(CARD)}` });
    expect(sent[0].tools).not.toContain("flashcard.create");
    expect(sent[0].tools).toContain("flashcard.review_due");
  });

  it("runs in a mode that does not offer the tool, since the student asked", async () => {
    card = CARD;
    const { result } = await run("explain", [{ role: "user", content: REQUEST }], { confirmTool: async () => true });
    expect(created).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ name: "flashcard.create", ok: true, byApp: true });
  });

  it("saves nothing when the learner declines, and says so to the model", async () => {
    card = CARD;
    const { result } = await run("review", [{ role: "user", content: REQUEST }], { confirmTool: async () => false });
    expect(created).toEqual([]);
    expect(result.toolCalls).toEqual([{ name: "flashcard.create", args: CARD, ok: false, byApp: true }]);
    expect(last(sent[0].messages).content).toBe(`${REQUEST}\n\n${flashcardNote(null)}`);
    expect(sent[0].tools).not.toContain("flashcard.create");
  });

  it("leaves the turn as it was when the card call fails or does not validate", async () => {
    cardError = new Error("model returned no valid JSON");
    await run("review", [{ role: "user", content: REQUEST }]);
    card = { front: "What is 6 x 7?", back: "what is 6 x 7?" };
    cardError = null;
    await run("review", [{ role: "user", content: REQUEST }]);
    expect(created).toEqual([]);
    for (const s of sent) {
      expect(last(s.messages)).toEqual({ role: "user", content: REQUEST });
      expect(s.tools).toContain("flashcard.create");
    }
  });

  it("makes no call on a turn that does not ask for a card", async () => {
    card = CARD;
    const { result } = await run("review", [{ role: "user", content: "Which of my flashcards are due today?" }]);
    expect(callLLMStructured).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(last(sent[0].messages)).toEqual({ role: "user", content: "Which of my flashcards are due today?" });
  });
});
