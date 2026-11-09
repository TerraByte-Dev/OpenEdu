import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever 9f, drop the passages on a notes-miss turn (kernel TutorEngine.ts, turnKind.ts notesDropNote),
// through runRagEval (what `npm run eval` and window.__runRagEval call) on the headless stand-ins, with a
// fake Ollama.
//
// The snapshot holds the raw /api/chat and /api/embed bodies with the drop off (TutorTurn.notesDrop,
// EVAL_NOTES_DROP=off). It was written by this test at 97762a6, the tip of feat/lookup-notes-miss
// (lever 9e), before any 9f code existed, so it pins that EVAL_NOTES_DROP=off sends exactly what 9e
// sent. The drop on must then change one thing only: on a turn where 9e fires and the asked-about
// phrase has at most NOTES_DROP_MAX_WORDS words, the grounding block is not put in front of the
// student's message and the note is notesDropNote. No request is added, no embedding changes, no other
// turn changes.
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
import { notesMissNote, notesDropNote } from "../../kernel/turnKind";
import { notesMissThing } from "../../kernel/askedThing";

const MODEL = "gemma4:e2b";

const VAULT: FixtureNote[] = [
  { title: "Field Guide — Pond Newt", text: "The pond newt regrows a lost tail in 17 days. It lives under stones in cold streams and hunts at dusk." },
  { title: "Shed Log", text: "The shed roof was patched in March. The rain barrel holds 190 litres and overflows after two days of rain." },
];

