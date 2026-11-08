// Lever 3 (docs/BENCHMARKS.md section 3): the named-entity mismatch gate. Pure; no model call.
//
// The failure it targets: a student asks about a real thing ("How high is Ben Nevis?") and retrieval
// hands the model a note about a different, similar thing (the student's own invented ridge). The
// embedder ranks such a note as highly as the right note on a real question, so no score floor can
// tell them apart. A small model then either refuses a fact it knows ("my notes don't cover that") or
// drags the note's value into its answer. Code can see the mismatch directly: the question names
// something the note never mentions, and the note names something the question never mentions.
//
// "Distinctive" is decided by two signals the app already has, never by a list of names:
//   case        a word that starts with a capital letter where a sentence does not start
//   vocabulary  a word the bundled library never uses (buildDfIndex(manifest).vocab, every word the
//               library's cards can match on). "Celsius", "January" and "English" are library words, so
//               a capitalised one is not a name; an invented ridge, or a mountain the library never
//               mentions, is.
//
// The gate only ever DROPS a note, so every rule below errs towards keeping:
//   - it is off unless the question reads as English (most of its lower-case words are library words).
//     German capitalises every noun; Spanish, Swahili and the rest are skipped rather than guessed at;
//   - it is off for Title Case and ALL CAPS questions, where case carries no signal;
//   - one question name found in the note keeps it, typos included (fuzzy match);
//   - a note with no distinctive name of its own is never dropped;
//   - a note whose own name the question mentions, in any case, is kept;
//   - library cards are never dropped (ground.ts only passes notes here).
//
// Lower-case entities ("how tall is mount kilimanjaro?") are deliberately not handled: nothing here
// can tell "glycerol" (another thing) from "lubricant" (a description of the note's thing), and a
// name-free question about the student's own note must never lose that note. Lever 11's job.
//
// The gate reads the student's own words only, never L2's English gloss (gloss.ts). L2 glosses only
// non-Latin-script questions, which have no letter case, so the gate is off on that path anyway; and a
// gloss can spell a native-script name in a Latin form that differs from the note's, which would drop
// exactly the note L2 exists to recover.

import { words } from "../library-rank";
import { contentWords } from "./ground";

/** A word as written: its normalised form (library-rank `words`), whether it starts with a Latin
 *  capital letter, and whether it starts a sentence. */
interface Word {
  w: string;
  cap: boolean;
  initial: boolean;
}

// A run of letters, marks and digits as written; words() then splits and normalises it.
const SEGMENT = /[\p{L}\p{M}\p{Nd}]+/gu;
const LATIN_CAPITAL = /^(?=\p{Script=Latin})\p{Lu}/u;
// What may sit between a sentence break and the next word: spaces, quotes, brackets.
const LEAD = /[\s"'“”‘’«»()[\]]*$/u;
const BREAK = /[.!?¿¡:;…—–]$/u;

function scan(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(SEGMENT)) {
    const before = text.slice(0, m.index).replace(LEAD, "");
    const initial = before === "" || BREAK.test(before);
    const cap = LATIN_CAPITAL.test(m[0]);
    for (const w of words(m[0])) out.push({ w, cap, initial });
  }
  return out;
}

const isContent = (w: string) => contentWords(w).length === 1;

// The library's df terms are plural-folded (library-rank `tokenize`); its title and alias words are not.
const fold = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
const inVocab = (w: string, vocab: ReadonlySet<string>) => vocab.has(w) || vocab.has(fold(w));

/** Edit distance, stopping early once it exceeds `max`. */
function within(a: string, b: string, max: number): boolean {
  const x = [...a], y = [...b];
  if (Math.abs(x.length - y.length) > max) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[y.length] <= max;
}

/** Same word: equal after folding a plural "s", or a typo away (1 edit from 5 letters, 2 from 8). */
export function sameWord(a: string, b: string): boolean {
  if (fold(a) === fold(b)) return true;
  const shorter = Math.min([...a].length, [...b].length);
  return shorter >= 5 && within(a, b, shorter >= 8 ? 2 : 1);
}

const anyMatch = (names: string[], pool: Iterable<string>) => {
  const all = [...pool];
  return names.some((n) => all.some((p) => sameWord(n, p)));
};

export interface EntityGate {
  /** The question's distinctive names, normalised. Never empty. */
  entities: string[];
  /** Whether a note with this title and text stays. */
  keeps(note: { title: string; text: string }): boolean;
}

/**
 * The gate for one question, or null when it is off: no library vocabulary, a question that does not
 * read as English, or no distinctive name in it.
 */
export function entityGate(question: string, vocab: ReadonlySet<string> | null): EntityGate | null {
  if (!vocab || vocab.size === 0) return null;
  const qWords = scan(question);

  // Reads as English: at least one lower-case content word, and at least half of them library words.
  const lower = qWords.filter((x) => !x.cap && isContent(x.w));
  if (lower.length === 0 || lower.filter((x) => inVocab(x.w, vocab)).length * 2 < lower.length) return null;

  // Title Case or ALL CAPS: case carries no signal.
  const later = qWords.filter((x) => !x.initial && /\p{Script=Latin}/u.test(x.w) && [...x.w].length >= 2);
  const capped = later.filter((x) => x.cap).length;
  if (capped >= 3 && capped >= 0.8 * later.length) return null;

  const entities = [...new Set(later.filter((x) => x.cap && isContent(x.w) && !inVocab(x.w, vocab)).map((x) => x.w))];
  if (entities.length === 0) return null;
  const questionWords = qWords.map((x) => x.w);

  return {
    entities,
    keeps(note) {
      const noteWords = scan(`${note.title}\n${note.text}`);
      if (anyMatch(entities, new Set(noteWords.map((x) => x.w)))) return true;
      const own = [...new Set(noteWords.filter((x) => x.cap && isContent(x.w) && !inVocab(x.w, vocab)).map((x) => x.w))];
      if (own.length === 0) return true;
      return anyMatch(own, questionWords);
    },
  };
}
