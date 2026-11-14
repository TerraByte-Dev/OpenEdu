import { describe, it, expect, vi, beforeEach } from "vitest";

// The assess-mode answer check through the real kernel (tutorEngine.run, the function ChatTab calls):
// the student's answer to the tutor's question in a mastery check gets a verdict from code before the
// reply is written, the reply is told it, and what the reply says against it never reaches the child.
// Stand-ins: the model calls (callLLMTurn for the reply, callLLMStructured for the key and grading
// calls) and the database writes behind progress.mark_mastered.
//
// The conversations are written for this test. None comes from an eval set. They run the way the app
// runs them: the student taps "Check if I've got this." (assess mode on that one turn), the tutor asks,
// and the answer arrives in the default mode, since the chat resets the mode after every send. Some
// also run with assess mode on the answer turn, as an eval runner does.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" };

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const replies: Sent[] = [];
// The tool calls each model call's messages record, as the model reads them back.
const recordedCalls: unknown[][] = [];
let script: TurnEvent[][] = [];
const structured: Array<{ tool: string; messages: Sent; opts: { validate?: (o: unknown) => string[] } }> = [];
let keyOut: unknown = null;
let gradeOut: unknown = null;

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    replies.push(messages.map((m) => ({ role: m.role, content: m.content })));
    recordedCalls.push((messages as Array<{ tool_calls?: unknown[] }>).flatMap((m) => m.tool_calls ?? []));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
  callLLMStructured: vi.fn(async (messages: Sent, _config: unknown, opts: { toolName: string; validate?: (o: unknown) => string[] }) => {
    structured.push({ tool: opts.toolName, messages, opts });
    const out = opts.toolName === "AnswerKey" ? keyOut : gradeOut;
    if (out instanceof Error) throw out;
    return out;
  }),
}));

const marks: Array<{ id: string; status: string }> = [];
vi.mock("../progress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../progress")>()),
  setSubtopicStatus: vi.fn(async (_c: string, _s: unknown, id: string, status: string) => { marks.push({ id, status }); return { found: true, changed: true, title: "Times Tables" }; }),
  updateUserProgress: vi.fn(async () => {}),
  refreshProgressContext: vi.fn(async () => {}),
}));
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getSyllabus: vi.fn(async () => null),
}));

import { tutorEngine, MASTERY_REFUSED, CARD_REFUSED, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { answerCheckNote, asksForMasteryCheck, KEY_INSTRUCTION } from "./answerCheck";
import { ASSESS_MESSAGE } from "./suggestions";
import { CHECK_BEFORE_PRAISE_NOTE } from "./checkBeforePraise";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig, Syllabus } from "../../types";
import type { AskChoice } from "../tools/EduTool";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const SYSTEM = "You are a tutor.";
const SYLLABUS = { level: 1, subtopics: [{ id: "1.1", title: "Times Tables", key_concepts: [], practice_type: "recall", mastered: false }] } as unknown as Syllabus;
const student = (content: string) => ({ role: "user", content });
const tutor = (content: string) => ({ role: "assistant", content });

// A reply streamed in 3-character pieces, as a real model streams it.
const reply = (text: string): TurnEvent[] => [
  ...Array.from({ length: Math.ceil(text.length / 3) }, (_, i) => ({ type: "text" as const, delta: text.slice(i * 3, i * 3 + 3) })),
  { type: "done", finishReason: "stop" },
];
const markCall = (status: string): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name: "progress.mark_mastered", args: { subtopic_id: "1.1", status } },
  { type: "done", finishReason: "tool_calls" },
];
const askCall = (question: string, labels: string[], before = ""): TurnEvent[] => [
  ...(before ? reply(before).slice(0, -1) : []),
  { type: "tool_call", id: "call_0", name: "ask_user.question", args: { question, choices: labels.map((label, i) => ({ label, value: `c${i}` })) } },
  { type: "done", finishReason: "tool_calls" },
];

interface Run { result: TutorTurnResult; shown: string[]; confirms: string[]; cards: Array<{ question: string; choices: AskChoice[] }> }

