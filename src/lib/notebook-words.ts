// Which note passages answer a question, by their words, with no model (notebook.ts searchNotesByWords).
// Pure and Tauri-free. Ported from TerraTutor's packs/rank.ts (TerraTutor #209 uses that matcher for the
// notes); OpenEdu has no resource packs, so the matcher lives here with the notes.
//
// Used only when no embedder can run (no embedding model pulled, Ollama not answering, no OpenAI key or
// connection): without it the tutor never read the notes at all. Deterministic, so the same question
// always gets the same passages.
//
// The score is COVERAGE: the share of the question's information (IDF-weighted content words) that a
// passage contains. A word the notes never use carries the most weight of all, so a passage that shares
// one common word with an unrelated question covers little of it and stays out.
//
// Coverage alone cannot judge a question with ONE word left in it: every passage holding that word
// covers all of it. So one shared word is never enough on its own (`loneTermOk`): a passage must match
// two of the question's words, unless that one word names the note (a topic word of its title,
// `topicWords`: not "first", "say" or "form") or is rare in these notes and the question says nothing
// else. Words that ask for help rather than name a topic ("help", "answer", "times") never match at all,
// and numerals never make up the two words ("10 times 15").

import { words, wordLength } from "./library-rank";
import { contentWords } from "./kernel/contentWords";

/** One passage of one note, cut the way indexNote cuts it (notebook.ts chunkText). */
export interface NotePassage {
  title: string;
  text: string;
}

export interface NoteWordIndex {
  passages: NotePassage[];
  /** Per passage: its stemmed words (title included), and the same as a set. */
  tokens: string[][];
  sets: Array<Set<string>>;
  /** Stem → how many passages contain it. */
  df: Map<string, number>;
  /** Per passage: the words that say what it is about (topicWords of its note's title). */
  topics: Array<Set<string>>;
}

/** A passage must cover at least this share of the question to be offered to the tutor. */
export const MIN_WORD_COVERAGE = 0.4;

/**
 * A word the question carries alone matches when it is in at most this share of the passages (and at
 * least in 1): "graupel", not "time". In a notebook of fewer than about seven passages that is any word
 * only one passage has.
 */
export const LONE_TERM_MAX_SHARE = 0.15;

/**
 * Words that ask for help or about the work rather than name what it is about: "can you HELP me", "what
 * is the right ANSWER", "5 TIMES 3", "what should I SAY". Left out of the question, so they never match a
 * passage, but they still count as something the question said (a "help me with fractions" is not a
 * one-word question). Compared after stem().
 */
const CHAT_WORDS = new Set([
  "help", "answer", "question", "problem", "time", "know", "understand", "learn", "thing", "stuff", "work",
  "need", "want", "like", "think", "wrong", "again", "idea", "lot", "really", "just", "also", "say", "said",
]);

/**
 * Words that shape a question without saying what it is about ("what CAUSES thunder", "WHY is the sky
 * blue"). ground.ts's stopwords keep them, because there they only decide whether to search at all. Here a
 * word the notes never use counts most, so leaving these in would sink every passage on a question
 * phrased with them. Compared after stem().
 */
const QUESTION_WORDS = new Set([
  "why", "when", "where", "which", "who", "whom", "whose", "cause", "caused", "happen", "happened", "mean", "meant",
  "explain", "describe", "define", "called", "kind", "type", "example", "much", "many", "far", "would", "should", "will",
]);

/** A numeral: never one of the two words a passage must match ("what is 10 times 15"). */
const NUMERAL = /^\p{Nd}+$/u;

/** Plural folding, applied the same way to the question and the passages: "storms" → "storm". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

function terms(s: string): string[] {
  return words(s).filter((t) => wordLength(t) >= 2).map(stem);
}

/**
 * Words too short or too common in titles to say what something is about: "First grade math" and "the
 * first ten amendments" share nothing. Compared after stem().
 */
const MIN_TOPIC_WORD = 4;
const NOT_A_TOPIC = new Set([
  "first", "second", "third", "grade", "level", "basic", "intro", "introduction", "beginning", "beginner",
  "course", "lesson", "unit", "class", "study", "learning", "language", "other", "their", "there", "they",
  "them", "these", "those", "from", "into", "your", "more", "some", "each", "every", "make", "made", "come",
  "came", "form", "part", "using", "through", "will", "would", "should", "which", "when", "where", "while",
  "create", "created",
]);

/** The stemmed words of `text` that can say what something is about. */
export function topicWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of contentWords(text)) {
    const t = stem(w);
    if (t.length >= MIN_TOPIC_WORD && !NOT_A_TOPIC.has(t)) out.add(t);
  }
  return out;
}

export function buildNoteWordIndex(passages: NotePassage[]): NoteWordIndex {
  const tokens = passages.map((p) => terms(`${p.title} ${p.text}`));
  const sets = tokens.map((t) => new Set(t));
  const df = new Map<string, number>();
  for (const set of sets) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const topics = passages.map((p) => topicWords(p.title));
  return { passages, tokens, sets, df, topics };
}

/**
 * The passages that cover enough of the question, best first, at most `limit`, as indexes into
 * `index.passages`.
 *
 * `questionWords` are the question's content words (contentWords: stopwords and acknowledgements
 * already gone). Ties on coverage go to the passage where the question's words are densest, then to the
 * earlier passage, so the order never depends on anything but the text.
 */
export function rankNotePassages(
  questionWords: string[], index: NoteWordIndex, limit = 6,
): Array<{ i: number; coverage: number }> {
  const asked = [...new Set(questionWords.map(stem))].filter((t) => !QUESTION_WORDS.has(t));
  const q = asked.filter((t) => !CHAT_WORDS.has(t));
  const n = index.passages.length;
  if (q.length === 0 || n === 0) return [];
  const idf = (t: string) => Math.log(1 + n / (1 + (index.df.get(t) ?? 0)));
  const total = q.reduce((s, t) => s + idf(t), 0);
  // One matched word is enough only when it names the note, or when it is rare in the notes and is all
  // the question asked (not "help me with fractions", whose "fractions" one note uses once). A word that
  // never names a topic ("first", "second", "form") is never enough alone, however rare.
  const rare = (t: string) => (index.df.get(t) ?? 0) <= Math.max(1, LONE_TERM_MAX_SHARE * n);
  const loneTermOk = (t: string, i: number) => index.topics[i].has(t) || (asked.length === 1 && !NOT_A_TOPIC.has(t) && rare(t));

  const scored: Array<{ i: number; coverage: number; density: number }> = [];
  for (let i = 0; i < n; i++) {
    const matched = q.filter((t) => index.sets[i].has(t));
    if (matched.length === 0) continue;
    // Numerals never make up the two words: "10 times 15" is arithmetic, whichever note has both numbers.
    // A numeral asked alone ("what happened in 1791") is judged like any lone word.
    const named = matched.filter((t) => !NUMERAL.test(t));
    if (named.length < 2) {
      const lone = named.length === 1 ? named[0] : matched.length === 1 ? matched[0] : null;
      if (lone === null || !loneTermOk(lone, i)) continue;
    }
    const coverage = matched.reduce((s, t) => s + idf(t), 0) / total;
    if (coverage < MIN_WORD_COVERAGE) continue;
    const toks = index.tokens[i];
    const hits = toks.filter((t) => matched.includes(t)).length;
    scored.push({ i, coverage, density: hits / Math.sqrt(toks.length || 1) });
  }
  scored.sort((a, b) => b.coverage - a.coverage || b.density - a.density || a.i - b.i);
  return scored.slice(0, limit).map(({ i, coverage }) => ({ i, coverage }));
}
