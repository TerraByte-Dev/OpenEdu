import { describe, it, expect, vi, beforeEach } from "vitest";

// An ask_user.question card through the real kernel (tutorEngine.run, the function ChatTab calls) and the
// real tool. Only the model is a stand-in, scripted per model call.
//
// Click test 2026-11-14 (gemma4:e4b, fractions L1, "Check if I've got this."): the card's buttons did not
// answer its question, and after a pick the turn ended with only a "✓ Done" chip: no reply, and the
// question gone. Run headless against the same model with the same card, the call after the bare
// {"choice": "..."} tool result came back EMPTY in 5 of 8 runs (8 of 8 when retried without tools). The
// kernel's "never a blank turn" line only covered turns that ran no tool, so the empty turn was
// returned as "", ChatTab saved nothing, and the card's question lived only in the card.
//
// These turns are mastery checks (the chat offers the card only in assess mode), so each answer to a
// card also gets the answer check (answerCheckTurn.test.ts covers it). Its key and grading calls are
// stand-ins here: a card about 1/5 is keyed "1", any other card asks nothing with one right answer.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "aborted" };

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const sent: Sent[] = [];
let script: TurnEvent[][] = [];
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
  callLLMStructured: vi.fn(async (messages: Sent, _config: unknown, opts: { toolName: string }) => {
    const said = messages[1].content;
    if (opts.toolName === "AnswerGrade") return { student_answer: said.split("Student's answer: ")[1] ?? "", verdict: "correct" };
    const question = said.split("\n").find((l) => l.includes("1/5")) ?? "";
    return question ? { question, working: "A unit fraction has 1 on top.", answer: "1" } : { question: "", working: "", answer: "" };
  }),
}));
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getSyllabus: vi.fn(async () => null),
}));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { ASSESS_MESSAGE } from "./suggestions";
import { registerBuiltinTools } from "../tools";
import { AFTER_ANSWER_REPLY } from "../plain-language";
import { answerCheckNote } from "./answerCheck";
import { VERDICT_FALLBACK } from "./replyClaims";
import type { LLMConfig, Syllabus } from "../../types";
import type { AskChoice } from "../tools/EduTool";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const SYLLABUS = { level: 1, subtopics: [{ id: "1.1", title: "Unit fractions", key_concepts: [], practice_type: "recall", mastered: false }] } as unknown as Syllabus;

const reply = (text: string): TurnEvent[] => [
  ...Array.from({ length: Math.ceil(text.length / 3) }, (_, i) => ({ type: "text" as const, delta: text.slice(i * 3, i * 3 + 3) })),
  { type: "done", finishReason: "stop" },
];
const EMPTY: TurnEvent[] = [{ type: "done", finishReason: "stop" }];
const askCall = (question: string, choices: AskChoice[], before = ""): TurnEvent[] => [
  ...(before ? reply(before).slice(0, -1) : []),
  { type: "tool_call", id: "call_0", name: "ask_user.question", args: { question, choices } },
  { type: "done", finishReason: "tool_calls" },
];

// The click test's card, as gemma4:e4b wrote it.
const CLICK_TEST_Q = "Think about the fraction 1/5. Which number, 1 or 5, is the unit fraction part?";
const CLICK_TEST_CHOICES = [{ label: "What is the denominator?", value: "denominator" }, { label: "What is the numerator?", value: "numerator" }];

interface Run { result: TutorTurnResult; cards: Array<{ question: string; choices: AskChoice[] }> }

/** One turn of "Check if I've got this." in assess mode; the student answers the card with `answer`. */
async function check(answer: (choices: AskChoice[]) => string): Promise<Run> {
  const { activeSkill, domainSkill } = chatTurnSkills("assess", "Fractions", "tiny", true);
  const cards: Run["cards"] = [];
  let streamed = "";
  const result = await tutorEngine.run(
    {
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "What is a unit fraction?" },
        { role: "assistant", content: "A unit fraction is a fraction where the top number is 1." },
        { role: "user", content: ASSESS_MESSAGE },
      ],
      config: CONFIG, retrieval: "off",
      onText: (chunk) => { streamed += chunk; },
    },
    {
      courseId: "c-1", level: 1, syllabus: SYLLABUS, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async () => true,
      askUser: async (question, choices) => { cards.push({ question, choices }); return answer(choices); },
    },
  );
  expect(streamed, "what streamed is what the turn returns").toBe(result.text);
  return { result, cards };
}

const toolResultSeen = (call = 1) => sent[call].find((m) => m.role === "tool")?.content ?? "";

beforeEach(() => {
  sent.length = 0;
  script = [];
});

