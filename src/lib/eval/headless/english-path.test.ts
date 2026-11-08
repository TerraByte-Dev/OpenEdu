import { describe, it, expect, vi, beforeAll } from "vitest";

// English turns must reach Ollama byte for byte as they did before lever L2 (translate non-English
// questions before retrieval, docs/BENCHMARKS.md section 3, row 2).
//
// The snapshot below was written by this test on master, before any L2 code existed. It holds the raw
// /api/chat and /api/embed request bodies for a handful of English turns through the real kernel, on
// the headless platform stand-ins (in-memory SQLite with the real migrations, Node fetch, in-memory
// store). If L2, or anything after it, changes one byte of an English turn's requests, or adds a
// request, this fails. Updating the snapshot is a claim that English turns changed on purpose.
//
// The vault and questions are written for this test and are not from any eval set. The questions cover
// the shapes most likely to trip a script check: plain English, a Greek letter in maths, Latin
// letters with accents, a quoted symbol, and an acknowledgement that skips retrieval.

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runRagEval } from "../rag-runner";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import type { FixtureNote, RagQuestion } from "../rag-fixture";

const MODEL = "gemma4:e2b";

const VAULT: FixtureNote[] = [
  { title: "Garden Log", text: "The greenhouse tomatoes were planted on the third of May. The soil pH in bed two read 6.4, and the drip line runs for twenty minutes each morning." },
  { title: "Trig Notes", text: "For a right triangle, sin of an angle is the opposite side over the hypotenuse. With a hypotenuse of 5 and an opposite side of 3, sin is 0.6." },
];

const ENGLISH_QUESTIONS: RagQuestion[] = [
  { id: "en-plain", kind: "positive", ask: "What was the soil pH in bed two of the greenhouse?", expect: "6.4" },
  { id: "en-greek", kind: "positive", ask: "If the hypotenuse is 5 and the opposite side is 3, what is sin θ?", expect: "0.6" },
  { id: "en-accent", kind: "negative", ask: "Is a café au lait stronger than a naïve espresso?", poison: "6.4" },
  { id: "en-symbol", kind: "negative", ask: "What does the symbol π stand for in the formula for a circle's area?", poison: "0.6" },
  { id: "en-ack", kind: "negative", ask: "ok thanks", poison: "6.4" },
];

interface Call { path: string; raw: string | undefined }
let calls: Call[] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// A stand-in Ollama. Garden text on one axis, trig text on another, everything else on a third.
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const raw = init?.body ? String(init.body) : undefined;
  const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
  calls.push({ path: url.pathname, raw });
  switch (url.pathname) {
    case "/api/tags":
      return json({ models: [{ name: MODEL }, { name: "nomic-embed-text:latest" }] });
    case "/api/show":
      return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/version":
      return json({ version: "0.40.15" });
    case "/api/embed":
      return json({ embeddings: (body!.input as string[]).map((t) => (/greenhouse|soil|garden/i.test(t) ? [1, 0, 0] : /hypotenuse|sin/i.test(t) ? [0, 1, 0] : [0, 0, 1])) });
    case "/api/chat":
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "From your notes: " } })}\n` +
        `${JSON.stringify({ message: { role: "assistant", content: "the reading was 6.4." } })}\n` +
        `${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

const raws = (p: string) => calls.filter((c) => c.path === p).map((c) => c.raw);

describe("English turns: the requests Ollama sees", () => {
  let perQuestion: Array<{ id: string; chat: Array<string | undefined>; embed: Array<string | undefined> }> = [];
  let seedingEmbeds: Array<string | undefined> = [];

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();

    // One run per question, so each question's requests are isolated.
    perQuestion = [];
    for (const q of ENGLISH_QUESTIONS) {
      calls = [];
      await runRagEval({ custom: { name: "english-path", vault: VAULT, questions: [q] }, modes: ["always"], syllabus: "matched" });
      const embeds = raws("/api/embed");
      // The first VAULT.length embed calls seed the vault; the rest belong to the turn.
      seedingEmbeds = embeds.slice(0, VAULT.length);
      perQuestion.push({ id: q.id, chat: raws("/api/chat"), embed: embeds.slice(VAULT.length) });
    }
  }, 60_000);

  it("sends exactly one chat request per English turn", () => {
    for (const q of perQuestion) expect(q.chat, q.id).toHaveLength(1);
  });

  it("embeds each English question once (none for an acknowledgement)", () => {
    for (const q of perQuestion) expect(q.embed, q.id).toHaveLength(q.id === "en-ack" ? 0 : 1);
  });

  it("sends byte-identical chat and embedding requests to the pre-L2 snapshot", () => {
    expect(seedingEmbeds).toMatchSnapshot("vault seeding");
    for (const q of perQuestion) {
      expect(q.chat, q.id).toMatchSnapshot(`${q.id} chat`);
      expect(q.embed, q.id).toMatchSnapshot(`${q.id} embed`);
    }
  });
});
