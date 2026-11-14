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
//   - progress.mark_mastered never runs from text; a write tool runs only inside gemma4's own tool
//     tokens; a read-only tool may run from bare text. What runs is dispatched like a native call: zod
//     validation, the permission gate, the model called again with the result. The text the model
//     wrote after that call is not shown;
//   - a call that never closes hides nothing but its own first line;
//   - a call to a tool not offered this turn is removed and nothing runs.

vi.mock("@tauri-apps/plugin-http", () => import("../eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { ReplyTextFilter, displayReplyText, HOLD_CAP } from "./textToolCalls";
import { registerBuiltinTools, toolRegistry } from "../tools";
import { MIXED_UP_REPLY } from "../plain-language";
import type { LLMConfig } from "../../types";

const FC02 = "I will save a flashcard for you. This will help you remember important ideas.\n\nflashcard.create{front:<|\"|>What is the divisor in division?<|\"|>,back:<|\"|>The divisor is how many groups you are splitting things into.<|\"|>,subtopic_id:<|\"|>Division as Sharing<|\"|>}";
const MM02 = "That is correct. Each friend gets 5 crayons. You correctly found the quotient.\n\nYou used the words dividend, divisor, and quotient well. This shows you understand division as sharing.\n\nI think you have a good grasp of this topic.\n\nprogress.mark_mastered{status:<|\"|>mastered<|\"|>,subtopic_id:<|\"|>Division as Sharing<|\"|>}<tool_call|>";
const MM06 = "Your calculation for the box is correct.\n\nYou correctly used the formula for the volume of a prism: length times width times height. That is $5 \\times 4 \\times 2 = 40$ cubic centimeters.\n\nThis shows you understand how to find the volume of a prism.\n\nprogress.mark_mastered{status:<|\"|>mastered<|\"|>,subtopic_id:<|\"|>Volume of Prisms<|\"|>}<tool_call|>";
const MM17_BEFORE = "That is a very good description of the parts of an atom! You correctly identified that protons are positive, neutrons are neutral, and electrons are negative, and you know they are located in different parts of the atom.\n\nYou also correctly explained what isotopes are—atoms with the same number of protons but different numbers of neutrons.\n\nSince you've shown a solid understanding of the basic components of an atom and isotopes, I think we can mark that as mastered.\n\n";
const MM17_AFTER = "\n\nYou have successfully demonstrated a good understanding of the subtopic \"Atomic Structure.\" Would you like to move on to the next topic, or would you like to practice something related to atoms?";
const MM17 = `${MM17_BEFORE}progress.mark_mastered{status:<|"|>mastered<|"|>,subtopic_id:<|"|>Atomic Structure<|"|>}${MM17_AFTER}`;
const D01 = "I can draw a flowchart for an if/else statement. This will show the steps of that control flow.\n\nHere is the flowchart showing how an if/else statement works:\n\n```mermaid\ngraph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n    B -- No --> D[Execute the 'else' block];\n    C --> E[End];\n    D --> E;\n```\n\nThis flowchart shows the steps of an if/else statement. It starts, checks a condition, and then follows one path based on whether the condition is true or false.\n\nDo you want to try writing a small Python program that uses an if statement next?";
// fc02's call alone, and wrapped in the full gemma4 frame Ollama itself looks for.
const FC02_CALL = FC02.slice(FC02.indexOf("flashcard."));
const FC02_FRAMED = `${FC02.slice(0, FC02.indexOf("flashcard."))}<|tool_call>call:${FC02_CALL}<tool_call|>`;

// The reply with its call line removed: what the child should see when nothing runs.
const prose = (reply: string) => reply.slice(0, reply.search(/(?:<\|tool_call>|flashcard\.create|progress\.mark_mastered)/));

// What must never reach the screen or the transcript.
const MACHINERY = /<\||\|>|mark_mastered|flashcard\.create|math\.render|\{status|\{front|subtopic_id/;

const CONFIG = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;

type Msg = { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
// A scripted reply: the text, or the text and then a stream that stays open until the turn is stopped.
type Scripted = string | { thenHang: string };
let replies: Scripted[] = [];
let chat: Array<{ messages: Msg[]; tools?: unknown[] }> = [];
let stopTurn: (() => void) | null = null;

// Ollama's /api/chat NDJSON stream: the reply in 3-character content chunks, one line each.
function lines(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 3) out.push(`${JSON.stringify({ message: { role: "assistant", content: text.slice(i, i + 3) }, done: false })}\n`);
  return out;
}
function stream(reply: Scripted, signal?: AbortSignal): Response {
  if (typeof reply === "string") {
    const done = `${JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" })}\n`;
    return new Response([...lines(reply), done].join(""), { status: 200 });
  }
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines(reply.thenHang)) controller.enqueue(enc.encode(l));
      // As a real fetch does, a stopped request errors its body.
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      // Everything is sent; the student presses Stop while the model is still "writing".
      setTimeout(() => stopTurn?.(), 20);
    },
  });
  return new Response(body, { status: 200 });
}