async function answer(history: Sent, text: string, mode = "explain"): Promise<Run> {
  const { activeSkill, domainSkill } = chatTurnSkills(mode, "Arithmetic", "tiny", true);
  const shown: string[] = [];
  const confirms: string[] = [];
  const cards: Run["cards"] = [];
  let streamed = "";
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: SYSTEM }, ...history, student(text)],
      config: CONFIG, retrieval: "off",
      onText: (chunk) => { streamed += chunk; shown.push(streamed); },
    },
    {
      courseId: "c-1", level: 1, syllabus: SYLLABUS, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
      confirmTool: async (tool) => { confirms.push(tool); return true; },
      // The question card ChatTab shows; the student picks the first choice.
      askUser: async (question, choices) => { cards.push({ question, choices }); return choices[0].value; },
    },
  );
  expect(streamed, "what streamed is what the turn returns").toBe(result.text);
  return { result, shown, confirms, cards };
}

const lastUser = (sent: Sent) => sent.filter((m) => m.role === "user").pop()!.content;
// FALSE_PRAISE's claims, any of which on screen would tell the child a wrong answer is right.
const PRAISE = /is correct|great job|you got it\.|mastered/i;

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const Q_MULT = "Here is your first question. What is 6 x 8?";
const KEY_MULT = { question: "What is 6 x 8?", working: "6 x 8 = 48", answer: "48" };
const CHECK = [student(ASSESS_MESSAGE), tutor(Q_MULT)];

const Q_STRING = "A ribbon is cut into 6 pieces that are each 8 cm long. How long was the ribbon?";
const KEY_STRING = { question: "How long was the ribbon?", working: "6 x 8 = 48", answer: "48 cm" };

const Q_PLANTS = "Good. Next one: what gas do plants take in from the air to make their food?";
const KEY_PLANTS = { question: "what gas do plants take in from the air to make their food?", working: "Plants use carbon dioxide in photosynthesis.", answer: "carbon dioxide" };

const Q_MAMMAL = "Which of these animals is a mammal?\nA) shark\nB) dolphin\nC) trout";
const KEY_MAMMAL = { question: "Which of these animals is a mammal?", working: "A dolphin breathes air and feeds its young milk.", answer: "B) dolphin" };

const FALSE_PRAISE = "That is correct! Great job, you got it. You have mastered your times tables.";
const FALSE_DOUBT = "Not quite. Let's check: 6 x 8 is 48.";

beforeEach(() => {
  replies.length = 0;
  recordedCalls.length = 0;
  structured.length = 0;
  marks.length = 0;
  script = [];
  keyOut = KEY_MULT;
  gradeOut = null;
});

// ── A wrong answer is never called correct ──────────────────────────────────────────────────────

