// Turn a card's own markdown into gradable items. ZERO model calls.
//
// This is the whole bet. A card is 176 words of reference prose, and the design's claim is that the
// TABLES and DEFINITION LISTS inside those words are already an item bank — the answer key is the
// data, so a fabricated key is not merely unlikely, it is impossible.
//
// The alternative — asking a model to write questions — costs roughly 22M tokens per 1,000
// documents, which on a local model never finishes, and produces keys nothing can verify.

import { normalizeAnswer, numericValueOf } from "../quiz-grading";
import type { Expected, Item } from "./types";
import { closedBook, itemKey } from "./types";

/** Below this, the answer column's vocabulary is small enough to learn instead of the material. */
export const MIN_DISTINCT_ANSWERS = 8;
/** A prose sentence is a bad exact-match target; a short label is a good one. */
const MAX_ANSWER_TOKENS = 4;
const MIN_TABLE_ROWS = 4;
const MIN_DEFLIST_ENTRIES = 8;

const cell = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();
const tokens = (s: string) => s.split(/\s+/).filter(Boolean).length;

export interface Table {
  headers: string[];
  rows: string[][];
  /** Nearest preceding `##` heading, used to give a stem its context. */
  caption: string;
}

/** Strip a leading YAML frontmatter block — same shape the app and the builder both use. */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m.length ? m[0].length : 0) : md;
}

export function parseTables(md: string): Table[] {
  const lines = stripFrontmatter(md).split(/\r?\n/);
  const out: Table[] = [];
  let caption = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) { caption = cell(h[1]); continue; }
    if (!line.trim().startsWith("|")) continue;
    // A table is a header row, a |---|---| separator, then data rows.
    const sep = lines[i + 1];
    if (!sep || !/^\s*\|[\s:|-]+\|\s*$/.test(sep)) continue;
    const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map(cell);
    const headers = split(line);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const r = split(lines[j]);
      if (r.length === headers.length) rows.push(r);
    }
    if (rows.length >= MIN_TABLE_ROWS) out.push({ headers, rows, caption });
    i = j - 1;
  }
  return out;
}

/**
 * `- **Term** — definition`, and the bare `- Term — definition` the corpus also uses (polyatomic
 * ions declares "Format: **name — formula — charge**" and then lists `- Hydroxide — OH — -1`).
 */
export function parseDefList(md: string): Array<{ term: string; def: string }> {
  const out: Array<{ term: string; def: string }> = [];
  for (const line of stripFrontmatter(md).split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(?:\*\*(.+?)\*\*|([^—–:]{2,40}?))\s*[—–]\s*(.+)$/.exec(line);
    if (!m) continue;
    const term = cell(m[1] ?? m[2] ?? "");
    const def = cell(m[3] ?? "");
    if (term && def) out.push({ term, def });
  }
  return out;
}

function expectedFor(answer: string): Expected {
  const n = numericValueOf(answer);
  // tolRel 0 — a harvested value is exact. Significant-figure tolerance belongs to authored
  // transfer items, which compute a result rather than reproduce one.
  return n !== null
    ? { kind: "numeric", value: n, tolRel: 0 }
    : { kind: "exact_set", any: [answer] };
}

/**
 * One item per row, for every ordered column pair whose ANSWER column is short, unique and drawn
 * from a large enough vocabulary.
 *
 * The direction matters and both are generated: "Prefix un- means?" and "Which prefix means 'not'?"
 * are different retrieval tasks over the same row.
 */
export function harvestTable(sourceId: string, t: Table, minDistinct = MIN_DISTINCT_ANSWERS): Item[] {
  const items: Item[] = [];
  const n = t.headers.length;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const answers = t.rows.map((r) => r[b]).filter(Boolean);
      if (answers.length !== t.rows.length) continue;
      // Reject a prose column — exact-matching a sentence is a coin flip on wording.
      if (answers.some((x) => tokens(x) > MAX_ANSWER_TOKENS)) continue;
      const distinct = new Set(answers.map((x) => normalizeAnswer(x)));
      // V0b, applied where it belongs: a column of "yes/no/maybe" teaches its own vocabulary
      // rather than the material. Note this is about the COLUMN, not about the learner seeing
      // options — these are free-text items and nothing is on screen to pick from.
      if (distinct.size < minDistinct) continue;
      if (distinct.size < answers.length) continue; // ambiguous key: two rows, same answer
      // The CUE column must be unique too. Two rows sharing a cue produce the same stem with
      // different answers — an unanswerable item, which dedup would silently collapse to whichever
      // row happened to come first. Caught by the narrow-column test.
      const cues = t.rows.map((r) => r[a]).filter(Boolean);
      if (new Set(cues.map((x) => normalizeAnswer(x))).size < cues.length) continue;

      for (const row of t.rows) {
        const cue = row[a], ans = row[b];
        if (!cue || !ans) continue;
        const ctx = t.caption ? `${t.caption} — ` : "";
        const stem = `${ctx}${t.headers[a]}: ${cue}. ${t.headers[b]}?`;
        items.push({
          id: itemKey(sourceId, "exact_set", stem),
          sourceId,
          stem,
          kind: numericValueOf(ans) !== null ? "numeric" : "exact_set",
          expected: expectedFor(ans),
          span: row.join(" | "),
          generator: "table",
          closedBook: true,
        });
      }
    }
  }
  return items;
}

/**
 * Definition lists give one clean direction only.
 *
 * FORWARD (definition -> term) is a real closed-book recall item. REVERSE ("define X") would need a
 * keyset checker with a ban list to be gradable at all, and the design makes that practice-only by
 * default, so it is not generated here.
 */
export function harvestDefList(
  sourceId: string,
  entries: Array<{ term: string; def: string }>,
  minDistinct = MIN_DISTINCT_ANSWERS,
): Item[] {
  if (entries.length < MIN_DEFLIST_ENTRIES) return [];
  const usable = entries.filter((e) => tokens(e.term) <= MAX_ANSWER_TOKENS);
  const distinct = new Set(usable.map((e) => normalizeAnswer(e.term)));
  if (distinct.size < minDistinct || distinct.size < usable.length) return [];
  return usable.map((e) => {
    const stem = `${e.def} — what is this?`;
    return {
      id: itemKey(sourceId, "exact_set", stem),
      sourceId,
      stem,
      kind: "exact_set" as const,
      expected: { kind: "exact_set", any: [e.term] } as Expected,
      span: `${e.term} — ${e.def}`,
      generator: "deflist" as const,
      closedBook: closedBook("exact_set"),
    };
  });
}

/** Everything a single card yields, before the gates run. */
export function harvestCard(sourceId: string, md: string, minDistinct = MIN_DISTINCT_ANSWERS): Item[] {
  const items: Item[] = [];
  for (const t of parseTables(md)) items.push(...harvestTable(sourceId, t, minDistinct));
  items.push(...harvestDefList(sourceId, parseDefList(md), minDistinct));
  // Two column pairs can describe the same row from the same angle; identity is the stem.
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
