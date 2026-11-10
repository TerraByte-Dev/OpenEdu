import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import protocolMd from "./heldout-v2-protocol.md?raw";
import {
  HELDOUT_V2_SHA256, protocolSha256, parseSealed, extractNames, findNameHits, loadSealed, sha256Hex,
  SealedLintError, englishWords, type SealedSet,
} from "./sealed";
import { fs, os, path, writeText, cwd } from "./headless/node-io";
import { RAG_FIXTURE } from "./rag-fixture";
import { RAG_HELDOUT } from "./rag-heldout";
import { K12_ITEMS } from "./k12-items";

// Every set here is synthetic and written in this file. The real sealed file is never read by tests.

function synthetic(): SealedSet {
  return {
    schema: "openedu-heldout-v2",
    created: "2026-11-07",
    sealed: true,
    rag: {
      notes: [
        { title: "Field Log — Quorvath Spring", text: "On Monday the team measured the spring. The Quorvath spring flows at 12.5 litres a minute in the dry season." },
        { title: "Workshop — Dellamire Press", text: "Our Dellamire press closes with 840 newtons of force. Oil it before use." },
      ],
      items: [
        { id: "s-nm01", group: "near-miss", kind: "negative", split: "test", note: "Field Log — Quorvath Spring", ask: "How deep is the Quorvath spring?", poison: "12.5", lookalike: "Quorvan", variant: "name" },
        { id: "s-pp01", group: "paraphrase", kind: "positive", split: "test", note: "Workshop — Dellamire Press", ask: "Which force does the Dellamire machine close with?", expect: "840" },
        { id: "s-xl-pt01", group: "crosslingual", kind: "positive", split: "test", lang: "pt", note: "Field Log — Quorvath Spring", ask: "Qual é a vazão da nascente Quorvath?", expect: "12.5|12,5" },
        { id: "s-xl-hi01", group: "crosslingual", kind: "positive", split: "test", lang: "hi", note: "Field Log — Quorvath Spring", ask: "क्वोरवाथ झरने में कितना पानी बहता है?", expect: "12.5|१२.५" },
      ],
    },
    k12: {
      items: [
        { id: "s-k12-001", subject: "math", band: "6-8", demand: "apply", strand: "ratios", stem: "Which fraction equals 0.75?", options: ["1/4", "2/3", "3/4", "4/5"], key: "C", basis: "computed: 3/4 = 0.75" },
      ],
    },
  } as SealedSet;
}

describe("the protocol hash", () => {
  it("is the one committed in heldout-v2-protocol.md", () => {
    expect(HELDOUT_V2_SHA256).toBe("47b288964b23735e24a4dc79af13b1874a969b8ab2d63e0ea4b5b39c97931291");
    expect(protocolSha256(protocolMd)).toBe(HELDOUT_V2_SHA256);
  });

  it("refuses a protocol with no hash row, or two", () => {
    expect(() => protocolSha256("| File | x |")).toThrow(/found 0/);
    const row = `| SHA-256 | \`${"a".repeat(64)}\` |`;
    expect(() => protocolSha256(`${row}\n${row}`)).toThrow(/found 2/);
  });
});

describe("parseSealed", () => {
  it("accepts the v2 schema, including pt, lookalike and variant", () => {
    const set = parseSealed(JSON.parse(JSON.stringify(synthetic())));
    expect(set.rag.items.map((x) => x.lang)).toContain("pt");
    expect(set.rag.items[0].lookalike).toBe("Quorvan");
  });

  it("names every problem at once", () => {
    const bad = synthetic() as unknown as { schema: string; rag: { items: Array<Record<string, unknown>> }; k12: { items: Array<Record<string, unknown>> } };
    bad.schema = "openedu-heldout-v1";
    bad.rag.items[1].expect = undefined;
    bad.rag.items[2].lang = "de";
    bad.k12.items[0].options = ["a", "b", "c"];
    let msg = "";
    try { parseSealed(bad); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/schema/);
    expect(msg).toMatch(/s-pp01.*expect/);
    expect(msg).toMatch(/s-xl-pt01.*lang "de"/);
    expect(msg).toMatch(/s-k12-001.*4 strings/);
  });
});

describe("extractNames", () => {
  it("finds made-up names and native-script names, not sentence starters or ordinary words", async () => {
    const names = extractNames(synthetic(), await englishWords());
    expect(names).toEqual(expect.arrayContaining(["quorvath", "dellamire", "quorvan", "क्वोरवाथ"]));
    // Sentence starters, weekdays, title-case title words, and ordinary Hindi words are not names.
    for (const w of ["which", "how", "monday", "on", "our", "field", "log", "workshop", "qual", "पानी", "कितना", "में"]) {
      expect(names).not.toContain(w);
    }
  });
});

describe("extractNames, ordinary vocabulary", () => {
  it("treats words from the given vocabulary, and plurals of ordinary words, as ordinary", () => {
    const set = synthetic();
    set.rag.items[1].ask = "Which force does the Dellamire machine close with on Fridays?";
    expect(extractNames(set)).toContain("dellamire");
    expect(extractNames(set)).not.toContain("fridays");
    expect(extractNames(set, new Set(["dellamire"]))).not.toContain("dellamire");
  });
});

