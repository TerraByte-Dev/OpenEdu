import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever 3 (kernel/entityGate.ts) on the wire: the gate as ground() runs it inside the real kernel, through
// runRagEval on the headless stand-ins, with a fake Ollama that puts every text on one axis (so every
// note is a perfect-score candidate and only the gate can remove one).
//   - An English question naming a different entity: the note is dropped before the floor and cap, the
//     trace says so, the empty-vault guard still sees the candidate, and no <context> reaches the model.
//   - A non-Latin question whose L2 gloss names the same entity: the gate reads the student's words, not
//     the gloss, so the note stays.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runRagEval, type RagRow } from "../rag-runner";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { RAG_DEV_V2_VAULT } from "../rag-dev-v2";
import type { RagQuestion } from "../rag-fixture";

const MODEL = "gemma4:e2b";
const NOTE = RAG_DEV_V2_VAULT.find((n) => n.title.includes("Corrabeth"))!;
const GLOSS = "How tall is Ben Nevis?";
const QUESTIONS: RagQuestion[] = [
  { id: "en", kind: "negative", ask: "How tall is Ben Nevis?", poison: "2,614" },
  { id: "hi", kind: "negative", ask: "बेन नेविस कितना ऊँचा है?", poison: "2,614" },
];

type Body = { messages?: Array<{ role: string; content: string }>; format?: unknown; input?: string[] };
let replies: Body[] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

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
      return json({ embeddings: body.input!.map(() => [1, 0]) });
    case "/api/chat":
      if (body.format) return json({ message: { role: "assistant", content: JSON.stringify({ english: GLOSS }) }, done: true, done_reason: "stop" });
      replies.push(body);
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "About 1,345 metres." } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

describe("the entity gate inside ground()", () => {
  const rows = new Map<string, { row: RagRow; reply: Body }>();

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    for (const q of QUESTIONS) {
      replies = [];
      const report = await runRagEval({ custom: { name: "entity-gate-path", vault: [NOTE], questions: [q] }, modes: ["always"], syllabus: "matched" });
      rows.set(q.id, { row: report.rows[0], reply: replies[0] });
    }
  }, 60_000);

  it("drops the note for an English question that names a different entity", () => {
    const { row, reply } = rows.get("en")!;
    expect(row.retrieval.entityGate).toEqual({ entities: ["ben", "nevis"], dropped: [NOTE.title] });
    expect(row.retrieval.noteCandidates).toBe(1);
    expect(row.retrieval.hitTitles).toEqual([]);
    expect(row.retrieval.skipped).toBe("entity-gate");
    expect(reply.messages!.map((m) => m.content).join("\n")).not.toContain("<context>");
  });

  it("does not read L2's gloss: a non-Latin question keeps the note", () => {
    const { row, reply } = rows.get("hi")!;
    expect(row.retrieval.gloss?.text).toBe(GLOSS);
    expect(row.retrieval.entityGate).toBeUndefined();
    expect(row.retrieval.hitTitles).toEqual([NOTE.title]);
    expect(reply.messages!.map((m) => m.content).join("\n")).toContain("<context>");
  });
});