describe("a wrong answer in a mastery check", () => {
  it.each(["46", "forty-six", "it's 46", "I think it's 46?", "6 x 8 is 46 because 6 x 7 is 42", "46 cm"])(
    "%j: the reply is told it is wrong, and its praise never reaches the child",
    async (text) => {
      gradeOut = { student_answer: text, verdict: "incorrect" };
      script = [reply(FALSE_PRAISE)];
      const { result, shown } = await answer(CHECK, text);

      expect(result.answerCheck).toMatchObject({ key: "48", verdict: "incorrect", by: "code+model" });
      // The reply call got the verdict as a fact, after the student's words.
      expect(lastUser(replies[0])).toBe(`${text}\n\n${answerCheckNote(result.answerCheck!)}`);
      expect(lastUser(replies[0])).toContain("it is not correct");
      // No state of the stream, and not the saved text, says it is right.
      for (const s of shown) expect(s).not.toMatch(PRAISE);
      expect(result.text).toMatch(/^That's not right yet\./);
      expect(result.text).not.toMatch(/mastered/);
    },
  );

  it("6 x 8 is keyed by code: the only model call is the grader's", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    const { result } = await answer(CHECK, "46");
    expect(result.answerCheck).toMatchObject({ question: "What is 6 x 8?", key: "48" });
    expect(structured.map((c) => c.tool)).toEqual(["AnswerGrade"]);
  });

  it("the key call never sees the student's answer", async () => {
    keyOut = KEY_STRING;
    gradeOut = { student_answer: "46 cm", verdict: "incorrect" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], "46 cm");
    expect(result.answerCheck).toMatchObject({ key: "48 cm", verdict: "incorrect", by: "code+model" });
    const key = structured.find((c) => c.tool === "AnswerKey")!;
    expect(key.messages[0].content).toBe(KEY_INSTRUCTION);
    expect(key.messages.map((m) => m.content).join("\n")).not.toContain("46");
    expect(key.messages[1].content).toContain(Q_STRING);
  });

  it("a grader that agrees with the wrong answer does not make it correct: code and grader disagree, so the reply says neither", async () => {
    gradeOut = { student_answer: "46", verdict: "correct" };
    script = [reply(`${FALSE_PRAISE} Can you explain how you got it?`)];
    const { result } = await answer(CHECK, "46");
    expect(result.answerCheck).toMatchObject({ verdict: "unsure", by: "conflict" });
    expect(lastUser(replies[0])).toContain("could not check");
    expect(result.text).not.toMatch(PRAISE);
    expect(result.text).toContain("Can you explain how you got it?");
  });

  it("praise around a correction is trimmed, not the correction", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply("Great, but 6 x 8 is 48. Try 7 x 8 next.")];
    const { result } = await answer(CHECK, "46");
    expect(result.text).toBe("That's not right yet. 6 x 8 is 48. Try 7 x 8 next.");
  });

  it("a reply that already says it is wrong is left as it is", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    const text = "Not quite. 6 x 8 is 48, because 6 x 8 is 8 more than 6 x 7.";
    script = [reply(text)];
    expect((await answer(CHECK, "46")).result.text).toBe(text);
  });

  it("a reply left empty by the filter still gives the verdict", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply("Correct! Well done!")];
    expect((await answer(CHECK, "46")).result.text).toBe("That's not right yet.");
  });

  it("a progress.mark_mastered \"mastered\" call is refused by code; nothing is saved and the model is told", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [markCall("mastered"), reply("I have marked Times Tables as mastered. Keep going!")];
    const { result, confirms } = await answer(CHECK, "46", "assess");
    expect(result.toolCalls).toEqual([{ name: "progress.mark_mastered", args: { subtopic_id: "1.1", status: "mastered" }, ok: false }]);
    expect(confirms).toEqual([]);
    expect(marks).toEqual([]);
    expect(replies[1].find((m) => m.role === "tool")!.content).toBe(`ERROR: ${MASTERY_REFUSED}`);
    expect(result.text).not.toMatch(/mastered/);
  });

  it("a \"practiced\" mark still runs", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [markCall("practiced"), reply("Let's practice 6 x 8 a little more.")];
    const { result } = await answer(CHECK, "46", "assess");
    expect(result.toolCalls[0]).toMatchObject({ ok: true });
    expect(marks).toEqual([{ id: "1.1", status: "practiced" }]);
  });

  it("in assess mode too (an eval runner's turn), with no chip in the history", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply(FALSE_PRAISE)];
    const history = [student("Can you test me on times tables?"), tutor(Q_MULT)];
    const { result } = await answer(history, "46", "assess");
    expect(result.answerCheck?.verdict).toBe("incorrect");
    expect(result.text).not.toMatch(PRAISE);
  });
});

// ── A right answer is never called wrong ────────────────────────────────────────────────────────

describe("a right answer in a mastery check", () => {
  it.each(["48", "forty-eight", "it's 48", "Is it 48?", "I think it's 48.", "6 x 8 = 48", "48!", "6 x 8 is 48 because it is 8 sixes"])(
    "%j: correct by code, with no model call, and the reply's doubt never reaches the child",
    async (text) => {
      script = [reply(FALSE_DOUBT)];
      const { result, shown } = await answer(CHECK, text);
      expect(result.answerCheck).toMatchObject({ key: "48", verdict: "correct", by: "code" });
      expect(structured).toEqual([]);
      expect(lastUser(replies[0])).toContain("it is correct");
      for (const s of shown) expect(s).not.toMatch(/not quite/i);
      expect(result.text).toBe("That's right. Let's check: 6 x 8 is 48.");
    },
  );

  it("a reply that says it is right is left byte for byte", async () => {
    const text = "That's right! 6 x 8 is 48. Here is the next one: what is 7 x 8?";
    script = [reply(text)];
    expect((await answer(CHECK, "48")).result.text).toBe(text);
  });

  it.each([
    ["48 cm", "code"],
    ["48 centimeters", "code"],
    ["48", "code"],
  ])("units: %j against the key \"48 cm\" is correct by code, after the one key call", async (text, by) => {
    keyOut = KEY_STRING;
    script = [reply("That is wrong.")];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], text);
    expect(result.answerCheck).toMatchObject({ verdict: "correct", by });
    expect(structured.map((c) => c.tool)).toEqual(["AnswerKey"]);
    expect(result.text).toBe("That's right.");
  });

  it("the same length in metres is not called wrong by code: the grader decides", async () => {
    keyOut = KEY_STRING;
    gradeOut = { student_answer: "0.48 m", verdict: "correct" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], "0.48 m");
    expect(result.answerCheck).toMatchObject({ verdict: "correct", by: "model" });
  });

  it("a plain operation the model copied out of a message with no question mark is keyed by code too", async () => {
    keyOut = { question: "Calculate 6 x 8.", working: "6 x 8 = 48", answer: "46" };
    script = [reply("That is wrong.")];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("Next one. Calculate 6 x 8.")], "48");
    expect(structured.map((c) => c.tool)).toEqual(["AnswerKey"]);
    expect(result.answerCheck).toMatchObject({ key: "48", verdict: "correct", by: "code" });
  });

  it("a right answer with its working shown goes to the grader, and code agrees with the grader's copy", async () => {
    gradeOut = { student_answer: "48", verdict: "correct" };
    const { result } = await answer(CHECK, "I got 48 because 6 x 4 is 24 and double that is 48");
    expect(result.answerCheck).toMatchObject({ verdict: "correct", by: "code+model" });
  });

  it("a mastery claim stays when the mark was saved earlier in the turn", async () => {
    script = [markCall("mastered"), reply("I have marked Times Tables as mastered. You have mastered your times tables!")];
    const { result } = await answer(CHECK, "48", "assess");
    expect(marks).toEqual([{ id: "1.1", status: "mastered" }]);
    expect(result.text).toBe("I have marked Times Tables as mastered. You have mastered your times tables!");
  });

  it("a mastery claim with no mark saved is taken out, even after a right answer", async () => {
    script = [reply("That's right! You have mastered your times tables. Try 9 x 7 next.")];
    const { result } = await answer(CHECK, "48");
    expect(result.text).toBe("That's right! Try 9 x 7 next.");
    expect(result.removedClaims).toEqual([{ kind: "mastery", text: "You have mastered your times tables." }]);
  });
});

