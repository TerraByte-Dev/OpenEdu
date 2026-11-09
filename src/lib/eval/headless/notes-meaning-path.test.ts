import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever 9g, the meaning check under the notes-miss switch (kernel meaning.ts, TutorEngine.ts), through
// runRagEval (what `npm run eval` and window.__runRagEval call) on the headless stand-ins, with a fake
// Ollama. With the check off (TutorTurn.notesMeaning, EVAL_NOTES_MEANING=off) the turn is lever 9f's. With
// it on, a turn the word switch would fire on makes one more /api/embed call (the question and every
// shown sentence) and fires only when no sentence is within NOTES_MEANING_MIN of the question; otherwise,
// or when that call fails, it sends the plain lookup note with the passages. No other turn changes.
//
// The vault and questions are written for this test and are not from any eval set.

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
import type { FixtureNote, RagQuestion } from "../rag-fixture";
import { FACT_LOOKUP_NOTE, notesDropNote } from "../../kernel/turnKind";
import { notesMissThing } from "../../kernel/askedThing";
import { meaningSentences, NOTES_MEANING_MIN } from "../../kernel/meaning";

const MODEL = "gemma4:e2b";

const VAULT: FixtureNote[] = [
  { title: "Field Guide — Pond Newt", text: "The pond newt regrows a lost tail in 17 days. It lives under stones in cold streams and hunts at dusk." },
  { title: "Shed Log", text: "The shed roof was patched in March. The rain barrel holds 190 litres and overflows after two days of rain." },
];

// The word switch (askedThing.ts) fires on "gecko", "salamander" and "axolotl" (none is in the notes) and
// not on "pond newt". The fake embedder puts the gecko question far from the newt sentence (cosine 0.6)
// and the salamander question close to it (0.8); for the axolotl question the check's embed call fails.
const CASES: Array<{ q: RagQuestion; lookupNote: "lookup" | "notes-drop"; offNote: "lookup" | "notes-drop"; nearest: number | null | undefined }> = [
  { q: { id: "far", kind: "negative", ask: "How long does a gecko take to regrow its tail?", poison: "17" }, lookupNote: "notes-drop", offNote: "notes-drop", nearest: 0.6 },
  { q: { id: "close", kind: "negative", ask: "How long does a salamander take to regrow its tail?", poison: "17" }, lookupNote: "lookup", offNote: "notes-drop", nearest: 0.8 },
  { q: { id: "embed-fails", kind: "negative", ask: "How long does an axolotl take to regrow its tail?", poison: "17" }, lookupNote: "lookup", offNote: "notes-drop", nearest: null },
  { q: { id: "unfired", kind: "positive", ask: "How long does the pond newt take to regrow its tail?", expect: "17" }, lookupNote: "lookup", offNote: "lookup", nearest: undefined },
];

interface Call { path: string; raw: string | undefined }
let calls: Call[] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

