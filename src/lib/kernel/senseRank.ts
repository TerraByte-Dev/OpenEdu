// Lever 19 (issue #256; docs/BENCHMARKS.md row 19): rank one headword's dictionary senses by the
// student's sentence, a simplified Lesk. Pure, synchronous and stable: no data, no fetch, no model.
// defineWord.ts selectSenses reads it before lever 18's caps and the child-safety filter, so ranking
// only reorders what the filter is then applied to.
//
// A text's content stems: lower case, split on anything that is not a letter, tokens under 3 letters
// and STOPWORDS dropped, each token stemmed (stem() below; irregular forms are not matched, so "flew" is
// not "fly"). The stems of the typed word and of the headword are dropped from both sides, because a
// sense's example usually repeats the headword. A sense's score is the number of distinct sentence
// stems found among the stems of its definition plus its example. Senses are sorted by score, highest
// first, ties in stored order; with no sense above 0 the order is the stored order.
//
// The stopword list is written from general knowledge, in two stated classes, with no word taken from
// an eval item: English function words (with the pieces contractions split into), and the frame words
// WordNet glosses are built from ("usually", "especially", "something", "a person who", "the act of").

/** English function words, and the pieces a split on non-letters leaves of contractions ("don't" ->
 *  "don"). Tokens under 3 letters never count, so they are not listed. */
const FUNCTION_WORDS =
  "the and but for nor yet not are was were been being has have had having does did doing done can could " +
  "may might must shall should will would ought its his her hers him she they them their theirs our ours " +
  "you your yours who whom whose which what when where why how that this these those there here then than " +
  "too very also just only even still such each every either neither both all any some few many much more " +
  "most less least other others another same own into onto unto upon from with within without about " +
  "above below over under after before between among amongst against along around across through throughout " +
  "during until till toward towards beside besides beyond behind near off out down via per since while " +
  "though although because unless whether whereas once again ever never always yes " +
  "don doesn didn isn aren wasn weren won wouldn couldn shouldn hasn haven hadn mustn needn shan ain let";
/** Words WordNet glosses are framed with, which say how a definition is worded, not what it is about. */
const GLOSS_FRAME_WORDS =
  "usually especially typically generally often sometimes something someone somebody anything anyone " +
  "anybody everything everyone nothing one ones person persons thing things act acts state quality kind " +
  "kinds sort sorts type types manner way ways certain particular various esp etc used use uses using " +
  "make makes made making become becomes becoming";

export const STOPWORDS: ReadonlySet<string> = new Set(`${FUNCTION_WORDS} ${GLOSS_FRAME_WORDS}`.split(/\s+/).filter(Boolean));

const CONSONANT = /[bcdfghjklmnpqrstvwxyz]/;

/** The fixed stemmer, in order: "ies" -> "y"; "es" after s/x/z/ch/sh removed; a final "s" removed unless
 *  the word ends "ss", "us" or "is"; then "ing" or "ed" removed when 3 or more letters remain; then a
 *  doubled final consonant made single; then a final "e" removed. */
export function stem(token: string): string {
  let w = token;
  if (w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (/(?:s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length - 3 >= 3) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length - 2 >= 3) w = w.slice(0, -2);
  const n = w.length;
  if (n >= 2 && w[n - 1] === w[n - 2] && CONSONANT.test(w[n - 1])) w = w.slice(0, -1);
  if (w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** The content stems of a text, less `exclude` (stems). */
export function contentStems(text: string, exclude: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z]+/)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    const s = stem(t);
    if (s && !exclude.has(s)) out.add(s);
  }
  return out;
}

/** The stems to drop from both sides: every stem of the typed word and of the headword. */
export function excludedStems(...words: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const w of words) for (const t of w.toLowerCase().split(/[^a-z]+/)) if (t) out.add(stem(t));
  return out;
}

/** How many of the sentence's stems a sense's definition plus example contains. */
export function senseOverlap(sentence: ReadonlySet<string>, sense: { definition: string; example: string }, exclude: ReadonlySet<string>): number {
  if (sentence.size === 0) return 0;
  const own = contentStems(`${sense.definition} ${sense.example}`, exclude);
  let n = 0;
  for (const s of sentence) if (own.has(s)) n++;
  return n;
}

/** Each sense's score against the sentence, in stored order. */
export function senseScores(senses: ReadonlyArray<{ definition: string; example: string }>, sentence: string, exclude: ReadonlySet<string>): number[] {
  const stems = contentStems(sentence, exclude);
  return senses.map((s) => senseOverlap(stems, s, exclude));
}

/**
 * One headword's senses sorted by their score against `sentence`, highest first, ties in stored order.
 * `exclude` is excludedStems(typed word, headword). With no sense above 0 it returns the stored order
 * (the same array contents in the same order).
 */
export function rankSenses<T extends { definition: string; example: string }>(senses: readonly T[], sentence: string, exclude: ReadonlySet<string>): T[] {
  const scores = senseScores(senses, sentence, exclude);
  if (!scores.some((s) => s > 0)) return [...senses];
  return senses.map((s, i) => ({ s, i, score: scores[i] })).sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
}