// ── Words, options, and what the grader decides ─────────────────────────────────────────────────

describe("answers code cannot settle alone", () => {
  const plants = [student(ASSESS_MESSAGE), tutor(Q_MULT), student("48"), tutor(Q_PLANTS)];

  it("the same words as the key: correct by code", async () => {
    keyOut = KEY_PLANTS;
    const { result } = await answer(plants, "carbon dioxide");
    expect(result.answerCheck).toMatchObject({ verdict: "correct", by: "code" });
  });

  it("other words for the key: the grader's verdict, and its doubt is taken out", async () => {
    keyOut = KEY_PLANTS;
    gradeOut = { student_answer: "CO2", verdict: "correct" };
    script = [reply("Not quite! Plants take in carbon dioxide, which is CO2.")];
    const { result } = await answer(plants, "CO2");
    expect(result.answerCheck).toMatchObject({ verdict: "correct", by: "model", studentAnswer: "CO2" });
    expect(structured.find((c) => c.tool === "AnswerGrade")!.messages[1].content).toBe("Question: what gas do plants take in from the air to make their food?\nAnswer key: carbon dioxide\nStudent's answer: CO2");
    expect(result.text).toBe("That's right. Plants take in carbon dioxide, which is CO2.");
  });

  it("a wrong word answer: the grader's verdict, and the praise is taken out", async () => {
    keyOut = KEY_PLANTS;
    gradeOut = { student_answer: "oxygen", verdict: "incorrect" };
    script = [reply("You are correct, plants need gases! You correctly named a gas in the air. I will mark that as mastered.")];
    const { result } = await answer(plants, "oxygen");
    expect(result.answerCheck).toMatchObject({ verdict: "incorrect", by: "model" });
    expect(result.text).toBe("That's not right yet.");
  });

  it("a partly right answer: whole praise goes, praise for the right part stays", async () => {
    keyOut = { question: "How many full boxes of 4 can you fill with 14 eggs, and how many eggs are left?", working: "14 = 3 x 4 + 2", answer: "3 boxes, 2 left over" };
    gradeOut = { student_answer: "3 boxes", verdict: "partly" };
    script = [reply("Correct! You correctly found the 3 full boxes. How many eggs are left over?")];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("How many full boxes of 4 can you fill with 14 eggs, and how many eggs are left?")], "3 boxes");
    expect(result.answerCheck?.verdict).toBe("partly");
    expect(result.text).toBe("That's partly right. You correctly found the 3 full boxes. How many eggs are left over?");
  });

  it.each([["B", "correct"], ["b) dolphin", "correct"], ["dolphin", "correct"]])("lettered options: %j is %s by code", async (text, verdict) => {
    keyOut = KEY_MAMMAL;
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_MAMMAL)], text);
    expect(result.answerCheck).toMatchObject({ verdict, by: "code" });
  });

  it("lettered options: another option is wrong by code and grader together", async () => {
    keyOut = KEY_MAMMAL;
    gradeOut = { student_answer: "C", verdict: "incorrect" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_MAMMAL)], "C");
    expect(result.answerCheck).toMatchObject({ verdict: "incorrect", by: "code+model" });
  });
});

