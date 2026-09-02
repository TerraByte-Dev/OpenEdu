// Lexical matching for the curated Library — pure, Tauri-free, unit-tested.
//
// Extracted from library.ts so it can run under vitest: library.ts imports
// @tauri-apps/plugin-http, which a test can't load. library.ts re-exports everything here, so no
// call site changed.
//
// ── The scoring model, and why each term exists ─────────────────────────────────────────────────
//
//   score = phraseBonus + (tokenOverlap x coverage) + bodyScore
//
// PHRASE BONUS (12 exact / 6 containment) is unchanged and is deliberately NOT scaled by anything.
// A query that equals or contains a curated title or alias is near-certain evidence, and that is
// what makes "periodic table" and "table of elements" both land cleanly.
//
// TOKEN OVERLAP is the weighted field sum (title 3 / aliases 3 / tags 2 / summary 1), with two
// corrections applied to each field's contribution:
//
//   rarity      A term in 40 of 154 cards is not evidence. Common tokens are damped toward 0.25x;
//               anything at or below `IDF_PIVOT_DF` documents keeps its full weight. The multiplier
//               is capped at 1.0, so this can only ever LOWER a score — which means
//               MIN_LIBRARY_SCORE keeps the meaning it was calibrated with, and the floor gets
//               stricter rather than looser.
//   length      Dividing by sqrt(fieldTokens/4) stops an 8-alias card structurally outranking a
//               2-alias one. This is the defect that gets WORSE as content is added, which is why
//               it has to land before bulk authoring, not after.
//
// COVERAGE is the fix that rarity alone cannot make, and it is the important one.
//
//   `tokenize("IR spectroscopy")` gives [ir, spectroscopy]. The romance-verb cards carry "-ir" in
//   title, aliases AND tags, so they scored 3+3+2 = 8 — above the grounding floor — on a query
//   about chemistry. Rarity does not help: "ir" appears in only two cards, so document frequency
//   rates it rare and VALUABLE. The actual defect is that the card answered one of two query terms
//   and ignored the one carrying the meaning.
//
//   So the token score is scaled by the share of the query's INFORMATION the card actually matched,
//   measured in IDF mass rather than token count. A term absent from the corpus entirely (df = 0,
//   e.g. "spectroscopy") carries the most mass of all, because failing to match it is the strongest
//   possible signal that this card is not about the question.
//
// BODY SCORE is capped strictly below the grounding floor (`BODY_BUDGET` < MIN_LIBRARY_SCORE) and
// gated on real evidence. Body terms can therefore LIFT a card across the floor in combination with
// metadata — which is the coverage fix — but can never ADMIT one on their own.

import type { LibraryEntry } from "../types";

export const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "what", "whats", "show", "me", "my",
  "tell", "about", "give", "list", "and", "or", "how", "do", "i", "you", "can", "with", "this", "that",
]);

/** Terms in this many documents or fewer keep their full weight. Above it, damped toward RARITY_MIN. */
const IDF_PIVOT_DF = 3;
/** Floor for the rarity multiplier — a term in most of the corpus still counts for something. */
const RARITY_MIN = 0.25;
/** Max total contribution from body terms. Strictly below MIN_LIBRARY_SCORE (6) on purpose. */
export const BODY_BUDGET = 5;
/** Field token count that scores un-normalised; longer fields are damped, shorter are not boosted. */
const LEN_NORM_BASE = 4;

