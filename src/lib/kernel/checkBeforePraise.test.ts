import { describe, it, expect, vi, beforeEach } from "vitest";

// The check-before-praise note (checkBeforePraise.ts). Unit cases on made-up text, then every frozen
// k12-flow (240) and k12-flow-fr (81) turn text, first through the gate and then through
// tutorEngine.run, the function ChatTab and the eval runners call, with the model call as the only
// stand-in (as in turnRules.test.ts).

type Sent = Array<{ role: string; content: string }>;
const sent: Sent[] = [];

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "text" as const, delta: "Here is the next step." };
    yield { type: "done" as const, finishReason: "stop" as const };
  }),
}));

import { tutorEngine } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { personaIdentityLayer } from "./systemPrompt";
import { SHOW_ANSWER_MESSAGE } from "./suggestions";
import { FIRST_TURN_HOLD_NOTE, withFirstTurnHold } from "./attemptFirst";
import { estTokens } from "./budget";
import { CHECK_BEFORE_PRAISE_NOTE, isAttemptText, isCheckBeforePraiseTurn, withCheckBeforePraise } from "./checkBeforePraise";
import { buildSystemPrompt } from "../curriculum";
import { K12_ITEMS } from "../eval/k12-items";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "../eval/k12-flow";
import { K12_FR_ITEMS } from "../eval/k12-flow-fr-items";
import { formatK12FlowFrT1, formatK12FlowFrT2 } from "../eval/k12-flow-fr";
import type { LLMConfig } from "../../types";

const student = (content: string) => ({ role: "user", content });
const tutor = (content: string) => ({ role: "assistant", content });

// Made-up content. Nothing here comes from an eval item.
const PROBLEM = "A recipe needs 3 cups of flour for every 2 cups of milk. How many cups of flour go with 8 cups of milk?";
const LISTED = `${PROBLEM}\n\nA) 10\nB) 12\nC) 16\nD) 5\n\nWhich one is right?`;
const HINT_Q = "What number turns the 2 cups of milk into 8?";
// Tutor replies with no number, so the frozen-text proofs below do not lean on the reply.
const T1_REPLY = "Start with what the problem gives you. What is the first step?";
const T2_REPLY = "Not quite. Look again at what the question asks for. What do you get this time?";
const T2_REPLY_FLAT = "Let us look at it together.";

describe("isAttemptText", () => {
  it("reads a try", () => {
    for (const t of [
      "I think it's C.", "I think it's 15 beads.", "Is it 10?", "is it B?", "It's D", "The answer is A.", "C", "c)", "(B)", "D.",
      "12", "12 cups", "$0.95", "3/4", "1 5/12", "-14?", "x = 4", "90 pi cubic centimeters", "it's about 40 miles", "I got 22",
      "My answer is oxygen", "I'd say B", "I guess it is 7", "I think the answer is 9",
    ]) expect(isAttemptText(t), t).toBe(true);
  });

  it("does not read a request, a thank-you or small talk as a try", () => {
    for (const t of [
      "Give me a hint.", "Walk me through it.", "Show me the answer", SHOW_ANSWER_MESSAGE, "I don't know", "idk", "I think so",
      "I think I get it now", "Thanks!", "Can I try another one?", "What is 36 × 7?", "Help me with Decimals.", "I guess",
      "Why do we flip the second fraction?", "a long time ago in a town far away",
    ]) expect(isAttemptText(t), t).toBe(false);
  });
});