describe("extractNames, names in every position and case", () => {
  let english: Set<string>;
  beforeAll(async () => { english = await englishWords(); });

  function withNote(title: string, text: string, ask = "What does the note say?"): SealedSet {
    const set = synthetic();
    set.rag.notes.push({ title, text });
    set.rag.items.push({ id: "s-far01", group: "far", kind: "negative", split: "test", note: title, ask });
    return set;
  }

  it("finds a name that only starts sentences, follows a colon, or sits in a title", () => {
    expect(extractNames(withNote("Gear Works", "Zeltrin makes gears. Zeltrin was founded long ago.", "Zeltrin: who owns it?"), english)).toContain("zeltrin");
    expect(extractNames(withNote("Brask Mill", "The mill grinds corn every morning."), english)).toContain("brask");
  });

  it("finds a capitalised name that the set also writes in lower case", () => {
    expect(extractNames(withNote("Valley Survey", "The Kormath valley is wide; a kormath is a fish."), english)).toContain("kormath");
  });

  it("finds lower-case invented terms, and not ordinary English", () => {
    const names = extractNames(withNote("Lab Bench", "Add the florbic solution slowly, then stir the beaker."), english);
    expect(names).toContain("florbic");
    for (const w of ["add", "solution", "slowly", "stir", "beaker", "lab", "bench"]) expect(names).not.toContain(w);
  });

  it("finds two-letter names", () => {
    expect(extractNames(withNote("River Log", "The boats left the Ix river at dawn."), english)).toContain("ix");
  });

  it("still skips the sentence starters of a question in another language", () => {
    expect(extractNames(synthetic(), english)).not.toContain("qual");
  });
});

describe("findNameHits", () => {
  it("matches whole words, case-insensitively", () => {
    const files = [
      { path: "src/a.ts", text: "const label = 'QUORVATH spring';" },
      { path: "src/b.ts", text: "quorvathian is a different word; so is xquorvath" },
      { path: "src/c.md", text: "क्वोरवाथ" },
    ];
    expect(findNameHits(["quorvath", "क्वोरवाथ"], files)).toEqual([
      { token: "quorvath", files: ["src/a.ts"] },
      { token: "क्वोरवाथ", files: ["src/c.md"] },
    ]);
  });

  it("finds a name inside code identifiers, with a plural or possessive, in any Unicode form", () => {
    const leaks = ["const QUORVATH_BOOST = 2;", "if (isQuorvath(q)) {}", "quorvathFix();", "let quorvath2 = 0;", "the Quorvaths", "Quorvath's flow", "Quorvath’s flow", "case 'quorvath-spring':"];
    for (const text of leaks) expect(findNameHits(["quorvath"], [{ path: "src/x.ts", text }]), text).toHaveLength(1);
    const nfd = "Zoëtrin".normalize("NFD");
    expect(findNameHits(["zoëtrin".normalize("NFC")], [{ path: "src/x.ts", text: `// ${nfd}` }])).toHaveLength(1);
    expect(findNameHits(["zoëtrin".normalize("NFD")], [{ path: "src/x.ts", text: "// Zoëtrin".normalize("NFC") }])).toHaveLength(1);
    // A longer word that merely starts or ends with the name is still a different word.
    for (const text of ["quorvathian", "xquorvath", "unquorvathed"]) expect(findNameHits(["quorvath"], [{ path: "src/x.ts", text }]), text).toEqual([]);
  });

  it("finds a name that really is in this repo's src/ outside src/lib/eval/", async () => {
    // RAG_FIXTURE's "Verrin" is quoted by the citation tests; the lint must see it, as it would a
    // sealed name that leaked the same way.
    const { listFiles } = await import("./headless/node-io");
    const f = await fs();
    const files = [];
    for (const file of await listFiles(`${cwd()}/src/lib/kernel`)) files.push({ path: file, text: await f.readFile(file, "utf8") });
    const hits = findNameHits(["verrin"], files);
    expect(hits[0]?.files.some((p) => p.endsWith("src/lib/kernel/citation.test.ts"))).toBe(true);
  });
});

