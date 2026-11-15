// Settling a written answer in code, before any model sees it. Pure: no Tauri, no DOM, no model.
//
// A small grader model fails right answers written in other words: "washington" for George Washington,
// "h two o" for H2O, "a hundred degrees" for 100 degrees Celsius, "tadpoles" for a tadpole (OpenEdu
// #316/#317, 1 to 5 of 30 right answers per run on gemma4:e2b). Each of those is the key in another
// form, and code can see that for certain. So before the batch goes to the model, both sides are put in
// one form (case, punctuation, a leading article, number words as digits, a spelled formula, plurals),
// and an answer is accepted when it is the key, or one of the key's accepted forms:
//
//   - the key's parts: "Carbon dioxide (CO2)" also accepts "carbon dioxide" and "co2" (one word in
//     brackets, so "(the planet)" is not an answer); "a / b" (spaced) either;
//   - a number with units: the same number, bare or with the key's own units ("100", "a hundred
//     degrees" for "100 degrees Celsius"). Degrees and the scale may be left out; any other unit the
//     answer gives must be all of the key's ("12 cm" is not "12 square centimeters"), never a unit the
//     key does not have;
//   - a person's surname: the key is a person's name (the question asks "who", the key is 2-4
//     capitalised words) and the answer is that name's last word;
//   - a one-edit misspelling of a key word of 6 letters or more, when the answer's word is not itself a
//     word ("herbivor"). "neuron" for "neutron" or "photon" for "proton" is a real word, so it is a
//     different answer, and the model decides it. The caller supplies the word list (the dictionary).
//
// It never accepts on a shared word: "red" is not "red blood cells". It never returns false either. An
// answer code cannot settle goes to the model as before.

import { gradeFreeTextDeterministic } from "./quiz-grading";

// ─── One form for both sides ──────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { thousand: 1000, million: 1_000_000 };

const isNumberWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w === "hundred" || w in SCALES;

/**
 * Number words as digits: "a hundred" → 100, "fifty six" → 56, "one hundred and five" → 105, "two
 * thousand" → 2000. Takes the words already split; a run that does not read as one number ("nineteen
 * eighty") is cut where it stops making sense, so each part stays its own number.
 */
function numberWordsToDigits(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const startsRun = isNumberWord(w) || ((w === "a" || w === "an") && (words[i + 1] === "hundred" || words[i + 1] in SCALES));
    if (!startsRun) { out.push(w); i++; continue; }
    let total = 0;
    let current = 0;
    // What may come next inside the run: after a unit or teen only a scale; after a tens word a unit.
    let expect: "any" | "unit" | "scale" | "after-hundred" = "any";
    let j = i;
    if (w === "a" || w === "an") { current = 1; expect = "scale"; j++; }
    for (; j < words.length; j++) {
      const t = words[j];
      if (t === "and" && expect === "after-hundred" && j + 1 < words.length && (words[j + 1] in UNITS || words[j + 1] in TEENS || words[j + 1] in TENS)) continue;
      if (t in UNITS && (expect === "any" || expect === "unit" || expect === "after-hundred")) { current += UNITS[t]; expect = "scale"; continue; }
      if (t in TEENS && (expect === "any" || expect === "after-hundred")) { current += TEENS[t]; expect = "scale"; continue; }
      if (t in TENS && (expect === "any" || expect === "after-hundred")) { current += TENS[t]; expect = "unit"; continue; }
      if (t === "hundred" && current > 0 && current < 10 && expect !== "after-hundred") { current *= 100; expect = "after-hundred"; continue; }
      if (t === "hundred" && expect === "any") { current = 100; expect = "after-hundred"; continue; }
      if (t in SCALES) { total += (current || 1) * SCALES[t]; current = 0; expect = "any"; continue; }
      break;
    }
    out.push(String(total + current));
    i = j;
  }
  return out;
}

// A leading "it's" / "the answer is" says nothing; the rest is the answer.
const FILLER_RE = /^(?:i think (?:that )?|i believe |maybe )?(?:it's|it is|its|it was|they are|they're|the answer is|answer is|answer)\s+/;
const ARTICLE_RE = /^(?:the|a|an)\s+/;

/**
 * Lowercase words with punctuation gone, number words as digits, and a leading filler and article
 * dropped. "It's the H-two-O!" → ["h", "2", "o"]. A decimal point and a leading minus survive.
 */
