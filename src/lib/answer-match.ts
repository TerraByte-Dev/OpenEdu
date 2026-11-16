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
//     "12 square centimeters"), never a unit the key does not have, and units in the key's order ("60
//     hours per km" is not "60 km per hour"). Not the number alone when the question offers a choice
//     ("100 °C or 100 °F?", "10 cm vs 10 m?") or already says that number;
//   - an ordinal in words or digits: "the fourth planet" is "4th planet", "first" is "1st". Never a
//     plain number for an ordinal, and never the ordinal without the key's other words ("the fourth"
//     for "4th planet" goes to the model);
//   - a person's surname: the key is a person's name (the question asks "who", the key is 2-4
//     capitalised words) and the answer is that name's last word;
//   - a one-edit misspelling of a key word of 6 letters or more, when the answer's word is not itself a
//     word ("herbivor"). "neuron" for "neutron" or "photon" for "proton" is a real word, so it is a
//     different answer, and the model decides it. The caller supplies the word list (the dictionary).
//     Never when another real word is one edit from the answer's word ("slovania" is Slovenia or
//     Slovakia), when a word the question offers is as close ("hypetonic" on "hypertonic or
//     hypotonic?"), or when the key word is not in the dictionary, which has no names of places or
//     people ("Zambia" for "Gambia"). Never two edits: "glucogan" is as close to glycogen as to
//     glucagon, and two edits leave too many words that close, so "omnivour" goes to the model;
//   - a sign's name, when the key is the sign itself: ">" takes "greater than", "more than" or
//     "bigger than"; never "greater than or equal to", never "<". Never the sign for a key that is a
//     name, never two names ("smaller than" for "Less than"), and only on a question with a blank
//     between two numbers ("7 __ 2") that neither shows the sign nor says a word of its names or
//     what it does ("Which symbol means greater?", "Which sign shows 9 is bigger? 9 __ 2");
//   - a short code (3 letters or fewer, like an element symbol) written as spaced or dotted letters:
//     "n a" or "N.a." for "Na". When the letters cased another way are another symbol ("CO" carbon
//     monoxide, "Co" cobalt; "NO", "No"), an answer cased as that other symbol is never accepted, and
//     on a question about symbols or formulas the case has to be the key's.
//
// It never accepts on a shared word: "red" is not "red blood cells". Words are compared in order, so an
// answer with the key's words reversed ("4 girls per boy" for "4 boys per girl") is not the key. A
// number never settles on its own when the key's other words say something the answer contradicts or
// leaves out ("6 arms" for "6 legs", "3 am" for "3 PM", "4" for "4 light years"). It never returns false
// either. An answer code cannot settle goes to the model as before.

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

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Every string one edit from a word: a letter dropped, added, changed, or swapped with the next. */
export function oneEditAway(w: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i <= w.length; i++) {
    for (const c of LETTERS) {
      out.add(w.slice(0, i) + c + w.slice(i));
      if (i < w.length) out.add(w.slice(0, i) + c + w.slice(i + 1));
    }
    if (i < w.length) out.add(w.slice(0, i) + w.slice(i + 1));
    if (i + 1 < w.length) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  }
  out.delete(w);
  return [...out];
}

// An ending that makes another form of the same word: "evaporating" and "evaporation" are one stem.
const INFLECTION_RE = /(?:s|es|ed|ing|er|ers|ion|ions|ly)$/;
const stem = (w: string) => singular(w).replace(INFLECTION_RE, "");

/** The words one edit from a misspelling, other than forms of the key word. If one of them is a real
 * word, the answer may be that word misspelt ("slovania" is one edit from Slovenia and from Slovakia),
 * so code does not take it. */
function nearerWords(answer: string, key: string): string[] {
  return oneEditAway(answer).filter((n) => singular(n) !== singular(key) && stem(n) !== stem(key));
}

/** Is this the key's word, as written, as a plural, or (when it is not itself a word) misspelled.
 * `rivals` are the question's other words: one as close to the answer as the key word is (a choice the
 * question offers) means the answer may be that one misspelt. The key word has to be in the dictionary
 * itself: it has no names of places or people, so it cannot say that "zambia" is a real word and not
 * "Gambia" misspelt. */