describe("loadSealed", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await (await fs()).mkdtemp(`${(await os()).tmpdir()}/oe-sealed-test-`);
    await writeText(`${dir}/src/lib/tutor.ts`, "export const hello = 'world';\n");
    // The eval folder's data, tests and docs are excluded from the lint: names may appear there.
    for (const f of ["rag-fixture.ts", "rag-heldout.ts", "rag-dev-v2.ts", "k12-items.ts", "k12-flow-fr-items.ts", "sealed.test.ts", "results/run.md"]) {
      await writeText(`${dir}/src/lib/eval/${f}`, "// Quorvath\n");
    }
  });
  afterEach(async () => {
    await (await fs()).rm(dir, { recursive: true, force: true });
  });

  async function writeSet(set: unknown): Promise<{ file: string; sha: string }> {
    const file = (await path()).join(dir, "set.json");
    const text = JSON.stringify(set);
    await writeText(file, text);
    return { file, sha: await sha256Hex(new TextEncoder().encode(text)) };
  }

  it("loads a set whose hash matches and whose names are nowhere in src/", async () => {
    const { file, sha } = await writeSet(synthetic());
    const loaded = await loadSealed(file, sha, { srcRoot: `${dir}/src` });
    expect(loaded.sha256).toBe(sha);
    expect(loaded.set.rag.notes).toHaveLength(2);
    expect(loaded.lintedTokens).toBeGreaterThan(0);
  });

  it("refuses on a hash mismatch, before parsing", async () => {
    const { file } = await writeSet({ not: "even the schema" });
    await expect(loadSealed(file, "0".repeat(64), { srcRoot: `${dir}/src` })).rejects.toThrow(/hash mismatch/);
  });

  it("refuses on a schema mismatch", async () => {
    const { file, sha } = await writeSet({ ...synthetic(), schema: "something-else" });
    await expect(loadSealed(file, sha, { srcRoot: `${dir}/src` })).rejects.toThrow(/v2 schema/);
  });

  it("refuses with the list of hits when a name leaked into src/", async () => {
    await writeText(`${dir}/src/lib/kernel/gate.ts`, "// tuned so the Dellamire question passes\n");
    await writeText(`${dir}/src/skills/hint.md`, "क्वोरवाथ\n");
    const { file, sha } = await writeSet(synthetic());
    const err = await loadSealed(file, sha, { srcRoot: `${dir}/src` }).catch((e) => e);
    expect(err).toBeInstanceOf(SealedLintError);
    expect((err as SealedLintError).hits).toEqual([
      { token: "dellamire", files: ["src/lib/kernel/gate.ts"] },
      { token: "क्वोरवाथ", files: ["src/skills/hint.md"] },
    ]);
    expect((err as Error).message).toMatch(/dellamire: src\/lib\/kernel\/gate\.ts/);
  });

  it("on the v1 sets, flags the v1 vault names that src/ quotes and nothing else", async () => {
    // A dry run of the real path on data that is already public: the v1 held-out items and the 240
    // k12 items, reshaped to the v2 schema, linted against this repo's real src/ and library. v1's
    // nonce names are quoted by kernel tests, so they must be caught; ordinary words must not be.
    const v1 = {
      schema: "openedu-heldout-v2", created: "2026-11-06", sealed: true,
      rag: { notes: RAG_FIXTURE, items: RAG_HELDOUT.filter((x) => x.lang !== "am").map((x) => ({ ...x, split: "test" })) },
      k12: { items: K12_ITEMS },
    };
    const { file, sha } = await writeSet(v1);
    const err = await loadSealed(file, sha).catch((e) => e);
    expect(err).toBeInstanceOf(SealedLintError);
    const tokens = (err as SealedLintError).hits.map((h) => h.token);
    expect(tokens).toContain("verrin");
    const vaultWords = new Set(RAG_FIXTURE.flatMap((n) => `${n.title} ${n.text}`.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? []));
    // The blind sets for levers 10 and 9g, and 16 (rag-blind-10.json, rag-blind-16.json) are public dev data whose realistic notes use
    // ordinary names and real things v1 also asks about, so src/ now quotes those words too. Catching them
    // is right; a hit found only in that file is allowed here by name.
    const onlyBlind = (h: { files: string[] }) => h.files.every((f) => f === "src/lib/eval/rag-blind-10.json" || f === "src/lib/eval/rag-blind-16.json");
    expect((err as SealedLintError).hits.filter((h) => !vaultWords.has(h.token) && !onlyBlind(h)).map((h) => h.token)).toEqual([]);
  });

  it("lints the eval code that shapes the request (runner prompts, syllabi), not only the app", async () => {
    await writeText(`${dir}/src/lib/eval/rag-runner.ts`, "const RAG_INSTRUCTIONS = 'Answer about the Dellamire press.';\n");
    const { file, sha } = await writeSet(synthetic());
    const err = await loadSealed(file, sha, { srcRoot: `${dir}/src` }).catch((e) => e);
    expect(err).toBeInstanceOf(SealedLintError);
    expect((err as SealedLintError).hits).toEqual([{ token: "dellamire", files: ["src/lib/eval/rag-runner.ts"] }]);
  });

  it("skips binary files", async () => {
    const f = await fs();
    await f.mkdir(`${dir}/src/assets`, { recursive: true });
    await writeText(`${dir}/src/assets/x.txt`, "");
    const bin = new Uint8Array([0x89, 0x50, 0x00, ...new TextEncoder().encode("Quorvath")]);
    await (f as unknown as { writeFile(p: string, d: Uint8Array): Promise<void> }).writeFile(`${dir}/src/assets/x.png`, bin);
    const { file, sha } = await writeSet(synthetic());
    await expect(loadSealed(file, sha, { srcRoot: `${dir}/src` })).resolves.toBeTruthy();
  });
});
