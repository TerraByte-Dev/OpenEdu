import { FIRST_TURN_HOLD_NOTE } from "../../kernel/attemptFirst";
import { withTurnNote } from "../../kernel/turnKind";
import { describe, it, expect, vi, beforeAll } from "vitest";

// B7 (`EVAL_SUITE=b7-cpu npm run eval`) end to end on a stand-in Ollama: the same entry `npm run eval`
// calls (runHeadlessEval), the real kernel on the headless platform stand-ins, and a fake pair of
// servers: the machine's usual one on 11434 and the CPU-only one on 11435, which loads a model on its
// first request, reports Ollama's timing fields, lists what it holds in /api/ps, and unloads on
// keep_alive 0. Checked:
//   - the k12 turns are the k12-flow runner's turns, byte for byte (runK12FlowEval, the webview hook);
//     the notes turns are the RAG dev eval's (runRagEval, set "dev", matched syllabus, retrieval always);
//   - the cold repeat really starts with nothing loaded, and the warm ones with the model resident;
//   - each turn's requests and Ollama's numbers land on the right row, without the vault seeding;
//   - the refusals: weights on a GPU, another server with a model loaded, a busy CPU.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runK12FlowEval } from "../k12-flow-runner";
import { runRagEval } from "../rag-runner";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "../k12-flow";
import { RAG_HELDOUT } from "../rag-heldout";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { fs, os } from "./node-io";
import { b7K12Items, B7_NOTES } from "./latency";
import type { B7Result } from "./latency";
import type { MachineInfo } from "./machine";

const MODEL = "gemma4:e2b";
const EMBED = "nomic-embed-text";
const CPU = "http://127.0.0.1:11435";
const GLOSS = "How many grams of rye flour go into one loaf of the bread?";
const REPLY = ["Not quite. Look at the numbers again. ", "Which option do you get when you work it out?"];
const MACHINE: MachineInfo = { cpuModel: "Test CPU 8-Core", logicalCpus: 16, physicalCores: 8, ramGb: 31.4, platform: "win32", osRelease: "10.0.26200", arch: "x64", node: "22.0.0", power: "ac" };

const tag = (m: string) => (m.includes(":") ? m : `${m}:latest`);
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

interface Call { port: string; path: string; body: Record<string, unknown> | undefined; raw: string | undefined }
const server = {
  calls: [] as Call[],
  loaded: new Set<string>(),
  gpu: false,
  other: [] as string[],
  reset() { this.calls = []; this.loaded = new Set(); this.gpu = false; this.other = []; },
};

// Timing fields Ollama reports at the end of a request: a model load costs 2.5 s, a resident one 5 ms.
function timings(model: string, extra: object = {}) {
  const cold = !server.loaded.has(tag(model));
  server.loaded.add(tag(model));
  return { load_duration: cold ? 2_500_000_000 : 5_000_000, total_duration: 1, ...extra };
}

