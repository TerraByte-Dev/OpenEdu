import { describe, it, expect } from "vitest";
import { arithmeticClaims } from "./arithmetic-claims";

const verdicts = (text: string) => arithmeticClaims(text).map((c) => [c.text, c.holds]);

describe("arithmeticClaims: equations", () => {
  it.each([
    ["6 x 7 = 48", false, "6 × 7 = 42, not 48."],
    ["6 x 7 = 42", true, "6 × 7 = 42."],
    ["6×7=42", true, "6 × 7 = 42."],
    ["9 + 5 = 13", false, "9 + 5 = 14, not 13."],
    ["10 - 4 = 6", true, "10 − 4 = 6."],
    ["12 ÷ 4 = 3", true, "12 ÷ 4 = 3."],
    ["12 / 4 = 4", false, "12 ÷ 4 = 3, not 4."],
    ["1 ÷ 3 = 0.33", true, "1 ÷ 3 = 0.33."],
    ["1 / 4 = 0.5", false, "1 ÷ 4 = 0.25, not 0.5."],
    ["1,000 + 2,500 = 3,500", true, "1,000 + 2,500 = 3,500."],
    ["0.1 + 0.2 = 0.3", true, "0.1 + 0.2 = 0.3."],
  ])("%s", (text, holds, truth) => {
    const [claim] = arithmeticClaims(`So ${text} in the end.`);
    expect(claim).toMatchObject({ text, holds, truth });
  });

  it("finds the claim inside a sentence and reports where it is", () => {
    const note = "Times tables: 6 x 7 = 48. That one is tricky.";
    const [claim] = arithmeticClaims(note);
    expect(note.slice(claim.from, claim.to)).toBe("6 x 7 = 48");
  });

  it.each([
    "2x + 3 = 7",              // a variable
    "x + 3 = 7",
    "10 - 2 x 3 = 4",          // a longer expression (true as a whole)
    "2 + 3 + 4 = 9",
    "-3 + 5 = 2",              // a negative sign
    "2 x 10^3 = 2000",         // an exponent
    "50% x 2 = 100%",
    "7 / 2 = 3",               // integer division or "3 remainder 1": no verdict
    "17 ÷ 5 = 3 R2",
    "5 + 3 = 8 = 2 x 4",       // a chain
    "y = 3 x 4",
    "twice 3 + 4 = 10",
    "range(3) gives 0, 1, 2",
    "v2 + 3 = 5",
  ])("leaves %s alone", (text) => {
    expect(arithmeticClaims(text)).toEqual([]);
  });
});

describe("arithmeticClaims: comparisons", () => {
  it("catches the fraction mix-up from the audit", () => {
    expect(arithmeticClaims("Remember: 1/3 is bigger than 1/2.")).toMatchObject([
      { text: "1/3 is bigger than 1/2", holds: false, truth: "1/3 is smaller than 1/2." },
    ]);
  });

  it.each([
    ["1/2 is bigger than 1/3", true],
    ["0.25 is greater than 0.5", false],
    ["3 is less than 7", true],
    ["2/4 is bigger than 1/2", false],
    ["1/3 > 1/2", false],
    ["0.5 < 0.25", false],
    ["8 > 5", true],
  ])("%s", (text, holds) => {
    expect(verdicts(text)).toEqual([[text, holds]]);
  });

  it("says when the two are equal", () => {
    expect(arithmeticClaims("2/4 is bigger than 1/2")[0].truth).toBe("2/4 and 1/2 are equal.");
  });

  it.each([
    "7 is 3 more than 4",           // a difference, not a comparison of 3 and 4
    "twice 1/3 is bigger than 1/2",
    "half of 6 is less than 4",
    "1 1/2 is bigger than 1",       // a mixed number
    "5 is less than 3 times 2",
    "1 is smaller than 2 dozen",
    "3 apples are more than 2",
    "x > 3",
    "a 1/3 cup is bigger than 1/4",
  ])("leaves %s alone", (text) => {
    expect(arithmeticClaims(text)).toEqual([]);
  });
});
