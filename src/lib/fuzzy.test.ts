import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter, highlightRuns } from "./fuzzy";

const titles = [
  "Calvin cycle",
  "Light reactions",
  "Chlorophyll",
  "Carbon fixation",
  "RuBisCO",
  "Cellular respiration",
];
const rank = (q: string) => fuzzyFilter(q, titles, (t) => t).map((m) => m.item);

describe("fuzzyScore", () => {
  it("matches a contiguous prefix", () => {
    expect(fuzzyScore("cal", "Calvin cycle")?.positions).toEqual([0, 1, 2]);
  });

  it("matches a non-contiguous subsequence", () => {
    expect(fuzzyScore("cvc", "Calvin cycle")).not.toBeNull();
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyScore("xyz", "Calvin cycle")).toBeNull();
  });

  it("returns null when characters are present but out of order", () => {
    expect(fuzzyScore("cba", "abc")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("CALVIN", "calvin cycle")).not.toBeNull();
  });

  it("treats an empty query as a match with no positions", () => {
    expect(fuzzyScore("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("scores a contiguous run above a scattered one", () => {
    const tight = fuzzyScore("cal", "Calvin")!.score;
    const loose = fuzzyScore("cal", "Cellular animal")!.score;
    expect(tight).toBeGreaterThan(loose);
  });

  it("rewards a word-start match over a mid-word one", () => {
    const start = fuzzyScore("r", "Light reactions")!.score;   // "reactions"
    const mid = fuzzyScore("r", "Chlorophyll")!.score;          // inside "chlorophyll"
    expect(start).toBeGreaterThan(mid);
  });

  it("prefers the shorter of two equally good candidates", () => {
    const short = fuzzyScore("ab", "ab")!.score;
    const long = fuzzyScore("ab", "ab and a much longer title")!.score;
    expect(short).toBeGreaterThan(long);
  });

  it("recognises a camelCase hump as a word start", () => {
    expect(fuzzyScore("rb", "RuBisCO")).not.toBeNull();
    expect(fuzzyScore("rb", "RuBisCO")!.score).toBeGreaterThan(fuzzyScore("rb", "arbitrary")!.score);
  });
});

describe("fuzzyFilter", () => {
  it("ranks the intended note first for a prefix", () => {
    expect(rank("cal")[0]).toBe("Calvin cycle");
  });

  it("ranks the intended note first for an initialism", () => {
    expect(rank("cc")[0]).toBe("Calvin cycle");
  });

  it("drops non-matches entirely", () => {
    expect(rank("zzz")).toEqual([]);
  });

  it("returns everything, in original order, for an empty query", () => {
    expect(rank("")).toEqual(titles);
    expect(rank("   ")).toEqual(titles);
  });

  it("is stable between keystrokes — ties break on the label", () => {
    const items = ["beta", "alpha"];
    expect(fuzzyFilter("a", items, (t) => t).map((m) => m.item)).toEqual(["alpha", "beta"]);
  });

  it("carries positions through for highlighting", () => {
    const [first] = fuzzyFilter("cal", titles, (t) => t);
    expect(first.positions).toEqual([0, 1, 2]);
  });
});

describe("highlightRuns", () => {
  it("splits into matched and unmatched runs", () => {
    expect(highlightRuns("Calvin", [0, 1, 2])).toEqual([
      { text: "Cal", hit: true },
      { text: "vin", hit: false },
    ]);
  });

  it("handles scattered positions", () => {
    expect(highlightRuns("abc", [0, 2])).toEqual([
      { text: "a", hit: true },
      { text: "b", hit: false },
      { text: "c", hit: true },
    ]);
  });

  it("returns one unmatched run when there are no positions", () => {
    expect(highlightRuns("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });

  it("reassembles to the original string", () => {
    const runs = highlightRuns("Calvin cycle", [0, 7, 8]);
    expect(runs.map((r) => r.text).join("")).toBe("Calvin cycle");
  });
});
