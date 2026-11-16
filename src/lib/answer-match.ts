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
//   - a person's surname: the key is a person's name (the question asks "who" or names a person's role,
//     "Which scientist", "Name the author"; the key is 2-4 capitalised words) and the answer is that
//     name's last word, or for a name of 3 or 4 words its last two ("conan doyle" for Arthur Conan
//     Doyle), never two words that start with an initial ("w bush" for George H. W. Bush). Never under
//     a choice, never a surname the question itself says ("Which Roosevelt"), never a role the question
//     does not ask for ("Which country's president", "What did the emperor X rule?"), never a key that
//     names a place or a thing ("South Africa", "Soviet Union": see namesAThing), and a surname that is
//     also a common word ("Bell", "Young") only on such a question about a person;
//   - a misspelt name: a key word written with a capital that is in neither the dictionary nor the word
//     list (a place or a person: Sahara, Pompeii), and an answer word that is not a word either, with
//     the same first and last letters, at most one slip of spelling by ear away (two for a name of 7+
//     letters): a vowel for a vowel, a vowel added or left out, a letter doubled or undoubled, two
//     neighbours swapped ("sahera", "pompei"). Never when a word of the question or the key, a country,
//     a US state, a continent or a planet is as close ("slovania" may be Slovakia), so "Zambia" for
//     Gambia and "Niger" for Nigeria go to the model;
//   - a clock time in words for a clock-time key: "quarter after eleven", "half past three", "ten to
//     four", "eleven fifteen", "noon"; a.m./p.m. or "in the morning" only when the key's half of the day
//     matches, and none only when the key has none or the question pins it (see settleQuantity). Never
//     a half the key does not give, and never on a question that asks for 12-hour or 24-hour time;
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
// leaves out ("6 arms" for "6 legs", "3 am" for "3 PM", "4" for "4 light years").
//
// One rule decides both ways: a number with a unit (see "Numbers and units, both ways" below). When the key
// and the answer are each one quantity and nothing else, code compares the amounts after converting
// units, and marks the answer right, or wrong only when it misses grossly ("4.5%" for 45% is wrong, "1
// g/mL" for 1 g/cm³ is right, "340 m/s" for 343 m/s is the model's). Every other rule only accepts. An answer code cannot settle goes to the model as before.

import { gradeFreeTextDeterministic, normalizeAnswer } from "./quiz-grading";
import { SUFFIX_RULES } from "./dictionary";

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
    .replace(/(\b10\s*\^?\s*)-(?=\d)/g, "$1\u0000")      // and an exponent's minus: 10^-4, 10⁻⁴ (NFKC: 10-4)
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
function sameWord(answer: string, key: string, isWord: (w: string) => boolean, rivals: string[], name?: { known: (w: string) => boolean; rivals: string[] }): boolean {
  if (answer === key || singular(answer) === singular(key)) return true;
  if (name && misspeltName(answer, key, name.known, name.rivals)) return true;
  if (!oneEditOff(answer, key) || isWord(answer) || !isWord(key)) return false;
  if (rivals.some((r) => editDistance(singular(answer), singular(r)) <= 1)) return false;
  return !nearerWords(answer, key).some(isWord);
}

/** The key's words that may be misspelt names (misspeltName): those written with a capital. `known` says
 * whether a word is in the dictionary or the English word list. */
interface Names { words: Set<string>; known: (w: string) => boolean }

/** The answer's words against the key's, in order. A name's rivals include the key's other words. */
function sameWords(answer: string[], key: string[], isWord: (w: string) => boolean, rivals: string[] = [], names?: Names): boolean {
  return answer.length === key.length && answer.every((w, i) => sameWord(w, key[i], isWord, rivals,
    names?.words.has(key[i]) ? { known: names.known, rivals: [...rivals, ...key.filter((k) => k !== key[i])] } : undefined));
}

// ─── A misspelt name ──────────────────────────────────────────────────────────

// Names a misspelt place could also be: countries, US states, continents and planets. Neither the
// dictionary nor the word list has names, so without these "slovania" would be Slovenia, when it may be
// Slovakia.
const PLACE_NAMES = new Set((
  "afghanistan albania algeria andorra angola antigua argentina armenia australia austria azerbaijan bahamas " +
  "bahrain bangladesh barbados belarus belgium belize benin bhutan bolivia bosnia botswana brazil brunei " +
  "bulgaria burkina burundi cambodia cameroon canada chad chile china colombia comoros congo croatia cuba " +
  "cyprus czechia denmark djibouti dominica ecuador egypt eritrea estonia eswatini ethiopia fiji finland " +
  "france gabon gambia georgia germany ghana greece grenada guatemala guinea guyana haiti honduras hungary " +
  "iceland india indonesia iran iraq ireland israel italy jamaica japan jordan kazakhstan kenya kiribati " +
  "korea kosovo kuwait kyrgyzstan laos latvia lebanon lesotho liberia libya liechtenstein lithuania " +
  "luxembourg madagascar malawi malaysia maldives mali malta mauritania mauritius mexico micronesia moldova " +
  "monaco mongolia montenegro morocco mozambique myanmar namibia nauru nepal netherlands nicaragua niger " +
  "nigeria norway oman pakistan palau palestine panama paraguay peru philippines poland portugal qatar " +
  "romania russia rwanda samoa senegal serbia seychelles singapore slovakia slovenia somalia spain sudan " +
  "suriname swaziland sweden switzerland syria taiwan tajikistan tanzania thailand togo tonga trinidad " +
  "tunisia turkey turkmenistan tuvalu uganda ukraine uruguay uzbekistan vanuatu vatican venezuela vietnam " +
  "yemen zambia zimbabwe " +
  "alabama alaska arizona arkansas california colorado connecticut delaware florida hawaii idaho illinois " +
  "indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi " +
  "missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia " +
  "washington wisconsin wyoming carolina dakota " +
  "africa asia europe antarctica oceania america mercury venus earth mars jupiter saturn uranus neptune pluto"
).split(" "));

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Edits from the key's word to the answer's, counting only slips of spelling a name by ear: a vowel for
 * another vowel, a vowel added or left out, a letter doubled or undoubled, two neighbours swapped. Any
 * other edit (a consonant changed, added or dropped) counts as too many: "slovakia" is not a slip from
 * Slovenia, "pompei" is from Pompeii.
 */
