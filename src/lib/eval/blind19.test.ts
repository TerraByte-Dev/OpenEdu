import { describe, it, expect } from "vitest";

// blind-19's generator and selection (blind19.ts; docs/BENCHMARKS.md B8 "Lever 19"). No request leaves
// the machine: the network is a stand-in, and the dictionary check is a stand-in except where named.

import {
  AUTHOR_PROMPT, B8_WORDS, BLIND19_MODELS, BLIND19_CELL, GENERATOR_USAGE, OPENROUTER_ENDPOINT,
  authorMessage, checkShape, emptyCells, finalSet, generateBlind19, modelArg, parseAuthorResponse, readBand,
  selectFrom, shortCells, type GeneratorDeps,
} from "./blind19";
import { DEFINE_ITEMS } from "./define-items";

const BANDS = ["K-2", "3-5", "6-8", "9-12"] as const;
/** A well-formed item whose word is `w`. */
const item = (band: string, kind: string, w: string) => ({ band, kind, word: w, ask: `what does ${w} mean in 'the ${w} was near the old house'` });
/** A made-up word of letters only (askedWord reads letters): prefix, band, kind, index. */
const CODE: Record<string, string> = { "K-2": "ka", "3-5": "tf", "6-8": "sx", "9-12": "nt" };
const word = (prefix: string, band: string, kind: string, i: number) => `${prefix}${CODE[band]}${kind.toLowerCase()}${String.fromCharCode(97 + i)}`;
/** `n` items per band and kind with distinct made-up words. */
function batch(perCell: Record<"L" | "C", number>, prefix = "w"): ReturnType<typeof item>[] {
  const out: ReturnType<typeof item>[] = [];
  for (const b of BANDS) for (const k of ["L", "C"] as const) for (let i = 0; i < perCell[k]; i++) out.push(item(b, k, word(prefix, b, k, i)));
  return out;
}

function deps(responses: Array<{ status?: number; content?: string; throws?: boolean }>, over: Partial<GeneratorDeps> = {}) {
  const files = new Map<string, string>();
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  let i = 0;
  const d: GeneratorDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      const r = responses[i++];
      if (!r) throw new Error("no more responses");
      if (r.throws) throw new Error("offline");
      return new Response(JSON.stringify({ choices: [{ message: { content: r.content ?? "" } }], usage: { total_tokens: 1 } }), { status: r.status ?? 200 });
    }) as unknown as typeof fetch,
    env: { OPENROUTER_API_KEY: "test-key-not-real" },
    write: async (f, t) => { files.set(f, t); },
    exists: async (f) => files.has(f),
    hasNote: async (w) => !w.startsWith("nonote"),
    now: () => new Date("2026-11-12T12:00:00Z"),
    log: () => {},
    ...over,
  };
  return { d, files, sent };
}

describe("blind-19 author prompt and request", () => {
  it("sends the frozen prompt, then B8's 184 words as a do-not-use list, and no sampling parameters", () => {
    expect(B8_WORDS).toHaveLength(184);
    expect(new Set(B8_WORDS)).toEqual(new Set(DEFINE_ITEMS.map((i) => i.word.toLowerCase())));
    const m = authorMessage(B8_WORDS);
    expect(m.startsWith(AUTHOR_PROMPT)).toBe(true);
    expect(m).toContain(`Do not use any of these words: ${B8_WORDS.join(", ")}.`);
    expect(AUTHOR_PROMPT).toMatch(/^Write questions a student types/);
    expect(AUTHOR_PROMPT).toMatch(/Reply with a JSON array of \{band, kind, word, ask\} and nothing else\.$/);
    expect(AUTHOR_PROMPT).not.toMatch(/dictionary|rank|WordNet/i);
  });

  it("names the short cells on a top-up", () => {
    const m = authorMessage(["a"], [{ band: "K-2", kind: "L", missing: 3 }, { band: "9-12", kind: "C", missing: 1 }]);
    expect(m).toMatch(/Only these grade bands and kinds are still needed: K-2 kind L \(3 more\); 9-12 kind C \(1 more\)\.$/);
  });

  it("takes the model as its only argument", () => {
    expect(modelArg([])).toBeNull();
    expect(modelArg(["--"])).toBeNull();
    expect(modelArg(["--", "openai/gpt-6.1-sol"])).toBe("openai/gpt-6.1-sol");
    expect(modelArg(["openai/gpt-6.1-sol", "extra"])).toBeNull();
  });
});

