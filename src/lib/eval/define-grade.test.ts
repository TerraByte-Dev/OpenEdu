import { describe, it, expect } from "vitest";
import { matchTerm, gradeDefine, itemMajority, compareDefineArms, addedCalls, judgeDefine, accuracyGain, type DefineRowLike, type DefineRunRow, type ArmContrast } from "./define-grade";
import type { DefineItem, DefineSplit } from "./define-items";

// Made-up items: the grader is checked on its own words, not the suite's.
const PLAIN: DefineItem = { id: "p1", band: "9-12", kind: "plain", ask: "what does zorp mean", word: "zorp", expect: ["laugh*|very big|talk* into"] };
const SENSE: DefineItem = { id: "s1", band: "K-2", kind: "sense", ask: "what does zorp mean in 'x'", word: "zorp", expect: ["river*|shore"], wrongSense: "money|loan*" };

describe("matchTerm", () => {
  it("matches whole words, case-insensitive, with * as a word-ending wildcard", () => {
    expect(matchTerm("It means LAUGHING a lot.", "laugh*")).toBe("laugh*");
    expect(matchTerm("Something very\n big.", "very big")).toBe("very big");
    expect(matchTerm("They talked her into it.", "talk* into")).toBeNull();
    expect(matchTerm("They talked into it.", "talk* into")).toBe("talk* into");
    expect(matchTerm("a slaughter", "laugh*")).toBeNull();
    expect(matchTerm("bigger", "very big|big")).toBeNull();
    expect(matchTerm("don’t want to", "don't want")).toBe("don't want");
    expect(matchTerm("redo", "red")).toBeNull();
  });
});

describe("gradeDefine", () => {
  it("passes a plain item when every group matches", () => {
    expect(gradeDefine(PLAIN, "Zorp means to laugh.").pass).toBe(true);
    expect(gradeDefine(PLAIN, "Zorp means small.")).toMatchObject({ pass: false, passStrict: false, wrongSenseHit: null });
  });
  it("reads a sense item two ways", () => {
    expect(gradeDefine(SENSE, "Here it means the shore.")).toMatchObject({ pass: true, passStrict: true });
    expect(gradeDefine(SENSE, "Not the money kind: here it means the shore.")).toMatchObject({ pass: true, passStrict: false, wrongSenseHit: "money" });
    expect(gradeDefine(SENSE, "It is where you keep money.")).toMatchObject({ pass: false, passStrict: false });
  });
});

const g = (pass: boolean, passStrict = pass) => ({ expectHits: [], wrongSenseHit: null, pass, passStrict });
const rows = (id: string, verdicts: Array<boolean | null>): DefineRowLike[] => verdicts.map((v, repeat) => ({ id, repeat, grade: v === null ? null : g(v) }));

describe("itemMajority", () => {
  it("is the majority of repeats; ties and ERROR rows fail", () => {
    const m = itemMajority([...rows("a", [true, true, false]), ...rows("b", [true, false]), ...rows("c", [true, null, null]), ...rows("d", [true])]);
    expect(Object.fromEntries(m)).toEqual({ a: true, b: false, c: false, d: true });
  });
});

describe("compareDefineArms", () => {
  it("pairs items by majority within a split and counts lost and gained items per group", () => {
    const items: DefineItem[] = [
      { ...PLAIN, id: "r1" }, { ...PLAIN, id: "r2" }, { ...PLAIN, id: "r3" }, { ...PLAIN, id: "r4", band: "K-2" },
      { ...SENSE, id: "s1" }, { ...PLAIN, id: "dev1" },
    ];
    const split: Record<string, DefineSplit> = { r1: "test", r2: "test", r3: "test", r4: "test", s1: "test", dev1: "dev" };
    const B = [...rows("r1", [true]), ...rows("r2", [false]), ...rows("r3", [false]), ...rows("r4", [true]), { id: "s1", repeat: 0, grade: g(true, false) }, ...rows("dev1", [false])];
    const D = [...rows("r1", [true]), ...rows("r2", [true]), ...rows("r3", [true]), ...rows("r4", [false]), { id: "s1", repeat: 0, grade: g(true, true) }, ...rows("dev1", [true])];
    const by = Object.fromEntries(compareDefineArms(items, "test", split, B, D).map((c) => [c.group, c]));
    expect(by.rare).toMatchObject({ n: 3, b: { k: 1 }, d: { k: 3 }, lost: [], gained: ["r2", "r3"] });
    expect(by.common).toMatchObject({ n: 1, lost: ["r4"], gained: [] });
    expect(by.sense).toMatchObject({ n: 1, lost: [], gained: [] });
    expect(by["sense-strict"]).toMatchObject({ n: 1, gained: ["s1"] });
    expect(by.target).toMatchObject({ n: 4, gained: ["r2", "r3"] });
    expect(by["plain-all"].n).toBe(4);
    expect(by.rare.p).toBeCloseTo(0.5);
  });
});

const run = (over: Partial<DefineRunRow> = {}): DefineRunRow => ({
  id: "r1", repeat: 0, grade: g(true), error: null, askedWord: "zorp", dictionaryNote: "NOTE", attempts: 1, stopReason: "complete",
  toolCalls: [], toolCallRecovery: null, chatRequests: 1, structuredRequests: 0, reply: "x", ...over,
});

