// A written answer that answers nothing ("xyz", "?!", "asdfgh"), told apart by code before any model reads
// it. TerraTutor click test 2026-11-19 (gemma4:e2b): in one fractions quiz 4 of 5 typed "xyz" answers were marked
// right, and a re-grade of the same rows marked them wrong 3 of 3 times, so the model's verdict on a
// non-answer is a coin toss. Code settles these; anything it is unsure of still goes to the model.
//
// What counts as a non-answer (each narrow on purpose; a real attempt, even a wrong one, is never one):
//   1. empty, or only spaces;
//   2. no letter or digit at all ("?", "...", "!!", an emoji), unless the key has none either (">");
//   3. one to four tokens of lower-case letters, each a keyboard mash:
//      - shaped like one: an alphabet run ("xyz", "abcd"), the same letter three times in a row
//        ("jjjj"), or every letter on one keyboard row with either no a, e, i, o or u ("qwrtp", "jkl")
//        or three keys side by side along it ("asdf", "sdf", "lkjh", "zxcv"). Having no vowel, or a run
//        of consonants, is never enough on its own: a K-2 spelling of a right answer ("shrk", "trtl",
//        "strwbrry"), an abbreviation ("fdr", "hcl"), a name ("pittsburgh", "tchaikovsky"), a German word
//        ("tschuss", "deutsch") or a sounded-out misspelling ("nepchune", "omnivour", "eigths") goes to
//        the model, right or wrong;
//      - three letters or more ("x", "cm", "km" are answers);
//      - not in the bundled dictionary (dictionary.ts, inflections included) nor the English word list
//        (wordlist.ts), and not two such words run together ("hmm", "brr", "qwerty" are listed);
//      - not within about half its letters of a word of the key or the question, nor part of one, nor of
//        the key's letters run together ("xyz" for "x, y and z", "rythm" for rhythm), nor the key's
//        initials ("jfk" for John F. Kennedy, "nyc", "mph");
//      - not a Roman numeral ("xiv").
// Never a non-answer: anything with a digit (numbers, fractions, "H2O", "5cm"), a capital letter (names,
// "DNA", "NaCl"; "Xyz" is left to the model too), or a word either list knows. A dictionary that cannot be
// read counts every word as real, so then only rules 1 and 2 apply.

import { lookupWord } from "./dictionary";
import { inWordList } from "./wordlist";
import { editDistance } from "./answer-match";

const MAX_MASH_TOKENS = 4;
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const bothWays = (r: string) => [r, [...r].reverse().join("")];

/** Shaped like a keyboard mash (the first sub-list of rule 3 in the file comment). */
function mashShaped(w: string): boolean {
  if (/(.)\1\1/.test(w) || bothWays(ALPHABET).some((a) => a.includes(w))) return true;
  const row = KEYBOARD_ROWS.find((r) => [...w].every((c) => r.includes(c)));
  if (!row) return false;
  if (!/[aeiou]/.test(w)) return true;
  for (let i = 0; i + 3 <= w.length; i++) {
    const run = w.slice(i, i + 3);
    if (bothWays(row).some((r) => r.includes(run))) return true;
  }
  return false;
}

/** True when a lower-case word is a real word: the dictionary or the word list has it. Unreadable = real. */
async function knownWord(w: string): Promise<boolean> {
  try {
    if ((await lookupWord(w)).length > 0) return true;
    return await inWordList(w);
  } catch {
    return true;
  }
}

/** Two real words run together, each at least three letters ("plantfood", "sunlight"). */
async function twoWords(w: string): Promise<boolean> {
  for (let i = 3; i <= w.length - 3; i++) {
    if ((await knownWord(w.slice(0, i))) && (await knownWord(w.slice(i)))) return true;
  }
  return false;
}

const lettersOf = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** The token is close to, or part of, a word of the key or the question, the key's letters run together, or its initials. */
function nearAnyWord(token: string, key: string, question: string): boolean {
  const keyWords = lettersOf(key);
  // The key's initials ("John F. Kennedy" → "jfk", "miles per hour" → "mph").
  if (keyWords.length >= 2 && keyWords.map((w) => w[0]).join("") === token) return true;
  // The key's letters run together, and its single letters ("x, y and z" → "xyz").
  for (const compact of [keyWords.join(""), keyWords.filter((w) => w.length === 1).join("")]) {
    if (compact.length >= 2 && (compact.includes(token) || (token.includes(compact) && compact.length >= 3))) return true;
  }
  const words = [...lettersOf(key), ...lettersOf(question)].filter((w) => w.length >= 2);
  return words.some((w) => {
    if (w === token) return true;
    if (w.length >= 3 && token.length >= 3 && (w.includes(token) || token.includes(w))) return true;
    return editDistance(token, w) <= Math.max(1, Math.floor(Math.max(token.length, w.length) / 2));
  });
}

const ROMAN = /^[ivxlcdm]+$/;

/**
 * True when code is sure `student` answers nothing (see the file comment for the list). `key` is the answer
 * key, `question` the question asked; both only keep a token that looks like one of their words.
 */
export async function isNonAnswer(student: string, key: string, question = ""): Promise<boolean> {
  const t = student.trim();
  if (!t) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return /[\p{L}\p{N}]/u.test(key);
  const tokens = t.split(/\s+/);
  if (tokens.length > MAX_MASH_TOKENS) return false;
  if (!tokens.every((w) => /^[a-z]{3,}$/.test(w) && !ROMAN.test(w) && mashShaped(w))) return false;
  if (tokens.some((w) => nearAnyWord(w, key, question))) return false;
  for (const w of tokens) {
    if ((await knownWord(w)) || (await twoWords(w))) return false;
  }
  return true;
}