describe("parsing a response", () => {
  it("counts a JSON array of at least the minimum four-key objects, fenced or not", () => {
    const arr = JSON.stringify(batch({ L: 20, C: 10 }));
    expect(parseAuthorResponse(arr, 120)).toMatchObject({ ok: true, counted: 120 });
    expect(parseAuthorResponse("```json\n" + arr + "\n```", 120)).toMatchObject({ ok: true, counted: 120 });
    expect(parseAuthorResponse(JSON.stringify(batch({ L: 20, C: 9 })), 120)).toMatchObject({ ok: false });
    expect(parseAuthorResponse("Here you go: " + arr, 120)).toMatchObject({ ok: false });
    expect(parseAuthorResponse(JSON.stringify({ items: [] }), 1)).toMatchObject({ ok: false, reason: "not a JSON array" });
    // Objects missing a key are not counted.
    const short = [...batch({ L: 20, C: 10 }).slice(0, 119), { band: "K-2", kind: "L", word: "x" }];
    expect(parseAuthorResponse(JSON.stringify(short), 120)).toMatchObject({ ok: false });
  });

  it("reads band labels with any dash or spacing, and nothing else", () => {
    expect(readBand("K–2")).toBe("K-2");
    expect(readBand("k - 2")).toBe("K-2");
    expect(readBand("9-12")).toBe("9-12");
    expect(readBand("grade 3-5")).toBeNull();
    expect(readBand("K-1")).toBeNull();
  });
});

describe("the item checks", () => {
  const none = new Set<string>();
  it("keeps an item whose message fires on the word, with a context that contains it", () => {
    expect(checkShape(item("K-2", "L", "pupil"), none)).toEqual({ item: { band: "K-2", kind: "L", word: "pupil", ask: "what does pupil mean in 'the pupil was near the old house'" } });
    for (const form of [
      "What does the word pupil mean in this sentence: The pupil got smaller in the light.",
      "The pupil got smaller in the light. What does pupil mean here?",
      "I don't know what pupil means in 'the pupil got smaller in the light'",
      "what is the meaning of pupil in 'the pupil got smaller in the light'",
    ]) expect(checkShape({ band: "3-5", kind: "C", word: "pupil", ask: form }, none), form).toHaveProperty("item");
  });

  it("turns down a bad band or kind, a message that does not fire or reads another word, no context, a context without the word, a B8 word and a repeat", () => {
    const why = (x: unknown, ex = none) => ("reason" in checkShape(x, ex) ? (checkShape(x, ex) as { reason: string }).reason : "kept");
    expect(why({ ...item("K-3", "L", "pupil") })).toMatch(/band/);
    expect(why({ ...item("K-2", "X", "pupil") })).toMatch(/kind/);
    expect(why({ band: "K-2", kind: "L", word: "pupil", ask: "tell me about pupils" })).toMatch(/does not fire/);
    expect(why({ band: "K-2", kind: "L", word: "pupil", ask: "what does iris mean in 'the iris was blue'" })).toMatch(/reads "iris"/);
    expect(why({ band: "K-2", kind: "L", word: "pupil", ask: "what does pupil mean?" })).toMatch(/no context/);
    expect(why({ band: "K-2", kind: "L", word: "pupil", ask: "what does pupil mean in 'the pupils were bright'" })).toMatch(/does not contain/);
    expect(why(item("K-2", "L", "bank"), new Set(B8_WORDS))).toMatch(/B8/);
    expect(why(item("K-2", "L", "pupil"), new Set(["pupil"]))).toMatch(/already kept/);
    expect(why({ band: "K-2", kind: "L", word: "pupil" })).toMatch(/not an object/);
  });

  it("keeps, in output order, the first 20 L and 10 C per band that pass, checking the dictionary last", async () => {
    const cells = emptyCells();
    const raw = [
      item("K-2", "L", "nonotea"), // no note: rejected
      ...batch({ L: 21, C: 11 }),
      item("K-2", "L", "bank"), // B8 word: rejected
    ];
    const asked: string[] = [];
    const rejected = await selectFrom(0, raw, cells, async (w) => { asked.push(w); return !w.startsWith("nonote"); });
    expect(rejected.map((r) => [r.index, r.reason])).toEqual([[0, "dictionaryNote is null"], [raw.length - 1, "a B8 word or already kept"]]);
    const set = finalSet(cells);
    expect(set.counts).toEqual({ L: 80, C: 40 });
    expect(set.runnable).toBe(true);
    expect(shortCells(cells)).toEqual([]);
    // The 21st L and 11th C of each band are surplus: never looked up, never kept.
    expect(asked).not.toContain(word("w", "K-2", "L", 20));
    expect(cells["K-2"].L.map((i) => i.word)).toEqual(Array.from({ length: 20 }, (_, i) => word("w", "K-2", "L", i)));
    expect(cells["K-2"].L[0]).toMatchObject({ id: "b19-k2-L-01", source: { response: 0, index: 1 } });
    expect(cells["9-12"].C[9].id).toBe("b19-912-C-10");
  });

  it("a duplicate word is kept once, even across kinds and bands", async () => {
    const cells = emptyCells();
    const rejected = await selectFrom(0, [item("K-2", "L", "pupil"), item("6-8", "C", "Pupil")], cells, async () => true);
    expect(rejected.map((r) => r.reason)).toEqual(["a B8 word or already kept"]);
  });

  it("names short cells, and a set under 60 L or 30 C is not runnable", async () => {
    const cells = emptyCells();
    await selectFrom(0, batch({ L: 14, C: 8 }), cells, async () => true);
    expect(shortCells(cells)).toEqual(BANDS.flatMap((band) => [{ band, kind: "L", missing: 6 }, { band, kind: "C", missing: 2 }]));
    expect(finalSet(cells)).toMatchObject({ counts: { L: 56, C: 32 }, runnable: false });
    const ok = emptyCells();
    await selectFrom(0, batch({ L: 15, C: 8 }), ok, async () => true);
    expect(finalSet(ok)).toMatchObject({ counts: { L: 60, C: 32 }, runnable: true });
  });
});