async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname !== "/api/chat") return new Response("not found", { status: 404 }); // /api/ps: load state unknown
  chat.push(JSON.parse(String(init?.body)));
  const next = replies.shift();
  if (next === undefined) throw new Error(`unscripted /api/chat request #${chat.length}`);
  return stream(next, init?.signal ?? undefined);
}

interface Run {
  result: TutorTurnResult;
  shown: string[]; // the streamed reply after every onText call
  confirms: Array<{ tool: string; summary: string }>;
  events: string[]; // tool UI events, "kind:name"
}

async function run(mode: string, scripted: Scripted[], opts: { approve?: boolean } = {}): Promise<Run> {
  replies = [...scripted];
  chat = [];
  const shown: string[] = [];
  const confirms: Run["confirms"] = [];
  const events: string[] = [];
  let text = "";
  const abort = new AbortController();
  stopTurn = () => abort.abort();
  const { activeSkill, domainSkill } = chatTurnSkills(mode, "Math", "tiny", true);
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: "Here is my answer." }],
      config: CONFIG,
      retrieval: "off",
      onText: (chunk) => { text += chunk; shown.push(text); },
      onToolEvent: (ev) => { events.push(`${ev.kind}:${ev.name}`); },
    },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: abort.signal, activeSkill, domainSkill, supportsTools: true,
      confirmTool: async (tool, summary) => { confirms.push({ tool, summary }); return opts.approve ?? false; },
    },
  );
  expect(replies, "every scripted reply was used").toHaveLength(0);
  expect(shown[shown.length - 1] ?? "", "what streamed is what the turn returns").toBe(result.text);
  return { result, shown, confirms, events };
}