describe("addedCalls", () => {
  it("counts structured requests and turn requests above toolCalls + 1", () => {
    expect(addedCalls(run())).toBe(0);
    expect(addedCalls(run({ chatRequests: 3, toolCalls: [{}, {}] }))).toBe(0);
    expect(addedCalls(run({ chatRequests: 2 }))).toBe(1);
    expect(addedCalls(run({ structuredRequests: 1 }))).toBe(1);
  });
  it("allows one more on a capped or recovered turn, and does not count retried or ERROR rows", () => {
    expect(addedCalls(run({ chatRequests: 2, stopReason: "max_iterations" }))).toBe(0);
    expect(addedCalls(run({ chatRequests: 2, toolCallRecovery: { iteration: 0, error: "x" } }))).toBe(0);
    expect(addedCalls(run({ attempts: 2, chatRequests: 5 }))).toBeNull();
    expect(addedCalls(run({ error: "x", grade: null }))).toBeNull();
  });
});

describe("compareDefineArms dropItems", () => {
  it("leaves out the dropped items in both arms", () => {
    const items: DefineItem[] = [{ ...PLAIN, id: "a" }, { ...PLAIN, id: "b" }];
    const split: Record<string, DefineSplit> = { a: "test", b: "test" };
    const c = compareDefineArms(items, "test", split, [...rows("a", [false]), ...rows("b", [false])], [...rows("a", [true]), ...rows("b", [true])], { dropItems: new Set(["a"]) });
    expect(c.find((x) => x.group === "rare")).toMatchObject({ n: 1, gained: ["b"] });
  });
});

const contrast = (group: ArmContrast["group"], n: number, bk: number, dk: number, lost: string[], gained: string[], p = 1): ArmContrast =>
  ({ group, n, b: { k: bk, wilson: [0, 1] }, d: { k: dk, wilson: [0, 1] }, lost, gained, p });

describe("accuracyGain and judgeDefine", () => {
  it("accepts 6 gained and 0 lost (p 0.031) but not 5 and 0 (p 0.0625)", () => {
    expect(accuracyGain(contrast("target", 45, 30, 36, [], ["1", "2", "3", "4", "5", "6"], 0.03125))).toBe(true);
    expect(accuracyGain(contrast("target", 45, 30, 35, [], ["1", "2", "3", "4", "5"], 0.0625))).toBe(false);
  });

  const base = (over: Partial<Record<ArmContrast["group"], ArmContrast>> = {}): ArmContrast[] =>
    (["common", "plain-6-8", "plain-k8", "rare", "sense", "sense-strict", "target", "target-strict", "plain-all"] as const)
      .map((k) => over[k] ?? contrast(k, 10, 5, 5, [], []));
  const words = new Map([["r1", "zorp"]]);

  it("fires the sense harm clause at 3 lost, and the fire clause on a missed note", () => {
    const v = judgeDefine({ all: base({ sense: contrast("sense", 20, 15, 12, ["a", "b", "c"], []) }), withoutErrorItems: base(), rowsB: [run()], rowsD: [run({ dictionaryNote: null })], wordOf: words });
    expect(v.clauses.filter((c) => c.fires).map((c) => c.clause)).toEqual(["harm: sense D <= B - 3", "fire: a non-ERROR D row whose word is missed or that gets no note"]);
    expect(v.killed).toBe(true);
  });

  it("does not read ERROR rows for the fire clause; errors are their own clause", () => {
    const err = run({ error: "x", grade: null, askedWord: null, dictionaryNote: null });
    const one = judgeDefine({ all: base(), withoutErrorItems: base(), rowsB: [run()], rowsD: [err], wordOf: words });
    expect(one.killed).toBe(false);
    const two = judgeDefine({ all: base(), withoutErrorItems: base(), rowsB: [run()], rowsD: [err, { ...err, repeat: 1 }], wordOf: words });
    expect(two.clauses.find((c) => c.clause.startsWith("errors"))!.fires).toBe(true);
  });

  it("calls an accuracy lever only when both readings gain, with and without ERROR items; ceiling at B >= 40 of 45", () => {
    const up = contrast("target", 45, 30, 36, [], ["1", "2", "3", "4", "5", "6"], 0.03125);
    const upS = { ...up, group: "target-strict" as const };
    const ok = { all: base({ target: up, "target-strict": upS }), withoutErrorItems: base({ target: up, "target-strict": upS }), rowsB: [run()], rowsD: [run()], wordOf: words };
    expect(judgeDefine(ok).accuracy).toBe("lever");
    expect(judgeDefine({ ...ok, all: base({ target: up }) }).accuracy).toBe("not-shown");
    expect(judgeDefine({ ...ok, withoutErrorItems: base({ target: up }) }).accuracy).toBe("not-shown");
    expect(judgeDefine({ ...ok, all: base({ target: { ...up, b: { k: 40, wilson: [0, 1] } }, "target-strict": upS }) }).accuracy).toBe("ceiling");
  });
});
