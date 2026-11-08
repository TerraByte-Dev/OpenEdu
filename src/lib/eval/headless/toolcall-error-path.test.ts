import { describe, it, expect, vi, beforeAll } from "vitest";

// What a turn does when Ollama cannot parse the tool call the model wrote, through runRagEval (the
// function `npm run eval` and window.__runRagEval call) and so through tutorEngine.run and
// llm.ts's Ollama stream, the code ChatTab runs. Only Ollama is fake.
//
// Ollama answers such a request with HTTP 500 and {"error": "<parser error>"} when nothing had been
// streamed (observed on 0.40.15 with a qwen3.5 model: "expected element type <function> but have
// <parameter>"), or with an {"error": ...} line in a 200 stream when something had. Promised here:
//   - that failure, with tools declared and nothing streamed, is answered by ONE call without tools
//     and without the tools manifest, and the turn records it (toolCallRecovery);
//   - any other 500, a failure after text reached the student, a request without tools, or a second
//     failure on the no-tools call fails the turn as before: one ERROR row with the real message;
//   - an ERROR row keeps the grounding trace the turn really had, so the vault check does not abort
//     the run with "NO note candidates" when the vault is fine.
// The note and questions are written for this test and are not from any eval set.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runRagEval, type RagReport } from "../rag-runner";
import { seedStore, resetStores } from "./shims/plugin-store";
import { setChatModel } from "../../store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { isOllamaToolCallParseFailure } from "../../llm";
import type { FixtureNote, RagQuestion } from "../rag-fixture";

const PARSE_ERROR = "expected element type <function> but have <parameter>";
const VAULT: FixtureNote[] = [
  { title: "Pond Survey", text: "The pond survey in April counted 14 frogs along the north bank. The water was 11 degrees at noon and the reeds were cut back in March." },
];
const QUESTION: RagQuestion = { id: "pond-1", kind: "positive", ask: "How many frogs did the April pond survey count?", expect: "14" };
const REPLY = "The April survey counted 14 frogs on the north bank.";

type Msg = { role: string; content: string };
type Body = { messages?: Msg[]; tools?: unknown[]; format?: unknown; input?: string[] };

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const ndjson = (...lines: unknown[]) => new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""), { status: 200 });
const reply = (text: string) => ndjson({ message: { role: "assistant", content: text } }, { done: true, done_reason: "stop" });
const ollama500 = (error: string) => json({ error }, 500);

// One scripted response per /api/chat reply request, in order.
type Script = Array<() => Response>;
let script: Script = [];
let chat: Body[] = [];
let tools = true;