// Lines that open or close a ``` / ~~~ fence. An odd count turns the rest of the reply into code.
const fenceLines = (text: string) => text.split("\n").filter((l) => /^ {0,3}(`{3,}|~{3,})/.test(l)).length;

function expectClean(r: Run) {
  for (const state of r.shown) expect(state).not.toMatch(MACHINERY);
  expect(r.result.text).not.toMatch(MACHINERY);
  expect(fenceLines(r.result.text) % 2, "no unmatched code fence is released").toBe(0);
}

const toolNames = () => toolRegistry.all().map((t) => t.name);

beforeAll(() => {
  globalThis.fetch = fakeOllama as typeof fetch;
  registerBuiltinTools();
});
beforeEach(() => { replies = []; chat = []; stopTurn = null; });

describe("a tool call written as text, for a tool not offered this turn", () => {
  it.each([
    ["fc02", FC02],
    ["mm02", MM02],
    ["mm06", MM06],
  ])("%s: the child sees the reply without the call, at every point of the stream, and nothing runs", async (_id, reply) => {
    // Explain mode on a math course offers notebook.search, math.render and diagram.render only.
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

  it("the full gemma4 frame (<|tool_call>call:…) is removed too, and a word held back at the end is still shown", async () => {
    // "math" could have been the start of math.render{ until the stream ended.
    const r = await run("explain", [`Good work.<|tool_call>call:${FC02_CALL}<tool_call|> Next we try math`]);
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

describe("which calls written as text run", () => {
  // Both end with <tool_call|>, so gemma4's own token frames them: only the mastery rule stops them.
  it.each([["mm02", MM02, prose(MM02)], ["mm06", MM06, prose(MM06)]])(
    "%s in assess mode, where the tool is offered: progress.mark_mastered never runs from text, it is only removed",
    async (_id, reply, expected) => {
      const r = await run("assess", [reply]);
      expectClean(r);
      expect(r.confirms).toEqual([]);
      expect(r.result.toolCalls).toEqual([]);
      expect(chat).toHaveLength(1);
      expect(r.result.text).toBe(expected);
    },
  );

  it("fc02 as written (bare text) in review mode: a write tool does not run, the call is removed", async () => {
    const r = await run("review", [FC02]);
    expectClean(r);
    expect(r.confirms).toEqual([]);
    expect(r.result.toolCalls).toEqual([]);
    expect(chat).toHaveLength(1);
    expect(r.result.text).toBe(prose(FC02));
  });

  it("fc02 inside gemma4's tool tokens: the write tool goes to the confirm card, and the model hears the answer", async () => {
    const r = await run("review", [FC02_FRAMED, "Okay, I won't save it."]);
    expectClean(r);
    expect(r.confirms).toEqual([{ tool: "flashcard.create", summary: "The card: “What is the divisor in division?”" }]);
    expect(r.result.toolCalls.map((c) => [c.name, c.ok, c.fromText])).toEqual([["flashcard.create", false, true]]);
    const sent = chat[1].messages;
    const call = sent.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(call?.tool_calls?.[0].function.name).toBe("flashcard.create");
    expect(call?.content).toBe(prose(FC02));
    expect(sent[sent.length - 1]).toMatchObject({ role: "tool", content: "ERROR: The student declined to let flashcard.create run." });
    expect(r.result.text).toBe(`${prose(FC02)}Okay, I won't save it.`);
  });

  it("the closing token alone frames a write call too (mm02's form, with fc02's call)", async () => {
    const r = await run("review", [`Here you go.\n\n${FC02_CALL}<tool_call|>`, "Done."]);
    expectClean(r);
    expect(r.confirms.map((c) => c.tool)).toEqual(["flashcard.create"]);
  });

  it("a read-only tool runs from bare text: math.render draws, and the text after the call is not shown", async () => {
    const r = await run("explain", ["The area of a circle is:\n\nmath.render{latex:<|\"|>A = \\pi r^2<|\"|>}\n\nThat is the formula.", "Here r is the radius."]);
    expectClean(r);
    expect(r.confirms).toEqual([]);
    expect(r.events).toEqual(["start:math.render", "result:math.render"]);
    expect(r.result.toolCalls).toEqual([{ name: "math.render", args: { latex: "A = \\pi r^2" }, ok: true, fromText: true }]);
    expect(r.result.text).toBe("The area of a circle is:\n\nHere r is the radius.");
  });

  it("arguments the tool's schema rejects are refused, as a native call's are", async () => {
    const r = await run("explain", ["See:\n\nmath.render{tex:<|\"|>x^2<|\"|>}", "Let's try again."]);
    expectClean(r);
    expect(r.result.toolCalls).toMatchObject([{ name: "math.render", ok: false, fromText: true }]);
    expect(chat[1].messages[chat[1].messages.length - 1]?.content).toMatch(/^ERROR: Invalid arguments for math\.render: latex:/);
  });
});