// ── When the check cannot run, and when it does not ─────────────────────────────────────────────

describe("failures and turns that get no check", () => {
  it("a failed key call: unsure, and the reply says neither right nor wrong", async () => {
    keyOut = new Error("model returned no valid JSON");
    script = [reply("That is correct! Not quite, though. Can you show me how you worked it out?")];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], "46 cm");
    expect(result.answerCheck).toMatchObject({ key: "", verdict: "unsure", by: "failed" });
    expect(result.text).toBe("Can you show me how you worked it out?");
  });

  it("a key whose working does not add up is not used: the call is repaired, and failing that the verdict is unsure", async () => {
    keyOut = { ...KEY_STRING, working: "6 x 8 = 46", answer: "46 cm" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], "46 cm");
    const key = structured.find((c) => c.tool === "AnswerKey")!;
    expect(key.opts.validate!(keyOut)).toEqual(['Your working says "6 x 8 = 46", but 6 × 8 = 48, not 46. Work the question out again and fix "answer".']);
    expect(result.answerCheck).toMatchObject({ verdict: "unsure", by: "failed" });
  });

  it("a key whose question is not in the tutor's message is not used", async () => {
    keyOut = { question: "How many legs does a spider have?", working: "Spiders have 8 legs.", answer: "8" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor(Q_STRING)], "48 cm");
    expect(structured.find((c) => c.tool === "AnswerKey")!.opts.validate!(keyOut)).toEqual(['"question" must be copied word for word from the tutor\'s message.']);
    expect(result.answerCheck?.verdict).toBe("unsure");
  });

  it("the grader's copy of the answer must come from the student's message, in words or numbers", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    await answer(CHECK, "forty-six");
    const validate = structured.find((c) => c.tool === "AnswerGrade")!.opts.validate!;
    expect(validate({ student_answer: "46", verdict: "incorrect" })).toEqual([]);
    expect(validate({ student_answer: "forty six", verdict: "incorrect" })).toEqual([]);
    expect(validate({ student_answer: "48", verdict: "correct" })).toEqual(['"student_answer" must be copied from the student\'s answer.']);
  });

  it("a failed grading call: unsure", async () => {
    gradeOut = new Error("timed out");
    const { result } = await answer(CHECK, "46");
    expect(result.answerCheck).toMatchObject({ key: "48", verdict: "unsure", by: "failed" });
  });

  it("a message that asks nothing with one right answer gets no verdict, and the turn is as before", async () => {
    keyOut = { question: "", working: "", answer: "" };
    script = [reply("Great choice! Here is a question about it: what is 3 x 5?")];
    const history = [student(ASSESS_MESSAGE), tutor("Which topic would you like to be checked on: times tables or sharing?")];
    const { result } = await answer(history, "times tables");
    expect(result.answerCheck).toBeNull();
    expect(structured.map((c) => c.tool)).toEqual(["AnswerKey"]);
    expect(lastUser(replies[0])).toBe("times tables");
    expect(result.text).toBe("Great choice! Here is a question about it: what is 3 x 5?");
  });

  it.each(["Give me a hint.", "What does product mean?", "I don't know", "Can you explain it again?"])(
    "%j is not an answer: no model call is added", async (text) => {
      await answer(CHECK, text);
      expect(structured).toEqual([]);
      expect(lastUser(replies[0])).not.toContain("The app checked");
    },
  );

  it("outside a mastery check nothing is called and the reply is not touched, streamed as it came", async () => {
    const history = [student("Teach me times tables."), tutor("Sure! What is 6 x 8?")];
    // The system prompt asks the tutor to name what the record shows mastered; outside a check that stays.
    const text = "That is correct! Great job. Since you've mastered your 5s, the 6s come next.";
    script = [reply(text)];
    const { result, shown } = await answer(history, "46");
    expect(structured).toEqual([]);
    expect(result.answerCheck).toBeNull();
    // The check-before-praise note still governs this turn, as before.
    expect(lastUser(replies[0])).toBe(`46\n\n${CHECK_BEFORE_PRAISE_NOTE}`);
    expect(result.text).toBe(text);
    expect(result.removedClaims).toEqual([]);
    // Not held a sentence at a time: every 3-character piece showed as it arrived.
    expect(shown).toHaveLength(Math.ceil(text.length / 3));
  });

  it("on the chip's own turn a mastery claim is taken out, with no answer to check", async () => {
    script = [reply("Let's see what you know. You have mastered times tables already! What is 6 x 8?")];
    const { result } = await answer([student("Teach me times tables."), tutor("Times tables are groups of the same number.")], ASSESS_MESSAGE, "assess");
    expect(result.answerCheck).toBeNull();
    expect(result.text).toBe("Let's see what you know. What is 6 x 8?");
  });

  it("two questions in one message: code keys neither, and both answers go to the grader", async () => {
    keyOut = { question: "What is 7 x 9? What is 8 x 9?", working: "7 x 9 = 63; 8 x 9 = 72", answer: "63; 72" };
    gradeOut = { student_answer: "62 and 72", verdict: "partly" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("Two quick ones. What is 7 x 9? What is 8 x 9?")], "62 and 72");
    expect(structured.map((c) => c.tool)).toEqual(["AnswerKey", "AnswerGrade"]);
    expect(result.answerCheck).toMatchObject({ key: "63; 72", verdict: "partly" });
  });

  it("an operation with more after it is not keyed by code", async () => {
    keyOut = { question: "What is 5 + 3 and then double it?", working: "5 + 3 = 8, 8 x 2 = 16", answer: "16" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("What is 5 + 3 and then double it?")], "16");
    expect(structured.map((c) => c.tool)).toEqual(["AnswerKey"]);
    expect(result.answerCheck).toMatchObject({ key: "16", verdict: "correct", by: "code" });
  });

  it("the chip's own turn is not an answer, and a check opened more than four answers ago has ended", async () => {
    await answer([student("Teach me times tables."), tutor("What is 6 x 8?")], ASSESS_MESSAGE, "assess");
    expect(structured).toEqual([]);
    const old = [student(ASSESS_MESSAGE), tutor("Q1?"), student("a"), tutor("Q2?"), student("b"), tutor("Q3?"), student("c"), tutor("Q4?"), student("d"), tutor(Q_MULT)];
    await answer(old, "46");
    expect(structured).toEqual([]);
  });

  it("an eval can turn the check off", async () => {
    const { activeSkill, domainSkill } = chatTurnSkills("explain", "Arithmetic", "tiny", true);
    const result = await tutorEngine.run(
      { messages: [{ role: "system", content: SYSTEM }, ...CHECK, student("46")], config: CONFIG, retrieval: "off", onText: () => {}, answerCheck: "off" },
      { courseId: "c-1", level: 1, syllabus: SYLLABUS, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG, abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true },
    );
    expect(structured).toEqual([]);
    expect(result.answerCheck).toBeNull();
  });
});