export function slipEdits(key: string, answer: string): number {
  const TOO_MANY = 99;
  const d: number[][] = Array.from({ length: key.length + 1 }, () => Array(answer.length + 1).fill(TOO_MANY));
  d[0][0] = 0;
  // A letter that may come or go: a vowel, or one of a doubled pair.
  const loose = (w: string, i: number) => VOWELS.has(w[i]) || w[i] === w[i - 1] || w[i] === w[i + 1];
  for (let i = 0; i <= key.length; i++) {
    for (let j = 0; j <= answer.length; j++) {
      if (i > 0) d[i][j] = Math.min(d[i][j], d[i - 1][j] + (loose(key, i - 1) ? 1 : TOO_MANY));
      if (j > 0) d[i][j] = Math.min(d[i][j], d[i][j - 1] + (loose(answer, j - 1) ? 1 : TOO_MANY));
      if (i > 0 && j > 0) {
        const k = key[i - 1], a = answer[j - 1];
        d[i][j] = Math.min(d[i][j], d[i - 1][j - 1] + (k === a ? 0 : VOWELS.has(k) && VOWELS.has(a) ? 1 : TOO_MANY));
      }
      if (i > 1 && j > 1 && key[i - 1] === answer[j - 2] && key[i - 2] === answer[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[key.length][answer.length];
}

/** The key's words written with a capital then small letters: "Sahara", "Pompeii", not "NASA". */
function capitalisedWords(form: string): Set<string> {
  return new Set((form.normalize("NFKC").match(/[\p{L}'’]+/gu) ?? []).filter((w) => /^\p{Lu}\p{Ll}/u.test(w)).flatMap((w) => answerWords(w)));
}

/**
 * The answer's word is the key's name misspelt: the key's word is in neither the dictionary nor the word
 * list (`known` says both), and neither is the answer's; the same first and last letters; at most one
 * slip (slipEdits) for a name of 6 letters, two for 7 or more; and no rival (a word of the question or
 * the key, a country, a US state, a continent, a planet) that close to it.
 */
function misspeltName(answer: string, key: string, known: (w: string) => boolean, rivals: string[]): boolean {
  const edits = key.length >= 7 ? 2 : key.length >= MISSPELLING_MIN_LETTERS ? 1 : 0;
  if (edits === 0 || isNumber(answer) || known(key) || known(answer)) return false;
  if (answer[0] !== key[0] || answer[answer.length - 1] !== key[key.length - 1]) return false;
  if (slipEdits(key, answer) > edits) return false;
  return ![...rivals, ...PLACE_NAMES].some((r) => r !== key && editDistance(answer, r) <= edits);
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

// The question asks about a person: "who", or a person's role ("Which scientist discovered penicillin?",
// "Name the author of Hamlet", "Which Greek philosopher"). Not roles that are also everyday words for
// other things ("general", "man-made"), and only a role the question asks for: "Which country's
// president", "What nation did President Mandela lead?" and "What did the emperor Charlemagne rule?" ask
// for a place or a thing, so a word before the role is never a possessive, a verb or an article.
const WHO_RE = /\bwho(?:m|se)?\b/i;
const PERSON_ROLES = [
  "scientist", "author", "writer", "poet", "playwright", "novelist", "president", "king", "queen", "emperor",
  "empress", "pharaoh", "ruler", "leader", "explorer", "inventor", "artist", "painter", "sculptor", "composer",
  "musician", "mathematician", "physicist", "chemist", "biologist", "botanist", "geologist", "astronomer",
  "naturalist", "philosopher", "person", "woman", "prince", "princess", "astronaut", "aviator", "admiral",
  "minister", "senator", "governor", "activist", "abolitionist", "reformer", "engineer", "architect",
  "economist", "psychologist", "physician", "doctor", "nurse", "founder", "saint", "pope",
];
const ROLE_MODIFIER = "(?!(?:did|do|does|was|were|is|are|has|had|have|will|would|could|can|the|a|an)\\s)[\\p{L}\\p{N}-]+\\s+";
const PERSON_ROLE_RE = new RegExp(`\\b(?:which|what|name\\s+(?:the|a|an|this|that))\\s+(?:${ROLE_MODIFIER}){0,2}?(?:${PERSON_ROLES.join("|")})\\b(?!-)`, "iu");

// A key's first word that makes it a place or a thing, not a person: "South Africa", "New Mexico", "Holy
// Roman Empire".
const PLACE_QUALIFIERS = new Set(["north", "south", "east", "west", "new", "holy"]);

/** A person's name in the key, on a question about a person: its 2-4 capitalised words (a suffix such as
 * "Jr." dropped), the first not an article ("The Roman Empire" is not a person). */
interface PersonName { parts: string[] }
function personName(question: string, keyForm: string): PersonName | null {
  if (!WHO_RE.test(question) && !PERSON_ROLE_RE.test(question)) return null;
  if (/^(?:the|a|an)\s/i.test(keyForm.trim())) return null;
  const named = keyForm.normalize("NFKC").replace(/[.,]/g, " ").trim().split(/\s+/).filter((p) => !NAME_SUFFIX.test(p.toLowerCase()));
  if (named.length < 2 || named.length > 4) return null;
  if (!named.every((p) => /^\p{Lu}[\p{L}'’-]*$/u.test(p))) return null;
  const parts = named.map((p) => answerWords(p).join(" "));
  return parts.every(Boolean) ? { parts } : null;
}

/** The name's last word, and for a name of 3 or 4 words its last two ("conan doyle"), each as words; never
 * two words that start with an initial ("w bush" is George W. Bush, not George H. W. Bush). */
const surnameForms = (p: PersonName): string[][] =>
  p.parts.slice(1).map((_, k) => p.parts.slice(p.parts.length - 1 - k).join(" ").split(" ")).slice(0, 2)
    .filter((words) => words.length === 1 || words[0].length > 1);

/** The name's first and last words. */
const firstWord = (p: PersonName): string => p.parts[0].split(" ")[0];
const lastWord = (p: PersonName): string => { const w = p.parts[p.parts.length - 1].split(" "); return w[w.length - 1]; };

/** What the dictionary says of a word: it has an adjective sense, and a sense written in small letters
 * (an everyday word, not only a name: "union" and "bell", not "Fleming"). */
export interface WordSenses { adjective: boolean; everyday: boolean }
const NO_SENSES: WordSenses = { adjective: false, everyday: false };

/**
 * The key names a place or a thing, though the question asks who: its first word is a direction, "New"
 * or "Holy" ("South Africa", "West Virginia"), or an adjective before an everyday word ("Soviet Union",
 * "World War II", "Roman Empire"), or an everyday word or adjective before a country, US state or
 * continent ("Central America"). A surname that is an everyday word is still taken after a first name
 * that is not an adjective ("Alexander Graham Bell", "James Cook"), and "Washington" after "George".
 */
function namesAThing(p: PersonName, senses: (w: string) => WordSenses): boolean {
  const first = firstWord(p);
  const last = lastWord(p);
  if (PLACE_QUALIFIERS.has(first)) return true;
  const f = senses(first);
  return (f.adjective && senses(last).everyday) || ((f.adjective || f.everyday) && PLACE_NAMES.has(last));
}

/**
 * The surname forms an answer may give for the key, on a question about a person; none when the
 * question already says the surname ("Which Roosevelt...?"): it names someone the surname cannot tell
 * apart from the key; none when the key names a place or a thing (namesAThing). A surname that is a
 * common word ("Bell", "Young") is taken only here, where the question asks who or names a person's role.
 */
function personSurnames(question: string, keyForm: string, senses: (w: string) => WordSenses): string[][] {
  const p = personName(question, keyForm);
  if (!p || namesAThing(p, senses)) return [];
  const said = new Set(answerWords(question));
  if (p.parts[p.parts.length - 1].split(" ").some((w) => said.has(w))) return [];
  return surnameForms(p);
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

// ─── Numbers and units, both ways ─────────────────────────────────────────────
//
// The small grader model fails the same amount in other units ("1 g/mL" for 1 g/cm³, "8 mL" for 8 cm³,
// "0.25 km per minute" for 15 km/h) and passes a different amount ("4.5%" for 45%, "0.33 g/cm³" for 3
// g/cm³, "2/8" for 1/2): GRADE_DEV_NUMBERS, results/2026-11-16-grade-dev-numbers.md. Code can compute
// both. The key and the answer are each read as one quantity (parseQuantity): a number (digits with or
// without thousands commas, a leading dot, a fraction or mixed number, scientific or e notation,
// "150 million", number words), a sign (-, minus, negative, "below zero"), and at most one unit from a
// small table: length, mass, volume, time, and compounds of them (square and cubic, "per" or a
// slash: km/h, g/cm³, g/mL), percent, money ($, dollars, cents, ¢), and temperature, never converted
// between scales. A clock time ("4:15 p.m.", "16:15", "quarter past four in the afternoon") is read on
// its own, and a word time is only ever accepted, never marked wrong. Anything else in either, or
// any word the table does not know, and code does not decide.
//
// Right (true) when the amounts are equal after converting units (within the precision written; on an
// estimate question, "Estimate 49 x 21", "roughly", "about how", within 10%). Wrong (false) only on a
// gross miss (grossMiss), when both sides read fully:
//   - another kind of unit: an area for a volume, a mass for a volume, a length for a time, "$10" for 25%;
//   - a factor of about 10, 100 or 1000: "4.5%" for 45%, "0.33 g/cm³" for 3 g/cm³, "1 kg/mL" for 1 g/cm³,
//     "46,020" for 406,020. Not 100 between two plain numbers or on a percent question: "45" for 0.45 and
//     "50" for a probability of 0.5 are the same number read as a percent;
//   - a different fraction for a fraction key: "2/8" for 1/2, "4/3" for 3/4;
//   - a.m. for p.m. on a clock time ("4:15 a.m." for 4:15 p.m.); any other time is the model's;
//   - the other sign ("-3" for 3), except on a question about a fall, drop, decrease, loss, depth, being
//     below, a change or a difference, where either sign may be meant ("-6 °C" for a fall of 6 °C);
//   - otherwise, more than 20% apart, only when the question gives the numbers (not just a year) and asks
//     for no estimate: "20" for half of 50, "6 cm³" for a cube of edge 2 cm.
// Never on precision alone: a measured fact ("8,848 m" for Everest's 8,849 m, "340 m/s" for 343 m/s,
// "98 °F" for 98.6 °F), an estimate, pi or a rounded conversion factor ("12.57" for 12.56, "62.5 miles"
// for 62.1) is the model's. Code also says nothing (null) when:
//   - the answer says "about" (or "approximately", "around"), or was read with a guess ("406 020");
//   - the key says "about": then the answer is right within 2% (and the key's last digit);
//   - the units differ in kind and the answer used a one-letter unit ("9 m" for 9 m² may mean 9
//     minutes; "m", "s", "g", "l", "h", "in");
//   - a temperature is on another scale ("212 °C" for 212 °F), has a scale the key lacks ("90 degrees
//     Celsius" for an angle of 90°), or leaves the key's scale out and the amount differs ("32 degrees"
//     for 0 °C may be Fahrenheit) or the question offers a choice;
//   - years against days or weeks (a year is not a set number of days);
//   - the answer's number read with the comma and point swapped is the key ("1.000" for 1,000);
//   - a bare number for a key with a unit could be the key in some other unit of its kind, within 5%
//     ("1000" for 1 L, "2.2" for 1 kg, "0.45" for 45%), or the question asks for the unit ("Include the
//     unit"), or the key is about or a temperature; otherwise it is read in the key's unit;
//   - a bare count on a question that names what it counts ("How many fourths", "in thirds", "how many
//     tens"): read in that unit, right when it is the key ("3" for 3/4) and the model's otherwise, and
//     the model's when the question asks "what fraction";
//   - percent against a plain number when the reading is the other one: "45%" for 45. "45%" for 9/20 is
//     right only when the question asks for no form;
//   - the question asks for a form (as a percent, decimal or fraction, simplest form, scientific or
//     standard notation, rounded, exact, in digits) and the answer has the right value in another form:
//     "0.45" on "Write 9/20 as a percent", "75/100" for simplest form, "30 × 10^3" for scientific
//     notation. A different value is still judged as above;
//   - the question asks for the key's unit ("in kilometers", "how many grams") and the answer gives the
//     same amount in another ("1500 m"): not converted, which the model decides;
//   - the key is a ratio ("2:3"), or a clock time that cannot be told from a.m. ("4:15" for 4:15 p.m.),
//     unless the question pins the half of the day ("A film starts at 2:45 p.m. ...");
//   - the answer says a half of the day the key does not ("1:30 a.m." for 1:30 on "A movie starts at
//     11:30 a.m. and lasts 2 hours"): the question's half is the start time's;
//   - the question asks for 12-hour or 24-hour time and the answer has no half of the day or is in words
//     ("4:15" or "quarter past four" for 16:15 on "Write 4:15 p.m. in 24-hour time").
// A bare key takes the unit the question asks for ("Write the elevation as a number of meters": "-15
// km" is wrong, "negative 15 meters" right). A code rejection is stored like any other code mark
// (graded_by 'exact'), and the learner can still say "I think I was right" (written-answer-checks.ts).

/** A number as written. `ulp` is the place of its last digit (0.01 for "0.67", 1 for "273", 0 for an
 * exact fraction); `loose` also counts an integer's trailing zeros (100 for "4,900"). */
interface WrittenNumber {
  v: number;
  ulp: number;
  loose: number;
  form: "int" | "dec" | "frac" | "mixed" | "sci";
  /** The number read with the comma and the point swapped ("1.000" may be a thousand, "1,000" one). */
  alt?: number;
  /** frac and mixed: numerator and denominator; sci: mantissa and exponent. */
  a?: number;
  b?: number;
  whole?: number;
}

interface Quantity {
  kind: "plain" | "percent" | "money" | "measure" | "temperature";
  /** plain: the number; percent: the percent (45); money: dollars; measure: SI units; temperature: on its scale. */
  v: number;
  /** The last digit's place, in the same units as v, and the same counting trailing zeros. */
  ulp: number;
  loose: number;
  /** Units of v per written unit (cents 0.01, km 1000). */
  f: number;
  num: WrittenNumber;
  /** measure: exponents of length, mass and time ("1,0,-1" is a speed). */
  dims: string;
  /** temperature: "c", "f", "k", or "" for degrees with no scale. */
  scale: string;
  approx: boolean;
  guessed: boolean;
  abbrev: boolean;
  /** Written in years, which convert to other units of time only roughly. */
  calendar: boolean;
}

// [SI units per one, exponents of length (m), mass (kg), time (s)]. A year is 365.25 days, but how many
// days a year is depends on the year, so years against another unit of time never settle exactly
// (Quantity.calendar).
const Q_UNIT_DEFS: Record<string, [number, [number, number, number]]> = {
  mm: [1e-3, [1, 0, 0]], cm: [1e-2, [1, 0, 0]], m: [1, [1, 0, 0]], km: [1e3, [1, 0, 0]],
  inch: [0.0254, [1, 0, 0]], foot: [0.3048, [1, 0, 0]], yard: [0.9144, [1, 0, 0]], mile: [1609.344, [1, 0, 0]],
  mg: [1e-6, [0, 1, 0]], g: [1e-3, [0, 1, 0]], kg: [1, [0, 1, 0]], pound: [0.45359237, [0, 1, 0]], ounce: [0.028349523125, [0, 1, 0]],
  ml: [1e-6, [3, 0, 0]], liter: [1e-3, [3, 0, 0]],
  second: [1, [0, 0, 1]], minute: [60, [0, 0, 1]], hour: [3600, [0, 0, 1]], day: [86400, [0, 0, 1]], week: [604800, [0, 0, 1]],
  year: [365.25 * 86400, [0, 0, 1]],
  mph: [1609.344 / 3600, [1, 0, -1]], kph: [1000 / 3600, [1, 0, -1]],
};
const Q_UNIT_ALIASES: Record<string, string> = {
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  in: "inch", inch: "inch", inches: "inch", ft: "foot", foot: "foot", feet: "foot",
  yd: "yard", yds: "yard", yard: "yard", yards: "yard", mi: "mile", mile: "mile", miles: "mile",
  mg: "mg", milligram: "mg", milligrams: "mg", g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg", lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "liter", liter: "liter", liters: "liter", litre: "liter", litres: "liter",
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  day: "day", days: "day", week: "week", weeks: "week", year: "year", years: "year", yr: "year", yrs: "year",
  mph: "mph", kph: "kph", kmh: "kph",
};
// A unit an answer may have meant as another ("m" for minutes).
const ONE_LETTER_UNITS = new Set(["m", "s", "g", "l", "h", "in"]);
const TEMP_SCALES: Record<string, string> = { c: "c", celsius: "c", centigrade: "c", f: "f", fahrenheit: "f", k: "k", kelvin: "k", kelvins: "k" };
const SCALE_WORDS: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
const APPROX_RE = /^(?:about|approximately|approx|around|roughly|nearly|almost|close to|~|≈)\s*/;
const own = (o: object, k: string | undefined) => k !== undefined && Object.prototype.hasOwnProperty.call(o, k);

/** The words and signs of a quantity, number words as digits, and whether it opens with "about". */
function quantityTokens(s: string): { toks: string[]; approx: boolean } {
  let t = (s ?? "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => ` ^ ${[...m].map((c) => SUPERSCRIPTS[c]).join("")} `) // before NFKC makes ² a 2
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[−–—]/g, "-")
    .replace(/[×·*✕]/g, " x ")
    .replace(/°/g, " degrees ")
    .replace(/\bper\s+cent\b/g, "percent")
    .replace(/(\p{L})-(\p{L})/gu, "$1 $2")              // thirty-six
    .trim()
    .replace(/[.!?]+$/, "")
    .trim()
    .replace(FILLER_RE, "");
  const approx = APPROX_RE.test(t);
  t = t.replace(APPROX_RE, "");
  const raw = t.match(/\d+(?:\.\d+)?e[+-]?\d+(?![\p{L}\d])|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])|\d+(?:\.\d+)?|\.\d+|\p{L}+|\S/gu) ?? [];
  // A scale word after digits stays with them ("150 million"); other number words become digits.
  const marked = raw.map((w, i) => (own(SCALE_WORDS, w) && i > 0 && /^[\d.,]+$/.test(raw[i - 1]) ? `*${w}` : w));
  return { toks: numberWordsToDigits(marked), approx };
}

function readDigits(tok: string | undefined): WrittenNumber | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/.exec(tok ?? "");
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const int = (m[1] ?? "0").replace(/,/g, "");
  const dec = m[2] ?? "";
  const v = Number(`${int}.${dec || "0"}`);
  if (dec) return { v, ulp: 10 ** -dec.length, loose: 10 ** -dec.length, form: "dec", alt: dec.length === 3 && !m[1]?.includes(",") ? Number(int + dec) : undefined };
  const alt = /^\d{1,3},\d{3}$/.test(m[1]!) ? Number(m[1]!.replace(",", ".")) : undefined;
  return { v, ulp: 1, loose: v === 0 ? 1 : 10 ** /0*$/.exec(int)![0].length, form: "int", alt };
}

const sci = (m: WrittenNumber, e: number): WrittenNumber =>
  ({ v: Number(`${m.v}e${e}`), ulp: m.ulp * 10 ** e, loose: m.loose * 10 ** e, form: "sci", a: m.v, b: e });
const frac = (a: number, b: number): WrittenNumber => ({ v: a / b, ulp: 0, loose: 0, form: "frac", a, b });

/** What a fraction word divides by: "half" 2, "quarters" 4, "twentieths" 20 ("1 4th" from "one fourth"). Never "second". */
function denominator(w: string | undefined): number | null {
  if (!w) return null;
  if (w === "half" || w === "halves") return 2;
  if (w === "quarter" || w === "quarters") return 4;
  const ord = /^(\d+)(?:st|nd|rd|th)$/.exec(w) ?? /^(\d+)(?:st|nd|rd|th)$/.exec(numberWordsToDigits([singular(w)])[0] ?? "");
  const d = ord ? Number(ord[1]) : 0;
  return d >= 3 ? d : null;
}

/** The number starting at toks[i]: its value as written and where it ends. */
function readNumber(toks: string[], i: number): { num: WrittenNumber; next: number; guessed: boolean } | null {
  const t = toks[i];
  if (t === "a" || t === "an") {
    const d = denominator(toks[i + 1]);
    return d ? { num: frac(1, d), next: i + 2, guessed: false } : null;
  }
  const e = /^(\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(t ?? "");
  if (e) return { num: sci(readDigits(e[1])!, Number(e[2])), next: i + 1, guessed: false };
  let n = readDigits(t);
  if (!n) return null;
  let j = i + 1;
  let guessed = false;
  // "406 020": groups of three digits after a space read as one number, with a guess.
  if (/^\d{1,3}$/.test(t) && /^\d{3}$/.test(toks[j] ?? "") && toks[j + 1] !== "/") {
    let joined = t;
    while (/^\d{3}$/.test(toks[j] ?? "")) joined += toks[j++];
    n = readDigits(joined)!;
    guessed = true;
  }
  const exponent = (k: number): { e: number; next: number } | null => {
    const sign = toks[k] === "-" ? -1 : 1;
    if (toks[k] === "-" || toks[k] === "+") k++;
    return /^\d+$/.test(toks[k] ?? "") ? { e: sign * Number(toks[k]), next: k + 1 } : null;
  };
  if (!guessed && (toks[j] === "x" || toks[j] === "times") && toks[j + 1] === "10" && toks[j + 2] === "^") {
    const x = exponent(j + 3);
    return x ? { num: sci(n, x.e), next: x.next, guessed } : null;
  }
  if (!guessed && t === "10" && toks[j] === "^") {
    const x = exponent(j + 1);
    return x ? { num: sci({ v: 1, ulp: 1, loose: 1, form: "int" }, x.e), next: x.next, guessed } : null;
  }
  if (n.form === "int" && !guessed) {
    if (toks[j] === "/") {
      const d = readDigits(toks[j + 1]);
      return d && d.form === "int" && d.v > 0 ? { num: frac(n.v, d.v), next: j + 2, guessed } : null;
    }
    const top = readDigits(toks[j]);
    const bottom = readDigits(toks[j + 2]);
    if (top?.form === "int" && toks[j + 1] === "/" && bottom?.form === "int" && top.v < bottom.v) {
      return { num: { ...frac(top.v, bottom.v), v: n.v + top.v / bottom.v, form: "mixed", whole: n.v }, next: j + 3, guessed };
    }
    if (toks[j] === "and" && (toks[j + 1] === "a" || toks[j + 1] === "1") && toks[j + 2] === "half") {
      return { num: { ...frac(1, 2), v: n.v + 0.5, form: "mixed", whole: n.v }, next: j + 3, guessed };
    }
    const d = denominator(toks[j]);
    if (d) return { num: frac(n.v, d), next: j + 1, guessed };
  }
  const scale = toks[j]?.startsWith("*") ? toks[j].slice(1) : toks[j] === "billion" || toks[j] === "trillion" ? toks[j] : null;
  if (scale && own(SCALE_WORDS, scale)) {
    const s = SCALE_WORDS[scale];
    n = { ...n, v: n.v * s, ulp: n.ulp * s, loose: n.loose * s };
    j++;
  }
  return { num: n, next: j, guessed };
}

interface UnitRead { f: number; dims: number[]; next: number; abbrev: boolean; simple: boolean; calendar: boolean }

/** One unit, maybe squared or cubed: "cm", "square meters", "m^2", "cm cubed". */
function readUnitTerm(toks: string[], i: number): UnitRead | null {
  let power = 1;
  let j = i;
  if (toks[j] === "square" || toks[j] === "sq") { power = 2; j++; } else if (toks[j] === "cubic" || toks[j] === "cu") { power = 3; j++; }
  if (!own(Q_UNIT_ALIASES, toks[j])) return null;
  const name = Q_UNIT_ALIASES[toks[j]];
  const abbrev = ONE_LETTER_UNITS.has(toks[j]);
  j++;
  let after = 1;
  if (toks[j] === "^" && (toks[j + 1] === "2" || toks[j + 1] === "3")) { after = Number(toks[j + 1]); j += 2; }
  else if (toks[j] === "squared") { after = 2; j++; } else if (toks[j] === "cubed") { after = 3; j++; }
  else if ((toks[j] === "2" || toks[j] === "3") && (j + 1 === toks.length || toks[j + 1] === "/" || toks[j + 1] === "per")) { after = Number(toks[j]); j++; }
  if (power > 1 && after > 1) return null;
  power = Math.max(power, after);
  const [f, d] = Q_UNIT_DEFS[name];
  if (power > 1 && d.join() !== "1,0,0") return null;
  return { f: f ** power, dims: d.map((x) => x * power), next: j, abbrev, simple: power === 1 && d.filter(Boolean).length === 1 && d.some((x) => x === 1), calendar: name === "year" };
}

/** A unit, or one unit per another: "km/h", "grams per cubic centimeter", "miles an hour". */
function readUnits(toks: string[], i: number): UnitRead | null {
  const a = readUnitTerm(toks, i);
  if (!a) return null;
  const per = toks[a.next];
  if (per !== "/" && per !== "per" && per !== "a" && per !== "an") return a;
  const b = readUnitTerm(toks, a.next + 1);
  if (!b) return null;
  return { f: a.f / b.f, dims: a.dims.map((x, k) => x - b.dims[k]), next: b.next, abbrev: a.abbrev || b.abbrev, simple: false, calendar: a.calendar || b.calendar };
}

/** The key or answer as one quantity, or null when it is anything more or else. */
function parseQuantity(s: string): Quantity | null {
  const { toks, approx } = quantityTokens(s);
  let i = 0;
  const take = (...ws: string[]) => (ws.includes(toks[i]) ? (i++, true) : false);
  let money = take("$");
  let sign = take("-", "minus", "negative") ? -1 : (take("+", "positive", "plus"), 1);
  if (!money) money = take("$");
  const read = readNumber(toks, i);
  if (!read) return null;
  i = read.next;
  const num = read.num;
  let kind: Quantity["kind"] = "plain";
  let f = 1;
  let value = num.v;  // in written units, until a second part is added in base units below
  let ulp = num.ulp;
  let loose = num.loose;
  let base = false;   // value, ulp and loose are already in base units
  let dims = "";
  let scale = "";
  let abbrev = false;
  let calendar = false;
  if (money) { kind = "money"; take("dollar", "dollars"); }
  else if (take("%", "percent", "pct")) kind = "percent";
  else if (take("¢", "cent", "cents")) { kind = "money"; f = 0.01; }
  else if (take("dollar", "dollars")) {
    kind = "money";
    const and = toks[i] === "and" ? 1 : 0;
    const cents = readDigits(toks[i + and]);
    if (num.form === "int" && cents?.form === "int" && ["cent", "cents", "¢"].includes(toks[i + and + 1])) {
      value = num.v + cents.v / 100; ulp = 0.01; loose = 0.01; base = true;
      i += and + 2;
    }
  } else if (take("degree", "degrees", "deg") || own(TEMP_SCALES, toks[i])) {
    kind = "temperature";
    if (own(TEMP_SCALES, toks[i])) scale = TEMP_SCALES[toks[i++]];
  } else {
    const u = readUnits(toks, i);
    if (u) {
      kind = "measure"; f = u.f; dims = u.dims.join(); abbrev = u.abbrev; calendar = u.calendar; i = u.next;
      // "1 hour 30 minutes", "5 feet and 6 inches": a second part in a smaller unit of the same kind.
      const and = toks[i] === "and" ? 1 : 0;
      const n2 = readDigits(toks[i + and]);
      const u2 = n2 ? readUnits(toks, i + and + 1) : null;
      if (u.simple && n2 && u2 && u2.simple && u2.dims.join() === dims && u2.f < u.f) {
        value = num.v * u.f + n2.v * u2.f; ulp = n2.ulp * u2.f; loose = n2.loose * u2.f; base = true;
        abbrev ||= u2.abbrev; calendar ||= u2.calendar; i = u2.next;
      }
      if (calendar) take("old");
    }
  }
  // "5 degrees below zero", "5 below zero".
  if ((kind === "temperature" || kind === "plain") && toks[i] === "below" && (toks[i + 1] === "0" || toks[i + 1] === "zero")) {
    if (sign === -1) return null;
    sign = -1;
    i += 2;
  }
  if (i !== toks.length) return null;
  const toBase = base ? 1 : f;
  return {
    kind, v: sign * value * toBase, ulp: ulp * toBase, loose: loose * toBase, f, num: { ...num, v: sign * num.v },
    dims, scale, approx, guessed: read.guessed, abbrev, calendar,
  };
}

// Every unit the table can make, for a bare number that may be the key in some other unit.
let unitCombos: Array<{ f: number; dims: string }> | null = null;
function allUnits(): Array<{ f: number; dims: string }> {
  if (unitCombos) return unitCombos;
  const simple = Object.values(Q_UNIT_DEFS).map(([f, d]) => ({ f, d }));
  const lengths = simple.filter((u) => u.d.join() === "1,0,0");
  const terms = [...simple, ...lengths.flatMap((u) => [{ f: u.f ** 2, d: [2, 0, 0] }, { f: u.f ** 3, d: [3, 0, 0] }])];
  unitCombos = [...terms, ...terms.flatMap((x) => simple.map((y) => ({ f: x.f / y.f, d: x.d.map((v, k) => v - y.d[k]) })))]
    .map((u) => ({ f: u.f, dims: u.d.join() }));
  return unitCombos;
}

// The question asks for the answer in a set form, so the same value in another form is not the answer.
const ASKS_FORM_RE = /\b(?:as|in|into|to)\s+(?:an?\s+)?(?:exact\s+)?(?:percent(?:age)?s?|decimals?|fractions?|mixed numbers?|improper fractions?|whole numbers?|ratios?|words|digits|numerals)\b|\bwhat (?:percent(?:age)?|fraction|decimal)\b|\bby what percent|\bsimplest\b|\blowest terms\b|\bsimplif|\b(?:scientific|standard|expanded) (?:notation|form)\b|\bround|\bnearest\b|\bexact\b|\bdecimal places?\b|\bsignificant\b/i;
// The question allows rounding, so an answer's trailing zeros may be rounding ("5,000").
const ASKS_ROUNDING_RE = /\b(?:round(?:ed|ing)?|nearest|estimate|approximate(?:ly)?|about|roughly|around)\b/i;
// The question asks for an estimate, so a near amount is right and only a gross miss is wrong. "About"
// and "around" only before how, what or a number: "go around the Sun" asks for no estimate.
const ESTIMATE_RE = /\b(?:estimate[ds]?|estimating|approximate(?:ly)?|roughly)\b|\b(?:about|around)\s+(?:how|what|\$?\d)/i;
// A sign flip is gross only when the question is nothing but an expression to evaluate ("What is 3 - 5?",
// "Compute -2 - 3.", "negative 7 plus 3"). In a word problem either sign may be meant ("how much less",
// "the decline from 2019-2020", "a 4 x 6 photo"), and a list of decrease words never ends, so the model
// decides there.
const EXPRESSION_LEAD_RE = /^\s*(?:what(?:'s|’s| is)|compute|calculate|evaluate|simplify|find(?: the value of)?|solve)\s*:?\s*/i;
const EXPRESSION_BODY_RE = /^(?:[-−–+×x*÷/().,\d\s]|\b(?:negative|minus|plus|times|divided|multiplied|by|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b)+[?=!]?\s*$/i;
const OPERATION_RE = /\d\s*[-−–+×x*÷/]\s*[-−(]?\s*\d|\b(?:plus|minus|times|divided by|multiplied by)\b/i;
function signMatters(question: string): boolean {
  const body = question.replace(EXPRESSION_LEAD_RE, "");
  return OPERATION_RE.test(body) && EXPRESSION_BODY_RE.test(body);
}
// "How many fourths", "in thirds", "how many tens": a bare number counts that unit.
const COUNT_UNITS: Record<string, number> = {
  halves: 1 / 2, thirds: 1 / 3, fourths: 1 / 4, quarters: 1 / 4, fifths: 1 / 5, sixths: 1 / 6, sevenths: 1 / 7,
  eighths: 1 / 8, ninths: 1 / 9, tenths: 0.1, twelfths: 1 / 12, hundredths: 0.01, thousandths: 0.001,
  ones: 1, tens: 10, hundreds: 100, thousands: 1000,
};
const COUNT_UNIT_RE = new RegExp(`\\b(?:in|how many|number of)\\s+(${Object.keys(COUNT_UNITS).join("|")})\\b`, "i");
// The question asks for the unit, so a bare number is not the whole answer.
const ASKS_UNIT_RE = /\b(?:include|with|give|show|write)\s+(?:the\s+|its\s+|your\s+|a\s+)?units?\b/i;

/** The unit the question asks the answer in: "how many grams", "a number of meters", "in kilometers?" at its end. */
function askedUnit(question: string): { f: number; dims: string } | null {
  const w = answerWords(question);
  for (let i = 0; i < w.length; i++) {
    const lead = (w[i] === "how" && w[i + 1] === "many") || (w[i] === "number" && w[i + 1] === "of") ? i + 2 : w[i] === "in" ? i + 1 : -1;
    if (lead < 0) continue;
    const u = readUnits(w, lead);
    if (!u || (w[i] === "in" && u.next !== w.length)) continue;
    return { f: u.f, dims: u.dims.join() };
  }
  return null;
}

const sameAmount = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y));

/** The answer is the key when its number is read with the comma and point swapped ("1.000" for 1,000). */
const swappedReading = (a: Quantity, target: number) =>
  a.num.alt !== undefined && a.num.v !== 0 && sameAmount(a.v * (a.num.alt / a.num.v), target);

/** The answer is in the form the question asks for, when it asks for one. */
function sameForm(k: Quantity, a: Quantity, question: string): boolean {
  if (!ASKS_FORM_RE.test(question)) return true;
  if (k.kind !== a.kind) return false;
  const kn = k.num, an = a.num;
  const decimal = (n: WrittenNumber) => n.form === "int" || n.form === "dec";
  if (decimal(kn)) return decimal(an);
  if (kn.form !== an.form) return false;
  if (kn.form === "sci") return sameAmount(kn.a!, an.a!) && kn.b === an.b;
  return kn.a === an.a && kn.b === an.b && kn.whole === an.whole;
}

/** The question gives the numbers the answer is worked out from: at least one that is not a year on its
 * own ("in 1987"), or two of any kind. A question with none asks for a fact. */
function givesNumbers(question: string): boolean {
  const nums = (question ?? "").match(/\d+(?:[.,]\d+)*/g) ?? [];
  return nums.length >= 2 || nums.some((n) => !/^(?:1\d{3}|20\d{2})$/.test(n));
}

/**
 * Two different amounts of one kind, in the same base units (`kv`, `av`): wrong only when the miss is
 * gross. A different sign only on bare arithmetic (signMatters); a factor of about 10, 100 or
 * 1000 (not 100 between two plain numbers or on a percent question: 45 for 0.45 is the same number read
 * as a percent); or, when the question gives the numbers and asks for no estimate, a different fraction
 * for a fraction key that does not say about, or more than 20% apart. Never on precision alone: "3/4"
 * for 7/10 of Earth's surface is the model's.
 */
function grossMiss(kv: number, av: number, kn: WrittenNumber, an: WrittenNumber, question: string, plainPair: boolean, precision: number, about = false): boolean {
  const change = !signMatters(question);
  if (kv * av < 0 && !change && Math.abs(kv + av) <= precision * (1 + 1e-9)) return true;
  const k = change ? Math.abs(kv) : kv;
  const a = change ? Math.abs(av) : av;
  if (k !== 0 && a !== 0 && k * a > 0) {
    const lg = Math.log10(a / k);
    const n = Math.round(lg);
    if (n !== 0 && Math.abs(n) <= 3 && Math.abs(lg - n) <= 0.1) {
      return !(Math.abs(n) === 2 && (plainPair || /percent|%/i.test(question)));
    }
  }
  if (!givesNumbers(question) || ESTIMATE_RE.test(question)) return false;
  const fraction = (w: WrittenNumber) => w.form === "frac" || w.form === "mixed";
  // A different fraction, not the same one with the other sign (that is the sign rule above).
  if (fraction(kn) && fraction(an) && !about && !sameAmount(Math.abs(k), Math.abs(a))) return true;
  if (k * a <= 0) return k !== a;
  return Math.max(Math.abs(k), Math.abs(a)) / Math.min(Math.abs(k), Math.abs(a)) > 1.2 + 1e-9;
}

/** Two amounts of one kind, in the same base units. */
function compareAmounts(k: Quantity, a: Quantity, question: string): boolean | null {
  const diff = Math.abs(a.v - k.v);
  // Years against days or weeks: never exactly the same, never marked wrong; an "about" key may still match.
  const rough = k.calendar !== a.calendar;
  if (!rough && sameAmount(a.v, k.v)) {
    // The question asks for the key's unit and the answer gives the same amount in another: not converted.
    if (k.kind === "measure" && !sameAmount(a.f, k.f)) {
      const asked = askedUnit(question);
      if (asked && asked.dims === k.dims && sameAmount(asked.f, k.f)) return null;
    }
    return sameForm(k, a, question) ? true : null;
  }
  const mayReject = !a.approx && !a.guessed && !rough;
  const rel = k.v === 0 ? Infinity : diff / Math.abs(k.v);
  if (k.approx && rel <= 0.02 && diff <= Math.max(k.loose, a.loose) / 2 * (1 + 1e-9)) return true;
  // An estimate: within 10% of the key is right.
  if (ESTIMATE_RE.test(question) && !rough && rel <= 0.1) return sameForm(k, a, question) ? true : null;
  if (!mayReject || swappedReading(a, k.v)) return null;
  const answerHalf = (ASKS_ROUNDING_RE.test(question) ? a.loose : a.ulp) / 2;
  const plainPair = k.kind === "plain" && a.kind === "plain";
  return grossMiss(k.v, a.v, k.num, a.num, question, plainPair, Math.max(k.ulp / 2, answerHalf), k.approx) ? false : null;
}

/** A bare number for a key with a unit: "1.75" for $1.75 is right; "2.75" is wrong; "175" may be cents. */
function bareForUnit(k: Quantity, a: Quantity, question: string): boolean | null {
  if (ASKS_UNIT_RE.test(question)) return null;
  const written = k.v / k.f;
  if (sameAmount(a.v, written)) return !offersChoice(question) && !questionSays(question, written) ? true : null;
  if (k.approx || k.kind === "temperature" || a.approx || a.guessed) return null;
  const readings = k.kind === "percent" ? [1, 100] : k.kind === "money" ? [1, 0.01] : allUnits().filter((u) => u.dims === k.dims).map((u) => u.f);
  if (readings.length === 0) return null;
  const close = readings.some((g) => Math.abs(a.v * g - k.v) <= Math.max(a.loose * g / 2, k.ulp / 2, 0.05 * Math.abs(k.v)) || swappedReading(a, k.v / g));
  if (close) return null;
  // Not the key in any unit of its kind: read in the key's unit, wrong only when the miss is gross. A
  // percent key reads the answer as a part when that is nearer ("3/4" for 70% is 75%, a precision gap).
  const near = (g: number) => Math.abs(Math.log10(Math.abs(a.v * g / written)));
  const g = k.kind === "percent" && a.v !== 0 && written !== 0 && near(100) < near(1) ? 100 : 1;
  return grossMiss(written, a.v * g, k.num, a.num, question, false, Math.max(k.ulp / k.f, a.ulp * g) / 2) ? false : null;
}

/** Two quantities: right, wrong, or null when code cannot be sure. */
function compareQuantities(k: Quantity, a: Quantity, question: string): boolean | null {
  const mayReject = !a.approx && !a.guessed;
  if (k.kind === a.kind) {
    if (k.kind === "temperature") {
      // Another scale is never converted. A scale the key does not have ("90 degrees Celsius" for an
      // angle of 90°) is not the key's; leaving the key's scale out is, unless the question offers a
      // choice or says the number ("30 °C or 30 °F?").
      if (k.scale !== a.scale && (a.scale || offersChoice(question) || questionSays(question, k.v))) return null;
      const verdict = compareAmounts(k, a, question);
      return verdict === false && k.scale !== a.scale ? null : verdict;
    }
    if (k.kind === "measure" && k.dims !== a.dims) return mayReject && !a.abbrev ? false : null;
    // "3" on "How many fourths are in 3/4?": a bare count of the unit the question names.
    const counted = COUNT_UNIT_RE.exec(question);
    if (k.kind === "plain" && counted && !sameAmount(a.v, k.v)) {
      const m = COUNT_UNITS[counted[1].toLowerCase()];
      const isCount = (q: Quantity) => q.num.form === "int" && q.v >= 0;
      if (isCount(a) && sameAmount(a.v * m, k.v)) return ASKS_FORM_RE.test(question) ? null : true;
      return null;
    }
    return compareAmounts(k, a, question);
  }
  if (a.kind === "plain") return bareForUnit(k, a, question);
  if (k.kind === "plain") {
    if (a.kind === "percent") {
      // "45%" for 9/20 is the same part; "45%" for 45 is not, but may be what was meant.
      if (sameAmount(a.v / 100, k.v)) return ASKS_FORM_RE.test(question) ? null : true;
      if (sameAmount(a.v, k.v) || Math.abs(a.v / 100 - k.v) <= Math.max(k.ulp, a.ulp / 100) / 2 * (1 + 1e-9) || swappedReading(a, k.v * 100)) return null;
      return mayReject && grossMiss(k.v, a.v / 100, k.num, a.num, question, true, Math.max(k.ulp, a.ulp / 100) / 2) ? false : null;
    }
    if (a.kind === "measure") {
      const asked = askedUnit(question);
      if (!asked || asked.dims !== a.dims) return null;
      const key: Quantity = { ...k, kind: "measure", v: k.v * asked.f, ulp: k.ulp * asked.f, loose: k.loose * asked.f, f: asked.f, dims: asked.dims };
      return compareAmounts(key, a, question);
    }
    return null;
  }
  // Different kinds, each with its own unit ("$10" for 25%). A temperature may be any of them.
  if (k.kind === "temperature" || a.kind === "temperature") return null;
  return mayReject && !a.abbrev ? false : null;
}

// A clock time: "4:15 p.m.", "4 pm", "16:15". Minutes after midnight, one reading or, with no a.m./p.m.
// and an hour of 1 to 12, two.
const CLOCK_RE = /^(?:it's |it is |at )?(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\b\.?)?$/;
function clockMatch(s: string): RegExpExecArray | null {
  const m = CLOCK_RE.exec((s ?? "").normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'").replace(/!+$/, "").trim());
  return m && (m[2] !== undefined || m[3]) ? m : null;
}
function clockReadings(s: string): number[] | null {
  const m = clockMatch(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) return h >= 1 && h <= 12 ? [((h % 12) + (m[3] === "p" ? 12 : 0)) * 60 + min] : null;
  if (h > 23) return null;
  return h >= 13 || h === 0 ? [h * 60 + min] : [h * 60 + min, ((h + 12) % 24) * 60 + min];
}

/** A key that is a clock time: with a.m./p.m. or a 24-hour hour, or on a question about the time (it
 * says time, o'clock, noon or midnight, asks when, or gives a clock time: "in at 10:40"); never a ratio. */
function isClockKey(expected: string, question: string): boolean {
  if (/\bratio\b/i.test(question)) return false;
  const k = clockReadings(expected);
  return !!k && (k.length === 1 || /\btime\b|o'?clock|\bnoon\b|\bmidnight\b|\bwhen\b|\d:\d\d/i.test(question));
}

// A half of the day said after a time in words, and the hours (1-12) it can go with: "twelve in the
// morning" and "two at night" could be either half, so they are not read.
const DAY_HALVES: Array<{ words: string[]; pm: boolean; hours: (h: number) => boolean }> = [
  { words: ["am"], pm: false, hours: () => true },
  { words: ["pm"], pm: true, hours: () => true },
  { words: ["in", "the", "morning"], pm: false, hours: (h) => h <= 11 },
  { words: ["in", "the", "afternoon"], pm: true, hours: (h) => h === 12 || h <= 6 },
  { words: ["in", "the", "evening"], pm: true, hours: (h) => h >= 4 && h <= 11 },
  { words: ["at", "night"], pm: true, hours: (h) => h >= 7 && h <= 11 },
];
const PAST_WORDS = new Set(["past", "after"]);
const TO_WORDS = new Set(["to", "before", "till", "til", "of"]);

/**
 * A clock time in words, as clockReadings reads one in digits: "quarter after eleven", "half past
 * three", "ten to four", "twenty-five minutes past six", "eleven fifteen", "three oh five", "four
 * o'clock", "noon", "midnight", each maybe with "a.m."/"p.m.", "in the morning", "in the afternoon", "in
 * the evening" or "at night" after it. Null for anything else, "about half past three" included.
 */
function spokenClock(s: string): number[] | null {
  let w = answerWords(s);
  if (w[0] === "at") w = w.slice(1);
  if (w.length === 0) return null;
  const half = DAY_HALVES.find((d) => w.length > d.words.length && d.words.every((x, i) => w[w.length - d.words.length + i] === x));
  if (half) w = w.slice(0, w.length - half.words.length);
  const t = w.join(" ");
  // Noon and midnight are one time each, and take no half of the day.
  const fixed: Record<string, number> = { noon: 720, midday: 720, "12 noon": 720, midnight: 0, "12 midnight": 0 };
  if (t in fixed) return half ? null : [fixed[t]];
  const int = (x: string | undefined, lo: number, hi: number) => (x !== undefined && /^\d+$/.test(x) && +x >= lo && +x <= hi ? +x : null);
  let hour: number | null = null;  // 0-23 as said
  let minutes = 0;                 // after the hour; negative before it
  let anchor: number | null = null; // "quarter past noon": the hour is noon or midnight, one reading
  // "quarter past eleven", "ten to four", "25 minutes past 6".
  const m = w.length >= 3 ? w[0] === "quarter" ? 15 : w[0] === "half" ? 30 : int(w[0], 1, 30) : null;
  const rest = w[1] === "minutes" || w[1] === "minute" ? 2 : 1;
  if (m !== null && w.length === rest + 2 && (PAST_WORDS.has(w[rest]) || (TO_WORDS.has(w[rest]) && w[0] !== "half"))) {
    minutes = PAST_WORDS.has(w[rest]) ? m : -m;
    const h = w[rest + 1];
    if (h === "noon" || h === "midnight") anchor = h === "noon" ? 720 : 1440;
    else hour = int(h, 1, 12);
    if (hour === null && anchor === null) return null;
  } else if (w.length === 3 && w[1] === "o" && w[2] === "clock") {
    hour = int(w[0], 1, 12);                                      // "four o'clock"
  } else if (w.length === 1 && half) {
    hour = int(w[0], 1, 12);                                      // "four in the afternoon"
  } else if (w.length === 2) {
    hour = int(w[0], 0, 23);                                      // "eleven fifteen"
    minutes = int(w[1], 10, 59) ?? -1;
    if (minutes < 0) return null;
  } else if (w.length === 3 && (w[1] === "oh" || w[1] === "o")) {
    hour = int(w[0], 0, 23);                                      // "three oh five"
    minutes = int(w[2], 1, 9) ?? -1;
    if (minutes < 0) return null;
  } else {
    return null;
  }
  if (anchor !== null) return half ? null : [(anchor + minutes + 1440) % 1440];
  if (hour === null) return null;
  if (hour === 0 || hour >= 13) return half ? null : [(hour * 60 + minutes + 1440) % 1440];
  // On a 12-hour clock: 0-719 from twelve o'clock, then a.m. or p.m.
  const onDial = ((hour % 12) * 60 + minutes + 720) % 720;
  if (!half) return [onDial, onDial + 720];
  if (!half.hours(Math.floor(onDial / 60) || 12)) return null;
  return [onDial + (half.pm ? 720 : 0)];
}

/** The half of the day the question pins: it says a.m. or the morning, or p.m., the afternoon, the evening
 * or the night, and not both. */
function questionHalf(question: string): "am" | "pm" | null {
  const am = /\d\s*a\.?\s?m\b|\ba\.m\.|\bmorning\b/i.test(question);
  const pm = /\d\s*p\.?\s?m\b|\bp\.m\.|\b(?:afternoon|evening|night|tonight)\b/i.test(question);
  return am === pm ? null : am ? "am" : "pm";
}

/** How a clock time in digits is written: with a.m./p.m. ("half"), as a 24-hour time ("24": an hour of 0
 * or 13-23, or a leading zero), or neither ("bare": "4:15"). */
function clockForm(s: string): "half" | "24" | "bare" | null {
  const m = clockMatch(s);
  if (!m) return null;
  if (m[3]) return "half";
  const h = Number(m[1]);
  return h === 0 || h >= 13 || /^0\d/.test(m[1]) ? "24" : "bare";
}

// The question asks for a time written another way: "Write 4:15 p.m. in 24-hour time", "using the 24
// hour system", "as a 12-hour time", "in standard time", "using a.m. or p.m.".
const CLOCK_FORM_RE = /\b(?:24|12|twenty[- ]four|twelve)[- ]hour\b|\bmilitary time\b|\bstandard time\b|\ba\.?\s?m\.?\s*(?:or|\/)\s*p\.?\s?m\b/i;
const QUESTION_CLOCK_RE = /\b\d{1,2}(?::\d{2})?(?:\s*[ap]\.?\s?m\b\.?)?/gi;

/** The question asks for the key's time written another way: it says a form (CLOCK_FORM_RE), or it gives
 * the key's time of day in another form ("Write 16:15 in standard time" for 4:15 p.m.). */
function asksClockForm(question: string, expected: string): boolean {
  if (CLOCK_FORM_RE.test(question)) return true;
  const k = clockReadings(expected) ?? [];
  const form = clockForm(expected);
  return (question.match(QUESTION_CLOCK_RE) ?? []).some((t) => {
    const q = clockReadings(t);
    return !!q && q.some((x) => k.includes(x)) && clockForm(t) !== form;
  });
}

/**
 * Settles an answer when the key and the answer are each one quantity: true when the amounts are the
 * same, false when code is sure they differ, null otherwise (see the notes above).
 */
function settleQuantity(item: WrittenAnswer): boolean | null {
  if (isClockKey(item.expected, item.question)) {
    const k = clockReadings(item.expected)!;
    const digits = clockReadings(item.student);
    const a = digits ?? spokenClock(item.student);
    if (!a) return null;
    // The conversion is the answer, so a time in words, without its half of the day, or in another form
    // than the key's skips it ("4:15 p.m." echoed for 16:15); the model decides.
    if (asksClockForm(item.question, item.expected) && (!digits || a.length === 2 || (k.length === 1 && clockForm(item.student) !== clockForm(item.expected)))) return null;
    if (a.length === 1 && k.length === 1) {
      if (a[0] === k[0]) return true;
      // Wrong only when it is the key with a.m. and p.m. swapped, in digits; any other time is the model's.
      return digits && a[0] === (k[0] + 720) % 1440 ? false : null;
    }
    // Neither says the half of the day ("quarter past four" for 4:15): the same two times.
    if (a.length === 2 && k.length === 2) return a.every((x) => k.includes(x)) ? true : null;
    // The answer says the half and the key does not: the half the question says is its start time's, and
    // an elapsed time can cross noon or midnight ("1:30 a.m." for 1:30 on "starts at 11:30 a.m. and lasts
    // 2 hours"), so the model decides.
    if (a.length === 1) return null;
    // The key says the half and the answer does not: right only when the question pins that half
    // ("4:15" for 4:15 p.m. on "A film starts at 2:45 p.m. ..."). "4:15" alone could be a.m.
    return a.includes(k[0]) && questionHalf(item.question) === (k[0] < 720 ? "am" : "pm") ? true : null;
  }
  const k = parseQuantity(item.expected);
  if (!k || k.guessed) return null;
  const a = parseQuantity(item.student);
  return a ? compareQuantities(k, a, item.question) : null;
}

// ─── Settling ─────────────────────────────────────────────────────────────────

export interface WrittenAnswer {
  question: string;
  expected: string;
  student: string;
  type: string;
}

/**
 * True when code can tell the answer is the key; false when the key and the answer are each one
 * quantity and code can tell the amounts differ (settleQuantity); null when it cannot, and the model
 * decides. `isWord` says whether a word is a real word (the dictionary); without it, no misspelling is
 * accepted. `listed` says whether a word is in the English word list (wordlist.ts); without it, no
 * misspelt name is accepted. `senses` says what the dictionary has for a key's first and last words
 * (personNameWords), so that a place or a thing is not taken for a person's name (namesAThing).
 */
export function settleByCode(item: WrittenAnswer, isWord: (w: string) => boolean = () => true, listed: (w: string) => boolean = () => true, senses: (w: string) => WordSenses = () => NO_SENSES): boolean | null {
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
    const names: Names = { words: capitalisedWords(form), known: (w) => isWord(w) || listed(w) };
    if (sameWords(answer, key, isWord, rivalWords(item.question, key), names)) return true;
    if (sameNumberAndUnits(answer, key, item.question)) return true;
    if (sameFormula(answer, form)) return true;
    // Under a choice the surname may be what both sides share ("Theodore Roosevelt or Franklin Roosevelt?").
    for (const surname of choice ? [] : personSurnames(item.question, form, senses)) {
      if (sameWords(answer, surname, isWord, rivalWords(item.question, surname), names)) return true;
    }
  }
  // Last, so it never overrides an accept above: a quantity, right or wrong.
  return settleQuantity(item);
}

/**
 * The words settleByCode needs the dictionary for, so the caller can look them up first (the dictionary
 * is loaded asynchronously): each of the answer's words it would accept as a misspelling if it is not a
 * real word, the key word it would be a misspelling of, and every word one edit from the answer's
 * word; and the answer and key words of a misspelt name (misspeltNameCandidates). The caller counts a
 * word it did not look up as real, so a misspelling is never accepted on an answer word or a nearer word
 * it did not check.
 */
export function misspellingCandidates(item: WrittenAnswer): string[] {
  const answer = answerWords(item.student);
  const out = new Set<string>(misspeltNameCandidates(item));
  for (const form of keyForms(item.expected)) {
    const keys = [answerWords(form)];
    const person = personName(item.question, form);
    if (person) keys.push(...surnameForms(person));
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

/** The first and last words of each key form that may be a person's name: what settleByCode's `senses`
 * is asked about (namesAThing). */
export function personNameWords(item: WrittenAnswer): string[] {
  const out = new Set<string>();
  for (const form of keyForms(item.expected)) {
    const p = personName(item.question, form);
    if (!p) continue;
    out.add(firstWord(p));
    out.add(lastWord(p));
  }
  return [...out];
}

/**
 * The answer's words that settleByCode could take as a misspelt name, and the key's names they would be
 * misspellings of: the words it needs the English word list for (settleByCode's `listed`), and the
 * dictionary too. A name is in neither, so a misspelling that is a real word is never taken for a name.
 */
export function misspeltNameCandidates(item: WrittenAnswer): string[] {
  const answer = answerWords(item.student);
  const out = new Set<string>();
  for (const form of keyForms(item.expected)) {
    const names = capitalisedWords(form);
    if (names.size === 0) continue;
    const keys = [answerWords(form)];
    const person = personName(item.question, form);
    if (person) keys.push(...surnameForms(person));
    for (const key of keys) {
      if (key.length !== answer.length) continue;
      answer.forEach((w, i) => {
        if (!names.has(key[i]) || w === key[i] || key[i].length < MISSPELLING_MIN_LETTERS || editDistance(w, key[i]) > 2) return;
        out.add(w);
        out.add(key[i]);
      });
    }
  }
  return [...out];
}

// ─── A note for the model: the answer may be the key misspelt ─────────────────
//
// Code cannot accept a two-edit misspelling ("skelitin" for skeleton): two edits leave too many other
// words that close, and the rule leaked. gemma4:e2b fails those answers on every run, though e4b passes
// them. So code tells the model what it can see, and the model still decides: a note on the item,
// '"skelitin" may be a misspelling of "skeleton"'. The note is given only when the answer's word can be
// nothing but the key's word misspelt: no other word in the question is as close to it, it is not itself
// a real word, in WordNet or in the full English word list (or it is the key's word with one
// British/American spelling swap the dictionary lists as a synonym, "sulphur"), the key's word is in the dictionary, and no other real word is as close to it,
// another word's -ing or -ed form included. "geolagist" (one edit from geologist) for Biologist gets no
// note, nor "glucogan" (two edits from glucagon and from glycogen), nor "attatching" for Attacking (one
// edit from attaching).

/** The shortest key word a note is given for, at one edit and at two. */
export const HINT_MIN_LETTERS: Record<1 | 2, number> = { 1: 4, 2: 7 };

/** One of the answer's words that may be the key's word misspelt. */
export interface MisspeltWord { answer: string; key: string; edits: 1 | 2 }

/**
 * The answer's words that may be misspellings of the key's, for one of the key's forms the answer
 * follows word for word: every other word is the key's own (or its plural), and each of these is one or
 * two edits from the key's word. Empty when the answer is not the key with some words misspelt.
 */
export function misspeltKeyWords(item: WrittenAnswer): MisspeltWord[] {
  const answer = answerWords(item.student);
  for (const form of keyForms(item.expected)) {
    const key = answerWords(form);
    if (key.length !== answer.length) continue;
    const out: MisspeltWord[] = [];
    const fits = answer.every((w, i) => {
      const k = key[i];
      if (w === k || singular(w) === singular(k)) return true;
      if (isNumber(w) || isNumber(k)) return false;
      const edits = editDistance(singular(w), singular(k));
      if ((edits !== 1 && edits !== 2) || singular(k).length < HINT_MIN_LETTERS[edits]) return false;
      out.push({ answer: w, key: k, edits });
      return true;
    });
    if (fits && out.length > 0) return out;
  }
  return [];
}

/** What the note needs from the dictionary. */
export interface SpellingLookup {
  /** Whether a word is a real word: a WordNet headword or one of its forms. */
  isWord: (w: string) => boolean;
  /** Whether a word is in the full English word list (wordlist.ts), which has many words WordNet lacks. */
  listed: (w: string) => boolean;
  /** The one-word synonyms the dictionary lists for a real word ("sulphur": sulfur). */
  synonyms: (w: string) => string[];
  /** The real words at most `edits` edits from a word, other words' inflected forms included. */
  wordsNear: (w: string, edits: number) => string[];
}

// Letters one word has more of than the other, the larger side: never more than the edits between
// them, and quick, so most of a word list is ruled out before editDistance.
const counts = new Int32Array(32);
function letterGap(a: string, b: string): number {
  counts.fill(0);
  for (let i = 0; i < a.length; i++) counts[(a.charCodeAt(i) - 97) & 31]++;
  for (let i = 0; i < b.length; i++) counts[(b.charCodeAt(i) - 97) & 31]--;
  let more = 0, fewer = 0;
  for (const c of counts) { if (c > 0) more += c; else fewer -= c; }
  return Math.max(more, fewer);
}
const within = (h: string, w: string, edits: number) =>
  Math.abs(h.length - w.length) <= edits && h !== w && letterGap(h, w) <= edits && editDistance(h, w) <= edits;

/** The real words at most `edits` edits from a word, out of a word list. */
export function wordsWithin(words: readonly string[], w: string, edits: number): string[] {
  return words.filter((h) => within(h, w, edits));
}

/**
 * The spellings at most `edits` edits from a word that WordNet's suffix rules read back to a word of the
 * list: "attaching" from attach, "inhaling" from inhale. The word list holds headwords and irregular
 * forms only, and a misspelling is as often another word's -ing or -ed form ("attatching" is one edit
 * from attaching). Spellings only: the dictionary says which are real words.
 */
export function formsWithin(words: readonly string[], w: string, edits: number): string[] {
  const out = new Set<string>();
  for (const [suffix, ending] of SUFFIX_RULES) {
    const grow = suffix.length - ending.length;
    for (const h of words) {
      if (Math.abs(h.length + grow - w.length) > edits || h.length <= ending.length || !h.endsWith(ending)) continue;
      const f = h.slice(0, h.length - ending.length) + suffix;
      if (within(f, w, edits)) out.add(f);
    }
  }
  return [...out];
}

// The British and American spellings of one word, as one swap: [one spelling, the other, where]. A real
// word is noted only when it is the key's word with one of these swaps. WordNet's synonym sets alone
// also hold other forms and related words (bacterium for bacteria, earlier for earliest, quick for
// quickly, arena for area), so a synonym is not enough. "end" is the word's last letters (centre); "inside"
// is not the last letters (anaemia: a final "ae" is a Latin plural, algae).
const SPELLING_SWAPS: ReadonlyArray<readonly [string, string, "end" | "inside" | "any"]> = [
  ["our", "or", "any"], // colour, color
  ["ise", "ize", "any"], ["isa", "iza", "any"], ["isi", "izi", "any"], // organise, organisation, organising
  ["yse", "yze", "any"], ["ysi", "yzi", "any"], // analyse, analysing
  ["re", "er", "end"], // centre, center
  ["ae", "e", "inside"], ["oe", "e", "inside"], // anaemia, oestrogen
  ["ph", "f", "any"], // sulphur, sulfur
  ["ll", "l", "any"], // travelled, traveled
  ["ium", "um", "any"], // aluminium, aluminum
];

/** True when one word is the other with one British/American spelling swap ("aluminium", "aluminum"). */
export function spellingVariant(a: string, b: string): boolean {
  const swapsTo = (from: string, to: string) => {
    for (const [x, y, where] of SPELLING_SWAPS) {
      for (const [p, q] of [[x, y], [y, x]]) {
        for (let i = from.indexOf(p); i >= 0; i = from.indexOf(p, i + 1)) {
          const atEnd = i + p.length === from.length;
          if ((where === "end" && !atEnd) || (where === "inside" && atEnd)) continue;
          if (from.slice(0, i) + q + from.slice(i + p.length) === to) return true;
        }
      }
    }
    return false;
  };
  return a !== b && swapsTo(a, b);
}

// Prefixes that make a word its opposite or its lack: "unextinct", "abiotic", "nontoxic", "disagree".
const NEGATING_PREFIXES = ["un", "in", "im", "il", "ir", "a", "an", "de", "non", "dis", "anti", "counter", "mis"];

/**
 * True when the answer's word is the key's word with letters added at the front ("unextinct" for
 * extinct, "abiotic" for biotic), or a negating prefix the key's word does not start with on the key's
 * word one edit off ("atipical" for typical), or the other way round: the key's word is the answer's
 * with a negating prefix, the answer's word one edit off allowed ("matchable" for Unmatchable). Such a
 * word may mean the opposite, so it is never noted as a misspelling.
 */
export function prefixAdded(answer: string, key: string): boolean {
  const a = singular(answer), k = singular(key);
  if (a.length > k.length && a.endsWith(k)) return true;
  const negated = (x: string, y: string) =>
    NEGATING_PREFIXES.some((p) => x.startsWith(p) && !y.startsWith(p) && editDistance(x.slice(p.length), y) <= 1);
  return negated(a, k) || (k.length > a.length && negated(k, a));
}

// Affixes that name a contrasting thing, in groups: swapping one for another of its group makes another
// word, often the opposite ("hypoventilation" for Hyperventilation, "lipophobic" for Lipophilic,
// "radioprotector" for Radioprotection). Technical words like these are often missing from WordNet, so
// the dictionary cannot say the answer is a real word.
const CONTRAST_PREFIXES: ReadonlyArray<readonly string[]> = [
  ["hyper", "hypo"], ["inter", "intra", "extra"], ["macro", "micro"], ["kilo", "mega", "giga", "tera", "peta"],
  ["uni", "mono", "bi", "di", "tri", "tetra", "penta", "hexa", "hepta", "octa"], ["endo", "exo", "ecto"], ["in", "ex", "de", "en"], ["ana", "cata"],
];
const CONTRAST_SUFFIXES: ReadonlyArray<readonly string[]> = [
  ["philic", "phobic"], ["phile", "phobe"], ["philia", "phobia"], ["itis", "osis"], ["ectomy", "otomy", "ostomy"],
  ["ane", "ene", "yne"], ["ate", "ite", "ide"], ["ase", "ose"],
  ["tion", "tor"], ["ion", "or"], ["gram", "graph"], ["er", "ee"],
];

/**
 * True when the answer's word and the key's differ only in a leading or trailing affix, one swapped for
 * another of its contrast group ("intramuscular" for Intermuscular, "gigawatt" for megawatt, "ethene" for
 * ethane). Such a word may name another thing, so it is never noted as a misspelling.
 */
export function affixSwapped(answer: string, key: string): boolean {
  const a = singular(answer), k = singular(key);
  const swapped = (groups: ReadonlyArray<readonly string[]>, rest: (w: string, x: string) => string | null) =>
    groups.some((g) => g.some((x) => {
      const r = rest(a, x);
      return r !== null && g.some((y) => y !== x && rest(k, y) === r);
    }));
  return swapped(CONTRAST_PREFIXES, (w, x) => (w.startsWith(x) ? w.slice(x.length) : null)) ||
    swapped(CONTRAST_SUFFIXES, (w, x) => (w.endsWith(x) ? w.slice(0, w.length - x.length) : null));
}

/** True when the key writes this word with two or more capitals: an acronym or a symbol ("NADP", "ATP"). */
function inCapitals(expected: string, word: string): boolean {
  return (expected.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [])
    .some((t) => t.toLowerCase() === word && (t.match(/\p{Lu}/gu) ?? []).length >= 2);
}

// Closed-class words (pronouns, determiners, prepositions, conjunctions, auxiliaries) WordNet does not
// list, or lists only in part. Each is a real word: never a misspelling, and a rival to one ("wheather" is
// as close to whether as to weather).
const FUNCTION_WORDS = new Set([
  "i", "me", "my", "mine", "myself", "you", "your", "yours", "yourself", "yourselves", "he", "him", "his", "himself",
  "she", "her", "hers", "herself", "it", "its", "itself", "we", "us", "our", "ours", "ourselves", "they", "them",
  "their", "theirs", "themselves", "this", "that", "these", "those", "who", "whom", "whose", "which", "what",
  "whatever", "whichever", "whoever", "where", "when", "why", "how", "whereas", "whereby", "wherever", "whenever",
  "a", "an", "the", "some", "any", "each", "every", "either", "neither", "both", "few", "many", "much", "more",
  "most", "several", "such", "no", "none", "nor", "not", "about", "above", "across", "after", "against", "along",
  "among", "amongst", "around", "at", "before", "behind", "below", "beneath", "beside", "besides", "between",
  "beyond", "by", "despite", "down", "during", "except", "for", "from", "in", "inside", "into", "like", "near",
  "of", "off", "on", "onto", "out", "outside", "over", "past", "since", "through", "throughout", "till", "to",
  "toward", "towards", "under", "underneath", "until", "unto", "up", "upon", "with", "within", "without", "and",
  "but", "or", "so", "yet", "because", "although", "though", "unless", "whether", "while", "whilst", "if", "than",
  "then", "there", "here", "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have",
  "has", "had", "can", "could", "shall", "should", "will", "would", "may", "might", "must", "ought",
  // Contractions typed without the apostrophe ("theyre" is not a misspelling of there).
  "theyre", "youre", "whos", "lets", "thats", "whats", "theres", "dont", "doesnt", "cant", "wont", "isnt",
  "wasnt", "arent", "werent", "hasnt", "havent", "hadnt", "didnt", "shouldnt", "couldnt", "wouldnt", "im", "ive",
  "id", "ill", "youve", "weve", "theyve", "aint",
]);

/**
 * A note for the grader model when the answer may be the key with words misspelt, or null. Never a
 * verdict: the model still decides. Null when any misspelt word could be another word: the key's word
 * with letters added at the front or a negating prefix taken off (prefixAdded: "unextinct" may be the
 * opposite), the key's word with a contrasting affix swapped (affixSwapped: "hypoventilation"), a key word
 * written in capitals (an acronym or symbol: "NADPH" for NADP is another molecule), a word of the question
 * as close to it as the key's word, a function word or a function word as close, a real word itself,
 * in WordNet or in the full English word list ("chalcogens" for Halogens, "granivore" for Carnivore),
 * unless it is the key's word with one British/American spelling swap and the dictionary lists the two
 * as synonyms, a key word the dictionary does not have (names of places and people), or another real
 * word as close to it.
 */
export function misspellingNote(item: WrittenAnswer, dict: SpellingLookup): string | null {
  const words = misspeltKeyWords(item);
  if (words.length === 0) return null;
  const rivals = [...rivalWords(item.question, answerWords(item.expected)), ...FUNCTION_WORDS];
  for (const { answer, key, edits } of words) {
    if (!dict.isWord(key) || prefixAdded(answer, key) || affixSwapped(answer, key) || FUNCTION_WORDS.has(answer)) return null;
    if (inCapitals(item.expected, key)) return null;
    const a = singular(answer);
    if (rivals.some((r) => r !== key && editDistance(a, singular(r)) <= edits)) return null;
    if (dict.isWord(answer) || dict.listed(answer) || dict.listed(a)) {
      if (!spellingVariant(answer, key) || !dict.synonyms(answer).includes(key)) return null;
      continue;
    }
    if (dict.wordsNear(a, edits).some((n) => singular(n) !== singular(key) && stem(n) !== stem(key))) return null;
  }
  return words.map((w) => `"${w.answer}" may be a misspelling of "${w.key}"`).join("; ");
}
