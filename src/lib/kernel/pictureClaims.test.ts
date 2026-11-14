import { describe, it, expect, vi, beforeEach } from "vitest";

// A reply that says it shows a picture and shows none (pictureClaims.ts). Click test 2026-11-14: asked
// to draw a pizza cut into 4 slices, the tutor wrote "Here is a picture of a pizza cut into 4 equal
// slices." and nothing else was drawn. The pure rules first, then the same through the real kernel
// (tutorEngine.run, the function ChatTab calls), with only the model a stand-in.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "aborted" };
let script: TurnEvent[][] = [];
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));
vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (_messages: Sent) {
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) yield ev;
  }),
}));

import { DRAW_OFFER, showsPicture, withoutPictureClaims } from "./pictureClaims";
import { tutorEngine } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig } from "../../types";

registerBuiltinTools();

describe("withoutPictureClaims", () => {
  it("puts the offer in place of a sentence that says a picture is shown", () => {
    expect(withoutPictureClaims(
      "Sure! Here is a picture of a pizza cut into 4 equal slices. Three of the slices are shaded, so that is three quarters, written 3/4. How many slices are not shaded?",
    )).toBe(
      `Sure! ${DRAW_OFFER} Three of the slices are shaded, so that is three quarters, written 3/4. How many slices are not shaded?`,
    );
  });

  it("reads the other ways a reply points at a picture", () => {
    expect(withoutPictureClaims("Look at the picture below. The pizza has 4 slices."))
      .toBe(`${DRAW_OFFER} The pizza has 4 slices.`);
    expect(withoutPictureClaims("The diagram above shows the water cycle. Rain falls, then it evaporates."))
      .toBe(`${DRAW_OFFER} Rain falls, then it evaporates.`);
    expect(withoutPictureClaims("Great question! I've drawn a simple diagram for you. Each box is one step."))
      .toBe(`Great question! ${DRAW_OFFER} Each box is one step.`);
    expect(withoutPictureClaims("Here's a quick sketch of a number line from 0 to 1."))
      .toBe(DRAW_OFFER);
    expect(withoutPictureClaims("Let me draw it for you. A fraction has a top number and a bottom number."))
      .toBe(`${DRAW_OFFER} A fraction has a top number and a bottom number.`);
  });

  it("keeps a description after a colon, and keeps a list or heading line's marker", () => {
    expect(withoutPictureClaims("I've drawn a diagram of the water cycle: water evaporates, forms clouds, and falls as rain."))
      .toBe(`Water evaporates, forms clouds, and falls as rain. ${DRAW_OFFER}`);
    expect(withoutPictureClaims("**Here is a diagram:**\n\nImagine a chocolate bar with 4 pieces. You eat 1 of them."))
      .toBe(`${DRAW_OFFER}\n\nImagine a chocolate bar with 4 pieces. You eat 1 of them.`);
    expect(withoutPictureClaims("Two ways to see it:\n- Here is a picture of 1/2.\n- Fold a paper in half."))
      .toBe(`Two ways to see it:\n- ${DRAW_OFFER}\n- Fold a paper in half.`);
  });

  it("offers once, and not at all when the reply already offers to draw", () => {
    expect(withoutPictureClaims("Here is a picture of 3/4. And here is a diagram of 1/4. Which is bigger?"))
      .toBe(`${DRAW_OFFER} Which is bigger?`);
    expect(withoutPictureClaims("Here is a picture of a pizza. Want me to draw it with 8 slices instead?"))
      .toBe("Want me to draw it with 8 slices instead?");
  });

  it("leaves sentences alone that offer, ask, instruct or imagine", () => {
    for (const text of [
      "Want me to draw a picture of it?",
      "Would you like a diagram?",
      "Imagine a picture of a pizza cut into 4 slices.",
      "Can you picture a pizza cut into 4 slices?",
      "Draw a picture of 3 groups of 4 apples.",
      "You could draw a diagram to help you.",
      "Great choice! Here is a question about it: what is 3 x 5?",
      "If I drew a diagram, it would have 4 equal parts.",
      "Which graph shows the fastest growth?",
      "A pie chart is a circle cut into parts.",
      "Here is a fraction: 3/4. The top number is 3.",
    ]) {
      expect(withoutPictureClaims(text), text).toBe(text);
    }
  });

  it("returns the offer when nothing else was said", () => {
    expect(withoutPictureClaims("Here is the diagram!")).toBe(DRAW_OFFER);
  });
});

