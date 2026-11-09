import { describe, it, expect, beforeAll } from "vitest";

// Lever 9e: the ported extractor (askedThing.ts) makes every decision the frozen prototype made.
//
// askedThing-frozen-pins.json holds, per dev and probe item, the hit titles the prototype judged, the
// phrase it parsed and its COVER-mode fire decision, copied from the prototype's own output files (dev:
// the first recorded row of iteration 2's L arm at 505ecd1; probe: simulated retrieval). Questions come
// from the committed sets; passage texts from the vaults and the bundled library cards, cut the way
// each prototype script cut them. Every phrase and every decision must match, and the fire sets must
// equal the pre-registered ones. A second pass gives library cards the text the kernel actually holds
// (fetchResource's 1800 characters) and must not change a decision either.

import { askedThing, notesMissThing } from "./askedThing";
import { classifyTurn } from "./turnKind";
import { RAG_DEV_V2, RAG_DEV_V2_VAULT } from "../eval/rag-dev-v2";
import { RAG_FIXTURE } from "../eval/rag-fixture";
import { RAG_HELDOUT } from "../eval/rag-heldout";
import { RAG_PROBE_ITEMS } from "../eval/rag-probe";
import pins from "../eval/askedThing-frozen-pins.json";
import { fs, path, cwd } from "../eval/headless/node-io";

type Pin = { id: string; titles: string[]; thing: string | null; fire: boolean };

// The body (frontmatter stripped) of every library card a pinned item showed, read in beforeAll.
const cards = new Map<string, string>();
const card = (title: string): string => {
  const t = cards.get(title);
  if (t === undefined) throw new Error(`no library card titled ${title}`);
  return t;
};
// The dev prototype (ground/load.mts libraryText): the block's ~1000 characters, with its marker line.
const devCard = (title: string) => {
  let t = card(title);
  if (t.length > 1800) t = t.slice(0, 1800).trimEnd() + "\n\n…(truncated — ask for more if needed)";
  return t.length > 1000 ? t.slice(0, 960) + `\n…[truncated: approx; block carries ~1000 of ${t.length} chars]` : t;
};
// The probe prototype (probe.mts cardText).
const probeCard = (title: string) => {
  let t = card(title);
  if (t.length > 1800) t = t.slice(0, 1800);
  return t.length > 1000 ? t.slice(0, 1000) : t;
};
// What the kernel holds (ground.ts groundFromLibrary -> library.ts fetchResource(entry, 1800)).
const kernelCard = (title: string) => {
  const t = card(title);
  return t.length > 1800 ? t.slice(0, 1800).trimEnd() + "\n\n…(truncated — ask for more if needed)" : t;
};

const vaultText = new Map([...RAG_DEV_V2_VAULT, ...RAG_FIXTURE].map((n) => [n.title, n.text]));
const passages = (titles: string[], lib: (t: string) => string) => titles.map((t) => vaultText.get(t) ?? lib(t));

const questions = new Map<string, string>([
  ...RAG_DEV_V2.map((q) => [q.id, q.ask] as [string, string]),
  ...RAG_HELDOUT.filter((q) => q.split === "dev").map((q) => [q.id, q.ask] as [string, string]),
]);
const probeAsk = new Map(RAG_PROBE_ITEMS.map((x) => [x.id, x.ask]));
const DEV = pins.dev as Pin[];
const PROBE = pins.probe as Pin[];
const lookup = (q: string) => classifyTurn([{ role: "user", content: q }]) === "fact-lookup";

beforeAll(async () => {
  const [f, p] = await Promise.all([fs(), path()]);
  const lib = p.resolve(cwd(), "public", "library");
  const index = JSON.parse(await f.readFile(p.join(lib, "index.json"), "utf8")) as Array<{ title: string; path: string }>;
  for (const t of new Set([...DEV, ...PROBE].flatMap((x) => x.titles).filter((x) => !vaultText.has(x)))) {
    const e = index.find((x) => x.title === t);
    if (!e) throw new Error(`no library card titled ${t}`);
    // Bundled cards are LF in git and in every checkout (.gitattributes); normalised anyway.
    const raw = await f.readFile(p.join(lib, e.path.replace(/^\/+/, "")), "utf8");
    cards.set(t, raw.replace(/\r\n/g, "\n").replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim());
  }
  expect([...cards.keys()].sort()).toEqual(["Circular & Rotational Motion", "Greek Alphabet", "Squares, Cubes & Roots", "The Solar System & Planet Data", "Waves & Sound"]);
});