async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const raw = init?.body ? String(init.body) : undefined;
  const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
  server.calls.push({ port: url.port, path: url.pathname, body, raw });
  if (url.port === "11434") {
    return url.pathname === "/api/ps" ? json({ models: server.other.map((name) => ({ name, model: name, size: 1e9, size_vram: 1e9 })) }) : json({ error: "not here" }, 404);
  }
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL, digest: "e2b-digest" }, { name: `${EMBED}:latest`, digest: "embed-digest" }] });
    case "/api/version":
      return json({ version: "0.40.15" });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/ps":
      return json({ models: [...server.loaded].map((name) => ({ name, model: name, size: 2e9, size_vram: server.gpu ? 1e9 : 0 })) });
    case "/api/generate": // only ever an unload here; an embedder refuses generate, as Ollama does
      if (tag(String(body!.model)) === tag(EMBED)) return json({ error: `"${EMBED}" does not support generate` }, 400);
      server.loaded.delete(tag(String(body!.model)));
      return json({ done: true, done_reason: "unload" });
    case "/api/embed": {
      const input = body!.input as string[];
      if (body!.keep_alive === 0 && input.length === 0) { server.loaded.delete(tag(String(body!.model))); return json({ embeddings: [] }); }
      // The rye-bread note and the English gloss on one axis, the Marlow note and its question on another.
      const vec = (t: string) => (/rye|brannock/i.test(t) ? [1, 0, 0] : /marlow|silt|sediment/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
      return json({ embeddings: input.map(vec), ...timings(String(body!.model), { prompt_eval_count: 7 }) });
    }
    case "/api/chat": {
      const t = timings(String(body!.model), { prompt_eval_count: 1_000, prompt_eval_duration: 10_000_000, eval_count: 50, eval_duration: 2_000_000 });
      if (body!.format) return json({ message: { role: "assistant", content: JSON.stringify({ english: GLOSS }) }, done: true, done_reason: "stop", ...t });
      return new Response(
        REPLY.map((content) => `${JSON.stringify({ message: { role: "assistant", content } })}\n`).join("") +
        `${JSON.stringify({ done: true, done_reason: "stop", ...t })}\n`,
        { status: 200 },
      );
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

// runHeadlessEval in a fresh module graph, as a new `npm run eval` process gets, with the machine
// probe replaced: its real one samples this machine's CPU for 3 s and asks the OS for core counts.
async function freshRun(busyPct = 0, power: MachineInfo["power"] = "ac") {
  vi.resetModules();
  vi.doMock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
  vi.doMock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
  vi.doMock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
  vi.doMock("@tauri-apps/api/core", () => import("./shims/api-core"));
  vi.doMock("./machine", () => ({ machineInfo: async () => ({ ...MACHINE, power }), cpuBusyPct: async () => busyPct, serverThreads: async () => 8 }));
  return (await import("./run")).runHeadlessEval;
}

async function b7Run(env: Record<string, string>, busyPct = 0, power: MachineInfo["power"] = "ac"): Promise<{ out: B7Result & Record<string, unknown>; error: Error | null }> {
  const f = await fs();
  const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-b7-`);
  const file = `${dir}/run.json`;
  let error: Error | null = null;
  try {
    await (await freshRun(busyPct, power))({ EVAL_SUITE: "b7-cpu", EVAL_MODEL: MODEL, EVAL_OUT: file, ...env });
  } catch (e) {
    error = e as Error;
  }
  try {
    return { out: JSON.parse(await f.readFile(file, "utf8")), error };
  } finally {
    await f.rm(dir, { recursive: true, force: true });
  }
}

type Msg = { role: string; content: string };
const lastUser = (raw: string) => (JSON.parse(raw) as { messages: Msg[] }).messages.filter((m) => m.role === "user").slice(-1)[0].content;

describe("b7-cpu: a full run on a stand-in CPU server", () => {
  const items = b7K12Items(2);
  const hi = RAG_HELDOUT.find((q) => q.id === B7_NOTES["notes-hi-gloss"])!;
  const en = RAG_HELDOUT.find((q) => q.id === B7_NOTES["notes-en"])!;
  let run: Awaited<ReturnType<typeof b7Run>>;
  let b7Chat: Call[];
  let webview: { k12: string[]; en: string[]; hi: string[] };

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();

    // The reference paths, as the webview runs them against the same server.
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL, [STORE_KEYS.ollamaUrl]: CPU });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    const chatRaws = () => server.calls.filter((c) => c.path === "/api/chat").map((c) => c.raw!);
    server.reset();
    await runK12FlowEval({ only: items[0].id });
    const k12 = chatRaws().slice(1); // after the runner's warm-up call
    server.reset();
    await runRagEval({ set: "dev", only: en.id, modes: ["always"], syllabus: "matched" });
    const enRaws = chatRaws();
    server.reset();
    await runRagEval({ set: "dev", only: hi.id, modes: ["always"], syllabus: "matched" });
    webview = { k12, en: enRaws, hi: chatRaws() };

    // `EVAL_SUITE=b7-cpu EVAL_REPEATS=1 npm run eval`, starting with nothing loaded.
    server.reset();
    run = await b7Run({ EVAL_REPEATS: "1", EVAL_B7_SERVER_LOG: "ollama-cpu.log" });
    b7Chat = server.calls.filter((c) => c.port === "11435" && c.path === "/api/chat");
  }, 120_000);

  it("finishes and writes every turn: two k12 items × 3 turns, then notes en and hi cold, then warm", () => {
    expect(run.error).toBeNull();
    expect(run.out.abort).toBeNull();
    expect(run.out.rows.map((r) => `${r.kind}#${r.rep}${r.cold ? "c" : ""}:${r.item}`)).toEqual([
      `k12-t1-new-problem#0c:${items[0].id}`, `k12-t2-wrong-try#0:${items[0].id}`, `k12-t3-show-answer#0:${items[0].id}`,
      `k12-t1-new-problem#1:${items[1].id}`, `k12-t2-wrong-try#1:${items[1].id}`, `k12-t3-show-answer#1:${items[1].id}`,
      `notes-en#0c:${en.id}`, `notes-hi-gloss#0c:${hi.id}`, `notes-en#1:${en.id}`, `notes-hi-gloss#1:${hi.id}`,
    ]);
    for (const r of run.out.rows) expect(r.error, `${r.kind}#${r.rep}`).toBeNull();
  });

  it("sends the k12-flow runner's own T1, T2 and T3 requests, byte for byte, without its warm-up", () => {
    const first = b7Chat.slice(0, 3).map((c) => c.raw!);
    expect(first).toEqual(webview.k12);
    expect(first.map(lastUser).map((u, i) => u.endsWith([withTurnNote(formatK12FlowT1(items[0]), FIRST_TURN_HOLD_NOTE), formatK12FlowT2(items[0]), K12_FLOW_T3][i]))).toEqual([true, true, true]);
    expect(b7Chat.some((c) => lastUser(c.raw!).includes("Reply with the single word"))).toBe(false);
    // Repeat 1 is a different item under the same system prompt: a learner's next problem.
    const sys = (raw: string) => (JSON.parse(raw) as { messages: Msg[] }).messages[0].content;
    expect(sys(b7Chat[3].raw!)).toBe(sys(b7Chat[0].raw!));
    expect(lastUser(b7Chat[3].raw!).endsWith(withTurnNote(formatK12FlowT1(items[1]), FIRST_TURN_HOLD_NOTE))).toBe(true);
  });

  it("sends the RAG dev eval's own requests for the notes turns, gloss included", () => {
    const notes = b7Chat.slice(6).map((c) => c.raw!);
    expect(notes.slice(0, 1)).toEqual(webview.en);
    expect(webview.hi).toHaveLength(2); // the gloss, then the reply
    expect(notes.slice(1, 3)).toEqual(webview.hi);
    expect(notes.slice(3)).toEqual([...webview.en, ...webview.hi]);
  });

  it("starts each cold repeat with nothing loaded, and the warm ones with the model resident", () => {
    const rows = run.out.rows;
    for (const r of rows.filter((x) => x.cold)) expect(r.residentBefore, `${r.kind}#${r.rep}`).toEqual({ chat: false, embed: false });
    for (const r of rows.filter((x) => !x.cold)) expect(r.residentBefore.chat, `${r.kind}#${r.rep}`).toBe(true);
    // The model loaded inside the cold k12 T1 (the cold-start first turn) and the cold notes turns.
    expect(rows.filter((r) => r.cost.reload).map((r) => `${r.kind}#${r.rep}`)).toEqual(["k12-t1-new-problem#0", "notes-en#0", "notes-hi-gloss#0"]);
    // Unloads went straight to the server, not through the turn log: generate for the chat model,
    // embed for the embedder that refuses generate.
    const unloads = server.calls.filter((c) => c.body?.keep_alive === 0).map((c) => `${c.path} ${c.body!.model}`);
    // (The k12 turns embed the question too, so the embedder is loaded first and listed first.)
    const both = [`/api/generate ${EMBED}:latest`, `/api/embed ${EMBED}:latest`, `/api/generate ${MODEL}`];
    expect(unloads).toEqual([...both, ...both]);
    // The cold-start first turn loads both: the embedder for the question, then the chat model.
    expect(run.out.summary.coldStart).toMatchObject({ loadMs: 5_000, error: null });
  });

  it("gives each turn its own requests and Ollama's numbers, and leaves the vault seeding out", () => {
    const rows = run.out.rows;
    const enCold = rows.find((r) => r.kind === "notes-en" && r.cold)!;
    expect(enCold.calls.map((c) => c.path)).toEqual(["/api/embed", "/api/chat"]); // the question, then the reply
    expect(enCold.calls[0].loadMs).toBeLessThan(1_000); // the embedder was loaded by the seeding, before the turn
    expect(enCold.calls[1].loadMs).toBe(2_500);
    const hiWarm = rows.find((r) => r.kind === "notes-hi-gloss" && r.rep === 1)!;
    expect(hiWarm.calls.map((c) => c.kind)).toEqual(expect.arrayContaining(["structured", "embed", "embed", "turn"]));
    expect(hiWarm.cost).toMatchObject({ chatCalls: 1, structuredCalls: 1, embedCalls: 2, promptTokens: 2_000, outputTokens: 100, promptTokPerSec: 100_000, outputTokPerSec: 25_000, reload: false, incomplete: false });
    expect(hiWarm.gloss).toMatchObject({ text: GLOSS });
    for (const r of rows) {
      expect(r.wallMs).toBeGreaterThanOrEqual(0);
      expect(typeof r.ttftMs).toBe("number");
      for (const c of r.calls) expect(c.label).toBe(`${r.kind}#${r.rep}`);
    }
    const t3 = rows.find((r) => r.kind === "k12-t3-show-answer" && r.rep === 1)!;
    expect(t3.workedAnswerRules).toBe(true);
  });

  it("writes the machine, the server, the plan, the model digests and the summary", () => {
    const o = run.out as unknown as B7Result & { suite: string; ollama: unknown; options: Record<string, unknown> };
    expect(o.suite).toBe("b7-cpu");
    expect(o.options).toMatchObject({ ollamaUrl: CPU, repeats: 1 });
    expect(o.machine).toEqual(MACHINE);
    expect(o.server).toMatchObject({ url: CPU, threads: 8, busyPctBefore: 0, psBefore: [] });
    expect(o.ollama).toEqual({ version: "0.40.15", models: { [MODEL]: { name: MODEL, digest: "e2b-digest" }, [EMBED]: { name: `${EMBED}:latest`, digest: "embed-digest" } } });
    expect(o.plan).toMatchObject({ warmRepeats: 1, coldRepeats: 1, k12: { subject: "math", band: "K-5", items: items.map((x) => x.id) }, notes: { en: en.id, hi: hi.id }, budgetMs: 15_000 });
    expect(o.summary.kinds.map((k) => [k.kind, k.warm])).toEqual([
      ["k12-t1-new-problem", 1], ["k12-t2-wrong-try", 1], ["k12-t3-show-answer", 1], ["notes-en", 1], ["notes-hi-gloss", 1],
    ]);
    expect(o.summary.allUnderBudget).toBe(true);
    // Long texts are in the rows once; the per-request log keeps a tail of the question and a count.
    for (const r of o.rows) for (const c of r.calls) { expect(c.ask.length).toBeLessThanOrEqual(120); expect(typeof c.inputs).toBe("number"); }
  });
});