describe("showsPicture", () => {
  const none: Array<{ name: string; ok: boolean }> = [];
  it("counts a diagram.render that ran, a Mermaid diagram, fenced text, an SVG, a table and a row of emoji", () => {
    expect(showsPicture("Here is a diagram.", [{ name: "diagram.render", ok: true }])).toBe(true);
    expect(showsPicture("Here is a diagram:\n\n```mermaid\ngraph TD\n  A[Pizza] --> B[4 slices]\n```", none)).toBe(true);
    expect(showsPicture("Here is a diagram:\n\ngraph TD\n  A[Pizza] --> B[4 slices]", none)).toBe(true);
    expect(showsPicture("Here is a picture:\n\n```\n[X][X][X][ ]\n```", none)).toBe(true);
    expect(showsPicture('Here is a picture: <svg viewBox="0 0 10 10"><circle r="4"/></svg>', none)).toBe(true);
    expect(showsPicture("Here is a chart:\n\n| Slices | Eaten |\n|---|---|\n| 4 | 3 |", none)).toBe(true);
    expect(showsPicture("Here is a picture: 🍕🍕🍕🍕", none)).toBe(true);
  });

  it("does not count a failed diagram.render, a math card, one emoji, or a remote image", () => {
    expect(showsPicture("Here is a diagram.", [{ name: "diagram.render", ok: false }])).toBe(false);
    expect(showsPicture("Here is a diagram.", [{ name: "math.render", ok: true }])).toBe(false);
    expect(showsPicture("Here is a picture of a pizza 🍕.", none)).toBe(false);
    // The sanitizer blocks remote images (#284), so nothing is shown.
    expect(showsPicture("Here is a picture: ![pizza](https://example.com/pizza.png)", none)).toBe(false);
    expect(showsPicture("Here is a picture: ![pizza](data:image/png;base64,AAAA)", none)).toBe(true);
  });
});

// ── Through the kernel ──────────────────────────────────────────────────────────────────────────

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];
const CLAIM = "Sure! Here is a picture of a pizza cut into 4 equal slices. Three slices are shaded, so that is 3/4.";

async function turn(): Promise<{ text: string; shown: string }> {
  const { activeSkill, domainSkill } = chatTurnSkills("explain", "Math: fractions", "tiny", true);
  let shown = "";
  const result = await tutorEngine.run(
    {
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "Draw me a pizza cut into 4 equal slices." },
      ],
      config: CONFIG, retrieval: "off", onText: (t) => { shown += t; },
    },
    {
      courseId: "c1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async () => true,
    },
  );
  return { text: result.text, shown };
}

beforeEach(() => { script = []; });

describe("the kernel takes out a picture claim with no picture", () => {
  it("replaces the claim in the saved reply", async () => {
    script = [reply(CLAIM)];
    const { text, shown } = await turn();
    expect(text).toBe(`Sure! ${DRAW_OFFER} Three slices are shaded, so that is 3/4.`);
    // The stream showed it as it came; the saved reply, which replaces it on screen, does not have it.
    expect(shown).toBe(CLAIM);
  });

  it("keeps the claim when a Mermaid diagram is in the reply", async () => {
    const text = `${CLAIM}\n\n\`\`\`mermaid\ngraph TD\n  A[Pizza] --> B[Slice 1]\n\`\`\``;
    script = [reply(text)];
    expect((await turn()).text).toBe(text);
  });

  it("keeps the claim when diagram.render ran this turn", async () => {
    script = [
      [{ type: "tool_call", id: "call_0", name: "diagram.render", args: { mermaid: "graph TD; A[Pizza] --> B[4 slices]" } }, { type: "done", finishReason: "tool_calls" }],
      reply(CLAIM),
    ];
    expect((await turn()).text).toBe(CLAIM);
  });
});
