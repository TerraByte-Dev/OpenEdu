import { describe, it, expect, vi, beforeEach } from "vitest";

// An equation or diagram the tutor drew stays in the conversation. math.render and diagram.render used
// to be drawn only from the turn's tool events, which the chat clears at the next message and never
// saves: the card was gone at the child's next message and when the thread was reopened, and a turn
// whose only answer was the card saved no reply at all. The pure rules first, then the same through
// the real kernel (tutorEngine.run, the function ChatTab calls) and the path a saved reply takes back
// onto the screen and through the speaker (persistedReply → displayReplyText → splitReplyDiagrams /
// the chat's math tokenizer, and speakableText).

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "aborted" };
let script: TurnEvent[][] = [];
// What the child sees (everything onText delivered) when each model call starts.
let onScreen = "";
const atCall: string[] = [];
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (_messages: Sent) {
    atCall.push(onScreen);
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
}));

import { drawnCard, mathBlock, mermaidFence } from "./drawnCards";
import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { persistedReply } from "./persistedReply";
import { displayReplyText } from "./textToolCalls";
import { registerBuiltinTools } from "../tools";
import { matchBlockMath } from "../chat-math";
import { splitReplyDiagrams } from "../mermaid-source";
import { speakableText } from "../speech";
import { MIXED_UP_REPLY } from "../plain-language";
import type { LLMConfig } from "../../types";

registerBuiltinTools();

describe("mathBlock", () => {
  it("is a $$ display block on its own lines", () => {
    expect(mathBlock("\\frac{1}{3} + \\frac{1}{4} = \\frac{7}{12}")).toBe("$$\n\\frac{1}{3} + \\frac{1}{4} = \\frac{7}{12}\n$$");
  });

  it("takes off delimiters the model wrote around the LaTeX anyway", () => {
    for (const wrapped of ["$$x^2$$", "$x^2$", "\\[x^2\\]", "\\(x^2\\)", "  $$ x^2 $$\n"]) expect(mathBlock(wrapped)).toBe("$$\nx^2\n$$");
  });

  it("drops blank lines, which would end the display block", () => {
    expect(mathBlock("a = 1\n\n\\\\\n \nb = 2")).toBe("$$\na = 1\n\\\\\nb = 2\n$$");
  });

  it("is null when there is nothing to draw", () => {
    expect(mathBlock("  ")).toBeNull();
    expect(mathBlock("$$ $$")).toBeNull();
  });
});

describe("mermaidFence", () => {
  it("is a ```mermaid fence", () => {
    expect(mermaidFence("graph TD; A[Start] --> B[End]")).toBe("```mermaid\ngraph TD; A[Start] --> B[End]\n```");
  });

  it("takes off a fence the model wrote around the source anyway", () => {
    expect(mermaidFence("```mermaid\ngraph TD\nA-->B\n```")).toBe("```mermaid\ngraph TD\nA-->B\n```");
    expect(mermaidFence("~~~\ngraph TD\nA-->B\n~~~")).toBe("```mermaid\ngraph TD\nA-->B\n```");
  });

  it("is longer than any run of backticks in the source, so no line of it closes the fence", () => {
    const fence = mermaidFence("graph TD\nA[```] --> B")!;
    expect(fence.startsWith("````mermaid\n")).toBe(true);
    expect(splitReplyDiagrams(fence)).toEqual([{ kind: "mermaid", code: "graph TD\nA[```] --> B", closed: true }]);
  });

  it("is null when there is nothing to draw", () => {
    expect(mermaidFence("\n")).toBeNull();
  });
});

describe("drawnCard", () => {
  it("starts on its own line after the text so far", () => {
    expect(drawnCard("", "math.render", { latex: "x" })).toBe("$$\nx\n$$");
    expect(drawnCard("Look:", "math.render", { latex: "x" })).toBe("\n\n$$\nx\n$$");
    expect(drawnCard("Look:\n", "math.render", { latex: "x" })).toBe("\n$$\nx\n$$");
    expect(drawnCard("Look:\n\n", "math.render", { latex: "x" })).toBe("$$\nx\n$$");
  });

  it("is nothing for another tool, or an argument with nothing to draw", () => {
    expect(drawnCard("Hi", "notebook.search", { query: "x" })).toBe("");
    expect(drawnCard("Hi", "math.render", { latex: " " })).toBe("");
    expect(drawnCard("Hi", "diagram.render", null)).toBe("");
  });
});

// ── Through the kernel ──────────────────────────────────────────────────────────────────────────

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];
const call = (name: string, args: unknown, text = ""): TurnEvent[] => [
  ...(text ? [{ type: "text" as const, delta: text }] : []),
  { type: "tool_call", id: "call_0", name, args },
  { type: "done", finishReason: "tool_calls" },
];
const LATEX = "\\frac{1}{3} + \\frac{1}{4} = \\frac{4}{12} + \\frac{3}{12} = \\frac{7}{12}";
const MERMAID = "graph TD\n  A[Whole pizza] --> B[4 equal slices]";