function sameWord(answer: string, key: string, isWord: (w: string) => boolean, rivals: string[]): boolean {
  if (answer === key || singular(answer) === singular(key)) return true;
  if (!oneEditOff(answer, key) || isWord(answer) || !isWord(key)) return false;
  if (rivals.some((r) => editDistance(singular(answer), singular(r)) <= 1)) return false;
  return !nearerWords(answer, key).some(isWord);
}

function sameWords(answer: string[], key: string[], isWord: (w: string) => boolean, rivals: string[] = []): boolean {
  return answer.length === key.length && answer.every((w, i) => sameWord(w, key[i], isWord, rivals));
}

/** The question's words that are not the key's: what a misspelling could also be of. */
function rivalWords(question: string, key: string[]): string[] {
  const own = new Set(key.map(singular));
  return answerWords(question).filter((w) => !isNumber(w) && !own.has(singular(w)));
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

/** The units that are not a scale or "square"/"cubic", in the order the words give them: "km per hour"
 * is km then hour, so "hours per km" is a different speed. */
function unitOrder(words: string[]): string {
  return words.map((w) => UNIT_NAMES[w]).filter((u): u is string => !!u && !OPTIONAL_UNITS.has(u) && u !== "square" && u !== "cubic").join(" ");
}

/** The question already says this number ("Which is longer, 10 cm or 10 m?"), so the number alone may
 * name any of the things it is said with. */
function questionSays(question: string, n: number): boolean {
  return answerWords(question).some((w) => isNumber(w) && Math.abs(parseFloat(w) - n) <= 1e-9);
}

function sameNumberAndUnits(answer: string[], key: string[], question: string): boolean {
  const k = numberWithUnits(key);
  if (!k) return false;
  const joined = answer.join(" ");
  let rest = answer;
  for (const h of HALF_WORDS) {
    if (joined === h || joined.startsWith(h + " ")) { rest = ["0.5", ...answer.slice(h.split(" ").length)]; break; }
  }
  const a = numberWithUnits(rest);
  if (!a || Math.abs(a.n - k.n) > 1e-9) return false;
  if (!unitsFit(a.units, k.units)) return false;
  if (unitOrder(rest) !== "" && unitOrder(rest) !== unitOrder(key)) return false;
  // Leaving a unit out is fine only when the number alone can name nothing else.
  return unitsCover(a.units, k.units) || (!offersChoice(question) && !questionSays(question, k.n));
}

// ─── The older first-number match ─────────────────────────────────────────────

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

/** The question offers a choice ("Is noon 12 AM or 12 PM?", "10 cm vs 10 m?"), so a number alone may
 * name either side. */
const offersChoice = (question: string) => /\b(?:or|vs|versus)\b/i.test(question);

/**
 * gradeFreeTextDeterministic reads the first number and ignores the words around it, which passed
 * "6 arms" for "6 legs", "3 am" for "3 PM", "12" for "12 PM" on "Is noon 12 AM or 12 PM?" and "1st" for
 * "1 second". Its number settles here only when nothing else can differ from the key: the answer's
 * words are the key's words in the key's order, a unit by any of its names ("12 centimeters" for "12
 * cm"); or the one word between them is what a "how many" question counts ("6" for "6 legs" on "How many
 * legs does an insect have?", "9 electrons" for "9" on "How many electrons?"), and a number alone only
 * when the question does not already say it. Never an ordinal, never under a choice.
 */
function firstNumberFits(answer: string[], key: string[], question: string): boolean {
  if (offersChoice(question)) return false;
  const answerNums = answer.filter(isNumber);
  if (answerNums.length !== 1 || key.filter(isNumber).length !== 1) return false;
  if ([...answer, ...key].some((w) => ORDINAL_RE.test(w))) return false;
  // Each side in order: a number as "#", a unit by its one name, "per"/"a" dropped.
  const shape = (side: string[]) => side.filter((w) => !UNIT_JOINERS.has(w)).map((w) => (isNumber(w) ? "#" : UNIT_NAMES[w] ?? singular(w))).join(" ");
  if (shape(answer) === shape(key)) return true;
  const counted = countedWord(question);
  if (!counted || isMeaningWord(counted)) return false;
  if (shape(key) === "#" && shape(answer) === `# ${counted}`) return true;
  return shape(answer) === "#" && shape(key) === `# ${counted}` && !questionSays(question, parseFloat(answerNums[0]));
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

// ─── Signs ────────────────────────────────────────────────────────────────────

// A comparison or operation sign and its names. "greater than or equal to" is its own sign (≥), so it
// is never ">"; "less than" is never ">".
const SIGNS: Record<string, string> = {
  ">": "gt", "greater than": "gt", "more than": "gt", "bigger than": "gt", "larger than": "gt",
  "<": "lt", "less than": "lt", "smaller than": "lt", "fewer than": "lt",
  "=": "eq", "equals": "eq", "equal": "eq", "equal to": "eq",
  "≥": "ge", ">=": "ge", "greater than or equal to": "ge", "greater than or equal": "ge", "more than or equal to": "ge",
  "≤": "le", "<=": "le", "less than or equal to": "le", "less than or equal": "le",
  "≠": "ne", "!=": "ne", "not equal to": "ne", "not equal": "ne", "does not equal": "ne",
  "+": "plus", "plus": "plus",
  "-": "minus", "minus": "minus",
  "×": "times", "times": "times", "multiplied by": "times",
  "÷": "divide", "divided by": "divide",
};

/** The sign a whole key or answer is, written as the sign or its name ("is greater than", "the equal
 * sign", ">"), and whether it is the sign itself; null when it is anything more or else ("x > 3",
 * "greater"). */
function signOf(s: string): { sign: string; written: boolean } | null {
  const t = (s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[−–]/g, "-")
    .replace(/["'`“”‘’]/g, "")
    .replace(/(\p{L})-(\p{L})/gu, "$1 $2")             // greater-than
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(FILLER_RE, "").replace(ARTICLE_RE, "").replace(/^is /, "").replace(/ (?:sign|symbol)$/, "");
  return Object.prototype.hasOwnProperty.call(SIGNS, t) ? { sign: SIGNS[t], written: !/\p{L}/u.test(t) } : null;
}

// The start of every word in a sign's names, and of the words that say what it does, so a question
// that says any of them ("Which symbol means greater?", "Which sign shows 9 is bigger?", "Which symbol
// means to multiply?") gives the name away.
const SIGN_WORDS: Record<string, string[]> = {
  gt: ["great", "more", "most", "big", "larg"],
  lt: ["less", "least", "small", "few"],
  eq: ["equal", "same"],
  ge: ["great", "more", "most", "big", "larg", "equal", "same"],
  le: ["less", "least", "small", "few", "equal", "same"],
  ne: ["not", "equal", "same"],
  plus: ["plus", "add", "sum", "total"],
  minus: ["minus", "subtract", "take", "differen"],
  times: ["time", "multipl", "product"],
  divide: ["divid", "divis", "share", "quotient"],
};

// A blank between two numbers to put the sign in: "7 __ 2", "(0.5 __ 0.25)", "3 + 4 □ 7".
const SIGN_BLANK = /[\p{N})]\s*(?:_{2,}|□)\s*[(\p{N}]/u;

/** The name can only be known from the numbers: the question has a blank between two numbers for the
 * sign, and neither shows this sign nor says a word of its names or what it does. Anything else (a
 * question asking what a sign means, "Which sign goes between 1/2 and 2/4?") goes to the model. A
 * hyphen counts as the minus sign. */
function signOnlyFromNumbers(question: string, sign: string): boolean {
  const raw = (question ?? "").normalize("NFKC").toLowerCase().replace(/[−–]/g, "-");
  if (!SIGN_BLANK.test(raw)) return false;
  if (Object.entries(SIGNS).some(([text, s]) => s === sign && !/\p{L}/u.test(text) && raw.includes(text))) return false;
  const words = raw.split(/[^\p{L}]+/u).filter(Boolean);
  return !words.some((w) => SIGN_WORDS[sign].some((stem) => w.startsWith(stem)));
}

// ─── Short codes ──────────────────────────────────────────────────────────────

const ELEMENTS = new Set((
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb " +
  "Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf " +
  "Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split(" "));

/** The letters read as element symbols, case as written: "Co" (cobalt), "CO" (C and O), not "co". */
function readsAsSymbols(s: string): boolean {
  if (s === "") return true;
  return (s.length >= 2 && ELEMENTS.has(s.slice(0, 2)) && readsAsSymbols(s.slice(2))) ||
    (ELEMENTS.has(s[0]) && readsAsSymbols(s.slice(1)));
}

/** Every way of casing a few letters: "co" → co, Co, cO, CO. */
function casings(s: string): string[] {
  return [...s].reduce<string[]>((acc, ch) => acc.flatMap((p) => [p + ch.toLowerCase(), p + ch.toUpperCase()]), [""]);
}

// The question is about symbols or formulas, so the case of a symbol's letters is part of the answer.
const ASKS_FOR_SYMBOL = /\b(?:symbols?|formulas?|formulae|elements?|chemical|chemistry|compounds?|molecules?|atoms?|atomic|periodic)\b/i;

/**
 * A key of 1-3 letters (an element symbol, "TX", "USA") and an answer of those letters, run together,
 * spaced or dotted ("n a", "N.a.", "NA" for "Na"): true. When the letters cased another way are other
 * symbols ("CO" carbon monoxide, "Co" cobalt; "NO", "No"), an answer cased as those other symbols is
 * null, and on a question about symbols or formulas any case but the key's is null. Undefined when the
 * key or the answer is something else, and the other rules decide.
 */
function settleShortCode(item: WrittenAnswer): true | null | undefined {
  const code = item.expected.normalize("NFKC").trim().replace(/\.$/, "");
  if (!/^[A-Za-z]{1,3}$/.test(code)) return undefined;
  const written = item.student.normalize("NFKC").trim();
  if (!/^(?:[A-Za-z][\s.-]*){1,3}$/.test(written)) return undefined;
  const letters = written.replace(/[^A-Za-z]/g, "");
  if (letters === code) return true;
  if (letters.toLowerCase() !== code.toLowerCase()) return undefined;
  if (readsAsSymbols(code) && readsAsSymbols(letters)) return null;
  const caseCarries = readsAsSymbols(code) && casings(code).some((c) => c !== code && readsAsSymbols(c));
  if (caseCarries && ASKS_FOR_SYMBOL.test(item.question)) return null;
  return true;
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
  // A sign has no words, so it is read before anything else. Only a name for a key that is the sign
  // itself: "greater than" for ">"; another sign's name ("less than", "greater than or equal to") is
  // never taken by a later rule. The sign for a key that is a name ("What does > mean?"), two names,
  // and a word key ("The Times", "equal") go to the model or the rules below as before. Only on a
  // question with a blank between two numbers that says no word of the sign's names ("Which sign goes
  // in the blank to make 7 __ 2 true?"); never on "Which symbol means greater?".
  const keySign = signOf(item.expected);
  if (keySign?.written) {
    const answerSign = signOf(item.student);
    if (answerSign && !answerSign.written) return answerSign.sign === keySign.sign && signOnlyFromNumbers(item.question, keySign.sign) ? true : null;
  }
  // A short code before the case-blind rules below, which would take "CO" for "Co".
  const code = settleShortCode(item);
  if (code !== undefined) return code;
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
    if (sameWords(answer, key, isWord, rivalWords(item.question, key))) return true;
    if (sameNumberAndUnits(answer, key, item.question)) return true;
    if (sameFormula(answer, form)) return true;
    // Under a choice the surname may be what both sides share ("Theodore Roosevelt or Franklin Roosevelt?").
    const surname = choice ? null : personSurname(item.question, form);
    if (surname && sameWords(answer, surname.split(" "), isWord, rivalWords(item.question, surname.split(" ")))) return true;
  }
  return null;
}

/**
 * The words settleByCode needs the dictionary for, so the caller can look them up first (the dictionary
 * is loaded asynchronously): each of the answer's words it would accept as a misspelling if it is not a
 * real word, the key word it would be a misspelling of, and every word one edit from the answer's
 * word. The caller counts a word it did not look up as real, so a misspelling is never accepted on an
 * answer word or a nearer word it did not check.
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
      answer.forEach((w, i) => {
        if (!oneEditOff(w, key[i])) return;
        out.add(w);
        out.add(key[i]);
        for (const n of nearerWords(w, key[i])) out.add(n);
      });
    }
  }
  return [...out];
}