describe("a call that never closes hides only itself", () => {
  it("a lone \" in the arguments: only the call is removed, the reply after it is shown", async () => {
    const r = await run("explain", ["progress.mark_mastered{status:\"mastered} You did great, now try 3x4."]);
    expectClean(r);
    expect(r.result.text).toBe(" You did great, now try 3x4.");
  });

  it("an unclosed {: only `name{` is removed when what follows is not arguments", async () => {
    const r = await run("explain", ["Use math.render{ to draw. Then 3+4 = 7. Great job!"]);
    expect(r.result.text).toBe("Use  to draw. Then 3+4 = 7. Great job!");
    expect(r.result.toolCalls).toEqual([]);
  });

  it("an unclosed call is given up at a blank line, before the stream ends, and its first line alone is removed", () => {
    const filter = new ReplyTextFilter(toolNames());
    const shown = filter.push("Nice.\n\nflashcard.create{front:<|\"|>What is a divisor?<|\"|>,\n\nNow try 12 ÷ 3.");
    expect(shown).toBe("Nice.\n\n\n\nNow try 12 ÷ 3.");
    expect(filter.end()).toBe("");
  });

  it(`an unclosed call is held for at most ${HOLD_CAP} characters, then released`, () => {
    const filter = new ReplyTextFilter(toolNames());
    const long = "word ".repeat(400);
    const shown = filter.push(`Use math.render{ ${long}`);
    expect(shown.length).toBeGreaterThan(long.length - 10);
    expect(shown).not.toMatch(/math\.render/);
  });

  it("Stop while a call is held: the turn ends with the text before it, and no part of the call", async () => {
    const r = await run("assess", [{ thenHang: "Good job. progress.mark_mastered{status:<|\"|>mas" }]);
    expect(r.result.stopReason).toBe("aborted");
    expectClean(r);
    expect(r.result.text).toBe("Good job. ");
  });
});

describe("text inside a call's string is never released", () => {
  it("an unterminated multi-line <|\"|> string (Mermaid source) is removed to the end of the stream", async () => {
    const r = await run("explain", ["Here it is:\n\ndiagram.render{code:<|\"|>graph TD\n  A[Start] --> B[Add]\n  B --> C[End]"]);
    expectClean(r);
    expect(r.result.text).toBe("Here it is:\n\n");
  });

  it("fc02's call with an unterminated multi-line back is removed whole", async () => {
    const r = await run("explain", [`${prose(FC02)}flashcard.create{front:<|"|>What is the divisor in division?<|"|>,back:<|"|>Four.\nIt is even.\nGood job`]);
    expectClean(r);
    expect(r.result.text).toBe(prose(FC02));
  });

  it("an unterminated \"…\" string is removed up to the blank line that ends it", async () => {
    const r = await run("explain", ["Look:\ndiagram.render{mermaid: \"graph TD\nA-->B\nB-->C\n\nWhat do you see?"]);
    expectClean(r);
    expect(r.result.text).toBe("Look:\n\n\nWhat do you see?");
  });

  it("a fenced Mermaid source inside a \"…\" argument leaves no stray ``` behind", async () => {
    const r = await run("explain", ["Look:\ndiagram.render{code: \"```mermaid\ngraph TD\nA-->B\n```\"}\nWhat do you see?"]);
    expectClean(r);
    expect(r.result.text).toBe("Look:\n\nWhat do you see?");
  });

  it(`a valid diagram.render whose source is longer than ${HOLD_CAP} characters still runs, and none of it is shown`, async () => {
    const source = `graph TD\n${Array.from({ length: 150 }, (_, i) => `  N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`).join("\n")}`;
    expect(source.length).toBeGreaterThan(HOLD_CAP * 2);
    const r = await run("explain", [`Here is the whole process:\n\ndiagram.render{mermaid:<|"|>${source}<|"|>}`, "Each step leads to the next."]);
    expectClean(r);
    expect(r.result.text).not.toContain("Step 1");
    expect(r.events).toEqual(["start:diagram.render", "result:diagram.render"]);
    expect(r.result.toolCalls).toEqual([{ name: "diagram.render", args: { mermaid: source }, ok: true, fromText: true }]);
    expect(r.result.text).toBe("Here is the whole process:\n\nEach step leads to the next.");
  });

  it("a call inside an open code fence is code the model is showing: kept, and nothing runs", async () => {
    const reply = "In the app it looks like this:\n\n```text\nmath.render{latex: \"x^2\"}\n```\n\nThat is all.";
    const r = await run("explain", [reply]);
    expect(r.result.text).toBe(reply);
    expect(chat).toHaveLength(1);
  });
});