describe("isCheckBeforePraiseTurn", () => {
  it("fires on a try at a problem the tutor just worked on", () => {
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student("Is it 10?")])).toBe(true);
    expect(isCheckBeforePraiseTurn([student(LISTED), tutor(T1_REPLY), student("I think it's A.")])).toBe(true);
    // The tutor posed it: a number in the reply.
    expect(isCheckBeforePraiseTurn([student("hi"), tutor("Let's warm up. What is 3 × 4?"), student("is it 12?")])).toBe(true);
    // A question from the student with no number, answered with a question.
    expect(isCheckBeforePraiseTurn([student("What gas do plants take in?"), tutor("Think about what we breathe out. Which gas is it?"), student("I think it's carbon dioxide")])).toBe(true);
    // A tutor reply that asked nothing still worked on the problem.
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(T2_REPLY_FLAT), student("12 cups")])).toBe(true);
  });

  it("does not fire on a first message, a new problem, a request, the show-answer chip, or a chat", () => {
    expect(isCheckBeforePraiseTurn([student("Is it 10?")])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM)])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student(LISTED)])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student("Give me a hint.")])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student("Is it 10?"), tutor(T2_REPLY), student(SHOW_ANSWER_MESSAGE)])).toBe(false);
    expect(isCheckBeforePraiseTurn([student("hello"), tutor("Hello! What would you like to work on today?"), student("I think it's fractions")])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q)])).toBe(false);
    expect(isCheckBeforePraiseTurn([student(PROBLEM), student("Is it 10?")])).toBe(false);
    expect(isCheckBeforePraiseTurn([])).toBe(false);
  });

  it("never fires on the same turn as the first-turn hold", () => {
    expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student(`${LISTED}\n`)])).toBe(false);
  });
});

// The frozen turn texts of both flows. T2 must fire whatever the T1 reply says; T1 and T3 must not.
const FLOWS: Array<[string, Array<{ id: string; t1: string; t2: string }>]> = [
  ["k12-flow", K12_ITEMS.map((x) => ({ id: x.id, t1: formatK12FlowT1(x), t2: formatK12FlowT2(x) }))],
  ["k12-flow-fr", K12_FR_ITEMS.map((x) => ({ id: x.id, t1: formatK12FlowFrT1(x), t2: formatK12FlowFrT2(x) }))],
];

describe("the frozen k12-flow and k12-flow-fr turn texts", () => {
  it("covers all 240 multiple-choice and 81 free-response items", () => {
    expect(FLOWS.map(([, items]) => items.length)).toEqual([240, 81]);
  });

  describe.each(FLOWS)("%s", (_name, items) => {
    it("T2 fires after any T1 reply: one that asks, one that asks nothing, one with a number", () => {
      for (const { id, t1, t2 } of items) {
        for (const reply of [T1_REPLY, T2_REPLY_FLAT, HINT_Q]) {
          expect(isCheckBeforePraiseTurn([student(t1), tutor(reply), student(t2)]), `${id} / ${reply}`).toBe(true);
        }
      }
    });

    it("T1 does not fire, as a first message or after another problem's turn", () => {
      for (const { id, t1 } of items) {
        expect(isCheckBeforePraiseTurn([student(t1)]), id).toBe(false);
        expect(isCheckBeforePraiseTurn([student(PROBLEM), tutor(HINT_Q), student(t1)]), id).toBe(false);
      }
    });

    it("T3 (the show-answer chip) does not fire", () => {
      for (const { id, t1, t2 } of items) {
        expect(isCheckBeforePraiseTurn([student(t1), tutor(T1_REPLY), student(t2), tutor(T2_REPLY), student(K12_FLOW_T3)]), id).toBe(false);
      }
    });
  });
});

