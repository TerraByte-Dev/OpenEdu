import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// A model call that fails AFTER an earlier call of the same turn already showed the child something,
// through the real kernel (tutorEngine.run, the function ChatTab calls) and llm.ts's Ollama stream. Only
// Ollama is fake.
//
// llm.ts ends a reply as "stalled" only when something from THAT request reached the child. A later
// request that fails before its first byte (Ollama's runner crashed or ran out of memory and the server
// answers 500, sends an {error} line, or the connection is refused) used to throw, and the whole turn was
// lost: the text the child had read, a card's question and their answer to it. Promised here:
//   - that turn ends as stalled with everything shown so far, so ChatTab saves it with the stalled
//     marker (persistedReply) and shows STALLED_TURN;
//   - the same for the forced no-tools call at the iteration cap;
//   - a kept turn leaves the failure in the log, since ChatTab's "turn failed" line never sees it;
//   - a failure before anything was shown still fails the turn, as before.
// The conversations are written for this test; none comes from an eval set.

vi.mock("@tauri-apps/plugin-http", () => import("../eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

import { tutorEngine, TutorTurnError, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { persistedReply } from "./persistedReply";
import { MAX_TURN_ITERATIONS } from "./stopHooks";
import { registerBuiltinTools } from "../tools";
import type { LLMConfig } from "../../types";

const CONFIG = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const OOM = "model requires more system memory than is available";
const STALLED_MARKER = "\n\n_[the tutor stopped responding — ask again to continue]_";

type Call = { name: string; arguments: unknown };
// One scripted answer per /api/chat request: a reply (text, then optional tool calls), or a failure.
type Scripted = { text?: string; calls?: Call[] } | "500" | "error-line" | "refused";

let script: Scripted[] = [];
let chat = 0;

const line = (v: unknown) => `${JSON.stringify(v)}\n`;
function respond(s: Scripted): Response {
  if (s === "500") return new Response(JSON.stringify({ error: OOM }), { status: 500 });
  if (s === "error-line") return new Response(line({ error: OOM }), { status: 200 });
  if (s === "refused") throw new TypeError("fetch failed");
  const out: string[] = [];
  const text = s.text ?? "";
  for (let i = 0; i < text.length; i += 3) out.push(line({ message: { role: "assistant", content: text.slice(i, i + 3) }, done: false }));
  if (s.calls) out.push(line({ message: { role: "assistant", content: "", tool_calls: s.calls.map((c) => ({ function: c })) }, done: false }));
  out.push(line({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }));
  return new Response(out.join(""), { status: 200 });
}

async function fakeOllama(input: Parameters<typeof fetch>[0]): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname !== "/api/chat") return new Response("not found", { status: 404 }); // /api/ps: load state unknown
  chat++;
  const next = script.shift();
  if (next === undefined) throw new Error(`unscripted /api/chat request #${chat}`);
  return respond(next);
}

const CARD = { question: "Which is bigger, 1/2 or 1/5?", choices: [{ label: "1/2", value: "1/2" }, { label: "1/5", value: "1/5" }] };
const askCall: Call = { name: "ask_user.question", arguments: CARD };
const drawCall: Call = { name: "math.render", arguments: { latex: "\\frac{1}{2}" } };

interface Run { result: TutorTurnResult; streamed: string; cards: string[] }

async function run(scripted: Scripted[], mode = "assess"): Promise<Run> {
  script = [...scripted];
  chat = 0;
  const cards: string[] = [];
  let streamed = "";
  const { activeSkill, domainSkill } = chatTurnSkills(mode, "Math", "tiny", true);
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: "Can you check if I understand fractions?" }],
      config: CONFIG, retrieval: "off", answerCheck: "off",
      onText: (chunk) => { streamed += chunk; },
    },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true, confirmTool: async () => true,
      askUser: async (question) => { cards.push(question); return "1/2"; },
    },
  );
  expect(script, "every scripted answer was used").toHaveLength(0);
  expect(streamed, "what streamed is what the turn returns").toBe(result.text);
  return { result, streamed, cards };
}

beforeAll(() => {
  globalThis.fetch = fakeOllama as typeof fetch;
  registerBuiltinTools();
});
let logged: unknown[][] = [];
beforeEach(() => {
  script = []; chat = 0; logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
});
afterEach(() => { vi.restoreAllMocks(); });
const keptLogged = () => logged.filter((a) => a[0] === "[OpenEdu:TutorEngine]" && String(a[1]).includes("turn kept as stalled"));

describe("a later model call of the turn fails after the child saw something", () => {
  it.each(["500", "error-line", "refused"] as const)("%s after a card was answered: the text, the question and the answer are kept as a stalled turn", async (failure) => {
    const { result, cards } = await run([{ text: "Let's check. ", calls: [askCall] }, failure]);
    expect(cards).toEqual([CARD.question]);
    expect(chat).toBe(2);
    expect(result.stopReason).toBe("stalled");
    expect(result.text).toContain("Let's check.");
    expect(result.text).toContain(CARD.question);
    expect(result.text).toContain("1/2*");
    // What ChatTab saves: the same text with the stalled marker, never a fallback line after it.
    expect(persistedReply(result.text, result.stopReason)).toBe(result.text + STALLED_MARKER);
    expect(keptLogged()).toHaveLength(1);
  });

  it("the forced no-tools call at the iteration cap fails: what was shown is kept as a stalled turn", async () => {
    const drawn = Array.from({ length: MAX_TURN_ITERATIONS }, (_, i) => ({ text: `Step ${i + 1}. `, calls: [drawCall] }));
    const { result } = await run([...drawn, "500"], "explain");
    expect(chat).toBe(MAX_TURN_ITERATIONS + 1);
    expect(result.stopReason).toBe("stalled");
    expect(result.text).toContain("Step 1.");
    expect(result.text).toContain(`Step ${MAX_TURN_ITERATIONS}.`);
    expect(persistedReply(result.text, result.stopReason)).toBe(result.text + STALLED_MARKER);
    expect(keptLogged()).toHaveLength(1);
  });

  it("a failure before anything was shown still fails the turn with the real message", async () => {
    const failed = run(["500"]);
    await expect(failed).rejects.toBeInstanceOf(TutorTurnError);
    await expect(failed).rejects.toThrow(`Ollama error 500: ${JSON.stringify({ error: OOM })}`);
    expect(keptLogged()).toHaveLength(0);
  });
});
