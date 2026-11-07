// CSV for the teacher overview export. Pure module, tested in csv.test.ts.
//
// RFC 4180 quoting, CRLF line ends, and a UTF-8 byte-order mark so Excel opens learner names in any
// script correctly. Learner names and course titles are typed by people, so every cell also gets the
// spreadsheet formula-injection guard: a cell that starts with = + - @ (or a tab / carriage return,
// which some spreadsheets strip before reading a formula) is prefixed with an apostrophe so it is
// shown as text and never run.

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