// ── Gaps a review of the first version found (2026-11-14) ───────────────────────────────────────
// The replies are a reviewer's hand-written probes, reworded for 6 x 8, and replies made up here.

describe("praise the first version let through, in a whole turn", () => {
  it.each([
    "Great job, can you tell me how you got 46?",
    "That's correct, so what is 7 x 8?",
    "46 is correct!",
    "Your answer of 46 is correct.",
    "Yes 46 is right.",
    "That answer is correct.",
    "🎉 Correct!",
    "✅ Correct\n",
    "Great answer!",
    "You figured it out!",
    "That's spot-on!",
    "Very good!",
    "¡Muy bien!",
  ])("%j after a wrong answer never reaches the child", async (praise) => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply(`${praise}${praise.endsWith("\n") ? "" : " "}Let's look at 6 x 8 together.`)];
    const { result, shown } = await answer(CHECK, "46");
    expect(result.answerCheck?.verdict).toBe("incorrect");
    for (const s of shown) expect(s).not.toMatch(/correct!|is correct|is right|great|very good|figured|spot-on|muy bien|🎉|✅/i);
    expect(result.text).toMatch(/^That's not right yet\.\s(?:Can you tell me how you got 46\? |What is 7 x 8\? )?Let's look at 6 x 8 together\.$/);
  });

  it("a reply that teaches, with words close to praise, comes through byte for byte", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    const text = "Not quite. Good question to ask, though! The correct answer is 48, and 8 x 6 = 48 is correct too. " +
      "Let's make sure we multiply correctly: 6 x 8 is 8 more than 6 x 7. Can you tell me how you got 46? Try again with 6 x 7 = 42 in mind.";
    script = [reply(text)];
    const { result } = await answer(CHECK, "46");
    expect(result.text).toBe(text);
    expect(result.removedClaims).toEqual([]);
  });

  it("two questions, partly right: a true word about the first answer stays", async () => {
    keyOut = { question: "What is 7 x 9? What is 8 x 9?", working: "7 x 9 = 63; 8 x 9 = 72", answer: "63; 72" };
    gradeOut = { student_answer: "63 and 71", verdict: "partly" };
    const text = "You got the first one right, but the second one is wrong. Your first answer was correct, so look again at 8 x 9.";
    script = [reply(text)];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("Two quick ones. What is 7 x 9? What is 8 x 9?")], "63 and 71");
    expect(result.text).toBe(text);
  });

  it("two questions, wrong: the app's verdict covers both answers, so a word praising one of them is taken out", async () => {
    keyOut = { question: "What is 7 x 9? What is 8 x 9?", working: "7 x 9 = 63; 8 x 9 = 72", answer: "63; 72" };
    gradeOut = { student_answer: "62 and 71", verdict: "incorrect" };
    script = [reply("Your first answer is correct. Look again at 8 x 9.")];
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("Two quick ones. What is 7 x 9? What is 8 x 9?")], "62 and 71");
    expect(result.text).toBe("That's not right yet. Look again at 8 x 9.");
  });

  it("a right answer: \"try it again with\" a new one is not doubt, a question asking for another go is", async () => {
    script = [reply("That's right! Let's try it again with 7 x 8. Can you try again?")];
    const { result } = await answer(CHECK, "48");
    expect(result.text).toBe("That's right! Let's try it again with 7 x 8.");
  });

  it("a mastery claim the first version let through is taken out", async () => {
    script = [reply("That's right! I can see you've mastered this! Now you can say you've mastered it! What is 7 x 8?")];
    const { result } = await answer(CHECK, "48");
    expect(result.text).toBe("That's right! What is 7 x 8?");
  });
});