// Apostrophes are elided rather than split on. The corpus writes "boyle's law" and "kirchhoff's
// laws" but also "ohms law" and "newtons laws" — so splitting produced [boyle, law] for one and
// [ohms, law] for the other, and a student typing "boyles law" could reach the second and never the
// first. Eliding normalises both sides to the same shape.
const APOSTROPHES = /['‘’ʼ]/g;

// Light plural folding so "lanthanide" reaches a body that says "lanthanides". Applied on both
// sides — query and index — so they always agree. Deliberately naive: no stemmer and no dependency,
// just strip a trailing "s" on tokens longer than 3 that don't end in "ss" (so "class" and "gas"
// survive). The builder in openedu-library/scripts/build-index.mjs carries the identical rule.
function fold(t: string): string {
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(fold);
}

export function normalizePhrase(s: string): string {
  return s.toLowerCase().replace(APOSTROPHES, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ── Document frequency ──────────────────────────────────────────────────────────────────────────

export interface DfIndex {
  /** term -> number of entries containing it, across every scored surface. */
  df: Map<string, number>;
  /** Corpus size. */
  n: number;
}

// body_terms ships as a compact "term:weight term:weight" string — an array of pairs quadrupled
// index.json under JSON.stringify's indenting and made every regenerated diff unreadable. Parsed
// once per entry and memoised, since ranking touches every entry on every query.
const bodyCache = new WeakMap<object, Array<[string, number]>>();

export function parseBodyTerms(entry: LibraryEntry): Array<[string, number]> {
  if (!entry.body_terms) return [];
  let out = bodyCache.get(entry);
  if (!out) {
    out = [];
    for (const part of entry.body_terms.split(" ")) {
      const i = part.lastIndexOf(":");
      if (i <= 0) continue;
      const w = Number(part.slice(i + 1));
      if (Number.isFinite(w)) out.push([part.slice(0, i), w]);
    }
    bodyCache.set(entry, out);
  }
  return out;
}

/** Every token an entry contributes to document frequency — the same surfaces scoring reads. */
function entryTerms(e: LibraryEntry): Set<string> {
  const t = new Set<string>();
  for (const s of [e.title, e.aliases.join(" "), e.tags.join(" "), e.summary]) {
    for (const tok of tokenize(s)) t.add(tok);
  }
  for (const [term] of parseBodyTerms(e)) t.add(term);
  return t;
}

export function buildDfIndex(manifest: LibraryEntry[]): DfIndex {
  const df = new Map<string, number>();
  for (const e of manifest) {
    for (const term of entryTerms(e)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return { df, n: manifest.length };
}

const rawIdf = (df: number, n: number) => Math.log((n + 1) / (df + 1));

/**
 * How much a matched term is worth, relative to a term that appears in `IDF_PIVOT_DF` documents.
 * Capped at 1.0 so this only ever damps — see the header note on preserving MIN_LIBRARY_SCORE.
 */
export function rarity(term: string, idx: DfIndex | null): number {
  if (!idx) return 1;
  const df = idx.df.get(term) ?? 0;
  const pivot = rawIdf(IDF_PIVOT_DF, idx.n);
  if (pivot <= 0) return 1;
  return Math.max(RARITY_MIN, Math.min(1, rawIdf(df, idx.n) / pivot));
}

/**
 * Share of the query's information this set of matched terms accounts for, in IDF mass.
 *
 * A query term absent from the corpus (df 0) carries the MOST mass, because failing to match it is
 * the strongest evidence a card is off-topic. Returns 1 with no index, so behaviour degrades to the
 * old scoring rather than to zero.
 */
export function queryCoverage(qTokens: string[], matched: Set<string>, idx: DfIndex | null): number {
  if (!idx || qTokens.length === 0) return 1;
  let total = 0, hit = 0;
  for (const t of new Set(qTokens)) {
    const mass = rawIdf(idx.df.get(t) ?? 0, idx.n);
    total += mass;
    if (matched.has(t)) hit += mass;
  }
  return total > 0 ? hit / total : 1;
}

// ── Scoring ─────────────────────────────────────────────────────────────────────────────────────

export function scoreEntry(
  qTokens: string[],
  qPhrase: string,
  entry: LibraryEntry,
  idx: DfIndex | null = null,
): number {
  let phrase = 0;
  // A curated title/alias the query contains (or vice-versa) is near-certain — never damped.
  for (const name of [entry.title, ...entry.aliases]) {
    const n = normalizePhrase(name);
    if (!n) continue;
    if (qPhrase === n) phrase += 12;
    else if (qPhrase.includes(n) || n.includes(qPhrase)) phrase += 6;
  }

  const fields: Array<[string, number]> = [
    [entry.title, 3],
    [entry.aliases.join(" "), 3],
    [entry.tags.join(" "), 2],
    [entry.summary, 1],
  ];

  const matched = new Set<string>();
  let tokens = 0;
  for (const [text, weight] of fields) {
    const fieldTokens = tokenize(text);
    if (fieldTokens.length === 0) continue;
    const set = new Set(fieldTokens);
    // Longer fields are damped; a short field is never boosted above its face weight.
    const lenNorm = Math.min(2, Math.max(1, Math.sqrt(set.size / LEN_NORM_BASE)));
    for (const qt of qTokens) {
      if (!set.has(qt)) continue;
      matched.add(qt);
      tokens += (weight * rarity(qt, idx)) / lenNorm;
    }
  }

  // Body terms: pre-scored 3|2|1 at build time by IDF over the corpus. Gated so two incidental
  // weight-1 hits can't add up to admission on their own.
  let body = 0;
  const bodyTerms = parseBodyTerms(entry);
  if (bodyTerms.length) {
    const q = new Set(qTokens);
    let hits = 0, best = 0;
    for (const [term, w] of bodyTerms) {
      if (!q.has(term)) continue;
      matched.add(term);
      hits++;
      best = Math.max(best, w);
      body += w * rarity(term, idx);
    }
    // Require one genuinely discriminative term (weight >= 2), not two incidental ones. An earlier
    // gate of "2 hits OR one weight-3" was wrong twice over: these cards average 176 words, so a
    // specific term like "lanthanide" appears exactly once and can never reach weight 3; and the
    // gate was redundant for admission anyway, since BODY_BUDGET (5) sits below the grounding floor
    // (6), so body evidence can lift a card across it but never admit one by itself.
    body = best >= 2 ? Math.min(BODY_BUDGET, body) : 0;
  }

  return phrase + (tokens + body) * queryCoverage(qTokens, matched, idx);
}

// ── Public entry points ─────────────────────────────────────────────────────────────────────────

// Built once per manifest identity. The manifest is a module-level singleton in library.ts that is
// replaced wholesale on refresh, so keying on the array itself invalidates for free.
const dfCache = new WeakMap<object, DfIndex>();

function dfFor(manifest: LibraryEntry[]): DfIndex {
  let idx = dfCache.get(manifest);
  if (!idx) {
    idx = buildDfIndex(manifest);
    dfCache.set(manifest, idx);
  }
  return idx;
}

/** Score every entry; return the top-N above zero, best first. Pure — no I/O. */
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
  const idx = dfFor(manifest);
  return manifest
    .map((e) => ({ entry: e, score: scoreEntry(qTokens, qPhrase, e, idx) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
