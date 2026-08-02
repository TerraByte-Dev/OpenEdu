// Subsequence fuzzy matching for the note quick-switcher — pure, Tauri-free, unit-tested (fuzzy.test.ts).
//
// "Fuzzy" here means SUBSEQUENCE, not edit distance: every character of the query must appear in the
// candidate, in order, but not necessarily adjacently. "cvc" matches "Calvin cycle". That is what makes
// a switcher feel fast — you type the shape of a title rather than a prefix of it.
//
// Edit distance is deliberately not used. It would match titles the query has no characters in common
// with, which reads as the switcher guessing rather than filtering.

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Indices into the candidate string that the query matched, for highlighting. */
  positions: number[];
}

// Scoring. Tuned so that, for a given query, the ordering people expect falls out: exact prefix beats
// word-start beats scattered, and short titles beat long ones when otherwise equal.
const S = {
  /** Consecutive run — the dominant signal. "calv" in "Calvin" should crush "c…a…l…v" scattered. */
  adjacent: 8,
  /** Match at the start of a word (after a space, -, _, /, or a lower->upper hump). */
  wordStart: 10,
  /** Match at index 0. */
  head: 15,
  /** Per unmatched leading character — a hit deep in the string is worth less. */
  leadingPenalty: -0.5,
  /** Applied once, scaled by length, so equal-quality matches prefer the shorter title. */
  lengthPenalty: -0.08,
};

const isBoundary = (s: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = s[i - 1];
  if (/[\s\-_/.,:()[\]]/.test(prev)) return true;
  // camelCase / TitleCase hump
  return prev === prev.toLowerCase() && s[i] !== s[i].toLowerCase() && prev !== s[i];
};

/**
 * Greedy left-to-right subsequence scan. Returns null when the query isn't a subsequence at all.
 *
 * Greedy rather than optimal (which would need DP over query x candidate): for note titles the
 * difference is not observable, and the switcher runs on every keystroke over the whole vault.
 */
export function fuzzyScore(query: string, candidate: string): { score: number; positions: number[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, positions: [] };

  const c = candidate.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let ci = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const found = c.indexOf(q[qi], ci);
    if (found === -1) return null;

    if (found === 0) score += S.head;
    else if (isBoundary(candidate, found)) score += S.wordStart;
    if (positions.length && found === positions[positions.length - 1] + 1) score += S.adjacent;
    if (qi === 0) score += found * S.leadingPenalty;

    positions.push(found);
    ci = found + 1;
  }

  score += candidate.length * S.lengthPenalty;
  return { score, positions };
}

/**
 * Rank `items` against `query`, dropping non-matches. An empty query returns everything in its original
 * order, which is what the switcher wants on open — most-recent-first, not alphabetised at random.
 *
 * Ties break on the label so the list never reorders unpredictably between keystrokes.
 */
export function fuzzyFilter<T>(query: string, items: readonly T[], label: (item: T) => string): FuzzyMatch<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, positions: [] }));

  const out: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const hit = fuzzyScore(query, label(item));
    if (hit) out.push({ item, score: hit.score, positions: hit.positions });
  }
  return out.sort((a, b) => b.score - a.score || label(a.item).localeCompare(label(b.item)));
}

/** Split `text` into matched / unmatched runs for highlighting, given sorted match indices. */
export function highlightRuns(text: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  if (!positions.length) return [{ text, hit: false }];
  const set = new Set(positions);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
