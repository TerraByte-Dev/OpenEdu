import { describe, it, expect, vi, beforeAll } from "vitest";

// The dev vault v2 set and the two new row fields, through runRagEval (the function `npm run eval` and
// window.__runRagEval call) on the headless stand-ins, with a fake Ollama:
//   - EVAL_SET=dev-v2 seeds rag-dev-v2.ts's own vault, not RAG_FIXTURE, and asks its items;
//   - `noteRetrieved` reads the gold or near note from the hits the model saw;
//   - `realWorld` scores a near-miss's real-world answer, and the v1 list on the v1 sets only.

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
import { RAG_DEV_V2_VAULT } from "../rag-dev-v2";
import { RAG_FIXTURE } from "../rag-fixture";

const MODEL = "gemma4:e2b";
type Body = { input?: string[]; messages?: Array<{ role: string; content: string }> };
let embedded: string[] = [];
let reply = "";

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// Text about boiling, or about Ben Nevis and Ashcombe, sits on one axis; the gecko question alone on a
// second, so it reaches no note; everything else on a third.
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Body;
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL }, { name: "nomic-embed-text:latest" }] });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/version":
      return json({ version: "0.40.15" });
    case "/api/embed":
      embedded.push(...body.input!);
      return json({ embeddings: body.input!.map((t) => (/boil|nevis|ashcombe/i.test(t) ? [1, 0, 0] : /gecko/i.test(t) ? [0, 1, 0] : [0, 0, 1])) });
    case "/api/chat":
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: reply } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

async function run(opts: Parameters<typeof runRagEval>[0], answer: string): Promise<RagReport> {
  embedded = [];
  reply = answer;
  return runRagEval({ modes: ["always"], syllabus: "matched", ...opts });
}

describe("EVAL_SET=dev-v2 through runRagEval", () => {
  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
  }, 60_000);

  it("seeds the v2 vault, asks its items, and records note retrieval and real-world answered", async () => {
    const report = await run({ set: "dev-v2", only: "v2-pf01,v2-nl01,v2-nl03" }, "Glycerol boils at 290 °C.");
    expect(report.set).toBe("dev-v2");
    expect(report.rows.map((r) => r.question.id)).toEqual(["v2-pf01", "v2-nl01", "v2-nl03"]);
    for (const n of RAG_DEV_V2_VAULT) expect(embedded.some((t) => t.includes(n.text.slice(0, 40))), n.title).toBe(true);
    for (const n of RAG_FIXTURE) expect(embedded.some((t) => t.includes(n.text.slice(0, 40))), n.title).toBe(false);

    const [pf01, nl01, nl03] = report.rows;
    expect(pf01.noteRetrieved).toBe(true); // "boil" reaches the oil note
    expect(nl01.noteRetrieved).toBe(true);
    expect(nl03.noteRetrieved).toBe(false); // the gecko question does not
    expect(pf01.realWorld).toBeNull(); // a positive
    expect(nl01.realWorld).toBe(true);
    expect(nl03.realWorld).toBeNull(); // graded: no crisp answer
    expect(report.realWorld.always).toEqual({ answered: 1, total: 1 });
    expect(report.noteRetrieved.always).toEqual({ positive: { retrieved: 1, total: 1 }, negative: { retrieved: 1, total: 2 } });
  }, 60_000);

  it("scores the v1 real-world list on the v1 dev split, and nothing on the main set", async () => {
    const dev = await run({ set: "dev", only: "h-nm23,h-nm01" }, "Ben Nevis is 1,345 metres high.");
    expect(dev.rows.map((r) => r.realWorld)).toEqual([null, true]);
    expect(dev.realWorld.always).toEqual({ answered: 1, total: 1 });
    const refused = await run({ set: "dev", only: "h-nm23" }, "I don't have the height of Ben Nevis in my notes.");
    expect(refused.realWorld.always).toEqual({ answered: 0, total: 1 });
    const main = await run({ set: "main", only: "n1,n4" }, "Ethanol boils at 78 °C.");
    expect(main.rows.map((r) => r.realWorld)).toEqual([null, null]);
    expect(main.rows.map((r) => r.noteRetrieved)).toEqual([null, null]); // main items name no note
  }, 60_000);
});
