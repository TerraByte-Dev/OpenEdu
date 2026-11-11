import { describe, it, expect } from "vitest";
import {
  GRADES, normalizeGrade, gradeLabel, gradeBand, isEarlyReader, readingLevelLayer, autoReadAloud, hasEarlyScreens,
  earlyScreensOn, type Grade,
} from "./grade";

describe("normalizeGrade", () => {
  it("keeps K (0) through 12, from a DB integer or a form string", () => {
    for (const g of GRADES) {
      expect(normalizeGrade(g)).toBe(g);
      expect(normalizeGrade(String(g))).toBe(g);
    }
  });

  it("reads anything else as not set", () => {
    for (const v of [null, undefined, "", " ", -1, 13, 2.5, "K", "abc", NaN, true, {}]) {
      expect(normalizeGrade(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("gradeBand", () => {
  it("maps every grade to its band", () => {
    const bands = GRADES.map((g) => gradeBand(g));
    expect(bands).toEqual(["K-2", "K-2", "K-2", "3-5", "3-5", "3-5", "6-8", "6-8", "6-8", "9-12", "9-12", "9-12", "9-12"]);
  });

  it("has no band when no grade is set", () => {
    expect(gradeBand(null)).toBeNull();
  });

  it("calls K-2 early readers, and nobody else", () => {
    expect(GRADES.filter(isEarlyReader)).toEqual([0, 1, 2]);
    expect(isEarlyReader(null)).toBe(false);
  });
});

describe("gradeLabel", () => {
  it("names kindergarten, grades and not set", () => {
    expect(gradeLabel(0)).toBe("Kindergarten");
    expect(gradeLabel(7)).toBe("Grade 7");
    expect(gradeLabel(null)).toBe("Not set");
  });
});

describe("readingLevelLayer", () => {
  it("adds nothing when no grade is set", () => {
    expect(readingLevelLayer(null)).toBeUndefined();
  });

  it("is one short section per grade, naming the grade", () => {
    expect(readingLevelLayer(0)).toMatch(/^## Reading level\nThe student is in kindergarten\. /);
    expect(readingLevelLayer(4)).toMatch(/^## Reading level\nThe student is in grade 4\. /);
    for (const g of GRADES) {
      const text = readingLevelLayer(g)!;
      expect(text.split("\n")).toHaveLength(2);
      expect(text.length).toBeLessThan(260);
    }
  });

  it("uses the same rule for every grade in a band, and a different rule per band", () => {
    const rule = (g: Grade) => readingLevelLayer(g)!.split(". ").slice(1).join(". ");
    expect(new Set([0, 1, 2].map((g) => rule(g as Grade))).size).toBe(1);
    expect(new Set([3, 4, 5].map((g) => rule(g as Grade))).size).toBe(1);
    expect(new Set([6, 7, 8].map((g) => rule(g as Grade))).size).toBe(1);
    expect(new Set([9, 10, 11, 12].map((g) => rule(g as Grade))).size).toBe(1);
    expect(new Set([0, 3, 6, 9].map((g) => rule(g as Grade))).size).toBe(4);
  });

  it("gives K-2 short sentences, simple words and one idea at a time", () => {
    const k2 = readingLevelLayer(1)!.toLowerCase();
    expect(k2).toContain("under 10 words");
    expect(k2).toContain("simple, everyday words");
    expect(k2).toContain("one idea at a time");
  });

  it("allows longer sentences as the band goes up", () => {
    const limit = (g: Grade) => Number(/under (\d+) words each/.exec(readingLevelLayer(g)!)?.[1] ?? Infinity);
    expect(limit(1)).toBeLessThan(limit(4));
    expect(limit(4)).toBeLessThan(limit(7));
    expect(limit(7)).toBeLessThan(limit(10));
  });
});

describe("autoReadAloud", () => {
  it("is on by default for K-2 and follows their own choice", () => {
    for (const g of [0, 1, 2] as Grade[]) {
      expect(autoReadAloud(g, null)).toBe(true);
      expect(autoReadAloud(g, false)).toBe(false);
      expect(autoReadAloud(g, true)).toBe(true);
    }
  });

  it("is off for grade 3 and up and for no grade, whatever is stored", () => {
    for (const g of [3, 8, 12, null] as Array<Grade | null>) {
      expect(autoReadAloud(g, null)).toBe(false);
      expect(autoReadAloud(g, true)).toBe(false);
    }
  });
});

describe("earlyScreensOn", () => {
  it("is on by default for K and grade 1, and follows the family's choice", () => {
    for (const g of [0, 1] as Grade[]) {
      expect(hasEarlyScreens(g)).toBe(true);
      expect(earlyScreensOn(g, null)).toBe(true);
      expect(earlyScreensOn(g, true)).toBe(true);
      expect(earlyScreensOn(g, false)).toBe(false);
    }
  });

  it("is off for grade 2 and up and for no grade, whatever is stored", () => {
    for (const g of [2, 3, 8, 12, null] as Array<Grade | null>) {
      expect(hasEarlyScreens(g)).toBe(false);
      expect(earlyScreensOn(g, null)).toBe(false);
      expect(earlyScreensOn(g, true)).toBe(false);
    }
  });
});
