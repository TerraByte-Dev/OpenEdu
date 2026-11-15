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
//     degrees" for "100 degrees Celsius" or "100 °C"; the sign is read as "degrees"). Degrees and the
//     scale may be left out; any other unit the answer gives must be all of the key's ("12 cm" is not
//     "12 square centimeters"), never a unit the key does not have;
//   - an ordinal in words or digits: "the fourth" is "4th", "first" is "1st". A key that is one
//     number or ordinal plus words the question already says ("4th planet" for "Counting out from the
//     Sun, which planet is Mars?") also accepts the number alone or with all of those words, never
//     some of them ("60 km" or "60 hours" is not "60 km per hour", "2 eggs" is not "2 dozen eggs"); not
//     a plain number for an ordinal, not when another word of the key is a sign, direction, am/pm or
//     fraction ("Negative 4" needs "negative"), and not when the question offers a choice ("12 AM or
//     12 PM?");
//   - a person's surname: the key is a person's name (the question asks "who", the key is 2-4
//     capitalised words) and the answer is that name's last word;
//   - a one-edit misspelling of a key word of 6 letters or more, when the answer's word is not itself a
//     word ("herbivor"). "neuron" for "neutron" or "photon" for "proton" is a real word, so it is a
//     different answer, and the model decides it. The caller supplies the word list (the dictionary).
//
// It never accepts on a shared word: "red" is not "red blood cells". A number never settles on its own
// when the key's other words say something the answer contradicts or leaves out ("6 arms" for "6 legs",
// "3 am" for "3 PM", "4 years" for "4 light years"). It never returns false either. An answer code
// cannot settle goes to the model as before.

import { gradeFreeTextDeterministic, normalizeAnswer } from "./quiz-grading";

// ─── One form for both sides ──────────────────────────────────────────────────

const isNumber = (w: string) => /^-?\d+(?:\.\d+)?$/.test(w);

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