// id, question, the kind the classifier gives it, and the lookup note the turn should send with the drop on.
const CASES: Array<{ q: RagQuestion; kind: string; lookupNote: "lookup" | "notes-miss" | "notes-drop" | null; thing: string | null }> = [
  { q: { id: "fired", kind: "negative", ask: "How long does a gecko take to regrow its tail?", poison: "17" }, kind: "fact-lookup", lookupNote: "notes-drop", thing: "gecko" },
  { q: { id: "fired-3", kind: "negative", ask: "How long does a great crested newt take to regrow its tail?", poison: "17" }, kind: "fact-lookup", lookupNote: "notes-drop", thing: "great crested newt" },
  { q: { id: "fired-long", kind: "negative", ask: "How long does the small spotted orange mountain gecko take to regrow its tail?", poison: "17" }, kind: "fact-lookup", lookupNote: "notes-miss", thing: "small spotted orange mountain gecko" },
  { q: { id: "unfired", kind: "positive", ask: "How long does the pond newt take to regrow its tail?", expect: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: "pond newt" },
  { q: { id: "unparsed", kind: "positive", ask: "How many days does it need to regrow a lost tail?", expect: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: null },
  { q: { id: "no-hits", kind: "negative", ask: "Who painted the Zorvel frescoes?", poison: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: null },
  { q: { id: "options", kind: "negative", ask: "Which animal regrows its tail?\nA) newt\nB) horse\nC) cow\nD) sheep", poison: "17" }, kind: "options-problem", lookupNote: null, thing: null },
  { q: { id: "typed", kind: "negative", ask: "A newt regrows 3 mm of tail a day. How many mm does it regrow in 6 days?", poison: "17" }, kind: "typed-problem", lookupNote: null, thing: null },
  { q: { id: "other", kind: "negative", ask: "I saw a gecko regrow its tail today, so cool.", poison: "17" }, kind: "other", lookupNote: null, thing: null },
  { q: { id: "notes-say", kind: "positive", ask: "What do my notes say about the newt's tail?", expect: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: "notes" },
  { q: { id: "lead-in", kind: "negative", ask: "I'm studying lizards this week. How long does a gecko take to regrow its tail?", poison: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: null },
];

interface Call { path: string; raw: string | undefined }
let calls: Call[] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

// Tails, newts and geckos on one axis (so the gecko question reaches the newt note), the shed on a
// second, everything else on a third.
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
      return json({ embeddings: (body!.input as string[]).map((t) => (/tail|newt|gecko|geco/i.test(t) ? [1, 0, 0] : /shed|rain/i.test(t) ? [0, 1, 0] : [0, 0, 1])) });
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

describe("dropping the passages on a notes-miss turn: the requests Ollama sees", () => {
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
    for (const notesDrop of ["off", "on"] as const) {
      for (const { q } of CASES) {
        calls = [];
        const report = await runRagEval({ custom: { name: "notes-drop-path", vault: VAULT, questions: [q] }, modes: ["always"], syllabus: "matched", prompt: "product-course", notesMeaning: "off", ...(notesDrop === "off" ? { notesDrop } : {}) });
        // Model-info calls (/api/show, /api/tags) are cached across runs, so only the turn's own calls count.
        (notesDrop === "off" ? off : on)[q.id] = { chat: raws("/api/chat"), embed: raws("/api/embed"), paths: calls.map((c) => c.path).filter((x) => x === "/api/chat" || x === "/api/embed"), report };
      }
    }
  }, 120_000);

  it("classifies each case as intended (the cases test what they say they test)", () => {
    for (const c of CASES) expect(on[c.q.id].report.rows[0].turnKind, c.q.id).toBe(c.kind);
    expect(on["no-hits"].report.rows[0].retrievedTitles).toEqual([]);
    expect(on.fired.report.rows[0].retrievedTitles).toContain("Field Guide — Pond Newt");
    // 9e fires on all three fired cases; only the phrase length tells them apart.
    for (const id of ["fired", "fired-3", "fired-long"]) {
      const ask = CASES.find((c) => c.q.id === id)!.q.ask;
      expect(notesMissThing(ask, VAULT.map((n) => n.text)).fire, id).toBe(true);
    }
  });

  it("with the drop off, sends byte-identical requests to 9e's branch tip", () => {
    for (const { q } of CASES) {
      expect(off[q.id].chat, q.id).toMatchSnapshot(`${q.id} chat`);
      expect(off[q.id].embed, q.id).toMatchSnapshot(`${q.id} embed`);
    }
  });

  it("adds no request on any path: the same calls, in the same order, with the drop on", () => {
    for (const { q } of CASES) {
      expect(on[q.id].paths, q.id).toEqual(off[q.id].paths);
      expect(on[q.id].chat, q.id).toHaveLength(1);
      expect(on[q.id].embed, q.id).toEqual(off[q.id].embed);
    }
  });

  it("changes only the dropped turns, and there only the last user message: no block, and the drop note", () => {
    for (const { q } of CASES.filter((c) => c.lookupNote !== "notes-drop")) expect(on[q.id].chat, q.id).toEqual(off[q.id].chat);
    for (const [id, phrase] of [["fired", "gecko"], ["fired-3", "great crested newt"]] as const) {
      const offBody = JSON.parse(off[id].chat[0]!) as { messages: Msg[] };
      const onBody = JSON.parse(on[id].chat[0]!) as { messages: Msg[] };
      const last = offBody.messages.length - 1;
      const ask = CASES.find((c) => c.q.id === id)!.q.ask;
      // 9e's message: block, blank line, the question, blank line, the notes-miss note.
      expect(offBody.messages[last].content.endsWith(`${ask}\n\n${notesMissNote(phrase)}`), id).toBe(true);
      expect(offBody.messages[last].content).toContain("The pond newt regrows a lost tail in 17 days.");
      // 9f's: the question, blank line, the drop note. Everything before the last message is unchanged.
      const dropped = { ...offBody.messages[last], content: `${ask}\n\n${notesDropNote(phrase)}` };
      expect(onBody, id).toEqual({ ...offBody, messages: [...offBody.messages.slice(0, last), dropped] });
      expect(lastContent(on[id].chat[0]!)).not.toContain("17");
    }
  });

  it("records the note each row sent and the phrase it parsed; with the drop off a dropped row is a notes-miss row", () => {
    for (const c of CASES) {
      const r = on[c.q.id].report.rows[0];
      expect([r.lookupNote, r.askedThing], c.q.id).toEqual([c.lookupNote, c.thing]);
      const o = off[c.q.id].report.rows[0];
      expect([o.lookupNote, o.askedThing], c.q.id).toEqual([c.lookupNote === "notes-drop" ? "notes-miss" : c.lookupNote, c.thing]);
    }
    // The passages are still retrieved and reported on a dropped turn, only not shown.
    expect(on.fired.report.rows[0].retrievedTitles).toEqual(off.fired.report.rows[0].retrievedTitles);
    expect(on.fired.report.notesDrop).toBe("on");
    expect(off.fired.report.notesDrop).toBe("off");
    expect(on.fired.report.rows[0].turnNoted).toBe(true);
  });
});