describe("a mastery check the student types", () => {
  it.each(["Check if I've got this", "quiz me", "Test me on times tables.", "Can you check if I mastered times tables?", "Am I ready for the test?", "Okay, can you quiz me on this?"])(
    "%j opens a check: the answer after it gets a verdict, and its praise is taken out",
    async (request) => {
      expect(asksForMasteryCheck(request)).toBe(true);
      gradeOut = { student_answer: "46", verdict: "incorrect" };
      script = [reply(FALSE_PRAISE)];
      const { result } = await answer([student(request), tutor(Q_MULT)], "46");
      expect(result.answerCheck).toMatchObject({ key: "48", verdict: "incorrect" });
      expect(result.text).not.toMatch(PRAISE);
    },
  );

  it.each(["Can you check my spelling?", "Can you check this sentence?", "Check if I got this right", "My teacher will quiz me tomorrow, can you help?", "Don't quiz me yet."])(
    "%j does not", async (request) => {
      expect(asksForMasteryCheck(request)).toBe(false);
      script = [reply("That is correct! Great job.")];
      const { result } = await answer([student(request), tutor(Q_MULT)], "46");
      expect(structured).toEqual([]);
      expect(result.answerCheck).toBeNull();
      expect(result.text).toBe("That is correct! Great job.");
    },
  );

  it("the request's own turn takes a mastery claim out, and the request is never read as an answer", async () => {
    script = [reply("You have mastered times tables already! What is 6 x 8?")];
    const { result } = await answer([student("Teach me times tables."), tutor(Q_MULT)], "Can you test me on times tables?");
    expect(structured).toEqual([]);
    expect(result.answerCheck).toBeNull();
    expect(result.text).toBe("What is 6 x 8?");
  });
});

