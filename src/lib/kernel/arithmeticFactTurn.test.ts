import { describe, it, expect, vi } from "vitest";

// The arithmetic-fact note through the real kernel (tutorEngine.run, the function ChatTab and the eval
// runners call), with ChatTab's own prompt and mode rules. The model call is the only stand-in.
//
// Pinned: (a) a fact turn's last user message is the student's text plus the fact and note, and nothing
// else in the request changes, the system prompt included, with no model call added; (b) a turn the
// detector does not fire on sends exactly what it sends with the switch off; (c) a mastery check and the
// tutor's own question get no note, so no answer to a question the tutor asked is given away; (d) the
// note never stacks with the first-turn hold, check-before-praise or a safety disclosure.

type Sent = Array<{ role: string; content: string }>;
const sent: Sent[] = [];

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "text" as const, delta: "7 × 8 = 56." };
    yield { type: "done" as const, finishReason: "stop" as const };
  }),
}));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnMode, chatTurnSkills } from "./chatSkills";
import { arithmeticFactNote, askedArithmetic } from "./arithmeticFact";
import { FIRST_TURN_HOLD_NOTE } from "./attemptFirst";
import { CHECK_BEFORE_PRAISE_NOTE } from "./checkBeforePraise";
import { ASSESS_MESSAGE, QUIZ_MESSAGE } from "./suggestions";
import { isSafetyDisclosure } from "../child-safety";
import { buildSystemPrompt } from "../curriculum";
import { gradePromptLayer } from "../grade";
import type { LLMConfig } from "../../types";

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;

// ChatTab's prompt, mode and grade for a grade-4 learner in a Fractions course, then tutorEngine.run.
async function run(history: Sent, userText: string, arithmeticFacts?: "on" | "off", chip: "assess" | null = null): Promise<{ req: Sent; result: TutorTurnResult }> {
  const mode = chatTurnMode(chip, [...history, { role: "user", content: userText }]);
  const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills(mode, "Fractions", "tiny", false);
  const system = buildSystemPrompt({}, null, 1, "Fractions", skillSuffix, undefined, undefined, gradePromptLayer(4));
  sent.length = 0;
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: userText }],
      config: CONFIG, retrieval: "off", answerCheck: "off", onText: () => {}, grade: 4,
      ...(arithmeticFacts ? { arithmeticFacts } : {}),
    },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default",
      config: CONFIG, abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: false,
    },
  );
  return { req: sent[0], result };
}

const CLICK_TEST = "what is 7 times 8 in the times tables?";