describe("one stray <|\"|> token does not hide the rest of the reply", () => {
  it("a } then a blank line after the stray token ends the call; the reply after it is shown", async () => {
    const r = await run("explain", ["library.search{query:<|\"|>cats}\n\nCats are mammals. They purr when they are happy."]);
    expectClean(r);
    expect(r.result.text).toBe("\n\nCats are mammals. They purr when they are happy.");
  });

  it("mm17's call with its first string left open: only the call is removed", async () => {
    const reply = "Good work!\nprogress.mark_mastered{status:<|\"|>mastered,subtopic_id:<|\"|>Atomic Structure<|\"|>}\n\nYou have shown you understand atoms. Want to try isotopes next?";
    const r = await run("assess", [reply]);
    expectClean(r);
    expect(r.result.text).toBe("Good work!\n\n\nYou have shown you understand atoms. Want to try isotopes next?");
    expect(r.result.toolCalls).toEqual([]);
  });

  it("a } then <tool_call|> after the stray token ends the call too", async () => {
    const r = await run("explain", ["Nice.\nlibrary.search{query:<|\"|>cats}<tool_call|> Cats purr."]);
    expectClean(r);
    expect(r.result.text).toBe("Nice.\n Cats purr.");
  });
});

describe("never a blank turn", () => {
  it("a reply that was only a call nothing ran shows and saves one plain line", async () => {
    const r = await run("assess", [MM02.slice(MM02.indexOf("progress."))]);
    expectClean(r);
    expect(r.result.text).toBe(MIXED_UP_REPLY);
    expect(r.shown[r.shown.length - 1]).toBe(MIXED_UP_REPLY);
    expect(r.result.stopReason).toBe("complete");
  });

  it("an empty reply gets the same line", async () => {
    const r = await run("explain", [""]);
    expect(r.result.text).toBe(MIXED_UP_REPLY);
  });

  it("a turn where a tool ran keeps its own (empty) text: the tool's card is the answer", async () => {
    const r = await run("explain", ["math.render{latex:<|\"|>x^2<|\"|>}", ""]);
    expect(r.result.toolCalls).toMatchObject([{ name: "math.render", ok: true }]);
    expect(r.result.text).toBe("");
  });
});

describe("text that only looks like machinery is kept", () => {
  it("<|y| at the end and x<y_z|> mid-reply are not gemma4 tokens", async () => {
    const reply = "Compare x<y_z|> with that, then write |x|<|y|";
    const r = await run("explain", [reply]);
    expect(r.result.text).toBe(reply);
  });

  it("a tool name glued to the word before it is not a call, even across a chunk boundary", async () => {
    // 3-character chunks: "sum" arrives before "math.render{…}".
    const reply = "summath.render{a:1} is not a call.";
    const r = await run("explain", [reply]);
    expect(r.result.text).toBe(reply);
    expect(chat).toHaveLength(1);
  });
});

describe("saved replies (ChatTab shows them through displayReplyText)", () => {
  it.each([["fc02", FC02], ["mm02", MM02], ["mm06", MM06]])("%s saved before this fix shows without the call", (_id, reply) => {
    expect(displayReplyText(reply)).toBe(prose(reply));
  });

  it("mm17 saved before this fix keeps the text after the call", () => {
    expect(displayReplyText(MM17)).toBe(MM17_BEFORE + MM17_AFTER);
  });
});
