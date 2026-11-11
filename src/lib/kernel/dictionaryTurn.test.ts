import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The dictionary note through the real kernel (tutorEngine.run, the function ChatTab and the eval
// runners call). The model call is the only stand-in, plus a fetch stub that serves a made-up
// dictionary the way Vite and Tauri serve bundled files: JSON with a JSON type, anything else as
// index.html with a 200. Nothing here is dictionary text.
//
// Pinned: (a) a define turn's last user message is the student's text plus the entry and note, and
// nothing else in the request changes, the system prompt included; (b) a turn that is not a meaning
// question sends exactly what it sends with the switch off, and fetches nothing (the existing request
// snapshots in turnRules.test.ts and headless/english-path.test.ts pin those bytes against master);
// (c) a meaning question about a word the dictionary lacks, or a failed lookup, sends exactly what the
// switch-off turn sends; (d) the note never stacks with the first-turn hold or check-before-praise.

type Sent = Array<{ role: string; content: string }>;
const sent: Sent[] = [];

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent) {
    sent.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "text" as const, delta: "Here is what it means." };
    yield { type: "done" as const, finishReason: "stop" as const };
  }),
}));

import { tutorEngine, type TutorTurnResult } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import { DICTIONARY_NOTE, dictionaryNote } from "./defineWord";
import { FIRST_TURN_HOLD_NOTE } from "./attemptFirst";
import { CHECK_BEFORE_PRAISE_NOTE } from "./checkBeforePraise";
import { buildSystemPrompt } from "../curriculum";
import { readingLevelLayer } from "../grade";
import { resetDictionaryCache, lookupWord, DICTIONARY_FETCH_TIMEOUT_MS, type Shard } from "../dictionary";
import type { LLMConfig } from "../../types";

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;

// A made-up dictionary: "zorp" has two noun senses and a verb sense; "zorped" is a form of it by rule.
const SHARD_ZO: Shard = {
  zorp: [
    ["zorp", "n", "a made-up gadget for testing", "the zorp hummed", []],
    ["zorp", "n", "a made-up second sense", "", []],
    ["zorp", "v", "to test a made-up thing", "she zorped it twice", []],
  ],
};
const FILES: Record<string, unknown> = {
  "exceptions.json": { n: {}, v: {}, a: {}, r: {} },
  "meta.json": { shardKeys: ["zo"] },
  "zo.json": SHARD_ZO,
};
let fetched: string[] = [];
let failFetch = false;
// When set, the stub never answers until the request is aborted (a hung bundled fetch).
let hangFetch = false;
let abortedFetches = 0;
// When set, the stub answers only after this promise settles (a slow first load, released by the test).
let gate: Promise<void> | null = null;

