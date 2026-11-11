import { describe, it, expect } from "vitest";
import { matchTerm, gradeDefine, itemMajority, compareDefineArms, type DefineRowLike } from "./define-grade";
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