describe("askedThing.ts reproduces the frozen prototype on every dev and probe item", () => {
  it.each([["dev", DEV, questions, devCard], ["probe", PROBE, probeAsk, probeCard]] as const)("%s: every phrase and every fire decision", (_, items, asks, lib) => {
    for (const p of items) {
      const q = asks.get(p.id)!;
      expect(q, p.id).toBeTruthy();
      // The prototype recorded notesMissThing's thing, which is null when no passage was shown.
      const r = notesMissThing(q, passages(p.titles, lib));
      expect(r.thing?.phrase ?? null, p.id).toBe(p.thing);
      if (p.titles.length) expect(askedThing(q)?.phrase ?? null, p.id).toBe(p.thing);
      expect(r.fire, p.id).toBe(p.fire);
    }
  });

  it("dev: fires on the 28 near-miss items and v2-pf04 on lookup turns; h-pp11, h-nm29, h-nm33 fire but are not lookups", () => {
    const fired = DEV.filter((p) => notesMissThing(questions.get(p.id)!, passages(p.titles, devCard)).fire);
    const onLookup = fired.filter((p) => lookup(questions.get(p.id)!)).map((p) => p.id);
    expect(onLookup).toEqual([
      "v2-pf04", "v2-nl01", "v2-nl02", "v2-nl03", "v2-nl04", "v2-nl05", "v2-nl06", "v2-nl07", "v2-nl08", "v2-nl09", "v2-nl11",
      "v2-nl12", "v2-nl13", "v2-nl16", "v2-nl17", "v2-nl18", "v2-nl19", "v2-nl20", "v2-nl21", "v2-nl22", "v2-nl24", "v2-nl25",
      "h-nm03", "h-nm05", "h-nm11", "h-nm17", "h-nm23", "h-nm31", "h-nm35",
    ]);
    expect(fired.filter((p) => !lookup(questions.get(p.id)!)).map((p) => p.id).sort()).toEqual(["h-nm29", "h-nm33", "h-pp11"]);
  });

  it("probe: fires on 34 near-miss items and bp-cor-1, bp-vos-2, bp-sor-2, bp-tol-1 on lookup turns", () => {
    const fired = PROBE.filter((p) => notesMissThing(probeAsk.get(p.id)!, passages(p.titles, probeCard)).fire);
    const onLookup = fired.filter((p) => lookup(probeAsk.get(p.id)!));
    expect(onLookup.filter((p) => p.id.startsWith("bp-")).map((p) => p.id).sort()).toEqual(["bp-cor-1", "bp-sor-2", "bp-tol-1", "bp-vos-2"]);
    expect(onLookup.filter((p) => p.id.startsWith("bn-")).map((p) => p.id).sort()).toEqual([
      "bn-ash-1", "bn-cin-1", "bn-cin-2", "bn-cor-1", "bn-cor-2", "bn-dal-1", "bn-dra-2", "bn-hal-1", "bn-hal-2", "bn-kes-1", "bn-kha-1",
      "bn-mir-1", "bn-mir-2", "bn-omb-1", "bn-omb-2", "bn-ost-1", "bn-ost-2", "bn-pel-1", "bn-pel-2", "bn-per-1", "bn-qbk-2", "bn-que-1",
      "bn-que-2", "bn-sor-1", "bn-tar-1", "bn-tar-2", "bn-tes-1", "bn-tol-1", "bn-var-1", "bn-var-2", "bn-ver-1", "bn-vos-1", "bn-vos-2",
      "bn-wex-1",
    ]);
    // Fire, but the turn is not a lookup, so no lookup note reaches them.
    expect(fired.filter((p) => !lookup(probeAsk.get(p.id)!)).map((p) => p.id).sort()).toEqual(["bn-qbk-1", "bp-ver-1"]);
  });

  it("makes the same decisions with the library text the kernel holds", () => {
    for (const [items, asks] of [[DEV, questions], [PROBE, probeAsk]] as const) {
      for (const p of items) expect(notesMissThing(asks.get(p.id)!, passages(p.titles, kernelCard)).fire, p.id).toBe(p.fire);
    }
  });
});
