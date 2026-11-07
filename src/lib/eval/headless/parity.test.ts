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
import { runHeadlessEval } from "./run";
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
const MARLOW = RAG_FIXTURE.find((n) => n.title === "Field Notes — Marlow Basin")!;
const ASK = RAG_HELDOUT.find((q) => q.id === ITEM)!.ask;

interface Call { path: string; body: Record<string, unknown> | undefined }
let calls: Call[] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// A stand-in Ollama. Embeddings put every Marlow text on one axis and everything else on another, so
// retrieval finds the Marlow note and nothing depends on a real embedder.
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
  calls.push({ path: url.pathname, body });
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL }, { name: "nomic-embed-text:latest" }] });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/embed":
      return json({ embeddings: (body!.input as string[]).map((t) => (/marlow/i.test(t) ? [1, 0, 0] : [0, 1, 0])) });
    case "/api/chat":
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "The sediment index was " } })}\n` +
        `${JSON.stringify({ message: { role: "assistant", content: "3.71 across the pits." } })}\n` +
        `${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

const bodies = (p: string) => calls.filter((c) => c.path === p).map((c) => c.body);

describe("headless eval == webview eval, on the wire", () => {
  let webview: { chat: unknown[]; embed: unknown[] };
  let headless: { chat: unknown[]; embed: unknown[]; out: Record<string, unknown> };

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

    // B. The terminal: `EVAL_SET=dev EVAL_ONLY=h-pp01 EVAL_MODES=always npm run eval`.
    resetStores();
    calls = [];
    const f = await fs();
    const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-parity-`);
    try {
      const { outFile } = await runHeadlessEval({ EVAL_MODEL: MODEL, EVAL_SET: "dev", EVAL_ONLY: ITEM, EVAL_MODES: "always", EVAL_OUT: `${dir}/run.json` });
      const out = JSON.parse(await f.readFile(outFile, "utf8")) as Record<string, unknown>;
      headless = { chat: bodies("/api/chat"), embed: bodies("/api/embed"), out };
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

  it("writes per-row timings and the run's identity to the results file", () => {
    const out = headless.out as { set: string; model: string; commit: unknown; options: Record<string, unknown>; rows: Array<Record<string, unknown>> };
    expect(out.set).toBe("dev");
    expect(out.model).toBe(MODEL);
    expect(out.options).not.toHaveProperty("apiKey");
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0] as { ttft_ms: number; total_ms: number; retrievedTitles: string[]; answer: string };
    expect(typeof row.ttft_ms).toBe("number");
    expect(row.total_ms).toBeGreaterThanOrEqual(row.ttft_ms);
    expect(row.retrievedTitles).toContain(MARLOW.title);
    expect(row.answer).toBe("The sediment index was 3.71 across the pits.");
  });
});
