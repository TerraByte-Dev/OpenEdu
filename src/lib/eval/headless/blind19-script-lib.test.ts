import { describe, it, expect } from "vitest";

// blind-19's script helpers (blind19-script-lib.ts): grouping runs into arms, prices, and R8's dry run.

import { dryRun, groupRuns, parsePrices } from "./blind19-script-lib";
import { grader2Request, type SheetData } from "./define-script-lib";
import type { Blind19Run } from "../blind19-grade";

const run = (model: string, dictionary: "on" | "off", senseRank?: "on" | "off"): Blind19Run =>
  ({ suite: "define", split: "blind-19", commit: "c", model, dictionary, senseRank, repeats: 3, partial: false, rows: [] });

describe("groupRuns", () => {
  it("groups S, R and B per model", () => {
    const g = groupRuns([run("a", "on", "off"), run("a", "on", "on"), run("a", "off", "on"), run("b", "on", "on"), run("b", "on", "off")]);
    expect(g.map((m) => [m.model, m.S.senseRank, m.R.senseRank, m.B?.dictionary ?? null])).toEqual([["a", "off", "on", "off"], ["b", "off", "on", null]]);
  });
  it("refuses a file that is no arm, two files for one arm, and a model without S or R", () => {
    expect(() => groupRuns([run("a", "on")])).toThrow(/neither S, R nor B/);
    expect(() => groupRuns([run("a", "on", "off"), run("a", "on", "off")])).toThrow(/two S files/);
    expect(() => groupRuns([run("a", "on", "off")])).toThrow(/needs both an S and an R file/);
  });
});

describe("prices and the dry run (R8)", () => {
  it("reads model=in/out per million tokens", () => {
    expect([...parsePrices("anthropic/claude-fable-5.2=3/15, openai/gpt-6.1-sol:batch=0.6/5")]).toEqual([
      ["anthropic/claude-fable-5.2", { inPerM: 3, outPerM: 15 }], ["openai/gpt-6.1-sol:batch", { inPerM: 0.6, outPerM: 5 }],
    ]);
    expect(() => parsePrices("gpt=cheap")).toThrow(/not model=in\/out/);
  });

  it("prices every row of every sheet for each grader, as define-label-grader2.ts would send it, and flags over 80% of the credit", () => {
    const sheet: SheetData = { sheet: "s", rows: Array.from({ length: 100 }, (_, i) => ({ rid: String(i + 1), word: "bank", kind: "sense" as const, ask: "what does bank mean in 'the bank of the river'", reply: "It means the side of a river. ".repeat(10) })) };
    const prices = parsePrices("anthropic/x=3/15,openai/y=1/10");
    const r = dryRun([sheet, sheet], prices, 9);
    expect(r.perModel.map((m) => m.requests)).toEqual([200, 200]);
    const one = Math.ceil(JSON.stringify(grader2Request("anthropic/x", sheet.rows[0])).length / 4);
    expect(r.perModel[0].inTokens).toBe(200 * one);
    expect(r.usd).toBeCloseTo(r.perModel[0].usd + r.perModel[1].usd, 12);
    expect(r.over).toBe(r.usd > 7.2);
    expect(dryRun([sheet], prices, 0.001).over).toBe(true);
  });
});