describe("b7-cpu refusals", () => {
  beforeAll(() => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
  });

  const chats = () => server.calls.filter((c) => c.port === "11435" && c.path === "/api/chat").length;

  it("voids the run when the CPU server puts weights on a GPU, and keeps the turn it measured", async () => {
    server.reset();
    server.gpu = true;
    const { out, error } = await b7Run({ EVAL_REPEATS: "1" });
    expect(error?.message).toMatch(/^VOID RUN — the CPU server has weights on a GPU after k12-t1-new-problem #0: .*gemma4:e2b \(50% GPU\)/);
    expect(out.abort).toBe(error!.message);
    expect(out.rows).toHaveLength(1);
    expect(chats()).toBe(1);
  }, 60_000);

  it("refuses before any model call when the CPU server already holds a model on a GPU", async () => {
    server.reset();
    server.gpu = true;
    server.loaded.add(MODEL);
    const { out, error } = await b7Run({ EVAL_REPEATS: "1" });
    expect(error?.message).toMatch(/^Refusing: the server at http:\/\/127\.0\.0\.1:11435 has weights on a GPU/);
    expect(out.rows).toEqual([]);
    expect(chats()).toBe(0);
  }, 60_000);

  it("refuses while the machine's other Ollama server has a model loaded", async () => {
    server.reset();
    server.other = ["gemma4:e4b"];
    const { out, error } = await b7Run({ EVAL_REPEATS: "1" });
    expect(error?.message).toMatch(/^Refusing: the Ollama server at http:\/\/127\.0\.0\.1:11434 has gemma4:e4b loaded/);
    expect(out.abort).toBe(error!.message);
    expect(chats()).toBe(0);
  }, 60_000);

  it("refuses on battery power", async () => {
    server.reset();
    const { error } = await b7Run({ EVAL_REPEATS: "1" }, 0, "battery");
    expect(error?.message).toMatch(/^Refusing: the machine is on battery/);
    expect(chats()).toBe(0);
  }, 60_000);

  it("refuses on a busy CPU", async () => {
    server.reset();
    const { error } = await b7Run({ EVAL_REPEATS: "1" }, 60);
    expect(error?.message).toMatch(/^Refusing: the CPU was 60% busy over 3 s before the run \(limit 25%\)/);
    expect(chats()).toBe(0);
  }, 60_000);
});