async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Body;
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [] }); // never asked: a chat model is always stored
    case "/api/show":
      return json({
        details: { parameter_size: "4.7B" },
        model_info: { "general.architecture": "qwen35", "qwen35.context_length": 32768 },
        capabilities: tools ? ["completion", "tools"] : ["completion"],
      });
    case "/api/version":
      return json({ version: "0.40.15" });
    case "/api/embed":
      return json({ embeddings: body.input!.map(() => [1, 0]) });
    case "/api/chat": {
      if (body.format) throw new Error("no structured call is expected on this path");
      chat.push(body);
      const next = script.shift();
      if (!next) throw new Error(`unscripted /api/chat request #${chat.length}`);
      return next();
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

let modelSeq = 0;
// Each run gets its own model name, so the profile cache cannot carry the tools capability across.
async function run(s: Script, opts: { tools?: boolean } = {}): Promise<RagReport> {
  script = s;
  chat = [];
  tools = opts.tools ?? true;
  await setChatModel(`fake-qwen-${++modelSeq}:4b`);
  const report = await runRagEval({ custom: { name: "toolcall-error", vault: VAULT, questions: [QUESTION] }, modes: ["always"], syllabus: "matched" });
  expect(script, "every scripted response was used").toHaveLength(0);
  return report;
}

const system = (b: Body) => b.messages?.find((m) => m.role === "system")?.content ?? "";
const nonSystem = (b: Body) => (b.messages ?? []).filter((m) => m.role !== "system");

describe("Ollama cannot parse the model's tool call", () => {
  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: "fake-qwen-0:4b" });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
  }, 60_000);

  it("a 500 on the first call: one retry without tools or the manifest, and the turn records it", async () => {
    const report = await run([() => ollama500(PARSE_ERROR), () => reply(REPLY)]);
    const [first, retry] = chat;
    expect(chat).toHaveLength(2);
    expect(first.tools?.length).toBeGreaterThan(0);
    expect(system(first)).toContain("<tools>");
    expect(retry.tools).toBeUndefined();
    expect(system(retry)).not.toContain("<tools>");
    // The same turn: the system prompt minus the manifest, and the same conversation with its notes.
    expect(system(first).startsWith(system(retry))).toBe(true);
    expect(nonSystem(retry)).toEqual(nonSystem(first));

    const row = report.rows[0];
    expect(row.answer).toBe(REPLY);
    expect(row.error).toBeNull();
    expect(row.toolCallRecovery).toEqual({ iteration: 0, error: PARSE_ERROR });
    expect(row.verdict.pass).toBe(true);
    expect(report.turnFailures.always).toEqual({ errors: 0, toolCallRecovered: 1 });
  }, 60_000);

  it("the same failure as an error line before any text in a 200 stream is recovered the same way", async () => {
    const report = await run([() => ndjson({ error: PARSE_ERROR }), () => reply(REPLY)]);
    expect(chat).toHaveLength(2);
    expect(chat[1].tools).toBeUndefined();
    expect(report.rows[0].answer).toBe(REPLY);
    expect(report.rows[0].toolCallRecovery).toEqual({ iteration: 0, error: PARSE_ERROR });
  }, 60_000);

  it("a failure after a tool already ran: the retry keeps the tool's result and records the call it failed on", async () => {
    const report = await run([
      () => ndjson({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "notebook.search", arguments: { query: "pond survey frogs" } } }] } }, { done: true, done_reason: "stop" }),
      () => ollama500(PARSE_ERROR),
      () => reply(REPLY),
    ]);
    expect(chat).toHaveLength(3);
    expect(chat[1].tools?.length).toBeGreaterThan(0);
    expect(chat[2].tools).toBeUndefined();
    expect(nonSystem(chat[2])).toEqual(nonSystem(chat[1]));
    expect(nonSystem(chat[2]).some((m) => m.role === "tool")).toBe(true);
    const row = report.rows[0];
    expect(row.toolCalls).toEqual(["notebook.search"]);
    expect(row.toolCallRecovery).toEqual({ iteration: 1, error: PARSE_ERROR });
    expect(row.answer).toBe(REPLY);
  }, 60_000);

  it("retries at most once: a second failure on the no-tools call is an ERROR row with the real message", async () => {
    const report = await run([() => ollama500(PARSE_ERROR), () => ollama500(PARSE_ERROR)]);
    expect(chat).toHaveLength(2);
    const row = report.rows[0];
    expect(row.error).toBe(`Ollama error 500: ${JSON.stringify({ error: PARSE_ERROR })}`);
    expect(row.answer).toBe(`ERROR: ${row.error}`);
    expect(report.turnFailures.always).toEqual({ errors: 1, toolCallRecovered: 0 });
  }, 60_000);

  it("other 500s are not retried, and the ERROR row keeps the real grounding trace instead of tripping the vault check", async () => {
    const report = await run([() => ollama500("model requires more system memory than is available")]);
    expect(chat).toHaveLength(1);
    const row = report.rows[0];
    expect(row.error).toBe(`Ollama error 500: ${JSON.stringify({ error: "model requires more system memory than is available" })}`);
    expect(row.toolCallRecovery).toBeNull();
    // Before this, the trace here was the empty placeholder and the run aborted with
    // "Fixture vault returned NO note candidates".
    expect(row.retrieval.noteCandidates).toBeGreaterThan(0);
    expect(row.retrievedTitles).toContain("Pond Survey");
  }, 60_000);

  it("a parse failure after text reached the student is not retried", async () => {
    const report = await run([() => ndjson({ message: { role: "assistant", content: "Let me check. " } }, { error: PARSE_ERROR })]);
    expect(chat).toHaveLength(1);
    expect(report.rows[0].error).toBe(`Ollama error: ${PARSE_ERROR}`);
    expect(report.rows[0].toolCallRecovery).toBeNull();
  }, 60_000);

  it("a request that declared no tools is not retried", async () => {
    const report = await run([() => ollama500(PARSE_ERROR)], { tools: false });
    expect(chat).toHaveLength(1);
    expect(chat[0].tools).toBeUndefined();
    expect(report.rows[0].error).toBe(`Ollama error 500: ${JSON.stringify({ error: PARSE_ERROR })}`);
    expect(report.rows[0].toolCallRecovery).toBeNull();
  }, 60_000);
});

describe("isOllamaToolCallParseFailure", () => {
  it("matches Ollama's tool-call parser errors and nothing else", () => {
    expect(isOllamaToolCallParseFailure(PARSE_ERROR)).toBe(true);
    expect(isOllamaToolCallParseFailure("invalid tool call: empty function name")).toBe(true);
    expect(isOllamaToolCallParseFailure("error parsing tool call: raw='x', err=unexpected end of JSON input")).toBe(true);
    expect(isOllamaToolCallParseFailure("model requires more system memory than is available")).toBe(false);
    expect(isOllamaToolCallParseFailure("registry.ollama.ai/library/x does not support tools")).toBe(false);
    expect(isOllamaToolCallParseFailure("")).toBe(false);
  });
});
