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
    expect(csvCell("\t=1+1")).toBe("\"\t'=1+1\"");
    expect(csvCell("\r=1+1")).toBe("\"\r'=1+1\"");
  });

  // Excel opens a double-clicked .csv with the Windows list separator, which is ; in much of Europe,
  // francophone Africa and Latin America. There a cell splits at every ; and a quote only counts at
  // the start of a field, so quoting alone is not enough: every place a field can start is defused.
  it("defuses a formula after a ; or a tab, where another spreadsheet may start a new cell", () => {
    expect(csvCell("Maths;=HYPERLINK(1)")).toBe("\"Maths;'=HYPERLINK(1)\"");
    expect(csvCell("x;=cmd|' /C calc'!A0;y")).toBe("\"x;'=cmd|' /C calc'!A0;y\"");
    expect(csvCell("a\t+1")).toBe("\"a\t'+1\"");
    expect(csvCell("a;b")).toBe("\"a;b\"");
  });

  it("defuses a formula after a line break", () => {
    expect(csvCell("a\n@SUM(A1)")).toBe("\"a\n'@SUM(A1)\"");
  });

  it("leaves = + - @ inside text alone", () => {
    expect(csvCell("Math = fun")).toBe("Math = fun");
    expect(csvCell("Grade-5")).toBe("Grade-5");
  });

  it("keeps non-Latin names intact", () => {
    expect(csvCell("Ọlá")).toBe("Ọlá");
    expect(csvCell("محمد")).toBe("محمد");
  });
});

describe("toCsv", () => {
  it("no field starts a formula, whichever of , ; or tab the spreadsheet splits on", () => {
    const evil = [
      "Maths;=HYPERLINK(\"http://x\",\"click\")", "x;=cmd|' /C calc'!A0;y", "a\t+1+1\tb", "a\r\n-2+3;c",
      "@SUM(A1)", "ok", "Grade 5, =1+1",
    ];
    const csv = toCsv([evil, [...evil].reverse()]);
    for (const sep of [/[,\r\n]/, /[;\r\n]/, /[\t\r\n]/]) {
      for (const field of csv.slice(1).split(sep)) expect(field).not.toMatch(/^"*[=+\-@]/);
    }
  });

  it("starts with a UTF-8 BOM and ends every row with CRLF", () => {
    expect(toCsv([["a", "b"], [1, null]])).toBe("﻿a,b\r\n1,\r\n");
  });
});