describe("the generator run", () => {
  it("makes no request without the model argument, with another model, or without the key", async () => {
    for (const args of [[], ["--"], ["openai/gpt-4o"], ["openai/gpt-6.1-sol", "x"]]) {
      const { d, sent } = deps([]);
      await expect(generateBlind19(args, d)).rejects.toThrow(/Usage: blind19-generate\.ts|not a pre-registered model/);
      expect(sent).toEqual([]);
    }
    const { d, sent } = deps([], { env: {} });
    await expect(generateBlind19(["openai/gpt-6.1-sol"], d)).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(sent).toEqual([]);
    expect(GENERATOR_USAGE).toContain(BLIND19_MODELS.join(" or "));
  });

  it("one request when the response fills every cell; the raw text, its hash and the items are written", async () => {
    const content = JSON.stringify(batch({ L: 30, C: 15 }));
    const { d, files, sent } = deps([{ content }]);
    const file = await generateBlind19(["--", "openai/gpt-6.1-sol"], d);
    expect(file).toBe("src/lib/eval/blind-19/items.json");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(OPENROUTER_ENDPOINT);
    expect(sent[0].body).toEqual({ model: "openai/gpt-6.1-sol", messages: [{ role: "user", content: authorMessage(B8_WORDS) }] });
    const out = JSON.parse(files.get(file)!);
    expect(out.counts).toEqual({ L: 80, C: 40 });
    expect(out.runnable).toBe(true);
    expect(out.topUpCells).toEqual([]);
    expect(files.get(out.counted.main.file)).toBe(content);
    const want = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(out.counted.main.sha256).toBe(want);
  });

  it("saves and retries a response that does not count, at most twice", async () => {
    const good = JSON.stringify(batch({ L: 20, C: 10 }));
    const { d, files, sent } = deps([{ content: "Sorry, here are some" }, { content: "[]" }, { content: good }]);
    await generateBlind19(["openai/gpt-6.1-sol"], d);
    expect(sent).toHaveLength(3);
    const out = JSON.parse(files.get("src/lib/eval/blind-19/items.json")!);
    expect(out.raws.map((r: { attempt: number; outcome: string }) => [r.attempt, r.outcome.split(" ")[0]])).toEqual([[1, "not"], [2, "0"], [3, "counts"]]);
    expect(out.counted.main.attempt).toBe(3);

    const bad = deps([{ content: "no" }, { content: "no" }, { content: "no" }, { content: good }]);
    await expect(generateBlind19(["openai/gpt-6.1-sol"], bad.d)).rejects.toThrow(/no response counted after 3 attempts/);
    expect(bad.sent).toHaveLength(3);
    expect([...bad.files.keys()].filter((f) => f.includes("/raw-"))).toHaveLength(3);
  });

  it("stops on an HTTP or network error, saving it, without retrying", async () => {
    const http = deps([{ status: 503, content: "busy" }]);
    await expect(generateBlind19(["openai/gpt-6.1-sol"], http.d)).rejects.toThrow(/HTTP 503.*try again in an hour/i);
    expect(http.sent).toHaveLength(1);
    expect([...http.files.keys()]).toHaveLength(1);
    const net = deps([{ throws: true }]);
    await expect(generateBlind19(["openai/gpt-6.1-sol"], net.d)).rejects.toThrow(/network error/);
    expect(net.sent).toHaveLength(1);
  });

  it("sends one top-up naming the short cells, with the kept words added to the do-not-use list, and fills only those cells", async () => {
    const first = batch({ L: 18, C: 12 });
    const more = [...batch({ L: 3, C: 2 }, "t")];
    const { d, files, sent } = deps([{ content: JSON.stringify(first) }, { content: JSON.stringify(more) }]);
    await generateBlind19(["openai/gpt-6.1-sol"], d);
    expect(sent).toHaveLength(2);
    const top = (sent[1].body.messages as Array<{ content: string }>)[0].content;
    expect(top).toContain("Only these grade bands and kinds are still needed: K-2 kind L (2 more); 3-5 kind L (2 more); 6-8 kind L (2 more); 9-12 kind L (2 more).");
    expect(top).toContain(word("w", "K-2", "L", 0));
    const out = JSON.parse(files.get("src/lib/eval/blind-19/items.json")!);
    expect(out.counts).toEqual({ L: 80, C: 40 });
    // The top-up's C items and third L per band are surplus.
    expect(out.items.filter((i: { source: { response: number } }) => i.source.response === 1)).toHaveLength(8);
    expect(out.shortAfterTopUp).toEqual([]);
    expect(BLIND19_CELL).toEqual({ L: 20, C: 10 });
  });

  it("writes a rerun beside an existing items file, never over it", async () => {
    const content = JSON.stringify(batch({ L: 20, C: 10 }));
    const { d, files } = deps([{ content }]);
    files.set("src/lib/eval/blind-19/items.json", "first");
    const file = await generateBlind19(["openai/gpt-6.1-sol"], d);
    expect(file).toMatch(/^src\/lib\/eval\/blind-19\/rerun-2026-11-12T12-00-00-000Z\.json$/);
    expect(files.get("src/lib/eval/blind-19/items.json")).toBe("first");
  });
});

