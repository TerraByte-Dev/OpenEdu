import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  candidateHeadwords,
  lookupWord,
  normalizeQuery,
  resetDictionaryCache,
  resolveEntries,
  shardKey,
  type Exceptions,
  type Shard,
} from "./dictionary";

// The shipped files, through Vite rather than node:fs: `npm run build` typechecks tests and this project
// has no @types/node (see library-fixture.test.ts).
const FILES = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../public/dictionary/*", { eager: true, query: "?raw", import: "default" }) as Record<string, string>,
  ).map(([path, text]) => [path.split("/").pop()!, text]),
);
const read = (name: string) => FILES[name];
const SHARD_FILE = /^[a-z0-9_]{2}\.json$/;

// The production lookup, fed the shipped files. The stub answers the way Vite's dev server and Tauri's
// asset resolver both do: a known file as JSON, an unknown name as index.html with a 200 (SPA fallback),
// never a 404. So these tests run lookupWord itself against what the app really gets back.
function stubFetchFromDisk() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const name = url.split("/").pop()!;
    calls.push(name);
    const text = read(name);
    return text === undefined
      ? new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })
      : new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const heads = async (q: string) => (await lookupWord(q)).map((e) => e.headword);

describe("normalizeQuery", () => {
  it.each([
    ["  Bank ", "bank"],
    ["“bank”?", "bank"],
    ["'photosynthesis'.", "photosynthesis"],
    ["dog's", "dog"],
    ["dog’s", "dog"],
    ["Ice   Cream", "ice cream"],
    ["?!", ""],
    ["", ""],
  ])("%j -> %j", (raw, want) => {
    expect(normalizeQuery(raw)).toBe(want);
  });
});

describe("candidateHeadwords", () => {
  const exc: Exceptions = { n: { mice: ["mouse"] }, v: { went: ["go"] }, a: {}, r: {} };
  const words = (w: string, opts = {}) => candidateHeadwords(w, exc, opts).map((c) => c.word);

  it("puts the word first, then irregular bases, then suffix-rule bases, each with the POS that made it", () => {
    expect(candidateHeadwords("mice", exc).slice(0, 2)).toEqual([{ word: "mice", pos: null }, { word: "mouse", pos: "n" }]);
    expect(candidateHeadwords("jumped", exc)).toEqual(expect.arrayContaining([{ word: "jump", pos: "v" }]));
  });

  it("lemmatizes the first word of a phrase and keeps the rest", () => {
    expect(words("looked up")).toContain("look up");
    expect(words("went out")).toContain("go out");
  });

  it("tries an abbreviation with its final dot back on", () => {
    expect(words("a.m")).toContain("a.m.");
    expect(words("dr", { trailingDot: true })).toContain("dr.");
    expect(words("dr")).not.toContain("dr.");
  });

  it("never yields an empty candidate", () => {
    expect(words("s")).toEqual(["s"]);
  });
});

describe("resolveEntries", () => {
  const exc: Exceptions = { n: {}, v: { saw: ["see"] }, a: {}, r: {} };
  const shards: Record<string, Shard> = {
    sa: { saw: [["saw", "n", "a hand tool for cutting", "", []]] },
    se: { see: [["see", "v", "perceive by sight", "", ["view"]]] },
  };

  it("keeps every headword a form can belong to, exact match first", () => {
    const got = resolveEntries("saw", exc, (k) => shards[k]);
    expect(got.map((e) => [e.headword, e.via])).toEqual([["saw", "exact"], ["see", "form"]]);
    expect(got[1].senses[0]).toEqual({ form: "see", pos: "v", definition: "perceive by sight", example: "", synonyms: ["view"] });
  });

  it("returns nothing for an unknown word or a blank query", () => {
    expect(resolveEntries("flurbish", exc, (k) => shards[k])).toEqual([]);
    expect(resolveEntries("", exc, (k) => shards[k])).toEqual([]);
  });
});

describe("the shipped dictionary", () => {
  const shardFiles = Object.keys(FILES).filter((f) => SHARD_FILE.test(f));

  it("files every headword under the shard lookupWord will fetch", () => {
    let headwords = 0;
    for (const f of shardFiles) {
      const shard = JSON.parse(read(f)) as Shard;
      for (const key of Object.keys(shard)) {
        expect(shardKey(key), key).toBe(f.slice(0, 2));
        expect(key).toBe(key.toLowerCase());
        headwords++;
      }
    }
    const meta = JSON.parse(read("meta.json"));
    expect(headwords).toBe(meta.headwords);
    expect(shardFiles.map((f) => f.slice(0, 2)).sort()).toEqual(meta.shardKeys);
  });

  it("ships its licence texts and attribution", () => {
    expect(read("LICENSE.md")).toMatch(/Creative Commons Attribution 4\.0/);
    expect(read("WNDB_License.txt")).toMatch(/Princeton University/);
    const meta = JSON.parse(read("meta.json"));
    expect(meta.attribution).toMatch(/Open English WordNet/);
    expect(meta.modifications).toMatch(/^Adapted/);
  });
});

describe("lookupWord over the shipped dictionary", () => {
  let calls: string[];
  beforeEach(() => {
    resetDictionaryCache();
    calls = stubFetchFromDisk();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["went", "go"],
    ["mice", "mouse"],
    ["children", "child"],
    ["geese", "goose"],
    ["running", "run"],
    ["jumped", "jump"],
    ["cats", "cat"],
    ["bigger", "big"],
    ["happiest", "happy"],
    ["better", "good"],
  ])("%s resolves to %s", async (q, base) => {
    expect(await heads(q)).toContain(base);
  });

  it("keeps both readings of an ambiguous form, exact headword first", async () => {
    const got = await lookupWord("saw");
    expect(got[0]).toMatchObject({ headword: "saw", via: "exact" });
    expect(got.map((e) => e.headword)).toContain("see");
  });

  it("keeps OEWN's sense order and carries examples and synonyms", async () => {
    const [bank] = await lookupWord("Bank?");
    expect(bank.headword).toBe("bank");
    expect(bank.senses[0].definition).toMatch(/sloping land/);
    expect(bank.senses.some((s) => /financial institution/.test(s.definition))).toBe(true);
    expect(bank.senses[0].example).not.toBe("");
    const [big] = await lookupWord("big");
    expect(big.senses.flatMap((s) => s.synonyms)).toContain("large");
  });

  it("finds phrases and their inflected forms", async () => {
    expect(await heads("ice cream")).toContain("ice cream");
    expect(await heads("looked up")).toContain("look up");
  });

  it("merges case variants under one headword, lowercase first", async () => {
    const [may] = await lookupWord("May");
    expect(may.senses[0].form).toBe("may");
    expect(may.senses.some((s) => s.form === "May")).toBe(true);
  });

  it("returns nothing for a word it doesn't have, and never fetches a shard that doesn't exist", async () => {
    expect(await lookupWord("flurbishness")).toEqual([]);
    expect(await lookupWord("qqzx")).toEqual([]);
    expect(await lookupWord("zzz")).toEqual([]);
    expect(await lookupWord("école")).toEqual([]);
    expect(await lookupWord("#1")).toEqual([]);
    expect(await lookupWord("   ")).toEqual([]);
    const known = new Set(JSON.parse(read("meta.json")).shardKeys.map((k: string) => `${k}.json`));
    expect(calls.filter((c) => !known.has(c) && c !== "exceptions.json" && c !== "meta.json")).toEqual([]);
  });

  it("only offers a suffix-rule base that has a sense in that rule's part of speech", async () => {
    expect(await heads("mother")).toEqual(["mother"]);
    expect(await heads("teacher")).toEqual(["teacher"]);
    expect(await heads("news")).toEqual(["news"]);
    expect(await heads("paper")).toEqual(["paper"]);
    expect(await heads("houses")).toContain("house");
  });

  it("finds abbreviations written with their dots", async () => {
    expect(await heads("a.m.")).toContain("a.m.");
    expect(await heads("e.g.")).toContain("e.g.");
  });

  it("fetches each file once per session, even for lookups in flight together", async () => {
    await Promise.all([lookupWord("bank"), lookupWord("banks"), lookupWord("banker")]);
    await lookupWord("bank");
    expect(calls.filter((c) => c === "ba.json")).toHaveLength(1);
    expect(calls.filter((c) => c === "exceptions.json")).toHaveLength(1);
    expect(calls.filter((c) => c === "meta.json")).toHaveLength(1);
  });
});