export function answerWords(s: string): string[] {
  let t = (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/−/g, "-")
    .replace(/^\s*\(?[a-d][).:]\s+/, "")                // an option label "B) "
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")             // 1,000
    .replace(/(^|[\s(])-(?=\d)/g, "$1\u0000")           // keep a leading minus through the punctuation strip
    .replace(/(\d)\.(\d)/g, "$1\u0001$2")               // and a decimal point
    .replace(/[^\p{L}\p{N}\s'\u0000\u0001]/gu, " ")      // every other punctuation mark is a space
    .replace(/'(?!s\b|re\b)/g, " ")                     // quotes, but not it's / they're
    .replace(/\u0000/g, "-").replace(/\u0001/g, ".")
    .replace(/(\d)(\p{L})/gu, "$1 $2").replace(/(\p{L})(\d)/gu, "$1 $2") // 100c → 100 c, h2o → h 2 o
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(FILLER_RE, "").replace(ARTICLE_RE, "");
  return numberWordsToDigits(t.split(" ").filter(Boolean));
}

/** One word with a plural ending taken off, so "tadpoles" and "tadpole" are the same word. */
export function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(?:ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length >= 4 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Edits between two words, a swap of neighbours counting as one (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The shortest key word a one-edit misspelling is accepted for. */
export const MISSPELLING_MIN_LETTERS = 6;

const isNumber = (w: string) => /^-?\d+(?:\.\d+)?$/.test(w);

/** True when the answer's word could be a misspelling of the key's word: one edit, key word long enough. */
function oneEditOff(answer: string, key: string): boolean {
  if (isNumber(answer) || isNumber(key)) return false;
  const a = singular(answer);
  const k = singular(key);
  return k.length >= MISSPELLING_MIN_LETTERS && a !== k && editDistance(a, k) === 1;
}

/** Is this the key's word, as written, as a plural, or (when it is not itself a word) misspelled. */
function sameWord(answer: string, key: string, isWord: (w: string) => boolean): boolean {
  if (answer === key || singular(answer) === singular(key)) return true;
  return oneEditOff(answer, key) && !isWord(answer);
}

function sameWords(answer: string[], key: string[], isWord: (w: string) => boolean): boolean {
  return answer.length === key.length && answer.every((w, i) => sameWord(w, key[i], isWord));
}

// ─── The key's accepted forms ─────────────────────────────────────────────────

/**
 * The key as written, plus its parts: the text outside brackets and a single word inside them
 * ("Carbon dioxide (CO2)"; "(the planet)" says what the key is, it is not another answer), and each
 * side of a spaced slash or a semicolon ("H2O / water"; "km/h" stays whole). Never single words of a
 * longer key.
 */
export function keyForms(expected: string): string[] {
  const forms = new Set<string>([expected]);
  const outside = expected.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (outside) forms.add(outside);
  for (const m of expected.matchAll(/\(([^)]+)\)/g)) {
    const inside = m[1].replace(/^(?:or|also)\s+/i, "").trim();
    if (/^[\p{L}\p{N}₀-₉]+$/u.test(inside)) forms.add(inside);
  }
  for (const f of [...forms]) for (const part of f.split(/\s+\/\s+|\s*;\s*/)) if (part.trim()) forms.add(part.trim());
  return [...forms].filter((f) => answerWords(f).length > 0);
}

// ─── Numbers with units ───────────────────────────────────────────────────────

// Unit words and their short forms, each to one name. A key's unit words may all be left out of an
// answer, but an answer may not add one the key does not have.
const UNIT_NAMES: Record<string, string> = {
  degree: "degree", degrees: "degree", deg: "degree",
  c: "celsius", celsius: "celsius", centigrade: "celsius",
  f: "fahrenheit", fahrenheit: "fahrenheit",
  k: "kelvin", kelvin: "kelvin", kelvins: "kelvin",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  in: "inch", inch: "inch", inches: "inch",
  ft: "foot", foot: "foot", feet: "foot",
  yd: "yard", yard: "yard", yards: "yard",
  mi: "mile", mile: "mile", miles: "mile",
  g: "gram", gram: "gram", grams: "gram",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg", milligram: "mg", milligrams: "mg",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  l: "liter", liter: "liter", liters: "liter", litre: "liter", litres: "liter",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  day: "day", days: "day", week: "week", weeks: "week", year: "year", years: "year",
  mph: "mph", kph: "kph",
  square: "square", squared: "square", sq: "square",
  cubic: "cubic", cubed: "cubic", cu: "cubic",
  percent: "percent", cent: "cent",
  units: "unit", unit: "unit",
};
// Units an answer may leave out on its own: "100 degrees" or "100" for "100 degrees Celsius".
const OPTIONAL_UNITS = new Set(["degree", "celsius", "fahrenheit", "kelvin", "unit"]);
// Said between units and meaning nothing on its own: "km per hour" is "km/h".
const UNIT_JOINERS = new Set(["per", "a", "an"]);

/** The one number in a key whose other words are all units, with those units; otherwise null. */
function numberWithUnits(words: string[]): { n: number; units: Set<string> } | null {
  const nums = words.filter(isNumber);
  if (nums.length !== 1) return null;
  const units = new Set<string>();
  for (const w of words) {
    if (isNumber(w) || UNIT_JOINERS.has(w)) continue;
    const u = UNIT_NAMES[w];
    if (!u) return null;
    units.add(u);
  }
  return { n: parseFloat(nums[0]), units };
}

/** The unit words among some words, each by its one name. */
function unitsIn(words: string[]): Set<string> {
  return new Set(words.map((w) => UNIT_NAMES[w]).filter((u): u is string => !!u));
}

/** The answer's units against the key's: none of its own, and all of the key's unless it gives none. */
function unitsFit(answer: Set<string>, key: Set<string>): boolean {
  if ([...answer].some((u) => !key.has(u))) return false;
  const required = (s: Set<string>) => [...s].filter((u) => !OPTIONAL_UNITS.has(u));
  const given = required(answer);
  return given.length === 0 || given.length === required(key).length;
}

// "half" where the key is a number. Only as the whole number part of the answer.
const HALF_WORDS = new Set(["half", "1 half"]);

function sameNumberAndUnits(answer: string[], key: string[]): boolean {
  const k = numberWithUnits(key);
  if (!k) return false;
  const joined = answer.join(" ");
  let rest = answer;
  for (const h of HALF_WORDS) {
    if (joined === h || joined.startsWith(h + " ")) { rest = ["0.5", ...answer.slice(h.split(" ").length)]; break; }
  }
  const a = numberWithUnits(rest);
  if (!a || Math.abs(a.n - k.n) > 1e-9) return false;
  return unitsFit(a.units, k.units);
}

// ─── Chemical formulas ────────────────────────────────────────────────────────

// "H2O", "CO2", "NaCl", "C6H12O6": element symbols with counts, as one word.
const FORMULA_RE = /^(?:[A-Z][a-z]?\d*){2,}$|^(?:[A-Z][a-z]?\d+)$/;

function sameFormula(answer: string[], keyForm: string): boolean {
  const key = keyForm.normalize("NFKC").replace(/\s+/g, "");
  if (!FORMULA_RE.test(key)) return false;
  return answer.join("") === key.toLowerCase();
}

// ─── A person's name ──────────────────────────────────────────────────────────

const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv)$/;

/** The key is a person's name: the question asks who, and the key is 2-4 capitalised words, the first
 * not an article ("The Roman Empire" is not a person). */
function personSurname(question: string, keyForm: string): string | null {
  if (!/\bwho\b/i.test(question)) return null;
  if (/^(?:the|a|an)\s/i.test(keyForm.trim())) return null;
  const parts = keyForm.normalize("NFKC").replace(/[.,]/g, " ").trim().split(/\s+/);
  const named = parts.filter((p) => !NAME_SUFFIX.test(p.toLowerCase()));
  if (named.length < 2 || named.length > 4) return null;
  if (!named.every((p) => /^\p{Lu}[\p{L}'’-]*$/u.test(p))) return null;
  return answerWords(named[named.length - 1]).join(" ") || null;
}

// ─── Settling ─────────────────────────────────────────────────────────────────

export interface WrittenAnswer {
  question: string;
  expected: string;
  student: string;
  type: string;
}

/**
 * True when code can tell the answer is the key; null when it cannot, and the model decides. Never
 * false. `isWord` says whether a word is a real word (the dictionary); without it, no misspelling is
 * accepted.
 */
export function settleByCode(item: WrittenAnswer, isWord: (w: string) => boolean = () => true): true | null {
  const answer = answerWords(item.student);
  if (answer.length === 0) return null;
  // The older number match reads the first number and ignores units, so it also has to pass the unit
  // rule here: "3 m" is not "3 cm", and "60 km" is not "60 km/h".
  if (gradeFreeTextDeterministic(item.expected, item.student, item.type) === true &&
      unitsFit(unitsIn(answer), unitsIn(answerWords(item.expected)))) return true;
  for (const form of keyForms(item.expected)) {
    const key = answerWords(form);
    if (sameWords(answer, key, isWord)) return true;
    if (sameNumberAndUnits(answer, key)) return true;
    if (sameFormula(answer, form)) return true;
    const surname = personSurname(item.question, form);
    if (surname && sameWords(answer, surname.split(" "), isWord)) return true;
  }
  return null;
}

/**
 * The answer's words that settleByCode would accept as a misspelling if they are not real words, so
 * the caller can look them up first (the dictionary is loaded asynchronously).
 */
export function misspellingCandidates(item: WrittenAnswer): string[] {
  const answer = answerWords(item.student);
  const out = new Set<string>();
  for (const form of keyForms(item.expected)) {
    const keys = [answerWords(form)];
    const surname = personSurname(item.question, form);
    if (surname) keys.push(surname.split(" "));
    for (const key of keys) {
      if (key.length !== answer.length) continue;
      answer.forEach((w, i) => { if (oneEditOff(w, key[i])) out.add(w); });
    }
  }
  return [...out];
}
