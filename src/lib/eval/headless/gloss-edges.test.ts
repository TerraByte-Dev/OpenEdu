import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever L2 at its edges, through the real kernel on the headless stand-ins (review of PR #188):
//   - a real-topic question in Hindi whose gloss matches a card in the bundled library (finding 6). The
//     RAG dev set cannot reach this path: its notes are about made-up things, so no dev gloss can match
//     a library card. With three strong notes the question finds them as written, so no gloss is made;
//   - a gloss call that never answers: the turn goes ahead on the original question alone once
//     GLOSS_TIMEOUT_MS has passed (finding 4).
// The vaults and questions are written for this test and are not from any eval set.

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
import { GLOSS_TIMEOUT_MS } from "../../kernel/gloss";
import type { FixtureNote, RagQuestion } from "../rag-fixture";

const MODEL = "gemma4:e2b";
const CARD = "Photosynthesis vs Cellular Respiration"; // public/library: biology/photosynthesis-respiration
const ASK = "प्रकाश संश्लेषण में पौधे किस गैस का उपयोग करते हैं?";
const GLOSS = "What gas do plants use in photosynthesis?";

type Body = { messages?: Array<{ role: string; content: string }>; format?: unknown; input?: string[] };
let chat: Body[] = [];
let embeds: string[][] = [];
let glossMode: "answer" | "hang" = "answer";

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// Hindi and English photosynthesis text share one axis; everything else is on the other.
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
      embeds.push(body.input!);
      return json({ embeddings: body.input!.map((t) => (/photosynth|chlorophyll|प्रकाश/i.test(t) ? [1, 0] : [0, 1])) });
    case "/api/chat":
      chat.push(body);
      if (body.format) {
        if (glossMode === "hang") {
          // A runner that never answers: resolves only by the client giving up.
          return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
        }
        return json({ message: { role: "assistant", content: JSON.stringify({ english: GLOSS }) }, done: true, done_reason: "stop" });
      }
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "Plants take in carbon dioxide." } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

async function run(vault: FixtureNote[], q: RagQuestion, mode: typeof glossMode): Promise<{ report: RagReport; chat: Body[]; turnEmbeds: string[][] }> {
  chat = [];
  embeds = [];
  glossMode = mode;
  const report = await runRagEval({ custom: { name: "gloss-edges", vault, questions: [q] }, modes: ["always"], syllabus: "matched" });
  return { report, chat, turnEmbeds: embeds.slice(vault.length) };
}

const UNRELATED: FixtureNote[] = [
  { title: "Garden Log", text: "The greenhouse tomatoes were planted on the third of May. The soil pH in bed two read 6.4." },
];
const PHOTO_NOTES: FixtureNote[] = [
  { title: "Leaf Notes", text: "Photosynthesis happens in the leaf. The stomata let gas in and out." },
  { title: "Chlorophyll Notes", text: "Chlorophyll absorbs red and blue light and reflects green, which is why leaves look green." },
  { title: "Light Notes", text: "Photosynthesis slows on a cloudy day because less light reaches the chlorophyll." },
];
const Q: RagQuestion = { id: "hi-photo", kind: "positive", ask: ASK, expect: "carbon dioxide" };

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

describe("a real-topic non-Latin question and the bundled library (finding 6)", () => {
  it("pins the library card the gloss matches, which the Hindi question alone cannot reach", async () => {
    const { report, chat } = await run(UNRELATED, Q, "answer");
    const row = report.rows[0];
    expect(row.retrieval.gloss).toMatchObject({ text: GLOSS });
    expect(row.retrievedTitles).toEqual([CARD]);
    const reply = chat[chat.length - 1];
    const last = reply.messages![reply.messages!.length - 1].content;
    expect(last).toContain(`[REFERENCE: ${CARD}]`);
    expect(last.endsWith(`\n\n${ASK}`)).toBe(true);
    expect(JSON.stringify(reply)).not.toContain(GLOSS);
  }, 30_000);

  it("when the question already reaches its notes, makes no gloss call and the card cannot displace a note", async () => {
    // Fallback-only (L2b, PR #188): gloss-only passages join only a search that found nothing.
    const { report, chat, turnEmbeds } = await run(PHOTO_NOTES, Q, "answer");
    const row = report.rows[0];
    expect(row.retrieval.gloss).toBeUndefined();
    expect(chat.filter((b) => b.format)).toHaveLength(0);
    expect(turnEmbeds).toEqual([[ASK]]);
    expect([...row.retrievedTitles].sort()).toEqual(PHOTO_NOTES.map((n) => n.title).sort());
  }, 30_000);
});

describe("fallback-only: a library card found as written blocks the gloss (known limit)", () => {
  it("makes no gloss call when the question's one Latin word pins a card, so a note only the gloss reaches is missed", async () => {
    // The question is about a greenhouse note; its Latin "pH" matches the library's pH card. That card
    // is a hit above the floor, so L2b does not gloss, and the note (reachable only in English) is not
    // retrieved. Recorded here so a change to this behaviour is a decision, not an accident.
    // On the fake embedder this note sits on the English axis, away from the Hindi question.
    const greenhouse: FixtureNote[] = [{ title: "Garden Log", text: "Greenhouse chlorophyll readings were normal, and the soil pH in bed two read 6.4." }];
    const ask = "ग्रीनहाउस के बेड दो में मिट्टी का pH कितना था?";
    const { report, chat } = await run(greenhouse, { id: "hi-ph", kind: "positive", ask, expect: "6.4" }, "answer");
    const row = report.rows[0];
    expect(row.retrieval.gloss).toBeUndefined();
    expect(chat.filter((b) => b.format)).toHaveLength(0);
    expect(row.retrievedTitles).toEqual(["The pH Scale"]);
  }, 30_000);
});

describe("a gloss call that never answers (finding 4)", () => {
  it("gives up after GLOSS_TIMEOUT_MS and retrieves on the original question alone", async () => {
    const started = performance.now();
    const { report, chat, turnEmbeds } = await run(UNRELATED, Q, "hang");
    const row = report.rows[0];
    expect(row.retrieval.gloss?.text).toBeNull();
    expect(row.retrieval.gloss?.error).toMatch(/timed out/);
    expect(row.retrieval.gloss!.ms).toBeGreaterThanOrEqual(GLOSS_TIMEOUT_MS - 50);
    expect(row.retrieval.gloss!.ms).toBeLessThan(GLOSS_TIMEOUT_MS + 2_000);
    expect(turnEmbeds).toEqual([[ASK]]);
    expect(row.retrievedTitles).toEqual([]); // the Hindi question alone reaches neither note nor card
    expect(chat.filter((b) => !b.format)).toHaveLength(1); // the reply still went out
    expect(row.answer).toContain("carbon dioxide");
    expect(performance.now() - started).toBeLessThan(GLOSS_TIMEOUT_MS + 10_000);
  }, 30_000);
});