describe("an ask_user.question card in a mastery check", () => {
  it("after a wrong answer, its praise is taken out before the child sees it, and the model's record holds what was shown", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [askCall("Correct! Ready for the next one?", ["Yes!", "Great job, next one"]), reply("Great job! What is 7 x 8?")];
    const { result, cards } = await answer(CHECK, "46", "assess");
    expect(cards).toEqual([{ question: "That's not right yet. Ready for the next one?", choices: [{ label: "Yes!", value: "c0" }, { label: "Next one", value: "c1" }] }]);
    expect(result.toolCalls[0]).toMatchObject({ name: "ask_user.question", ok: true, args: { question: "That's not right yet. Ready for the next one?" } });
    expect(recordedCalls[1]).toEqual([{ id: "0_call_0", name: "ask_user.question", args: { question: "That's not right yet. Ready for the next one?", choices: [{ label: "Yes!", value: "c0" }, { label: "Next one", value: "c1" }] } }]);
    // The reply said the verdict through the card, so no second line.
    expect(result.text).toBe("What is 7 x 8?");
  });

  it("a card left with no question is not shown, and the model is told", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [askCall("Well done!", ["Next", "Stop"], "Not quite. 6 x 8 is 48."), reply("Want to try 7 x 8?")];
    const { result, cards } = await answer(CHECK, "46", "assess");
    expect(cards).toEqual([]);
    expect(result.toolCalls[0]).toMatchObject({ name: "ask_user.question", ok: false });
    expect(replies[1].find((m) => m.role === "tool")!.content).toBe(`ERROR: ${CARD_REFUSED}`);
    expect(result.text).toBe("Not quite. 6 x 8 is 48.Want to try 7 x 8?");
  });

  it("on the check's opening turn, a mastery claim in the card is taken out", async () => {
    script = [askCall("You have mastered sharing! Which topic should we check next?", ["Times tables", "Sharing"]), reply("What is 6 x 8?")];
    const { cards } = await answer([student("Teach me times tables."), tutor("Times tables are groups of the same number.")], ASSESS_MESSAGE, "assess");
    expect(cards[0].question).toBe("Which topic should we check next?");
  });

  it("after a wrong answer, a card the child sees before any text leads with the verdict, and the text after it does not repeat it", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [askCall("What is 6 x 7?", ["42", "48"]), reply("Now add one more 6.")];
    const { result, cards } = await answer(CHECK, "46", "assess");
    expect(cards[0].question).toBe("That's not right yet. What is 6 x 7?");
    expect(result.text).toBe("Now add one more 6.");
  });

  it("a card with nothing to take out is shown as the model wrote it", async () => {
    script = [askCall("Which topic should we check?", ["Times tables", "Sharing"]), reply("What is 6 x 8?")];
    const { cards } = await answer([student("Teach me times tables."), tutor("Times tables are groups of the same number.")], ASSESS_MESSAGE, "assess");
    expect(cards).toEqual([{ question: "Which topic should we check?", choices: [{ label: "Times tables", value: "c0" }, { label: "Sharing", value: "c1" }] }]);
  });
});

// ── A wrong answer the reply never calls wrong (B9 rerun 2, gemma4:e2b) ─────────────────────────
// The app's verdict was right on 53 of 55 wrong answers, yet about 9 replies never told the child: they
// re-explained, moved on, or answered question 1 when the child was answering question 2. The replies
// below are excerpts from that run, reworded for the fixtures here.

describe("a wrong answer the reply never calls wrong", () => {
  it.each([
    "I see you are thinking about how to share things equally. What is 6 x 8?",
    "You said a proton has no charge. Let's look at the question again.",
    "The answer is 16.",
  ])("%j: the child sees the verdict first, from the first piece shown", async (text) => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply(text)];
    const { result, shown } = await answer(CHECK, "46");
    expect(result.text).toBe(`That's not right yet. ${text}`);
    for (const s of shown) expect(s.startsWith("That's not right yet.")).toBe(true);
  });

  it("not after a right answer", async () => {
    script = [reply("The answer is 16.")];
    expect((await answer(CHECK, "48")).result.text).toBe("The answer is 16.");
  });

  it("an empty reply gets the fallback once, not the line twice", async () => {
    gradeOut = { student_answer: "46", verdict: "incorrect" };
    script = [reply("")];
    expect((await answer(CHECK, "46")).result.text).toBe("That's not right yet. Want to try again?");
  });

  it("the reply is told which question the child answered", async () => {
    keyOut = { question: "What is 4 x 5?", working: "4 x 5 = 20", answer: "20" };
    gradeOut = { student_answer: "16", verdict: "incorrect" };
    const { result } = await answer([student(ASSESS_MESSAGE), tutor("Good. Question 1: What is 2 x 8? Question 2: What is 4 x 5?")], "16");
    expect(result.answerCheck).toMatchObject({ question: "What is 4 x 5?", verdict: "incorrect" });
    expect(lastUser(replies[0])).toContain("The question was: What is 4 x 5?\n");
  });

  it("with no question copied (a failed key call), no question line", async () => {
    keyOut = new Error("timeout");
    await answer([student(ASSESS_MESSAGE), tutor(Q_PLANTS)], "oxygen");
    expect(lastUser(replies[0])).not.toContain("The question was");
  });
});
