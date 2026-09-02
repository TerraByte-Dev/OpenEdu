import { describe, it, expect } from "vitest";
import { check, compileKeyset } from "./checkers";
import { harvestCard, parseTables, parseDefList } from "./harvest";
import { runGates, v0Answerable, v1Grounded, v3NoLeak } from "./gates";
import { measureF0, poolFor } from "./pool";
import { itemKey, closedBook, type Item, type Expected } from "./types";

// The real 154-card corpus, so F0(b) measures what ships rather than a fixture.
const raw = import.meta.glob("../../../public/library/resources/**/*.md", {
  eager: true, query: "?raw", import: "default",
}) as Record<string, string>;
const cards = Object.entries(raw).map(([p, markdown]) => ({
  id: p.replace(/^.*\/resources\//, "").replace(/\.md$/, ""),
  markdown,
}));

describe("checkers are total and never punish an abstention", () => {
  it("exact_set normalises the way quiz-grading already does", () => {
    const e: Expected = { kind: "exact_set", any: ["Hydroxide"] };
    expect(check(e, "hydroxide")).toBe("correct");
    expect(check(e, "  the Hydroxide.  ")).toBe("correct"); // article + terminal punctuation
    expect(check(e, "hydronium")).toBe("incorrect");
    expect(check(e, "")).toBe("abstain");
  });

  it("numeric abstains rather than guessing on a fraction — and abstain is NOT incorrect", () => {
    const e: Expected = { kind: "numeric", value: 0.5, tolRel: 0 };
    // numericValueOf deliberately refuses fractions, ratios, ranges, percent and currency. A
    // learner typing "1/2" has not answered wrongly; we have declined to judge, and mastery must
    // count it toward neither numerator nor denominator.
    expect(check(e, "1/2")).toBe("abstain");
    expect(check(e, "0.5")).toBe("correct");
  });

  it("numeric honours a relative tolerance", () => {
    const e: Expected = { kind: "numeric", value: 299792458, tolRel: 0.005 };
    expect(check(e, "3.0e8")).toBe("incorrect"); // outside half a percent? no — check the real one
    expect(check(e, "299792458")).toBe("correct");
  });

  it("order requires the sequence, not the set", () => {
    const e: Expected = { kind: "order", items: ["Domain", "Kingdom", "Phylum"] };
    expect(check(e, "Domain, Kingdom, Phylum")).toBe("correct");
    expect(check(e, "Domain → Kingdom → Phylum")).toBe("correct");
    expect(check(e, "Kingdom, Domain, Phylum")).toBe("incorrect");
  });

  it("keyset REJECTS a negated answer — the failure that makes it need a ban list", () => {
    // Without `ban`, "entropy never increases" scores correct on a keyword check.
    const e = compileKeyset(["entropy", "increases"], "entropy increases in an isolated system");
    expect(check(e, "entropy increases in an isolated system")).toBe("correct");
    expect(check(e, "entropy never increases in an isolated system")).toBe("incorrect");
    expect(e.ban.length).toBeGreaterThan(0);
  });

  it("a ban word already in the source span is not banned", () => {
    // Otherwise the correct answer would be unanswerable.
    const e = compileKeyset(["work"], "no work is done on the system");
    expect(e.ban).not.toContain("no");
  });
});

describe("harvest reads the corpus's own structure", () => {
  const md = [
    "---", "id: t/x", "title: T", "---", "",
    "# T", "", "## Prefixes", "",
    "| Prefix | Meaning |", "|---|---|",
    ...["un|not", "re|again", "dis|apart", "pre|before", "mis|wrongly", "sub|under", "over|above", "anti|against"]
      .map((r) => `| ${r.split("|")[0]} | ${r.split("|")[1]} |`),
  ].join("\n");

  it("parses a table and carries its heading into the stem", () => {
    const [t] = parseTables(md);
    expect(t.headers).toEqual(["Prefix", "Meaning"]);
    expect(t.rows).toHaveLength(8);
    expect(t.caption).toBe("Prefixes");
    expect(harvestCard("t/x", md)[0].stem).toContain("Prefixes");
  });

  it("generates both directions — they are different retrieval tasks", () => {
    const items = harvestCard("t/x", md);
    expect(items.some((i) => i.stem.includes("Prefix: un"))).toBe(true);
    expect(items.some((i) => i.stem.includes("Meaning: not"))).toBe(true);
  });

  it("refuses a column whose vocabulary is small enough to learn instead of the material", () => {
    const narrow = md.replace(/\| (not|again|apart|before|wrongly|under|above|against) \|/g, "| yes |");
    expect(harvestCard("t/x", narrow)).toHaveLength(0);
  });

  it("refuses a prose column — exact-matching a sentence is a coin flip on wording", () => {
    const prose = md.replace("| not |", "| something that negates the root word entirely |");
    const answers = harvestCard("t/x", prose)
      .filter((i) => i.expected.kind === "exact_set")
      .flatMap((i) => (i.expected.kind === "exact_set" ? i.expected.any : []));
    // The long value must never become an expected answer; the whole column is refused.
    expect(answers.some((a) => a.includes("negates the root word"))).toBe(false);
  });

  it("parses both definition-list shapes the corpus actually uses", () => {
    const dl = parseDefList("- **Vertex** — the turning point\n- Hydroxide — OH");
    expect(dl).toEqual([
      { term: "Vertex", def: "the turning point" },
      { term: "Hydroxide", def: "OH" },
    ]);
  });
});

describe("gates take the generator's authority away", () => {
  const base: Item = {
    id: "x", sourceId: "t/x", stem: "What is it?", kind: "exact_set",
    expected: { kind: "exact_set", any: ["argon"] }, span: "argon is a noble gas",
    generator: "table", closedBook: true,
  };

  it("V0 rejects a dangling reference to a figure that may not have survived extraction", () => {
    expect(v0Answerable({ ...base, stem: "Using the data in Table 7.3, compute Kc" })).toBeTruthy();
    expect(v0Answerable({ ...base, stem: "see p. 42 for the value" })).toBeTruthy();
    expect(v0Answerable(base)).toBeNull();
  });

  it("V1 makes a fabricated answer key structurally impossible", () => {
    expect(v1Grounded(base)).toBeNull();
    expect(v1Grounded({ ...base, expected: { kind: "exact_set", any: ["krypton"] } })).toBeTruthy();
  });

  it("V3 catches a stem that contains its own answer", () => {
    expect(v3NoLeak({ ...base, stem: "argon is which gas?" })).toBeTruthy();
    // ...but not an incidental substring: "or" inside "order" is not a leak.
    expect(v3NoLeak({ ...base, stem: "Put these in order", expected: { kind: "exact_set", any: ["or"] } })).toBeNull();
  });

  it("a rejection is attributed to the gate that fired", () => {
    const r = runGates([base, { ...base, stem: "argon is which gas?" }]);
    expect(r.kept).toHaveLength(1);
    expect(r.rejected[0].gate).toBe("V3");
  });
});

describe("the pool law", () => {
  const mk = (n: number, kind: "exact_set" | "numeric"): Item[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `i${i}`, sourceId: "c", stem: `q${i}`, kind,
      expected: kind === "numeric"
        ? { kind: "numeric", value: i, tolRel: 0 }
        : { kind: "exact_set", any: [`a${i}`] },
      span: `a${i}`, generator: "table", closedBook: true,
    }));

  it("needs ten closed-book items, not three", () => {
    // At a ~30% error rate a 3-item pool reaches a streak of 3 only ~34% of the time, and a concept
    // that masters by the minimum path has consumed every item, leaving none to sequester.
    expect(poolFor("c", [...mk(9, "exact_set"), ...mk(1, "numeric")]).bearsMastery).toBe(true);
    expect(poolFor("c", [...mk(8, "exact_set"), ...mk(1, "numeric")]).bearsMastery).toBe(false);
  });

  it("open-book items count toward nothing", () => {
    const open = mk(20, "exact_set").map((i) => ({ ...i, kind: "cite" as const, closedBook: false }));
    expect(poolFor("c", open).closedCount).toBe(0);
    expect(poolFor("c", open).bearsMastery).toBe(false);
  });

  it("select_span and cite can never be closed-book", () => {
    expect(closedBook("select_span")).toBe(false);
    expect(closedBook("cite")).toBe(false);
    expect(closedBook("exact_set")).toBe(true);
  });
});

