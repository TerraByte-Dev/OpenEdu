import { describe, it, expect } from "vitest";
import { sampleBySubject, selectK12FlowItems, seededRandom } from "./select";
import { K12_ITEMS } from "../k12-items";

const subjects = (xs: Array<{ subject: string }>) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x.subject]: (m[x.subject] ?? 0) + 1 }), {});

describe("seededRandom", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = seededRandom(7), b = seededRandom(7);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe("sampleBySubject", () => {
  it("spreads the sample across subjects in proportion, leftovers by largest remainder then item order", () => {
    expect(subjects(sampleBySubject(K12_ITEMS, 6))).toEqual({ math: 2, science: 2, ela: 1, "social-studies": 1 });
    expect(subjects(sampleBySubject(K12_ITEMS, 40))).toEqual({ math: 10, science: 10, ela: 10, "social-studies": 10 });
  });

  it("is the same every time, keeps item order, and has no repeats", () => {
    const s = sampleBySubject(K12_ITEMS, 24);
    expect(sampleBySubject(K12_ITEMS, 24).map((x) => x.id)).toEqual(s.map((x) => x.id));
    expect(new Set(s.map((x) => x.id)).size).toBe(24);
    const pos = s.map((x) => K12_ITEMS.indexOf(x));
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it("does not just take each subject's first items", () => {
    const firsts = new Set(["math-k5-01", "math-k5-02"]);
    expect(sampleBySubject(K12_ITEMS, 6).filter((x) => x.subject === "math").every((x) => firsts.has(x.id))).toBe(false);
  });

  it("returns every item when n covers the pool", () => {
    expect(sampleBySubject(K12_ITEMS, 999)).toHaveLength(K12_ITEMS.length);
  });
});

describe("selectK12FlowItems", () => {
  it("defaults to every dev item", () => {
    expect(selectK12FlowItems(K12_ITEMS, {})).toHaveLength(240);
  });
  it("EVAL_LIMIT takes the first N", () => {
    expect(selectK12FlowItems(K12_ITEMS, { limit: 3 }).map((x) => x.id)).toEqual(K12_ITEMS.slice(0, 3).map((x) => x.id));
  });
  it("EVAL_ONLY keeps the listed ids, in item order, and refuses an unknown one", () => {
    expect(selectK12FlowItems(K12_ITEMS, { only: "ela-k5-02, math-k5-01" }).map((x) => x.id)).toEqual(["math-k5-01", "ela-k5-02"]);
    expect(() => selectK12FlowItems(K12_ITEMS, { only: "math-k5-01,pilot-01" })).toThrow(/pilot-01/);
  });
  it("EVAL_SAMPLE then EVAL_LIMIT", () => {
    expect(selectK12FlowItems(K12_ITEMS, { sample: 8, limit: 2 })).toEqual(sampleBySubject(K12_ITEMS, 8).slice(0, 2));
  });
});
