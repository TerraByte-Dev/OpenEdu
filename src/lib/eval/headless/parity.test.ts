import { describe, it, expect, vi, beforeAll } from "vitest";

// Headless == app path, checked on the wire.
//
// One held-out dev item goes through the RAG eval twice, and every request the kernel sends to Ollama
// is captured:
//   A. the webview path: settings as a learner leaves them after picking the model in Settings, the
//      app's boot from main.tsx, then runRagEval, the function window.__runRagEval points at;
//   B. the headless path: runHeadlessEval with EVAL_* variables, exactly what `npm run eval` calls.
// The /api/chat and /api/embed bodies must match byte for byte. Both paths run on the same headless
// platform stand-ins (in-memory SQLite with the real migrations, Node fetch, in-memory store), so what
// this proves is that the headless entry adds nothing and drops nothing between the env vars and the
// request. The platform differences that remain are listed in ./README.md.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runRagEval } from "../rag-runner";
import { runK12FlowEval, runK12FlowFrEval } from "../k12-flow-runner";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "../k12-flow";
import { formatK12FlowFrT2 } from "../k12-flow-fr";
import { K12_FR_ITEMS } from "../k12-flow-fr-items";
import { OUTPUT_RULES, WORKED_ANSWER_RULES } from "../../kernel/outputRules";
import { FIRST_TURN_HOLD_NOTE, withFirstTurnHold } from "../../kernel/attemptFirst";
import { K12_ITEMS } from "../k12-items";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { RAG_FIXTURE } from "../rag-fixture";
import { RAG_HELDOUT } from "../rag-heldout";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { fs, os } from "./node-io";

const ITEM = "h-pp01"; // dev split: "In the Marlow survey, what number did we record for silt build-up…"
const MODEL = "gemma4:e2b";
const OTHER_EMBED = "other-embed";
const MARLOW = RAG_FIXTURE.find((n) => n.title === "Field Notes — Marlow Basin")!;
const ASK = RAG_HELDOUT.find((q) => q.id === ITEM)!.ask;

interface Call { path: string; body: Record<string, unknown> | undefined; raw: string | undefined }
let calls: Call[] = [];