// Ordinal words. Each ends the number it is part of: "twenty first" → 21st, "one hundredth" → 100th.
const ORD_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
};
const ORD_TEENS: Record<string, number> = {
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const ORD_TENS: Record<string, number> = {
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
};
const ORD_SCALES: Record<string, number> = { thousandth: 1000, millionth: 1_000_000 };

const isOrdinalWord = (w: string) => w in ORD_UNITS || w in ORD_TEENS || w in ORD_TENS || w === "hundredth" || w in ORD_SCALES;

/** 13 → "13th", 1 → "1st", 22 → "22nd": one form for an ordinal however it was written. */
export function ordinalToken(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/;

/**
 * Number words as digits: "a hundred" → 100, "fifty six" → 56, "one hundred and five" → 105, "two
 * thousand" → 2000. Takes the words already split; a run that does not read as one number ("nineteen
 * eighty") is cut where it stops making sense, so each part stays its own number. An ordinal word ends
 * its run as an ordinal: "the fourth" → 4th, "twenty first" → 21st. "second" is 2nd only before a
 * word that is not a unit ("the second planet"); see secondIsOrdinal.
 */
function numberWordsToDigits(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const startsRun = isNumberWord(w) || (isOrdinalWord(w) && (w !== "second" || secondIsOrdinal(out[out.length - 1], words[i + 1]))) ||
      ((w === "a" || w === "an") && (words[i + 1] === "hundred" || words[i + 1] in SCALES));
    if (!startsRun) { out.push(w); i++; continue; }
    let total = 0;
    let current = 0;
    let ordinal = false;
    // What may come next inside the run: after a unit or teen only a scale; after a tens word a unit.
    let expect: "any" | "unit" | "scale" | "after-hundred" = "any";
    let j = i;
    if (w === "a" || w === "an") { current = 1; expect = "scale"; j++; }
    for (; j < words.length; j++) {
      const t = words[j];
      if (t === "and" && expect === "after-hundred" && j + 1 < words.length && (words[j + 1] in UNITS || words[j + 1] in TEENS || words[j + 1] in TENS || words[j + 1] in ORD_UNITS || words[j + 1] in ORD_TEENS || words[j + 1] in ORD_TENS)) continue;
      if (t in UNITS && (expect === "any" || expect === "unit" || expect === "after-hundred")) { current += UNITS[t]; expect = "scale"; continue; }
      if (t in TEENS && (expect === "any" || expect === "after-hundred")) { current += TEENS[t]; expect = "scale"; continue; }
      if (t in TENS && (expect === "any" || expect === "after-hundred")) { current += TENS[t]; expect = "unit"; continue; }
      if (t === "hundred" && current > 0 && current < 10 && expect !== "after-hundred") { current *= 100; expect = "after-hundred"; continue; }
      if (t === "hundred" && expect === "any") { current = 100; expect = "after-hundred"; continue; }
      if (t in SCALES) { total += (current || 1) * SCALES[t]; current = 0; expect = "any"; continue; }
      // An ordinal word is the run's last word. "second" after a unit word is the unit of time, and
      // "twenty second" with nothing after it is 20 seconds as often as 22nd, so it stays 20 + "second".
      if (t === "second" && !secondIsOrdinal(undefined, words[j + 1])) break;
      if (t in ORD_UNITS && (expect === "any" || expect === "unit" || expect === "after-hundred")) { current += ORD_UNITS[t]; ordinal = true; j++; break; }
      if ((t in ORD_TEENS || t in ORD_TENS) && (expect === "any" || expect === "after-hundred")) { current += ORD_TEENS[t] ?? ORD_TENS[t]; ordinal = true; j++; break; }
      if (t === "hundredth" && (expect === "any" || (expect === "scale" && current < 10))) { current = (current || 1) * 100; ordinal = true; j++; break; }
      if (t in ORD_SCALES && expect !== "unit") { total += (current || 1) * ORD_SCALES[t]; current = 0; ordinal = true; j++; break; }
      break;
    }
    out.push(ordinal ? ordinalToken(total + current) : String(total + current));
    i = j;
  }
  return out;
}

/**
 * "second" is the ordinal 2nd only before a word that is not a unit ("the second planet", "second
 * place"). After a number, "per", "a"/"an" or a unit word, before a unit or a number, or as the last
 * word it is the unit of time or the word itself: "343 meters per second", "9.8 meters per second
 * squared", "a second", and "The second" (the SI unit) stays "second", so "seconds" matches it and
 * "2nd" does not.
 */
function secondIsOrdinal(before: string | undefined, after: string | undefined): boolean {
  if (before !== undefined && (isNumber(before) || UNIT_JOINERS.has(before) || isUnitWord(before))) return false;
  return after !== undefined && !isUnitWord(after) && !isNumber(after) && !isNumberWord(after);
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
    .replace(/°/g, " degrees ")                         // 100°C, 90° (℃ is °C after NFKC)
    .replace(/\b([ap])\.\s?m\b\.?/g, "$1m")             // a.m. / p.m. → am / pm, one word
    .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1\u0002")      // an ordinal in digits stays one word: 13th
    .replace(/^\s*\(?[a-d][).:]\s+/, "")                // an option label "B) "
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")             // 1,000
    .replace(/(^|[\s(])-(?=\d)/g, "$1\u0000")           // keep a leading minus through the punctuation strip
    .replace(/(\d)\.(\d)/g, "$1\u0001$2")               // and a decimal point
    .replace(/[^\p{L}\p{N}\s'\u0000\u0001\u0002]/gu, " ") // every other punctuation mark is a space
    .replace(/'(?!s\b|re\b)/g, " ")                     // quotes, but not it's / they're
    .replace(/\u0000/g, "-").replace(/\u0001/g, ".")
    .replace(/(\d)(\p{L})/gu, "$1 $2").replace(/(\p{L})(\d)/gu, "$1 $2") // 100c → 100 c, h2o → h 2 o
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(FILLER_RE, "").replace(ARTICLE_RE, "");
  const words = t.split(" ").filter(Boolean).map((w) => (/^\d+\u0002$/.test(w) ? ordinalToken(parseInt(w, 10)) : w.replace(/\u0002/g, "")));
  return numberWordsToDigits(words);
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
const isUnitWord = (w: string) => Object.prototype.hasOwnProperty.call(UNIT_NAMES, w);
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

/** The answer's units against the key's: none of its own, and all of the key's unless it gives none.
 * "Degrees" goes with Celsius and Fahrenheit, so "100 degrees C" fits "100 C". */
function unitsFit(answer: Set<string>, key: Set<string>): boolean {
  const keyHas = (u: string) => key.has(u) || (u === "degree" && (key.has("celsius") || key.has("fahrenheit")));
  if ([...answer].some((u) => !keyHas(u))) return false;
  const required = (s: Set<string>) => [...s].filter((u) => !OPTIONAL_UNITS.has(u));
  const given = required(answer);
  return given.length === 0 || given.length === required(key).length;
}

// "half" where the key is a number. Only as the whole number part of the answer.
const HALF_WORDS = new Set(["half", "1 half"]);

/** Under a choice ("100 °C or 100 °F?") the answer has to name every unit of the key; "degrees" may still
 * go when the scale is given. */
function unitsCover(answer: Set<string>, key: Set<string>): boolean {
  return [...key].every((u) => answer.has(u) || (u === "degree" && (answer.has("celsius") || answer.has("fahrenheit"))));
}

function sameNumberAndUnits(answer: string[], key: string[], choice: boolean): boolean {
  const k = numberWithUnits(key);
  if (!k) return false;
  const joined = answer.join(" ");
  let rest = answer;
  for (const h of HALF_WORDS) {
    if (joined === h || joined.startsWith(h + " ")) { rest = ["0.5", ...answer.slice(h.split(" ").length)]; break; }
  }
  const a = numberWithUnits(rest);
  if (!a || Math.abs(a.n - k.n) > 1e-9) return false;
  return unitsFit(a.units, k.units) && (!choice || unitsCover(a.units, k.units));
}

// ─── A number the question already names ──────────────────────────────────────

// Words that change what a number means, so a number never stands in for them: a sign or direction
// ("Negative 4", "23 degrees north"), more or less, am/pm, before or after. A fraction's denominator
// ("Two thirds") is checked by isFractionWord; "second" is never one (it is 2nd or the unit of time).
const MEANING_WORDS = new Set([
  "negative", "minus", "positive", "plus", "below", "above", "under", "over", "up", "down", "left", "right",
  "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
  "northern", "southern", "eastern", "western", "latitude", "longitude",
  "more", "less", "fewer", "greater", "smaller", "larger", "bigger", "higher", "lower", "most", "least",
  "increase", "decrease", "gain", "loss", "rise", "fall", "deficit", "debt",
  "before", "after", "ago", "earlier", "later", "am", "pm", "bc", "bce", "ad", "ce", "not", "no",
]);
const isFractionWord = (w: string) => ["half", "halves", "quarter", "quarters"].includes(w) || (isOrdinalWord(singular(w)) && singular(w) !== "second");
const isMeaningWord = (w: string) => MEANING_WORDS.has(w) || isFractionWord(w);

/** The question offers a choice ("Is noon 12 AM or 12 PM?"), so a number alone may name either side. */
const offersChoice = (question: string) => /\bor\b/i.test(question);

/**
 * The key is one number or ordinal plus words the question already says ("4th planet" for "Counting out
 * from the Sun, which planet is Mars?"), and the answer is that number alone or with every one of those
 * words. Some of them is not enough: dropping part of a compound unit or a counting word changes the
 * amount ("60 km" or "60 hours" for "60 km per hour", "12 centimeters" for "12 square centimeters", "2
 * eggs" for "2 dozen eggs", "3 shoes" for "3 pairs of shoes"). Every other word of the key must be in
 * the question, so "red" is still not "red blood cells"; none of them may be a sign, direction, am/pm or
 * fraction ("4" is not "Negative 4", "2" is not "Two thirds"); and the question may not offer a choice.
 */
function sameNumberQuestionNames(answer: string[], key: string[], question: string): boolean {
  if (offersChoice(question)) return false;
  const isNum = (w: string) => isNumber(w) || ORDINAL_RE.test(w);
  const keyNums = key.filter(isNum);
  if (keyNums.length !== 1 || key.length < 2) return false;
  if (key.some((w) => !isNum(w) && isMeaningWord(w))) return false;
  const asked = new Set(answerWords(question).map(singular));
  const named = key.filter((w) => !isNum(w)).map(singular);
  if (!named.every((w) => asked.has(w))) return false;
  const answerNums = answer.filter(isNum);
  if (answerNums.length !== 1 || answerNums[0] !== keyNums[0]) return false;
  const said = answer.filter((w) => !isNum(w)).map(singular);
  return said.length === 0 || [...said].sort().join(" ") === [...named].sort().join(" ");
}

// ─── The older first-number match ─────────────────────────────────────────────

/**
 * gradeFreeTextDeterministic reads the first number and ignores the words around it, which passed
 * "6 arms" for "6 legs", "3 am" for "3 PM", "12" for "12 PM" on "Is noon 12 AM or 12 PM?" and "1st" for
 * "1 second". Its number settles here only when the answer is one plain number and nothing else differs
 * from the key, under the same rule as sameNumberQuestionNames: the answer's other words, units
 * included, are none or all of the key's ("9" for "9 electrons" settles, "4 years" for "4 light years"
 * and "70 beats" for "70 beats per minute" do not). A key word the answer leaves out must be a word of
 * the question that is not a sign, direction, am/pm or fraction. A word the key does not have may only be
 * what the question counts ("9 electrons" for "9" on "How many electrons?"; "12 packs" for "12" on "How
 * many pencils are in 3 packs?" does not settle), and never with words of the key left out. The units
 * fit, and the question offers no choice.
 */
function firstNumberFits(answer: string[], key: string[], question: string): boolean {
  if (offersChoice(question)) return false;
  if (answer.filter(isNumber).length !== 1 || key.filter(isNumber).length !== 1) return false;
  if ([...answer, ...key].some((w) => ORDINAL_RE.test(w))) return false;
  const asked = new Set(answerWords(question).map(singular));
  const onlyIn = (side: string[], other: string[]) => side.filter((w) =>
    !isNumber(w) && !isUnitWord(w) && !UNIT_JOINERS.has(w) && !other.some((o) => singular(o) === singular(w)));
  const answerOnly = onlyIn(answer, key);
  const keyOnly = onlyIn(key, answer);
  if (answerOnly.length > 0 && keyOnly.length > 0) return false;
  // The answer's words, units included, are none or all of the key's.
  const said = (side: string[]) => side.filter((w) => !isNumber(w) && !UNIT_JOINERS.has(w)).map((w) => UNIT_NAMES[w] ?? singular(w));
  const answerSaid = said(answer);
  if (answerSaid.length > 0 && !said(key).every((w) => answerSaid.includes(w))) return false;
  if (!keyOnly.every((w) => asked.has(singular(w)) && !isMeaningWord(w))) return false;
  if (answerOnly.length > 0 && !(answerOnly.length === 1 && singular(answerOnly[0]) === countedWord(question))) return false;
  return unitsFit(unitsIn(answer), unitsIn(key));
}

/** What a "how many" question counts: "legs" in "How many legs does an insect have?". */
function countedWord(question: string): string | null {
  const q = answerWords(question);
  const i = q.findIndex((w, k) => w === "how" && q[k + 1] === "many");
  return i >= 0 && q[i + 2] ? singular(q[i + 2]) : null;
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
  const choice = offersChoice(item.question);
  if (normalizeAnswer(item.student) === normalizeAnswer(item.expected)) return true;
  // The older number match reads the first number and ignores the words around it, so its number has
  // to fit the key's other words here: "3 m" is not "3 cm", "6 arms" is not "6 legs".
  if (gradeFreeTextDeterministic(item.expected, item.student, item.type) === true &&
      firstNumberFits(answer, answerWords(item.expected), item.question)) return true;
  for (const form of keyForms(item.expected)) {
    const key = answerWords(form);
    if (sameWords(answer, key, isWord)) return true;
    if (sameNumberAndUnits(answer, key, choice)) return true;
    if (sameNumberQuestionNames(answer, key, item.question)) return true;
    if (sameFormula(answer, form)) return true;
    // Under a choice the surname may be what both sides share ("Theodore Roosevelt or Franklin Roosevelt?").
    const surname = choice ? null : personSurname(item.question, form);
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
