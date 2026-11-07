// CSV for the teacher overview export. Pure module, tested in csv.test.ts.
//
// RFC 4180 quoting, CRLF line ends, and a UTF-8 byte-order mark so Excel opens learner names in any
// script correctly. Learner names and course titles are typed by people, so every cell also gets the
// spreadsheet formula-injection guard: wherever a spreadsheet could start reading a new cell, an
// = + - @ there is prefixed with an apostrophe so it is shown as text and never run.
//
// A new cell can start at the cell's first character, and also after a ; a tab or a line break.
// Excel opens a double-clicked .csv with the Windows list separator, which is ; in much of Europe,
// francophone Africa and Latin America. There it splits at every ;, and a quote only counts at the
// start of a field, so quoting the cell is not enough on its own. A leading tab or carriage return
// (which some spreadsheets strip before reading a formula) is covered the same way.

const FIELD_START = /(^|[;\t\r\n])(?=[=+\-@])/g;
const NEEDS_QUOTES = /[",;\t\r\n]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(FIELD_START, "$1'");
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