describe("the click test's card", () => {
  it("shows the choices its question names, and the reply after the pick is shown and saved with the question", async () => {
    script = [askCall(CLICK_TEST_Q, CLICK_TEST_CHOICES), reply("Yes! 1 is the top number, so 1/5 is a unit fraction.")];
    const { result, cards } = await check((choices) => choices[0].value);
    expect(cards).toEqual([{ question: CLICK_TEST_Q, choices: [{ label: "1", value: "1" }, { label: "5", value: "5" }] }]);
    // The pick was checked: the model reads the verdict with it.
    expect(result.cardChecks).toEqual([expect.objectContaining({ key: "1", verdict: "correct", by: "code" })]);
    expect(toolResultSeen()).toBe(`The student picked "1". Reply to the student now, following on from their answer.\n\n${answerCheckNote(result.cardChecks[0])}`);
    expect(result.text).toBe(`${CLICK_TEST_Q}\n\n*You picked: 1*\n\nYes! 1 is the top number, so 1/5 is a unit fraction.`);
    expect(result.stopReason).toBe("complete");
  });

  it("asks the model once more when its reply after the pick is empty", async () => {
    script = [askCall(CLICK_TEST_Q, CLICK_TEST_CHOICES), EMPTY, reply("That's it: 1 is the numerator.")];
    const { result } = await check((choices) => choices[0].value);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual(sent[1]); // the same request again
    expect(result.text).toBe(`${CLICK_TEST_Q}\n\n*You picked: 1*\n\nThat's it: 1 is the numerator.`);
  });

  it("never ends on the card alone: two empty replies get one plain line, the verdict when the pick was checked", async () => {
    script = [askCall(CLICK_TEST_Q, CLICK_TEST_CHOICES), EMPTY, EMPTY];
    const { result } = await check((choices) => choices[0].value);
    expect(sent).toHaveLength(3);
    expect(result.text).toBe(`${CLICK_TEST_Q}\n\n*You picked: 1*\n\n${VERDICT_FALLBACK.correct}`);
    expect(result.stopReason).toBe("complete");

    sent.length = 0;
    script = [askCall("Which topic should we check first?", [{ label: "Unit fractions", value: "u" }, { label: "Equal parts", value: "e" }]), EMPTY, EMPTY];
    const topic = await check((choices) => choices[0].value);
    expect(topic.result.text).toBe(`Which topic should we check first?\n\n*You picked: Unit fractions*\n\n${AFTER_ANSWER_REPLY}`);
  });
});

describe("an answer the student types instead of picking", () => {
  it("reaches the model as typed, and the thread says so", async () => {
    script = [askCall("Which number is on top in 1/5?", [{ label: "The 1", value: "1" }, { label: "The 5", value: "5" }]), reply("Right, the 1 is on top.")];
    const { result } = await check(() => "it's the one");
    expect(result.cardChecks).toEqual([expect.objectContaining({ key: "1", verdict: "correct" })]);
    expect(toolResultSeen()).toBe(`The student typed their own answer instead of picking a choice: "it's the one". Reply to the student now, following on from their answer.\n\n${answerCheckNote(result.cardChecks[0])}`);
    expect(result.text).toBe("Which number is on top in 1/5?\n\n*You answered: it's the one*\n\nRight, the 1 is on top.");
  });
});

describe("a card whose question the reply already said", () => {
  it("is recorded once: the question is not repeated under the reply's own", async () => {
    script = [askCall("Which topic should we check first?", [{ label: "Unit fractions", value: "u" }, { label: "Equal parts", value: "e" }], "Let's see. Which topic should we check first?"), reply("Here is one on unit fractions.")];
    const { result, cards } = await check((choices) => choices[1].value);
    // The card itself is unchanged: the chat decides whether to show its question (repeatsQuestion).
    expect(cards[0].question).toBe("Which topic should we check first?");
    expect(result.text).toBe("Let's see. Which topic should we check first?\n\n*You picked: Equal parts*\n\nHere is one on unit fractions.");
  });
});

describe("a card that already answers its question", () => {
  it("is shown exactly as the model wrote it, and one reply is asked for", async () => {
    const choices = [{ label: "Unit fractions", value: "u" }, { label: "Equal parts", value: "e" }];
    script = [askCall("Which topic should we check first?", choices), reply("What is the top number of 1/3?")];
    const { result, cards } = await check((c) => c[0].value);
    expect(cards).toEqual([{ question: "Which topic should we check first?", choices }]);
    expect(sent).toHaveLength(2);
    expect(result.toolCalls).toEqual([{ name: "ask_user.question", args: { question: "Which topic should we check first?", choices }, ok: true }]);
  });
});