describe("the note", () => {
  it("goes after the student's text, separated by a blank line, and is plain LF text", () => {
    expect(withCheckBeforePraise("Is it 10?")).toBe(`Is it 10?\n\n${CHECK_BEFORE_PRAISE_NOTE}`);
    expect(CHECK_BEFORE_PRAISE_NOTE).not.toContain("\r");
    expect(CHECK_BEFORE_PRAISE_NOTE.startsWith("<tutor_note>\n")).toBe(true);
    expect(CHECK_BEFORE_PRAISE_NOTE.endsWith("\n</tutor_note>")).toBe(true);
  });

  it("says to check first, not to open with praise, to name a correct step, and to hint without the answer", () => {
    expect(CHECK_BEFORE_PRAISE_NOTE).toContain("Check their answer against the problem yourself before you judge it.");
    expect(CHECK_BEFORE_PRAISE_NOTE).toContain("Do not open with praise or say it is correct unless you have checked that it is the final answer to the question asked.");
    expect(CHECK_BEFORE_PRAISE_NOTE).toContain("say that it is a correct step but not yet the answer");
    expect(CHECK_BEFORE_PRAISE_NOTE).toContain("say so kindly and give one hint, without giving the answer");
  });

  it("is short: 113 tokens by the kernel's estimate, about the size of the first-turn hold note", () => {
    // estTokens is ~4 characters a token. The hold note estimates 103 and cost about 104 prompt tokens
    // on the dev runs (docs/BENCHMARKS.md, lever 9a).
    expect(estTokens(CHECK_BEFORE_PRAISE_NOTE)).toBe(113);
    expect(estTokens(FIRST_TURN_HOLD_NOTE)).toBe(103);
  });
});

// ── Through tutorEngine.run ──────────────────────────────────────────────────────────────────────

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills("explain", "Mathematics", "tiny", false);
// The k12-flow course shape: no stored instructions, no persona, no syllabus.
const SYSTEM = buildSystemPrompt({}, null, 1, "Mathematics", skillSuffix, undefined, personaIdentityLayer(null));

/** One turn through the kernel; what it sent the model. */
async function request(history: Sent, userText: string): Promise<Sent> {
  sent.length = 0;
  await tutorEngine.run(
    { messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: userText }], config: CONFIG, retrieval: "off", onText: () => {} },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: false,
    },
  );
  expect(sent).toHaveLength(1); // no model call added
  return sent[0];
}

beforeEach(() => { sent.length = 0; });

describe.each(FLOWS)("tutorEngine.run on every %s conversation", (name, items) => {
  it("sends T2 with the note after the try, and T1 and T3 as without the lever; system prompt byte-identical", async () => {
    for (const { id, t1, t2 } of items) {
      const h1: Sent = [];
      const h2: Sent = [student(t1), tutor(T1_REPLY)];
      const h3: Sent = [...h2, student(t2), tutor(T2_REPLY)];
      const r1 = await request(h1, t1);
      const r2 = await request(h2, t2);
      const r3 = await request(h3, K12_FLOW_T3);
      // T1: what the caller passed, plus the first-turn hold on a lettered list (the B arm's request).
      const t1Sent = name === "k12-flow" ? withFirstTurnHold(t1) : t1;
      expect(r1.slice(1), id).toEqual([student(t1Sent)]);
      // T2: the caller's history unchanged, the try plus the note; nothing else differs.
      expect(r2[0].content, id).toBe(r1[0].content);
      expect(r2.slice(1), id).toEqual([...h2, student(withCheckBeforePraise(t2))]);
      // T3: what the caller passed. The note was never saved, so the history has none.
      expect(r3.slice(1), id).toEqual([...h3, student(K12_FLOW_T3)]);
      expect(r3.some((m) => m.content.includes(CHECK_BEFORE_PRAISE_NOTE)), id).toBe(false);
    }
  }, 120_000);
});

describe("tutorEngine.run, the check turn", () => {
  it("pins the T2 user message, the same bytes on any checkout", async () => {
    const r = await request([student(formatK12FlowFrT1(K12_FR_ITEMS[0])), tutor(T1_REPLY)], "I think it's 12.");
    const last = r[r.length - 1].content;
    expect(last).not.toContain("\r");
    expect(last).toMatchSnapshot();
  });

  it("leaves a request, a chat and a new problem untouched", async () => {
    for (const [history, text] of [
      [[student(PROBLEM), tutor(HINT_Q)], "Give me a hint."],
      [[student("hello"), tutor("Hello! What would you like to work on today?")], "I think it's fractions"],
      [[student(PROBLEM), tutor(HINT_Q)], PROBLEM],
    ] as Array<[Sent, string]>) {
      const r = await request(history, text);
      expect(r.slice(1), text).toEqual([...history, student(text)]);
    }
  });
});