async function turn(topic = "Math: fractions"): Promise<{ result: TutorTurnResult; shown: string }> {
  const { activeSkill, domainSkill } = chatTurnSkills("explain", topic, "tiny", true);
  let shown = "";
  const result = await tutorEngine.run(
    {
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "How do I add 1/3 + 1/4?" },
      ],
      config: CONFIG, retrieval: "off", onText: (t) => { shown += t; onScreen = shown; },
    },
    {
      courseId: "c1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async () => true,
    },
  );
  return { result, shown };
}

// What MessageBubble shows for a saved reply when the thread is reopened.
const reopened = (saved: string) => displayReplyText(saved);

beforeEach(() => { script = []; onScreen = ""; atCall.length = 0; });

describe("a math.render card is saved with the reply", () => {
  it("is shown where the call ran, streamed and saved, and the chat draws it as display math", async () => {
    script = [call("math.render", { latex: LATEX }, "First give both fractions the same bottom number."), reply("So the answer is 7/12.")];
    const { result, shown } = await turn();
    expect(result.text).toBe(`First give both fractions the same bottom number.\n\n$$\n${LATEX}\n$$\n\nSo the answer is 7/12.`);
    expect(shown).toBe(result.text);

    const saved = persistedReply(result.text, result.stopReason)!;
    const back = reopened(saved);
    expect(back).toBe(saved);
    const at = back.indexOf("$$");
    expect(matchBlockMath(back.slice(at))).toEqual({ raw: `$$\n${LATEX}\n$$\n`, tex: LATEX, display: true });
    // Read aloud as words, not as LaTeX.
    expect(speakableText(back)).not.toMatch(/\\|\$/);
    expect(speakableText(back)).toContain("7/12");
  });

  it("a turn whose only answer was the card saves the card, never MIXED_UP_REPLY or nothing", async () => {
    script = [call("math.render", { latex: LATEX }), reply("")];
    const { result } = await turn();
    expect(result.text).toBe(`$$\n${LATEX}\n$$`);
    expect(result.text).not.toContain(MIXED_UP_REPLY);
    expect(persistedReply(result.text, result.stopReason)).toBe(`$$\n${LATEX}\n$$`);
  });

  it("a call that failed validation draws nothing, and the turn is not left blank", async () => {
    script = [call("math.render", { tex: "x" }), reply(""), reply("")];
    const { result } = await turn();
    expect(result.toolCalls).toMatchObject([{ name: "math.render", ok: false }]);
    expect(result.text).toBe(MIXED_UP_REPLY);
  });
});

describe("a diagram.render card is saved with the reply", () => {
  it("is a ```mermaid fence the chat draws through MermaidBlock, and read aloud as a drawing", async () => {
    script = [call("diagram.render", { mermaid: MERMAID }, "Here is a picture of the pizza."), reply("Each slice is one fourth.")];
    const { result } = await turn();
    expect(result.text).toBe(`Here is a picture of the pizza.\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n\nEach slice is one fourth.`);

    const back = reopened(persistedReply(result.text, result.stopReason)!);
    expect(splitReplyDiagrams(back)).toEqual([
      { kind: "markdown", text: "Here is a picture of the pizza.\n" },
      { kind: "mermaid", code: MERMAID, closed: true },
      { kind: "markdown", text: "\nEach slice is one fourth." },
    ]);
    expect(speakableText(back)).toBe("Here is a picture of the pizza. A drawing. Each slice is one fourth.");
  });
});

// The drawing's closing `$$` or fence must not wait for the next model call (seconds on a local model
// after a tool round, or until the child answers an Allow card): the drawing is shown whole when its call
// returns, not through the filters that hold text back while a model call streams.
describe("a drawing is on screen whole as soon as its call returns", () => {
  it("math.render: the closing $$ is shown before the next model call starts", async () => {
    script = [call("math.render", { latex: LATEX }, "First give both fractions the same bottom number."), reply("So the answer is 7/12.")];
    await turn();
    expect(atCall).toHaveLength(2);
    expect(atCall[1]).toBe(`First give both fractions the same bottom number.\n\n$$\n${LATEX}\n$$`);
    expect(matchBlockMath(atCall[1].slice(atCall[1].indexOf("$$")))).toMatchObject({ tex: LATEX, display: true });
  });

  it("diagram.render: the fence is closed before the next model call starts", async () => {
    script = [call("diagram.render", { mermaid: MERMAID }, "Here is a picture of the pizza."), reply("Each slice is one fourth.")];
    await turn();
    expect(atCall[1]).toBe(`Here is a picture of the pizza.\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``);
    expect(splitReplyDiagrams(atCall[1]).slice(-1)[0]).toEqual({ kind: "mermaid", code: MERMAID, closed: true });
  });
});