const vec = (t: string): number[] =>
  /gecko/i.test(t) ? [0.6, 0, 0.8] : /salamander|axolotl/i.test(t) ? [0.8, 0, 0.6] : /newt/i.test(t) ? [1, 0, 0] : /shed|rain/i.test(t) ? [0, 1, 0] : [0, 0, -1];

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
    case "/api/embed": {
      const texts = body!.input as string[];
      if (texts.length > 1 && /axolotl/i.test(texts[0])) return new Response("boom", { status: 400 });
      return json({ embeddings: texts.map(vec) });
    }
    case "/api/chat":
      return new Response(
        `${JSON.stringify({ message: { role: "assistant", content: "It takes about a month." } })}\n` +
        `${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
        { status: 200 },
      );
    default:
      return new Response("not found", { status: 404 });
  }
}

// Bundled cards are LF in git but CRLF in a Windows checkout; pin what the code sends (english-path.test.ts).
const raws = (p: string) => calls.filter((c) => c.path === p).map((c) => c.raw?.replaceAll("\\r\\n", "\\n"));
type Msg = { role: string; content: string };
const lastContent = (raw: string) => { const m = (JSON.parse(raw) as { messages: Msg[] }).messages; return m[m.length - 1].content; };

interface Arm { chat: Array<string | undefined>; embed: Array<string | undefined>; paths: string[]; report: RagReport }

describe("the meaning check under the notes-miss switch: the requests Ollama sees", () => {
  const off: Record<string, Arm> = {};
  const on: Record<string, Arm> = {};

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    registerBuiltinTools();
    await loadBuiltinSkills();
    await refreshManifest();
    await refreshDatasetManifest();
    for (const notesMeaning of ["off", "on"] as const) {
      for (const { q } of CASES) {
        calls = [];
        const report = await runRagEval({ custom: { name: "notes-meaning-path", vault: VAULT, questions: [q] }, modes: ["always"], syllabus: "matched", prompt: "product-course", ...(notesMeaning === "off" ? { notesMeaning } : {}) });
        // Model-info calls (/api/show, /api/tags) are cached across runs, so only the turn's own calls count.
        (notesMeaning === "off" ? off : on)[q.id] = { chat: raws("/api/chat"), embed: raws("/api/embed"), paths: calls.map((c) => c.path).filter((x) => x === "/api/chat" || x === "/api/embed"), report };
      }
    }
  }, 120_000);

  it("retrieves the newt note for every case and fires the word switch on all but the newt question", () => {
    for (const { q } of CASES) expect(on[q.id].report.rows[0].retrievedTitles, q.id).toContain("Field Guide — Pond Newt");
    for (const id of ["far", "close", "embed-fails"]) {
      const ask = CASES.find((c) => c.q.id === id)!.q.ask;
      expect(notesMissThing(ask, [VAULT[0].text]).fire, id).toBe(true);
    }
    expect(notesMissThing(CASES[3].q.ask, [VAULT[0].text]).fire).toBe(false);
    expect(0.6).toBeLessThan(NOTES_MEANING_MIN);
    expect(0.8).toBeGreaterThanOrEqual(NOTES_MEANING_MIN);
  });

  it("records the note each row sent, and the check's score only where it was asked", () => {
    for (const c of CASES) {
      const r = on[c.q.id].report.rows[0];
      expect(r.lookupNote, c.q.id).toBe(c.lookupNote);
      if (c.nearest === undefined) expect("nearest" in r, c.q.id).toBe(false);
      else if (c.nearest === null) expect(r.nearest, c.q.id).toBeNull();
      else expect(r.nearest, c.q.id).toBeCloseTo(c.nearest, 6);
      const o = off[c.q.id].report.rows[0];
      expect(o.lookupNote, c.q.id).toBe(c.offNote);
      expect("nearest" in o, c.q.id).toBe(false);
    }
    expect(on.far.report.notesMeaning).toBe("on");
    expect(off.far.report.notesMeaning).toBe("off");
  });

  it("adds one /api/embed call, after retrieval and before the chat, only where the switch would fire: the question and every shown sentence", () => {
    for (const { q } of CASES) {
      const extra = q.id === "unfired" ? 0 : 1;
      // Seeding embeds the two notes, then retrieval embeds the question; the check's call comes last.
      expect(off[q.id].paths, q.id).toEqual(["/api/embed", "/api/embed", "/api/embed", "/api/chat"]);
      expect(on[q.id].paths, q.id).toEqual(["/api/embed", "/api/embed", "/api/embed", ...Array(extra).fill("/api/embed"), "/api/chat"]);
      expect(on[q.id].embed.slice(0, 3), q.id).toEqual(off[q.id].embed);
      if (extra) expect(JSON.parse(on[q.id].embed[3]!).input, q.id).toEqual([q.ask, ...meaningSentences([VAULT[0].text])]);
    }
  });

  it("sends 9f's request where the check lets the switch fire, and the plain lookup note with the passages where it does not", () => {
    expect(on.far.chat).toEqual(off.far.chat);
    expect(on.unfired.chat).toEqual(off.unfired.chat);
    for (const [id, phrase] of [["close", "salamander"], ["embed-fails", "axolotl"]] as const) {
      const ask = CASES.find((c) => c.q.id === id)!.q.ask;
      const offBody = JSON.parse(off[id].chat[0]!) as { messages: Msg[] };
      const onBody = JSON.parse(on[id].chat[0]!) as { messages: Msg[] };
      const last = offBody.messages.length - 1;
      expect(lastContent(off[id].chat[0]!), id).toBe(`${ask}\n\n${notesDropNote(phrase)}`);
      const content = lastContent(on[id].chat[0]!);
      expect(content.startsWith("<context>"), id).toBe(true);
      expect(content, id).toContain("The pond newt regrows a lost tail in 17 days.");
      expect(content.endsWith(`${ask}\n\n${FACT_LOOKUP_NOTE}`), id).toBe(true);
      expect({ ...onBody, messages: onBody.messages.slice(0, last) }, id).toEqual({ ...offBody, messages: offBody.messages.slice(0, last) });
    }
  });
});