describe("the dictionary check, on the bundled dictionary", () => {
  it("is the kernel's own note: a word with an entry passes, a blocked or unknown word does not", async () => {
    const { installAppOrigin } = await import("./headless/origin");
    const { lookupWord } = await import("../dictionary");
    const { noteCheck } = await import("./blind19");
    installAppOrigin();
    const has = noteCheck(lookupWord);
    expect(await has("pupil")).toBe(true);
    expect(await has("bitch")).toBe(false);
    expect(await has("qzxv")).toBe(false);
  });
});

describe("the generator is the one whose SHA-256 is recorded (BENCHMARKS.md B8, Lever 19, R6)", () => {
  // Hashed with LF line endings, as git stores the files. A change to either file fails here: the
  // generator is frozen before the ranker exists.
  const RECORDED: Record<string, string> = {
    "src/lib/eval/blind19.ts": "71346adc246542896f43f0389468584ff206ff58f0d9777d7c0c95c1f1d48f14",
    "src/lib/eval/headless/blind19-generate.ts": "b49dcaf91f258a8aaca5530d6bfe31b5c69e1093026703e314da8aa13e7ac39c",
  };
  it.each(Object.entries(RECORDED))("%s", async (file, sha) => {
    const { fs } = await import("./headless/node-io");
    const { sha256Hex } = await import("./blind19");
    const text = (await (await fs()).readFile(file, "utf8")).replace(/\r\n/g, "\n");
    expect(await sha256Hex(text)).toBe(sha);
  });
});
