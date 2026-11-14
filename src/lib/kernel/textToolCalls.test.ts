import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// A tool call the model wrote as reply text, through the real kernel (tutorEngine.run, the function
// ChatTab calls) and llm.ts's Ollama stream. Only Ollama is fake, and the streaming chunks are small so
// the call text arrives split across many of them, as it does from a real model.
//
// The replies are gemma4:e2b's own, copied from the B9 readiness run (2026-11-13, rows fc02, mm02,
// mm06, mm17, d01): Ollama passed each call through as text, so nothing ran and the child saw it.
// Promised here:
//   - no state of the streamed reply, and not the saved text, ever holds the call syntax or a gemma4
//     control token; everything else in the reply (LaTeX, a Mermaid fence) is kept byte for byte;
//   - a call to a tool offered this turn is dispatched like a native call: zod validation, then the
//     permission gate (the confirm card for a write tool), and the model is called again with the
//     result; the text it wrote after the call is not shown;
//   - a call to a tool not offered this turn is dropped and nothing runs.

vi.mock("@tauri-apps/plugin-http", () => import("../eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig } from "../../types";

const FC02 = "I will save a flashcard for you. This will help you remember important ideas.\n\nflashcard.create{front:<|\"|>What is the divisor in division?<|\"|>,back:<|\"|>The divisor is how many groups you are splitting things into.<|\"|>,subtopic_id:<|\"|>Division as Sharing<|\"|>}";
const MM02 = "That is correct. Each friend gets 5 crayons. You correctly found the quotient.\n\nYou used the words dividend, divisor, and quotient well. This shows you understand division as sharing.\n\nI think you have a good grasp of this topic.\n\nprogress.mark_mastered{status:<|\"|>mastered<|\"|>,subtopic_id:<|\"|>Division as Sharing<|\"|>}<tool_call|>";
const MM06 = "Your calculation for the box is correct.\n\nYou correctly used the formula for the volume of a prism: length times width times height. That is $5 \\times 4 \\times 2 = 40$ cubic centimeters.\n\nThis shows you understand how to find the volume of a prism.\n\nprogress.mark_mastered{status:<|\"|>mastered<|\"|>,subtopic_id:<|\"|>Volume of Prisms<|\"|>}<tool_call|>";
const MM17_BEFORE = "That is a very good description of the parts of an atom! You correctly identified that protons are positive, neutrons are neutral, and electrons are negative, and you know they are located in different parts of the atom.\n\nYou also correctly explained what isotopes are—atoms with the same number of protons but different numbers of neutrons.\n\nSince you've shown a solid understanding of the basic components of an atom and isotopes, I think we can mark that as mastered.\n\n";
const MM17_AFTER = "\n\nYou have successfully demonstrated a good understanding of the subtopic \"Atomic Structure.\" Would you like to move on to the next topic, or would you like to practice something related to atoms?";
const MM17 = `${MM17_BEFORE}progress.mark_mastered{status:<|"|>mastered<|"|>,subtopic_id:<|"|>Atomic Structure<|"|>}${MM17_AFTER}`;
const D01 = "I can draw a flowchart for an if/else statement. This will show the steps of that control flow.\n\nHere is the flowchart showing how an if/else statement works:\n\n```mermaid\ngraph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n    B -- No --> D[Execute the 'else' block];\n    C --> E[End];\n    D --> E;\n```\n\nThis flowchart shows the steps of an if/else statement. It starts, checks a condition, and then follows one path based on whether the condition is true or false.\n\nDo you want to try writing a small Python program that uses an if statement next?";

// The reply with its call line removed: what the child should see when nothing runs.
const prose = (reply: string) => reply.slice(0, reply.search(/(?:flashcard\.create|progress\.mark_mastered)\{/));

// What must never reach the screen or the transcript.
const MACHINERY = /<\||\|>|mark_mastered|flashcard\.create|\{status|\{front|subtopic_id/;

const CONFIG = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;

type Msg = { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
let replies: string[] = [];
let chat: Array<{ messages: Msg[]; tools?: unknown[] }> = [];

// Ollama's /api/chat stream: the reply in 3-character content chunks, one NDJSON line each.
function stream(text: string): Response {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += 3) lines.push(JSON.stringify({ message: { role: "assistant", content: text.slice(i, i + 3) }, done: false }));
  lines.push(JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }));
  return new Response(lines.map((l) => `${l}\n`).join(""), { status: 200 });
}

async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname !== "/api/chat") return new Response("not found", { status: 404 }); // /api/ps: load state unknown
  chat.push(JSON.parse(String(init?.body)));
  const next = replies.shift();
  if (next === undefined) throw new Error(`unscripted /api/chat request #${chat.length}`);
  return stream(next);
}

interface Run {
  result: TutorTurnResult;
  shown: string[]; // the streamed reply after every onText call
  confirms: Array<{ tool: string; summary: string }>;
}

async function run(mode: string, scripted: string[], opts: { approve?: boolean } = {}): Promise<Run> {
  replies = [...scripted];
  chat = [];
  const shown: string[] = [];
  const confirms: Run["confirms"] = [];
  let text = "";
  const { activeSkill, domainSkill } = chatTurnSkills(mode, "Math", "tiny", true);
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: "Here is my answer." }],
      config: CONFIG,
      retrieval: "off",
      onText: (chunk) => { text += chunk; shown.push(text); },
    },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
      confirmTool: async (tool, summary) => { confirms.push({ tool, summary }); return opts.approve ?? false; },
    },
  );
  expect(replies, "every scripted reply was used").toHaveLength(0);
  expect(shown[shown.length - 1] ?? "", "what streamed is what the turn returns").toBe(result.text);
  return { result, shown, confirms };
}

