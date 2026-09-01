// Lexical matching for the curated Library — pure, Tauri-free, unit-tested.
//
// Extracted from library.ts so it can run under vitest: library.ts imports
// @tauri-apps/plugin-http, which a test can't load. The block was already marked "pure,
// unit-testable"; it just lived in a module that made testing it impossible. library.ts
// re-exports everything here, so no call site changed.
//
// Scoring today is metadata-only — title x3, aliases x3, tags x2, summary x1, plus a phrase
// bonus. The card BODY is not scored, and no term is weighted by how common it is. Both are
// known defects with measured consequences; see library-fixture.ts for the failing cases.

import type { LibraryEntry } from "../types";

// ── lexical matching (pure, unit-testable) ──
export const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "what", "whats", "show", "me", "my",
  "tell", "about", "give", "list", "and", "or", "how", "do", "i", "you", "can", "with", "this", "that",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function normalizePhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function scoreEntry(qTokens: string[], qPhrase: string, entry: LibraryEntry): number {
  let score = 0;
  // Phrase bonus: a curated title/alias that the query contains (or vice-versa) is a near-certain
  // hit — this is what makes "periodic table" / "table of elements" land cleanly.
  for (const name of [entry.title, ...entry.aliases]) {
    const n = normalizePhrase(name);
    if (!n) continue;
    if (qPhrase === n) score += 12;
    else if (qPhrase.includes(n) || n.includes(qPhrase)) score += 6;
  }
  // Weighted token overlap.
  const fields: Array<[string, number]> = [
    [entry.title, 3],
    [entry.aliases.join(" "), 3],
    [entry.tags.join(" "), 2],
    [entry.summary, 1],
  ];
  for (const [text, weight] of fields) {
    const fieldTokens = new Set(tokenize(text));
    for (const qt of qTokens) if (fieldTokens.has(qt)) score += weight;
  }
  return score;
}

// Score every entry against the query; return the top-N above zero, best first. Pure — no I/O.
export function matchResources(query: string, manifest: LibraryEntry[], topN = 3): LibraryEntry[] {
  return matchResourcesScored(query, manifest, topN).map((x) => x.entry);
}

// Same ranking, but WITH the scores. `matchResources` filters on `score > 0`, which means the best
// match always wins however bad it is — fine for a tool the model chose to call about a topic it had
// in mind, wrong for automatic grounding, where "the least-bad card in the library" gets injected
// into every unrelated question. Callers that retrieve without being asked need to see the number so
// they can set a floor. (#90 — the eval caught "boiling point of ethanol" pulling in
// "Types of Economic Systems".)
export function matchResourcesScored(
  query: string,
  manifest: LibraryEntry[],
  topN = 3,
): Array<{ entry: LibraryEntry; score: number }> {
  const qTokens = tokenize(query);
  const qPhrase = normalizePhrase(query);
  if (qTokens.length === 0 && !qPhrase) return [];
  return manifest
    .map((e) => ({ entry: e, score: scoreEntry(qTokens, qPhrase, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