beforeEach(() => {
  sent.length = 0;
  fetched = [];
  failFetch = false;
  hangFetch = false;
  abortedFetches = 0;
  gate = null;
  resetDictionaryCache();
  vi.stubGlobal("fetch", async (url: string, init?: { signal?: AbortSignal }) => {
    fetched.push(url);
    if (failFetch) throw new TypeError("network down");
    if (hangFetch) {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { abortedFetches++; reject(new DOMException("aborted", "AbortError")); }));
    }
    if (gate) await gate;
    const body = FILES[url.split("/").pop()!];
    return body === undefined
      ? new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

// ChatTab's prompt for a grade-4 learner in an English course, then tutorEngine.run.
async function run(history: Sent, userText: string, dictionary?: "on" | "off"): Promise<{ req: Sent; result: TutorTurnResult }> {
  const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills("explain", "English Language Arts", "tiny", false);
  const system = buildSystemPrompt({}, null, 1, "English Language Arts", skillSuffix, undefined, undefined, readingLevelLayer(4));
  sent.length = 0;
  const result = await tutorEngine.run(
    { messages: [{ role: "system", content: system }, ...history, { role: "user", content: userText }], config: CONFIG, retrieval: "off", onText: () => {}, ...(dictionary ? { dictionary } : {}) },
    {
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default",
      config: CONFIG, abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: false,
    },
  );
  expect(sent).toHaveLength(1); // no model call added
  return { req: sent[0], result };
}

const DEFINE = "what does zorp mean in 'the zorp hummed all night'?";

describe("dictionary note: request through the kernel", () => {
  it("(a) appends the entry and note after the student's text; nothing else changes", async () => {
    const off = await run([], DEFINE, "off");
    const on = await run([], DEFINE);
    const last = on.req[on.req.length - 1];
    expect(last.content).toBe(`${DEFINE}\n\n${dictionaryNote("zorp", [{ headword: "zorp", via: "exact", senses: SHARD_ZO.zorp.map(([form, pos, definition, example, synonyms]) => ({ form, pos, definition, example, synonyms })) }])}`);
    expect(last.content).toContain(`<dictionary_entry source="Open English WordNet">\n1. zorp (noun): a made-up gadget for testing. Example: "the zorp hummed"`);
    expect(last.content.endsWith(DICTIONARY_NOTE.replace("{word}", "zorp"))).toBe(true);
    expect(on.req.slice(0, -1)).toEqual(off.req.slice(0, -1)); // the system prompt and history, byte for byte
    expect(off.req[off.req.length - 1].content).toBe(DEFINE);
    expect(on.result).toMatchObject({ askedWord: "zorp", firstTurnHold: false });
    expect(on.result.dictionaryNote).toBe(last.content.slice(DEFINE.length + 2));
    expect(off.result).toMatchObject({ askedWord: "zorp", dictionaryNote: null });
  });

  it("(a) pins the define turn's user message, the note wording included, the same bytes on any checkout", async () => {
    const { req } = await run([], DEFINE);
    const last = req[req.length - 1].content;
    expect(last).not.toContain("\r");
    expect(last).toMatchSnapshot();
  });

  it("(a) shows a form's headword: \"zorped\" is a form of \"zorp\"", async () => {
    const { req } = await run([], "define zorped");
    expect(req[req.length - 1].content).toContain('"zorped" is a form of "zorp".');
  });

  it("(b) a turn that is not a meaning question is sent as with the switch off, and looks nothing up", async () => {
    const history: Sent = [{ role: "user", content: "what does zorp mean" }, { role: "assistant", content: "It is a made-up gadget." }];
    for (const [h, text] of [[[], "Can you help me write a poem about the sea?"], [[], "what does that mean"], [history, "ok thanks"], [history, "what do you mean?"]] as Array<[Sent, string]>) {
      const off = await run(h, text, "off");
      fetched = [];
      const on = await run(h, text);
      expect(on.req, text).toEqual(off.req);
      expect(on.req[on.req.length - 1].content, text).toBe(text);
      expect(on.result, text).toMatchObject({ askedWord: null, dictionaryNote: null });
      expect(fetched, text).toEqual([]);
    }
  });

  it("(b) the note is not carried into the next turn: the saved history is the student's text", async () => {
    const saved: Sent = [{ role: "user", content: DEFINE }, { role: "assistant", content: "Here it means a gadget." }];
    const { req, result } = await run(saved, "thanks, that helps");
    expect(req.slice(1)).toEqual([...saved, { role: "user", content: "thanks, that helps" }]);
    expect(result.dictionaryNote).toBeNull();
  });

  it("(c) a word the dictionary lacks: the request is the switch-off request", async () => {
    const text = "what does qwertyuiop mean?";
    const off = await run([], text, "off");
    const on = await run([], text);
    expect(on.req).toEqual(off.req);
    expect(on.result).toMatchObject({ askedWord: "qwertyuiop", dictionaryNote: null });
  });

  it("(c) a failed lookup (no files, or a network error) never fails the turn and changes nothing", async () => {
    const off = await run([], DEFINE, "off");
    FILES["meta.json"] = undefined;
    try {
      resetDictionaryCache();
      expect((await run([], DEFINE)).req).toEqual(off.req);
    } finally {
      FILES["meta.json"] = { shardKeys: ["zo"] };
    }
    failFetch = true;
    resetDictionaryCache();
    const failed = await run([], DEFINE);
    expect(failed.req).toEqual(off.req);
    expect(failed.result.stopReason).toBe("complete");
  });

  it("(c) a hung lookup: the turn waits for the 2 s deadline, then is sent unchanged", async () => {
    const off = await run([], DEFINE, "off");
    hangFetch = true;
    const started = Date.now();
    const hung = await run([], DEFINE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(hung.req).toEqual(off.req);
    expect(hung.result).toMatchObject({ askedWord: "zorp", dictionaryNote: null, stopReason: "complete" });
  }, 10_000);

  it("(c) a slow first load is not cut off by the turn's deadline: it finishes and warms the cache for the next turn", async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const first = await run([], DEFINE); // the load is still waiting at the 2 s deadline
    expect(first.result.dictionaryNote).toBeNull();
    const indexFetches = fetched.length;
    release(); // the shared load now finishes in the background
    gate = null;
    await lookupWord("zorp"); // joins the same cached index load, then loads the shard once
    expect(fetched.length).toBe(indexFetches + 1); // the index was not fetched again
    const fetchedBefore = fetched.length;
    const second = await run([], DEFINE);
    expect(second.result.dictionaryNote).not.toBeNull();
    expect(fetched.length).toBe(fetchedBefore); // served from the warmed cache, nothing fetched again
  }, 10_000);

  it("(d) yields to the first-turn hold: a new option-list problem ending in a meaning question gets the hold only", async () => {
    const text = "Which word fits the blank? The ___ hummed.\n\nA) zorp\nB) plim\nC) vask\nD) trell\n\nWhat does zorp mean?";
    const { req, result } = await run([], text);
    expect(req[req.length - 1].content).toBe(`${text}\n\n${FIRST_TURN_HOLD_NOTE}`);
    expect(result).toMatchObject({ firstTurnHold: true, askedWord: "zorp", dictionaryNote: null });
    expect(fetched).toEqual([]);
  });

  it("(d) yields to check-before-praise: a try that ends in a meaning question gets the check note only", async () => {
    const history: Sent = [{ role: "user", content: "How many zorps are in 3 boxes of 4?" }, { role: "assistant", content: "What do you multiply to find it?" }];
    const text = "I think it's 12. what does zorp mean?";
    const { req, result } = await run(history, text);
    expect(req[req.length - 1].content).toBe(`${text}\n\n${CHECK_BEFORE_PRAISE_NOTE}`);
    expect(result).toMatchObject({ askedWord: "zorp", dictionaryNote: null });
  });

  it("the off switch sends no note and looks nothing up, but still reports the asked word", async () => {
    const { req, result } = await run([], DEFINE, "off");
    expect(req[req.length - 1].content).toBe(DEFINE);
    expect(result).toMatchObject({ askedWord: "zorp", dictionaryNote: null });
    expect(fetched).toEqual([]);
  });
});

describe("dictionary.ts: a hung bundled file", () => {
  it("is given up on after DICTIONARY_FETCH_TIMEOUT_MS and dropped from the cache, so the next lookup fetches again", async () => {
    vi.useFakeTimers();
    try {
      hangFetch = true;
      const hung = lookupWord("zorp");
      const settled = hung.then(() => "resolved", () => "rejected");
      await vi.advanceTimersByTimeAsync(DICTIONARY_FETCH_TIMEOUT_MS + 10);
      expect(await settled).toBe("rejected");
      expect(abortedFetches).toBeGreaterThan(0);
      hangFetch = false;
      const again = await lookupWord("zorp");
      expect(again.map((e) => e.headword)).toEqual(["zorp"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