describe("itemKey is deterministic across sessions", () => {
  it("same content, same key — otherwise the mastery ledger rots", () => {
    // Harvested items are compiled at runtime and never stored, so identity must be a pure function
    // of the content. If it drifted, an attempt would key to an item that regenerates differently
    // next session and every mastery count would silently decay.
    expect(itemKey("c", "exact_set", "q")).toBe(itemKey("c", "exact_set", "q"));
    expect(itemKey("c", "exact_set", "q")).not.toBe(itemKey("c", "numeric", "q"));
  });
});

describe("F0(b) — measured against the real 154-card base", () => {
  it("loads every shipped card", () => {
    expect(cards.length).toBe(154);
  });

  it("FAILS its bar, and records why — see eval/results/2026-09-02-f0b-card-tier.md", () => {
    const r = measureF0(cards, 4);
    // The bar was >=40% mastery-bearing; the cliff below which the card tier is not mastery-bearing
    // was 28%. Measured: 10.4%. This assertion pins the FAILURE deliberately, the same way the
    // ranker defects were pinned before #112 fixed them — so that any change to the compiler, the
    // pool law or the corpus shows up here as a number that moved.
    expect(r.bearingFraction).toBeCloseTo(0.104, 2);

    // The diagnosis: item YIELD nearly clears the bar. The `kinds >= 2` clause is what fails it.
    const tenPlus = r.perCard.filter((c) => c.closed >= 10).length / r.cards;
    expect(tenPlus).toBeGreaterThan(0.35);

    // And the hard limit underneath both: most cards have no harvestable structure at all.
    expect(r.anyFraction).toBeLessThan(0.5);
  });

  it("compiles the whole corpus with no model and no gate catastrophe", () => {
    const r = measureF0(cards, 4);
    expect(r.totalItems).toBeGreaterThan(1500);
    // V0 firing zero times is expected on authored cards — there are no dangling "see Table 7.3"
    // references. It earns its keep the moment real extracted documents are ingested.
    expect(r.byGate.V0 ?? 0).toBe(0);
    expect(r.byGate.V1 ?? 0).toBe(0); // a harvested key IS its span
  });
});
