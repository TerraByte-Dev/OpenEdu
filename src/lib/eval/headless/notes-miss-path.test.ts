import { describe, it, expect, vi, beforeAll } from "vitest";

// Lever 9e, the notes-miss switch (kernel askedThing.ts + TutorEngine.ts), through runRagEval (what
// `npm run eval` and window.__runRagEval call) on the headless stand-ins, with a fake Ollama.
//
// The snapshot holds the raw /api/chat and /api/embed bodies with the switch off (TutorTurn.notesMiss,
// EVAL_NOTES_MISS=off). It was written by this test at the merge commit before the lever (the branch
// tip, where no switch existed), so it pins that EVAL_NOTES_MISS=off sends exactly what the branch tip
// sent. The switch on must then change one thing only: on a lookup turn whose shown passages do not
// contain the asked-about thing, the lookup note at the end of the last user message becomes the
// notes-miss note. No request is added, no embedding changes, no other turn changes.
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
import { FACT_LOOKUP_NOTE, notesMissNote } from "../../kernel/turnKind";
import { notesMissThing } from "../../kernel/askedThing";

const MODEL = "gemma4:e2b";

const VAULT: FixtureNote[] = [
  { title: "Field Guide — Pond Newt", text: "The pond newt regrows a lost tail in 17 days. It lives under stones in cold streams and hunts at dusk." },
  { title: "Shed Log", text: "The shed roof was patched in March. The rain barrel holds 190 litres and overflows after two days of rain." },
];

// id, question, the kind the classifier gives it, and what the switch should do.
const CASES: Array<{ q: RagQuestion; kind: string; lookupNote: "lookup" | "notes-miss" | null; thing: string | null }> = [
  { q: { id: "fired", kind: "negative", ask: "How long does a gecko take to regrow its tail?", poison: "17" }, kind: "fact-lookup", lookupNote: "notes-miss", thing: "gecko" },
  { q: { id: "unfired", kind: "positive", ask: "How long does the pond newt take to regrow its tail?", expect: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: "pond newt" },
  { q: { id: "unparsed", kind: "positive", ask: "How many days does it need to regrow a lost tail?", expect: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: null },
  { q: { id: "no-hits", kind: "negative", ask: "Who painted the Zorvel frescoes?", poison: "17" }, kind: "fact-lookup", lookupNote: "lookup", thing: null },
  { q: { id: "options", kind: "negative", ask: "Which animal regrows its tail?\nA) newt\nB) horse\nC) cow\nD) sheep", poison: "17" }, kind: "options-problem", lookupNote: null, thing: null },
  { q: { id: "typed", kind: "negative", ask: "A newt regrows 3 mm of tail a day. How many mm does it regrow in 6 days?", poison: "17" }, kind: "typed-problem", lookupNote: null, thing: null },
  { q: { id: "other", kind: "negative", ask: "I saw a gecko regrow its tail today, so cool.", poison: "17" }, kind: "other", lookupNote: null, thing: null },
  { q: { id: "spanish", kind: "negative", ask: "¿Cuántos días tarda un geco en regenerar la cola?", poison: "17" }, kind: "other", lookupNote: null, thing: null },
  // Found in the pre-run review of #222 (guards in TutorEngine.run): without the guards both would get
  // the notes-miss note and be told to ignore the notes. Added after the snapshot was first written; their
  // off-arm snapshots were recorded with the switch off, where no guard is reached.
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

describe("the notes-miss switch: the requests Ollama sees", () => {
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
    for (const notesMiss of ["off", "on"] as const) {
      for (const { q } of CASES) {
        calls = [];
        const report = await runRagEval({ custom: { name: "notes-miss-path", vault: VAULT, questions: [q] }, modes: ["always"], syllabus: "matched", prompt: "product-course", ...(notesMiss === "off" ? { notesMiss } : {}) });
        // Model-info calls (/api/show, /api/tags) are cached across runs, so only the turn's own calls count.
        (notesMiss === "off" ? off : on)[q.id] = { chat: raws("/api/chat"), embed: raws("/api/embed"), paths: calls.map((c) => c.path).filter((x) => x === "/api/chat" || x === "/api/embed"), report };
      }
    }
  }, 120_000);

  it("classifies each case as intended (the cases test what they say they test)", () => {
    for (const c of CASES) expect(on[c.q.id].report.rows[0].turnKind, c.q.id).toBe(c.kind);
    expect(on["no-hits"].report.rows[0].retrievedTitles).toEqual([]);
    expect(on.fired.report.rows[0].retrievedTitles).toContain("Field Guide — Pond Newt");
  });

  it("with the switch off, sends byte-identical requests to the branch tip", () => {
    for (const { q } of CASES) {
      expect(off[q.id].chat, q.id).toMatchSnapshot(`${q.id} chat`);
      expect(off[q.id].embed, q.id).toMatchSnapshot(`${q.id} embed`);
    }
  });

  it("adds no request on any path: the same calls, in the same order, with the switch on", () => {
    for (const { q } of CASES) {
      expect(on[q.id].paths, q.id).toEqual(off[q.id].paths);
      expect(on[q.id].chat, q.id).toHaveLength(1);
      expect(on[q.id].embed, q.id).toEqual(off[q.id].embed);
    }
  });

  it("changes only the fired lookup turn, and there only the note at the end of the last user message", () => {
    for (const { q } of CASES.filter((c) => c.lookupNote !== "notes-miss")) expect(on[q.id].chat, q.id).toEqual(off[q.id].chat);
    const offBody = JSON.parse(off.fired.chat[0]!) as { messages: Msg[] };
    const onBody = JSON.parse(on.fired.chat[0]!) as { messages: Msg[] };
    const last = offBody.messages.length - 1;
    expect(offBody.messages[last].content.endsWith(`\n\n${FACT_LOOKUP_NOTE}`)).toBe(true);
    const swapped = { ...offBody.messages[last], content: offBody.messages[last].content.slice(0, -FACT_LOOKUP_NOTE.length) + notesMissNote("gecko") };
    expect(onBody).toEqual({ ...offBody, messages: [...offBody.messages.slice(0, last), swapped] });
    // The passage that does not mention the gecko is still in the block: nothing is dropped.
    expect(lastContent(on.fired.chat[0]!)).toContain("The pond newt regrows a lost tail in 17 days.");
  });

  it("records which lookup note each row sent and the phrase it parsed; the switch off records the plain note", () => {
    for (const c of CASES) {
      const r = on[c.q.id].report.rows[0];
      expect([r.lookupNote, r.askedThing], c.q.id).toEqual([c.lookupNote, c.thing]);
      const o = off[c.q.id].report.rows[0];
      expect([o.lookupNote, o.askedThing], c.q.id).toEqual([c.lookupNote === null ? null : "lookup", null]);
    }
    expect(on.fired.report.notesMiss).toBe("on");
    expect(off.fired.report.notesMiss).toBe("off");
    expect(on.fired.report.rows[0].turnNoted).toBe(true);
  });

  it("the guards are what keep the notes-say and lead-in cases on the plain lookup note", () => {
    // The frozen extractor alone would fire on both (the review's finding); the guards in run() stop it.
    for (const id of ["notes-say", "lead-in"]) {
      const ask = CASES.find((c) => c.q.id === id)!.q.ask;
      expect(notesMissThing(ask, VAULT.map((n) => n.text)).fire, id).toBe(true);
      expect(on[id].chat, id).toEqual(off[id].chat);
    }
  });
});