describe("arithmetic-fact note: request through the kernel", () => {
  it("(a) appends the fact and note after the student's text; nothing else changes", async () => {
    const off = await run([], CLICK_TEST, "off");
    const on = await run([], CLICK_TEST);
    expect(sent).toHaveLength(1); // no model call added
    const fact = askedArithmetic(CLICK_TEST)!;
    expect(on.req[on.req.length - 1].content).toBe(`${CLICK_TEST}\n\n${arithmeticFactNote(fact)}`);
    expect(on.req[on.req.length - 1].content).toContain("<arithmetic_fact>\n7 × 8 = 56\n</arithmetic_fact>");
    expect(on.req.slice(0, -1)).toEqual(off.req.slice(0, -1)); // the system prompt and history, byte for byte
    expect(off.req[off.req.length - 1].content).toBe(CLICK_TEST);
    expect(on.result.arithmeticFact).toEqual({ expression: "7 × 8", answer: "56", operands: ["7", "8"] });
    expect(off.result.arithmeticFact).toBeNull();
  });

  it("(a) mid-chat, on a sum the tutor did not ask", async () => {
    const history: Sent = [{ role: "user", content: "can we do fractions" }, { role: "assistant", content: "Sure! A fraction is a part of a whole. Which part should we start with?" }];
    const { req, result } = await run(history, "what's 15 + 27?");
    expect(req[req.length - 1].content).toBe(`what's 15 + 27?\n\n${arithmeticFactNote(askedArithmetic("what's 15 + 27?")!)}`);
    expect(result.arithmeticFact?.answer).toBe("42");
  });

  it.each([
    "what is a fraction?",
    "what is 7 times 8 apples?",
    "how many times do I multiply?",
    "what is 12/25?",
    "what is 9-11",
    "what's 407 + 285?", // k12-flow-fr fr-math-k5-01: a typed problem the tutor holds (B4 G1)
    "what is 1/2 + 1/4?", // a fraction sum is a Fractions course's own exercise
    "quiz me on 7 times 8",
    "Don't tell me the answer, what is 7 x 8?",
    "what is 3 times 4 times 5?",
    "I think 7 times 8 is 54",
    "A baker has 7 trays with 8 buns on each. How many buns? what is 7 times 8?", // a typed problem (B4 G1)
    "what is 7 times 8\nwhat is 9 times 6", // a pasted worksheet
    "what is half of 10", // a fraction of a set is a Fractions course's exercise
  ])("(b) a turn it does not fire on sends exactly what the switch-off turn sends: %s", async (text) => {
    const off = await run([], text, "off");
    const on = await run([], text);
    expect(on.req).toEqual(off.req);
    expect(on.result.arithmeticFact).toBeNull();
  });

  it("(c) never in a mastery check: the assess chip's turn, its answers, or a typed quiz request", async () => {
    const assess: Sent = [{ role: "user", content: ASSESS_MESSAGE }, { role: "assistant", content: "Question 1: what is half of 6?" }];
    const quiz: Sent = [{ role: "user", content: "quiz me on times tables" }, { role: "assistant", content: "Okay! What is 9 times 6?" }];
    for (const [history, text, chip] of [
      [[], "what is 7 times 8?", "assess"],
      [assess, "what is 6 times 9?", null],
      [quiz, "what's 9 times 6?", null],
      [quiz, "what is 2 times 2", null],
    ] as Array<[Sent, string, "assess" | null]>) {
      const off = await run(history, text, "off", chip);
      const on = await run(history, text, undefined, chip);
      expect(on.req, text).toEqual(off.req);
      expect(on.result.arithmeticFact, text).toBeNull();
    }
  });

  it("(c) not on the tutor's own question, echoed back", async () => {
    const history: Sent = [{ role: "user", content: "give me a times table question" }, { role: "assistant", content: "Here you go: what is 7 × 8?" }];
    const off = await run(history, "what is 7 times 8?", "off");
    const on = await run(history, "what is 7 times 8?");
    expect(on.req).toEqual(off.req);
    expect(on.result.arithmeticFact).toBeNull();
  });

  // A quiz runs past inMasteryCheck's window (the student's last ASSESS_LOOKBACK + 1 messages), and a
  // question typed in it runs in explain mode, so only the echo check over the tutor's last messages holds.
  it("(c) not on a long quiz's question with a hint in between, from either chip, or on practice", async () => {
    const answered: Sent = [1, 2, 3, 4].flatMap((n) => [
      { role: "assistant", content: `Question ${n}: what is ${n} + 1?` }, { role: "user", content: String(n + 1) },
    ]);
    const quiz = (opener: string, question: string): Sent => [
      { role: "user", content: opener }, ...answered,
      { role: "assistant", content: question }, { role: "user", content: "hmm" },
      { role: "assistant", content: "Think about multiplying the groups by how many are in each." },
    ];
    const practice: Sent = [
      { role: "user", content: "hi" }, { role: "assistant", content: "What is 7 × 8?" },
      { role: "user", content: "idk" }, { role: "assistant", content: "What is 7 × 4? Then double it." },
    ];
    for (const [history, text] of [
      [quiz(QUIZ_MESSAGE, "Question 5: There are 7 boxes. Each has 8 pens. How many pens?"), "what is 7 times 8"],
      [quiz(ASSESS_MESSAGE, "Question 5: There are 9 shelves with 6 toys on each. How many toys?"), "what's 9 times 6"],
      [practice, "what is 7 times 8?"],
    ] as Array<[Sent, string]>) {
      const off = await run(history, text, "off");
      const on = await run(history, text);
      expect(on.req, text).toEqual(off.req);
      expect(on.result.arithmeticFact, text).toBeNull();
    }
  });

  it("(d) yields to the first-turn hold: an option-list problem gets the hold only", async () => {
    const text = "Which is right?\n\nA) 54\nB) 56\nC) 64\n\nwhat is 7 times 8?";
    const { req, result } = await run([], text);
    expect(req[req.length - 1].content).toBe(`${text}\n\n${FIRST_TURN_HOLD_NOTE}`);
    expect(result).toMatchObject({ firstTurnHold: true, arithmeticFact: null });
  });

  it("(d) yields to check-before-praise: a try gets the check note only", async () => {
    const history: Sent = [{ role: "user", content: "How many beads are in 3 boxes of 4?" }, { role: "assistant", content: "What do you multiply to find it?" }];
    const { req, result } = await run(history, "is it 12?");
    expect(req[req.length - 1].content).toBe(`is it 12?\n\n${CHECK_BEFORE_PRAISE_NOTE}`);
    expect(result.arithmeticFact).toBeNull();
  });

  it("(d) a safety-disclosure turn gets no fact note", async () => {
    const text = "i'm pregnant. what is 7 times 8?";
    expect(isSafetyDisclosure(text, 4)).toBe(true);
    const { req, result } = await run([], text);
    expect(result.arithmeticFact).toBeNull();
    expect(req[req.length - 1].content).not.toContain("<arithmetic_fact>");
  });
});
