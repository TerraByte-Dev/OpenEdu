import { describe, it, expect, vi, beforeAll } from "vitest";

// The define suite's two arms through the headless platform: the runner (define-runner.ts), the real
// kernel, the real bundled dictionary served from public/ as the app origin, and a stand-in Ollama.
// Pins that the D arm's request is the B arm's request plus the entry and note after the student's
// text, with the same system prompt, and that the eval path can read the bundled dictionary at all
// (a fetch that is not served as JSON is refused by dictionary.ts, which would silently make D = B).

vi.mock("@tauri-apps/plugin-sql", () => import("./shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./shims/api-core"));

import { runDefineItems, type DefineReport } from "../define-runner";
import { DEFINE_ITEMS } from "../define-items";
import { seedStore, resetStores } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { refreshManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { STORE_FILE, STORE_KEYS } from "../../store-keys";
import { DICTIONARY_NOTE } from "../../kernel/defineWord";

const MODEL = "gemma4:e2b";
type Msg = { role: string; content: string };
let chats: Msg[][] = [];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
async function fakeOllama(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Msg[]; input?: string[] } : undefined;
  switch (url.pathname) {
    case "/api/tags": return json({ models: [{ name: MODEL }, { name: "nomic-embed-text:latest" }] });
    case "/api/show": return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma3n", "gemma3n.context_length": 32768 }, capabilities: ["completion", "tools"] });
    case "/api/embed": return json({ embeddings: (body!.input ?? []).map(() => [0, 0, 1]) });
    case "/api/chat":
      if (!body!.messages!.some((m) => m.content === "Reply with the single word: ready")) chats.push(body!.messages!);
      return new Response(`${JSON.stringify({ message: { role: "assistant", content: "It means very big." } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`, { status: 200 });
    default: return new Response("not found", { status: 404 });
  }
}

// One common word and one sense item with a sentence.
const ITEMS = DEFINE_ITEMS.filter((i) => i.id === "def-k2-01" || i.id === "sense-35-01");

describe("define arms through the headless kernel", () => {
  const arms: Record<"on" | "off", { report: DefineReport; chats: Msg[][] }> = {} as never;

  beforeAll(async () => {
    globalThis.fetch = fakeOllama as typeof fetch;
    installAppOrigin();
    resetStores();
    seedStore(STORE_FILE, { [STORE_KEYS.chatModel]: MODEL });
    await refreshManifest();
    await refreshDatasetManifest();
    for (const dictionary of ["off", "on"] as const) {
      chats = [];
      const report = await runDefineItems(ITEMS, { split: "dev", dictionary, repeats: 1 });
      arms[dictionary] = { report, chats };
    }
  }, 60_000);

  it("sends one chat request per item in each arm, and the detector reads every item's word", () => {
    expect(ITEMS).toHaveLength(2);
    for (const arm of ["on", "off"] as const) {
      expect(arms[arm].chats, arm).toHaveLength(2);
      expect(arms[arm].report.detected, arm).toBe(2);
      expect(arms[arm].report.errors, arm).toBe(0);
    }
    expect(arms.off.report.noted).toBe(0);
    expect(arms.on.report.noted).toBe(2);
  });

  it("counts each row's chat requests on the wire (the warm-up excluded), with its tool calls", () => {
    for (const arm of ["on", "off"] as const) {
      for (const r of arms[arm].report.rows) expect(r, `${arm} ${r.id}`).toMatchObject({ chatRequests: 1, structuredRequests: 0, toolCalls: [], toolCallRecovery: null, attempts: 1 });
    }
  });

  it("D's request is B's plus the bundled entry and the note after the student's text; the rest is identical", () => {
    for (let i = 0; i < ITEMS.length; i++) {
      const b = arms.off.chats[i];
      const d = arms.on.chats[i];
      const row = arms.on.report.rows[i];
      expect(d.slice(0, -1), ITEMS[i].id).toEqual(b.slice(0, -1));
      expect(b[b.length - 1].content.endsWith(ITEMS[i].ask), ITEMS[i].id).toBe(true);
      expect(d[d.length - 1].content, ITEMS[i].id).toBe(`${b[b.length - 1].content}\n\n${row.dictionaryNote}`);
      expect(row.dictionaryNote, ITEMS[i].id).toMatch(/^<dictionary_entry source="Open English WordNet">\n1\. /);
      expect(row.dictionaryNote!.endsWith(DICTIONARY_NOTE.replace("{word}", ITEMS[i].word)), ITEMS[i].id).toBe(true);
      expect(row.noteTokens, ITEMS[i].id).toBeGreaterThan(0);
    }
  });

  it("gives each band its reading level in the system prompt", () => {
    expect(arms.on.chats[0][0].content).toContain("The student is in grade 2.");
    expect(arms.on.chats[1][0].content).toContain("The student is in grade 4.");
  });

  it("lever 19: S (EVAL_SENSE_RANK=off) and R send the same request for a plain item, and differ only in the entry's order for trunk", async () => {
    const items = DEFINE_ITEMS.filter((i) => i.id === "def-k2-01" || i.id === "sense-k2-07");
    const sent: Record<"on" | "off", Msg[][]> = { on: [], off: [] };
    const reports: Record<"on" | "off", DefineReport> = {} as never;
    for (const senseRank of ["off", "on"] as const) {
      chats = [];
      reports[senseRank] = await runDefineItems(items, { split: "dev", dictionary: "on", senseRank, repeats: 1 });
      sent[senseRank] = chats;
    }
    expect(reports.off.senseRank).toBe("off");
    expect(reports.on.senseRank).toBe("on");
    expect(sent.on[0]).toEqual(sent.off[0]);
    const [s, r] = [sent.off[1], sent.on[1]];
    expect(r.slice(0, -1)).toEqual(s.slice(0, -1));
    expect(r[r.length - 1].content).not.toBe(s[s.length - 1].content);
    expect(r[r.length - 1].content).toMatch(/1\. trunk \(noun\): a long flexible snout/);
    expect(s[s.length - 1].content).not.toMatch(/snout/);
  }, 30_000);

  it("runs a blind-19 item (lever 19): no term lists, so no lexical grade, and the run is whole", async () => {
    const item = { id: "b19-k2-L-01", band: "K-2" as const, kind: "L" as const, word: "pupil", ask: "what does pupil mean in 'the pupil of her eye got smaller'" };
    const report = await runDefineItems([item], { split: "blind-19", dictionary: "on", repeats: 1 });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ id: item.id, kind: "L", split: "blind-19", error: null, grade: null, askedWord: "pupil" });
    expect(report.rows[0].dictionaryNote).toMatch(/^<dictionary_entry/);
    expect(report).toMatchObject({ partial: false, detected: 1, noted: 1, errors: 0 });
    expect(report.summary.every((c) => c.n === 0)).toBe(true);
  }, 30_000);
});