// What the stand-in model says on every chat turn. The k12-flow section swaps in a reply that asks a
// question, so the show-answer chip is offered after T2 and T3 is a real worked-answer turn.
const RAG_REPLY = ["The sediment index was ", "3.71 across the pits."];
let chatReply: string[] = RAG_REPLY;

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// A stand-in Ollama. Embeddings put every Marlow text on one axis and everything else on another, so
// retrieval finds the Marlow note and nothing depends on a real embedder.
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
  calls.push({ path: url.pathname, body, raw: init?.body ? String(init.body) : undefined });
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL, digest: "e2b-digest" }, { name: "nomic-embed-text:latest", digest: "embed-digest" }, { name: OTHER_EMBED, digest: "other-digest" }] });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/embed":
      return json({ embeddings: (body!.input as string[]).map((t) => (/marlow/i.test(t) ? [1, 0, 0] : [0, 1, 0])) });
    case "/api/chat":
      return new Response(
        chatReply.map((content) => `${JSON.stringify({ message: { role: "assistant", content } })}\n`).join("") +
        `${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

// runHeadlessEval from a new module graph (fresh store, library manifest, tool registry, shims).
// vi.resetModules keeps mocked modules cached, so the shims are re-registered too.
async function freshRun() {
  vi.resetModules();
  vi.doMock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
  vi.doMock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
  vi.doMock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
  vi.doMock("@tauri-apps/api/core", () => import("./shims/api-core"));
  return (await import("./run")).runHeadlessEval;
}

const bodies = (p: string) => calls.filter((c) => c.path === p).map((c) => c.body);

describe("headless eval == webview eval, on the wire", () => {
  let webview: { chat: unknown[]; embed: unknown[] };
  let headless: { chat: unknown[]; embed: unknown[]; out: Record<string, unknown> };
  let custom: { chat: unknown[]; embed: unknown[] };

  beforeAll(async () => {
    expect(RAG_HELDOUT.find((q) => q.id === ITEM)?.split).toBe("dev");
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin(); // the webview serves /library/… from its origin; this serves it from public/

    // A. The webview: a learner picked the model in Settings; main.tsx booted; the dev console ran
    //    window.__runRagEval(...), which is runRagEval.
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    calls = [];
    await runRagEval({ set: "dev", only: ITEM, modes: ["always"] });
    webview = { chat: bodies("/api/chat"), embed: bodies("/api/embed") };

    // B. The terminal: `EVAL_SET=dev EVAL_ONLY=h-pp01 EVAL_MODES=always npm run eval`. Each terminal
    //    run gets a fresh module graph, as a new process would: store.ts keeps the first Store it
    //    opens, and library.ts and the tool registry keep state too, so without the reset B would
    //    read A's settings, manifest and tools, and a boot step missing from run.ts would go unseen.
    calls = [];
    const f = await fs();
    const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-parity-`);
    try {
      const { outFile } = await (await freshRun())({ EVAL_MODEL: MODEL, EVAL_SET: "dev", EVAL_ONLY: ITEM, EVAL_MODES: "always", EVAL_OUT: `${dir}/run.json` });
      const out = JSON.parse(await f.readFile(outFile, "utf8")) as Record<string, unknown>;
      headless = { chat: bodies("/api/chat"), embed: bodies("/api/embed"), out };

      // C. The terminal again, with non-default settings: they must reach the request.
      calls = [];
      await (await freshRun())({ EVAL_MODEL: MODEL, EVAL_SET: "dev", EVAL_ONLY: ITEM, EVAL_MODES: "always", EVAL_CTX: "4096", EVAL_EMBED_MODEL: OTHER_EMBED, EVAL_OUT: `${dir}/run-c.json` });
      custom = { chat: bodies("/api/chat"), embed: bodies("/api/embed") };
    } finally {
      await f.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("sends Ollama the same chat request", () => {
    expect(webview.chat).toHaveLength(1);
    expect(headless.chat).toEqual(webview.chat);
  });

  it("sends Ollama the same embedding requests (vault seeding, then the question)", () => {
    expect(webview.embed.length).toBeGreaterThan(1);
    expect(headless.embed).toEqual(webview.embed);
  });

  it("the request is the one ChatTab's kernel builds: think off, num_ctx resolved, grounded user turn", () => {
    const body = headless.chat[0] as { model: string; stream: boolean; think: boolean; options: Record<string, number>; tools?: unknown[]; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(true);
    expect(body.think).toBe(false);
    // min(model window 32768, the app's default cap 8192), exactly as ChatTab resolves it.
    expect(body.options).toMatchObject({ num_ctx: 8192, num_predict: 8192 });
    expect(body.tools?.length).toBeGreaterThan(0);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("You are a helpful tutor.");
    const user = body.messages[body.messages.length - 1];
    expect(user.role).toBe("user");
    expect(user.content).toContain(MARLOW.text);
    expect(user.content.endsWith(ASK)).toBe(true);
    for (const e of headless.embed as Array<{ model: string }>) expect(e.model).toBe("nomic-embed-text");
  });

  it("applies EVAL_CTX and EVAL_EMBED_MODEL to the request", () => {
    const body = custom.chat[0] as { options: Record<string, number> };
    expect(body.options.num_ctx).toBe(4096);
    expect(custom.embed.length).toBeGreaterThan(1);
    for (const e of custom.embed as Array<{ model: string }>) expect(e.model).toBe(OTHER_EMBED);
  });

  it("writes per-row timings and the run's identity to the results file", () => {
    const out = headless.out as { set: string; model: string; commit: unknown; options: Record<string, unknown>; rows: Array<Record<string, unknown>> };
    expect(out.set).toBe("dev");
    expect(out.model).toBe(MODEL);
    expect(out.options).not.toHaveProperty("apiKey");
    // The Ollama version (null: this stand-in has no /api/version) and each model's digest.
    expect((out as unknown as { ollama: unknown }).ollama).toEqual({
      version: null,
      models: { [MODEL]: { name: MODEL, digest: "e2b-digest" }, "nomic-embed-text": { name: "nomic-embed-text:latest", digest: "embed-digest" } },
    });
    expect((out as unknown as { library: { enabled: boolean; cards: number } }).library).toMatchObject({ enabled: true, cards: expect.any(Number) });
    expect((out as unknown as { library: { cards: number } }).library.cards).toBeGreaterThan(0);
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0] as { ttft_ms: number; total_ms: number; retrievedTitles: string[]; answer: string };
    expect(typeof row.ttft_ms).toBe("number");
    expect(row.total_ms).toBeGreaterThanOrEqual(row.ttft_ms);
    expect(row.retrievedTitles).toContain(MARLOW.title);
    expect(row.answer).toBe("The sediment index was 3.71 across the pits.");
  });
});

