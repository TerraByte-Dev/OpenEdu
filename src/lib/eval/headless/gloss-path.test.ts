import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever L2 on the wire: a non-English question through the real kernel on the headless stand-ins.
// Checks the properties the lever promises (docs/BENCHMARKS.md section 3, row 2):
//   - exactly one extra chat call, structured, before the reply;
//   - it continues the reply's own prefix: same model, tools, num_ctx and think flag, the same messages
//     up to the student's question, then one instruction; its output is capped at GLOSS_NUM_PREDICT;
//   - retrieval embeds the original AND the gloss, and a note only the gloss reaches is retrieved;
//   - the gloss never reaches the reply request, and the student's message is not rewritten.
// The English side (no extra call, byte-identical requests) is english-path.test.ts.
// The vault and question are written for this test and are not from any eval set.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runRagEval, type RagReport } from "../rag-runner";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { GLOSS_INSTRUCTION, GLOSS_NUM_PREDICT } from "../../kernel/gloss";
import type { FixtureNote } from "../rag-fixture";

const MODEL = "gemma4:e2b";
const ASK = "ग्रीनहाउस के बेड दो में मिट्टी का pH कितना था?";
const GLOSS = "What was the soil pH in bed two of the greenhouse?";
const VAULT: FixtureNote[] = [
  { title: "Garden Log", text: "The greenhouse tomatoes were planted on the third of May. The soil pH in bed two read 6.4, and the drip line runs for twenty minutes each morning." },
];

type Msg = { role: string; content: string };
type Body = { model: string; messages: Msg[]; tools?: unknown[]; options?: Record<string, unknown>; think?: boolean; format?: unknown; stream?: boolean; input?: string[] };
let calls: Array<{ path: string; body: Body }> = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// Only English greenhouse text lands near the note: the Hindi question alone retrieves nothing.
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Body;
  calls.push({ path: url.pathname, body });
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL }, { name: "nomic-embed-text:latest" }] });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/version":
      return json({ version: "0.40.15" });
    case "/api/embed":
      return json({ embeddings: body.input!.map((t) => (/greenhouse/i.test(t) ? [1, 0] : [0, 1])) });
    case "/api/chat":
      if (body.format) return json({ message: { role: "assistant", content: JSON.stringify({ english: GLOSS }) }, done: true, done_reason: "stop" });
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "Garden Log: pH 6.4." } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

describe("a non-English question: the gloss call and the double search", () => {
  let chat: Body[] = [];
  let turnEmbeds: Body[] = [];
  let report: RagReport;

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    calls = [];
    report = await runRagEval({ custom: { name: "gloss-path", vault: VAULT, questions: [{ id: "hi-1", kind: "positive", ask: ASK, expect: "6.4" }] }, modes: ["always"], syllabus: "matched" });
    chat = calls.filter((c) => c.path === "/api/chat").map((c) => c.body);
    turnEmbeds = calls.filter((c) => c.path === "/api/embed").map((c) => c.body).slice(VAULT.length);
  }, 60_000);

  it("makes one structured gloss call, then the reply", () => {
    expect(chat).toHaveLength(2);
    expect(chat[0].format).toBeDefined();
    expect(chat[0].stream).toBe(false);
    expect(chat[1].format).toBeUndefined();
  });

  it("continues the reply's own prefix: same model, tools, num_ctx and think flag; same messages up to the question", () => {
    const [g, r] = chat;
    expect(g.model).toBe(r.model);
    expect(g.tools).toEqual(r.tools);
    expect(g.tools?.length).toBeGreaterThan(0);
    expect(g.options?.num_ctx).toBe(r.options?.num_ctx);
    // num_predict is per request and does not reload the runner; the gloss is capped (finding 4).
    expect(g.options?.num_predict).toBe(GLOSS_NUM_PREDICT);
    expect(r.options?.num_predict).toBeGreaterThan(GLOSS_NUM_PREDICT);
    expect(g.think).toBe(r.think);
    // Everything before the student's message is identical; the gloss call then has the question
    // as written and the instruction, the reply has the question with the grounding block before it.
    expect(g.messages.slice(0, -2)).toEqual(r.messages.slice(0, -1));
    expect(g.messages[g.messages.length - 2]).toEqual({ role: "user", content: ASK });
    expect(g.messages[g.messages.length - 1]).toEqual({ role: "user", content: GLOSS_INSTRUCTION });
  });

  it("embeds the original question and the gloss, and retrieves the note only the gloss reaches", () => {
    expect(turnEmbeds.map((b) => b.input)).toEqual([[ASK], [GLOSS]]);
    expect(report.rows[0].retrievedTitles).toContain("Garden Log");
    expect(report.rows[0].retrieval.gloss).toMatchObject({ text: GLOSS, ms: expect.any(Number) });
  });

  it("keeps the gloss out of the reply request and leaves the student's message as written", () => {
    const r = chat[1];
    const last = r.messages[r.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content.endsWith(`\n\n${ASK}`)).toBe(true);
    expect(last.content).toContain(VAULT[0].text);
    expect(JSON.stringify(r)).not.toContain(GLOSS);
    expect(JSON.stringify(r)).not.toContain(GLOSS_INSTRUCTION);
  });
});
