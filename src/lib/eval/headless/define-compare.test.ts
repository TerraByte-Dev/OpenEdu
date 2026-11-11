import { describe, it, expect } from "vitest";
import { compareRefusals, shortGroups } from "./define-compare";
import { DEFINE_TEST_GROUP_N, type ArmContrast } from "../define-grade";

type Saved = Parameters<typeof compareRefusals>[0];
const file = (over: Partial<Saved> = {}): Saved => ({
  suite: "define", commit: "abc", model: "gemma4:e2b", split: "test", dictionary: "off", repeats: 3, partial: false, void: false, only: null,
  options: { suite: "define", set: "test", repeats: 3, dictionary: "off", out: "x.json" }, rows: [], ...over,
});
const pair = (b: Partial<Saved> = {}, d: Partial<Saved> = {}) =>
  compareRefusals(file(b), file({ dictionary: "on", options: { suite: "define", set: "test", repeats: 3, dictionary: "on", out: "y.json" }, ...d }));

describe("compareRefusals", () => {
  it("accepts two complete test arms at one commit with 3 repeats", () => {
    expect(pair()).toEqual([]);
  });
  it("refuses wrong arms, a missing or different commit, model, split or options", () => {
    expect(pair({ dictionary: "on" }).join()).toMatch(/DEFINE_B must be/);
    expect(pair({ commit: null }).join()).toMatch(/no commit/);
    expect(pair({}, { commit: "def" }).join()).toMatch(/different commits/);
    expect(pair({}, { model: "gemma4:e4b" }).join()).toMatch(/different models/);
    expect(pair({}, { options: { suite: "define", set: "test", repeats: 3, dictionary: "on", ctx: 4096 } }).join()).toMatch(/different run options/);
  });
  it("on the test split, refuses partial, EVAL_ONLY, void, unequal repeats and repeats other than 3", () => {
    expect(pair({ partial: true }).join()).toMatch(/partial/);
    expect(pair({ only: "def-k2-02" }).join()).toMatch(/partial/);
    expect(pair({}, { void: true }).join()).toMatch(/void/);
    expect(pair({}, { repeats: 1 }).join()).toMatch(/unequal repeats/);
    expect(pair({ repeats: 1 }, { repeats: 1 }).join()).toMatch(/runs 3 repeats/);
  });
  it("lets a dev comparison through with any repeats", () => {
    expect(pair({ split: "dev", repeats: 1 }, { split: "dev", repeats: 1 })).toEqual([]);
  });
});

describe("shortGroups", () => {
  it("names a test group smaller than the frozen split", () => {
    const full = Object.entries(DEFINE_TEST_GROUP_N).map(([group, n]) => ({ group, n }) as ArmContrast);
    expect(shortGroups(full)).toEqual([]);
    expect(shortGroups(full.map((c) => (c.group === "sense" ? { ...c, n: 19 } : c)))).toEqual(["sense n 19 < 20"]);
  });
});