// The same check for k12-flow: one dev item's three turns through the webview hook
// (window.__runK12FlowEval = runK12FlowEval) and through `EVAL_SUITE=k12-flow npm run eval`.
// Raw request bodies are compared, so this is byte for byte.
describe("headless k12-flow == webview k12-flow, on the wire", () => {
  const FLOW_ITEM = K12_ITEMS.find((x) => x.id === "math-k5-01")!; // math: the domain skill and tools are in play
  const raws = (p: string) => calls.filter((c) => c.path === p).map((c) => c.raw);
  const FLOW_REPLY = ["Not quite. Look at the numbers again. ", "Which option do you get when you work it out?"];
  let webview: { chat: unknown[]; embed: unknown[] };
  let headless: { chat: unknown[]; embed: unknown[]; out: Record<string, unknown> };

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    chatReply = FLOW_REPLY;

    // A. The webview: model picked in Settings, main.tsx's boot, then window.__runK12FlowEval({ only }).
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    calls = [];
    await runK12FlowEval({ only: FLOW_ITEM.id });
    webview = { chat: raws("/api/chat"), embed: raws("/api/embed") };

    // B. The terminal: `EVAL_SUITE=k12-flow EVAL_ONLY=math-k5-01 npm run eval`, in a fresh module graph.
    calls = [];
    const f = await fs();
    const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-parity-flow-`);
    try {
      const { outFile } = await (await freshRun())({ EVAL_SUITE: "k12-flow", EVAL_MODEL: MODEL, EVAL_ONLY: FLOW_ITEM.id, EVAL_OUT: `${dir}/run.json` });
      const out = JSON.parse(await f.readFile(outFile, "utf8")) as Record<string, unknown>;
      headless = { chat: raws("/api/chat"), embed: raws("/api/embed"), out };
    } finally {
      await f.rm(dir, { recursive: true, force: true });
      chatReply = RAG_REPLY;
    }
  }, 60_000);

  it("sends Ollama byte-identical chat requests: the warm-up, then T1, T2 and T3", () => {
    expect(webview.chat).toHaveLength(4);
    expect(headless.chat).toEqual(webview.chat);
    type Msg = { role: string; content: string };
    const turns = headless.chat.slice(1).map((r) => JSON.parse(r as string) as { messages: Msg[]; tools?: unknown[] });
    const lastUser = (m: Msg[]) => m.filter((x) => x.role === "user").slice(-1)[0].content;
    expect(turns.map((t) => t.messages[0].role)).toEqual(["system", "system", "system"]);
    expect(turns[0].messages[0].content).toContain("Mathematics");
    // T1 carries the first-turn hold note after the item's text (attemptFirst.ts); T2 and T3 do not.
    expect(lastUser(turns[0].messages).endsWith(withFirstTurnHold(formatK12FlowT1(FLOW_ITEM)))).toBe(true);
    expect(turns.slice(1).every((t) => t.messages.every((m) => !m.content.includes(FIRST_TURN_HOLD_NOTE)))).toBe(true);
    expect(lastUser(turns[1].messages).endsWith(formatK12FlowT2(FLOW_ITEM))).toBe(true);
    expect(lastUser(turns[2].messages).endsWith(K12_FLOW_T3)).toBe(true);
    for (const t of turns) expect(t.tools?.length).toBeGreaterThan(0);
  });

  it("swaps in the worked-answer rules on T3 only, when the chip was offered, before the tools manifest (lever L1)", () => {
    const row = (headless.out as { rows: Array<{ chipOffered: boolean; workedAnswerTurn: boolean; t3WorkedAnswerRules: boolean }> }).rows[0];
    expect(row).toMatchObject({ chipOffered: true, workedAnswerTurn: true, t3WorkedAnswerRules: true });
    type Msg = { role: string; content: string };
    const systems = headless.chat.slice(1).map((r) => (JSON.parse(r as string) as { messages: Msg[] }).messages[0].content);
    const [t1, t2, t3] = systems;
    expect(t2).toBe(t1);
    expect(t1).toContain(OUTPUT_RULES);
    expect(t1).not.toContain(WORKED_ANSWER_RULES);
    expect(t3).toBe(t1.replace(OUTPUT_RULES, WORKED_ANSWER_RULES));
    expect(t3).toMatch(/\n\n<tools>\n[\s\S]*<\/tools>$/);
  });

  it("sends Ollama byte-identical embedding requests", () => {
    expect(webview.embed.length).toBeGreaterThan(0);
    expect(headless.embed).toEqual(webview.embed);
  });

  it("writes each row with subject, band, the three turns and the detector verdicts, and a Wilson summary", () => {
    type Turn = { user: string; text: string; ttftMs: number; totalMs: number; toolCalls: unknown[]; firstTurnHold: boolean | null };
    const out = headless.out as {
      suite: string; split: string; partial: boolean; abort: unknown; options: Record<string, unknown>;
      rows: Array<{ id: string; subject: string; band: string; turns: Turn[]; grade: Record<string, unknown> }>;
      summary: { items: number; headline: { k: number; n: number; wilson: number[] }; g1: { wilson: number[] } };
    };
    expect(out).toMatchObject({ suite: "k12-flow", split: "dev", partial: true, abort: null });
    expect(out.options).not.toHaveProperty("apiKey");
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0];
    expect(row).toMatchObject({ id: FLOW_ITEM.id, subject: "math", band: "K-5" });
    expect(row.turns.map((t) => t.user)).toEqual([formatK12FlowT1(FLOW_ITEM), formatK12FlowT2(FLOW_ITEM), K12_FLOW_T3]);
    expect(row.turns.map((t) => t.firstTurnHold)).toEqual([true, false, false]);
    for (const t of row.turns) {
      expect(t.text).toBe(FLOW_REPLY.join(""));
      expect(typeof t.ttftMs).toBe("number");
      expect(t.totalMs).toBeGreaterThanOrEqual(t.ttftMs);
      expect(t.toolCalls).toEqual([]);
    }
    expect(row.grade).toMatchObject({ g1: expect.any(Boolean), g2: expect.any(Boolean), g3: false, g5: false, pass: false });
    expect(out.summary.items).toBe(1);
    expect(out.summary.headline).toMatchObject({ k: 0, n: 1 });
    expect(out.summary.headline.wilson).toHaveLength(2);
    expect(out.summary.g1.wilson).toHaveLength(2);
  });
});

// The same check for k12-flow-fr: one free-response item through its webview hook
// (window.__runK12FlowFrEval = runK12FlowFrEval) and through `EVAL_SUITE=k12-flow-fr npm run eval`.
describe("headless k12-flow-fr == webview k12-flow-fr, on the wire", () => {
  const FR_ITEM = K12_FR_ITEMS.find((x) => x.id === "fr-math-k5-06")!; // math: the domain skill and tools are in play
  const raws = (p: string) => calls.filter((c) => c.path === p).map((c) => c.raw);
  const FLOW_REPLY = ["Not quite. Think about the leftovers. ", "How many muffins are left after the full boxes?"];
  let webview: { chat: unknown[] };
  let headless: { chat: unknown[]; out: Record<string, unknown> };

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    chatReply = FLOW_REPLY;

    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    calls = [];
    await runK12FlowFrEval({ only: FR_ITEM.id });
    webview = { chat: raws("/api/chat") };

    calls = [];
    const f = await fs();
    const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-parity-fr-`);
    try {
      const { outFile } = await (await freshRun())({ EVAL_SUITE: "k12-flow-fr", EVAL_MODEL: MODEL, EVAL_ONLY: FR_ITEM.id, EVAL_OUT: `${dir}/run.json` });
      const out = JSON.parse(await f.readFile(outFile, "utf8")) as Record<string, unknown>;
      headless = { chat: raws("/api/chat"), out };
    } finally {
      await f.rm(dir, { recursive: true, force: true });
      chatReply = RAG_REPLY;
    }
  }, 60_000);

  it("sends Ollama byte-identical chat requests, with the typed problem alone as T1", () => {
    expect(webview.chat).toHaveLength(4);
    expect(headless.chat).toEqual(webview.chat);
    type Msg = { role: string; content: string };
    const turns = headless.chat.slice(1).map((r) => JSON.parse(r as string) as { messages: Msg[] });
    const lastUser = (m: Msg[]) => m.filter((x) => x.role === "user").slice(-1)[0].content;
    expect(turns[0].messages[0].content).toContain("Mathematics");
    expect(lastUser(turns[0].messages)).toBe(FR_ITEM.ask);
    expect(lastUser(turns[0].messages)).not.toMatch(/\bA\)|Which one is right/);
    expect(lastUser(turns[1].messages)).toBe(formatK12FlowFrT2(FR_ITEM));
    expect(lastUser(turns[2].messages)).toBe(K12_FLOW_T3);
  });

  it("sends T1 as a fresh conversation: the system prompt, the typed problem, and the tools", () => {
    type Req = { model: string; messages: Array<{ role: string; content: string }>; tools?: unknown[]; options?: unknown };
    const t1 = JSON.parse(headless.chat[1] as string) as Req;
    expect(t1.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(t1.tools?.length).toBeGreaterThan(0);
  });

  it("writes each row with source, subject, band, the three turns, the verdicts and a Wilson summary", () => {
    const out = headless.out as {
      suite: string; split: string; partial: boolean; abort: unknown;
      rows: Array<{ id: string; source: string; subject: string; band: string; key: string; attempted: string; turns: Array<{ user: string; text: string }>; chipOffered: boolean; workedAnswerTurn: boolean; t3WorkedAnswerRules: boolean; grade: Record<string, unknown> }>;
      summary: { items: number; headline: { k: number; n: number; wilson: number[] } };
    };
    expect(out).toMatchObject({ suite: "k12-flow-fr", split: "dev", partial: true, abort: null });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ id: FR_ITEM.id, source: "math-k5-06", subject: "math", band: "K-5", key: "16", attempted: "15", chipOffered: true, workedAnswerTurn: true, t3WorkedAnswerRules: true });
    expect(out.rows[0].turns.map((t) => t.user)).toEqual([FR_ITEM.ask, formatK12FlowFrT2(FR_ITEM), K12_FLOW_T3]);
    expect(out.rows[0].grade).toMatchObject({ g1: true, g2: true, g3: false, g5: false, pass: false });
    expect(out.summary).toMatchObject({ items: 1, headline: { k: 0, n: 1 } });
  });
});
