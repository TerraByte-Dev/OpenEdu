import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvCell("Amina")).toBe("Amina");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(0)).toBe("0");
  });

  it("writes null and undefined as empty cells", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell('The "best" course')).toBe('"The ""best"" course"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("defuses formulas: a cell starting with = + - @ is shown as text", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("defuses a formula hidden behind a leading tab or carriage return", () => {
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("\r=1+1")).toBe("\"'\r=1+1\"");
  });

  it("only looks at the first character", () => {
    expect(csvCell("Math = fun")).toBe("Math = fun");
    expect(csvCell("Grade-5")).toBe("Grade-5");
  });

  it("keeps non-Latin names intact", () => {
    expect(csvCell("Ọlá")).toBe("Ọlá");
    expect(csvCell("محمد")).toBe("محمد");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM and ends every row with CRLF", () => {
    expect(toCsv([["a", "b"], [1, null]])).toBe("﻿a,b\r\n1,\r\n");
  });
});