function expectClean(r: Run) {
  for (const state of r.shown) expect(state).not.toMatch(MACHINERY);
  expect(r.result.text).not.toMatch(MACHINERY);
}

beforeAll(() => {
  globalThis.fetch = fakeOllama as typeof fetch;
  registerBuiltinTools();
});
beforeEach(() => { replies = []; chat = []; });

describe("a tool call written as text, for a tool not offered this turn", () => {
  it.each([
    ["fc02", FC02],
    ["mm02", MM02],
    ["mm06", MM06],
  ])("%s: the child sees the reply without the call, at every point of the stream, and nothing runs", async (_id, reply) => {
    // Explain mode offers only the read tools: neither flashcard.create nor progress.mark_mastered.
    const r = await run("explain", [reply]);
    expectClean(r);
    expect(r.result.text).toBe(prose(reply));
    expect(r.result.toolCalls).toEqual([]);
    expect(r.confirms).toEqual([]);
    expect(chat).toHaveLength(1);
  });

  it("mm17: the text the model wrote after the call is kept when nothing runs", async () => {
    const r = await run("explain", [MM17]);
    expectClean(r);
    expect(r.result.text).toBe(MM17_BEFORE + MM17_AFTER);
  });

  it("the full gemma4 frame (<|tool_call>call:…) is dropped too, and a word held back at the end is still shown", async () => {
    // The opener Ollama needs to see a call, with the fc02 call inside. "math" could have been the start
    // of math.render{ until the stream ended.
    const call = FC02.slice(FC02.indexOf("flashcard."));
    const r = await run("explain", [`Good work.<|tool_call>call:${call}<tool_call|> Next we try math`]);
    expectClean(r);
    expect(r.result.text).toBe("Good work. Next we try math");
  });

  it("d01 + the mm02 call: the Mermaid fence (B{Condition?}) is kept byte for byte, the call is not", async () => {
    const reply = `${D01}\n\n${MM02.slice(MM02.indexOf("progress."))}`;
    const r = await run("explain", [reply]);
    expectClean(r);
    expect(r.result.text).toBe(`${D01}\n\n`);
  });
});

describe("a tool call written as text, for a tool offered this turn", () => {
  it("mm02 in assess mode: validated, sent to the confirm card, and the model hears the answer", async () => {
    const r = await run("assess", [MM02, "Let's keep practicing division."]);
    expectClean(r);
    // progress.mark_mastered writes, so the default rules ask first. Declined here, so nothing is written.
    expect(r.confirms.map((c) => c.tool)).toEqual(["progress.mark_mastered"]);
    expect(r.result.toolCalls).toEqual([
      { name: "progress.mark_mastered", args: { status: "mastered", subtopic_id: "Division as Sharing" }, ok: false, fromText: true },
    ]);
    // The second request carries the call as a real tool call and its result, as for a native call.
    expect(chat).toHaveLength(2);
    const sent = chat[1].messages;
    const call = sent.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(call?.tool_calls?.[0].function).toEqual({ name: "progress.mark_mastered", arguments: { status: "mastered", subtopic_id: "Division as Sharing" } });
    expect(call?.content).toBe(prose(MM02));
    expect(sent[sent.length - 1]).toMatchObject({ role: "tool", content: "ERROR: The student declined to let progress.mark_mastered run." });
    expect(r.result.text).toBe(`${prose(MM02)}Let's keep practicing division.`);
  });

  it("mm17 in assess mode: the text after the call is not shown, since the tool has not answered yet", async () => {
    const r = await run("assess", [MM17, "Let's look at the next topic."]);
    expectClean(r);
    expect(r.confirms.map((c) => c.tool)).toEqual(["progress.mark_mastered"]);
    expect(r.result.text).toBe(`${MM17_BEFORE}Let's look at the next topic.`);
  });

  it("fc02 in review mode: the card the confirm shows is the model's own front", async () => {
    const r = await run("review", [FC02, "Okay, I won't save it."]);
    expectClean(r);
    expect(r.confirms).toEqual([{ tool: "flashcard.create", summary: "The card: “What is the divisor in division?”" }]);
    expect(r.result.toolCalls.map((c) => [c.name, c.fromText])).toEqual([["flashcard.create", true]]);
  });

  it("arguments the tool's schema rejects are refused before the permission gate, as a native call's are", async () => {
    const bad = MM02.replace("<|\"|>mastered<|\"|>", "<|\"|>done<|\"|>");
    const r = await run("assess", [bad, "Let's try another one."]);
    expectClean(r);
    expect(r.confirms).toEqual([]);
    expect(r.result.toolCalls).toMatchObject([{ name: "progress.mark_mastered", ok: false, fromText: true }]);
    expect(chat[1].messages[chat[1].messages.length - 1]?.content).toMatch(/^ERROR: Invalid arguments for progress\.mark_mastered: status:/);
  });
});
