// Does a student's answer match an answer key? Decided by code where code can decide, and "undecided"
// everywhere else (answerCheck.ts then asks a structured grading call). Pure, no model, no Tauri.
//
// The rule both ways is the same: a confident "match" or "mismatch" only when the forms are plain
// enough that a string or number compare cannot be fooled. A false "mismatch" tells a child a right
// answer is wrong, which is as bad as praising a wrong one, so anything in doubt is "undecided":
//   - match: the same words once cue phrases ("I think it's", "the answer is") are off; the same number
//     (digits or words: "72", "seventy-two", "it's 72", "72 cm"); the same lettered option or yes/no.
//   - mismatch: the key is one plain number and the student's answer states plain numbers, none of them
//     the key or a rounding of it, with no unit that could be a conversion; a different lettered
//     option; the opposite yes/no.
//   - undecided: fractions, percents, times, money, "half", ranges, powers, a different unit, an answer
//     that names the key's number among others, a text answer in other words.
// Numbers the question itself holds ("7 x 9") are not read as the student's answer.

export type KeyMatch = "match" | "mismatch" | "undecided";

export interface CompareContext {
  /** The question the key answers. Its numbers are not counted as the student's answer. */
  question?: string;
  /** Lettered options the tutor offered, letter (upper case) → option text. */
  options?: ReadonlyMap<string, string>;
}

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────────

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
const isNumberWord = (w: string) => w in ONES || w in TENS || w in SCALES;

export interface FoundNumber {
  value: number;
  /** Index in the text where the number starts, and where it ends. */
  from: number;
  to: number;
  /** Digits after the decimal point, for rounding. */
  decimals: number;
  /** A lone "one", which is as often a pronoun ("the one on the left") as a number. */
  loneOne?: true;
}

const DIGITS = /(?<![\w.,])([-−])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\d])/g;
const WORD = /[a-z]+/gi;

/** Every plain number in `text`, in order: digits ("1,000", "-3", "3.14") and number words ("seventy-two"). */
export function numbersIn(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(DIGITS)) {
    const negative = !!m[1] && (m.index === 0 || /[\s(=:]/.test(text[m.index - 1]));
    const digits = m[2].replace(/,/g, "");
    const value = Number(`${digits}${m[3] ? `.${m[3]}` : ""}`);
    if (!Number.isFinite(value)) continue;
    const from = m.index + (m[1] && !negative ? 1 : 0);
    out.push({ value: negative ? -value : value, from, to: m.index + m[0].length, decimals: m[3]?.length ?? 0 });
  }
  // Number words: runs like "seventy-two", "one hundred and five", "negative six".
  const words = [...text.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), from: m.index!, to: m.index! + m[0].length }));
  for (let i = 0; i < words.length; i++) {
    if (!isNumberWord(words[i].w)) continue;
    let j = i;
    const run: string[] = [];
    while (j < words.length) {
      const gap = text.slice(words[j - 1]?.to ?? words[j].from, words[j].from);
      if (j > i && !/^[\s-]*$/.test(gap)) break;
      if (isNumberWord(words[j].w)) run.push(words[j].w);
      else if (words[j].w === "and" && j + 1 < words.length && isNumberWord(words[j + 1].w) && run.length && SCALES[run[run.length - 1]] !== undefined) { /* "hundred and five" */ }
      else break;
      j++;
    }
    let total = 0;
    let current = 0;
    for (const w of run) {
      if (w in ONES) current += ONES[w];
      else if (w in TENS) current += TENS[w];
      else if (w === "hundred") current = (current || 1) * 100;
      else { total += (current || 1) * SCALES[w]; current = 0; }
    }
    const before = words[i - 1];
    const negative = !!before && before.w === "negative" && /^\s+$/.test(text.slice(before.to, words[i].from));
    const value = total + current;
    out.push({
      value: negative ? -value : value,
      from: negative ? before.from : words[i].from,
      to: words[j - 1].to,
      decimals: 0,
      ...(run.length === 1 && run[0] === "one" ? { loneOne: true as const } : {}),
    });
    i = j - 1;
  }
  return out.sort((a, b) => a.from - b.from);
}

const agree = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const roundTo = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
/** `x` is `k` rounded (or `k` is `x` rounded) to the places one of them gives, but not equal. */
const approximates = (x: FoundNumber, k: FoundNumber) =>
  !agree(x.value, k.value) && (agree(roundTo(k.value, x.decimals), x.value) || agree(roundTo(x.value, k.decimals), k.value));

// A form a plain number compare could misread: fractions, percents, times and ratios, money, ranges,
// powers and roots, decimal commas, pi, and the words for parts.
const NOT_PLAIN = /\d\s*\/\s*\d|%|\bpercent\b|\d\s*:\s*\d|[$£€¢]|\bcents?\b|\bdollars?\b|\d\s*(?:[–—]|-\s*\d|\bto\b\s*\d)|\^|[²³√]|\bsquare root\b|\d,\d{1,2}(?!\d)|\bpi\b|π|\b(?:half|halves|quarters?|thirds?|fourths?|fifths?|sixths?|eighths?|tenths?|hundredths?|point)\b|\be\d/i;

// ── Units ───────────────────────────────────────────────────────────────────────────────────────

const UNIT: Record<string, string> = {
  mm: "millimeter", millimeter: "millimeter", millimetre: "millimeter",
  cm: "centimeter", centimeter: "centimeter", centimetre: "centimeter",
  m: "meter", meter: "meter", metre: "meter",
  km: "kilometer", kilometer: "kilometer", kilometre: "kilometer",
  in: "inch", inch: "inch", inches: "inch", ft: "foot", foot: "foot", feet: "foot",
  yd: "yard", yard: "yard", mi: "mile", mile: "mile",
  mg: "milligram", milligram: "milligram", g: "gram", gram: "gram", kg: "kilogram", kilogram: "kilogram",
  lb: "pound", lbs: "pound", pound: "pound", oz: "ounce", ounce: "ounce", ton: "ton", tonne: "ton",
  ml: "milliliter", milliliter: "milliliter", millilitre: "milliliter", l: "liter", liter: "liter", litre: "liter",
  cup: "cup", gallon: "gallon", quart: "quart", pint: "pint",
  s: "second", sec: "second", second: "second", min: "minute", minute: "minute", h: "hour", hr: "hour", hour: "hour",
  day: "day", week: "week", month: "month", year: "year",
  degree: "degree", "°": "degree", "°c": "degree celsius", "°f": "degree fahrenheit", celsius: "degree celsius", fahrenheit: "degree fahrenheit",
};
const singular = (w: string) =>
  w in UNIT ? w : w.endsWith("es") && w.slice(0, -2) in UNIT ? w.slice(0, -2) : w.endsWith("s") && w.slice(0, -1) in UNIT ? w.slice(0, -1) : w;

/** The unit written right after a number (`at` is where the number ends), normalized, or null. */
export function unitAfter(text: string, at: number): string | null {
  const m = /^\s*(?:(square|sq\.?|cubic|cu\.?)\s+)?(°[cf]?|[a-z]+)\.?(\s*(?:\^?[23]|[²³]))?(?![a-z])/i.exec(text.slice(at));
  if (!m) return null;
  const base = UNIT[singular(m[2].toLowerCase())];
  if (!base) return null;
  const power = m[3] ? (/[2²]/.test(m[3]) ? "square" : "cubic") : m[1] ? (/^sq/i.test(m[1]) ? "square" : "cubic") : "";
  return power ? `${power} ${base}` : base;
}

// ── Answers ─────────────────────────────────────────────────────────────────────────────────────

// Words around an answer that are not the answer: "I think it's 72", "the answer is B", "is it 9?".
const CUE = /^(?:(?:um+|uh+|hmm+|well|so|ok(?:ay)?|oh|i think|i guess|i believe|i'?m pretty sure|maybe|probably|is it|it'?s|it is|the answer is|my answer is|answer|i got|i get|i'?d say|that'?s|that is|that would be|it would be|it equals|equals)\b[\s,:=]*)+(?=\S)/i;

/** The answer with leading cue words, surrounding quotes and closing punctuation taken off. */
export function bareAnswer(text: string): string {
  let t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').trim();
  t = t.replace(/^[a-z]\s*=\s*/i, "");
  const cue = CUE.exec(t);
  // Only take the cue off when what is left is not itself empty or a lone letter the cue ate.
  if (cue && cue[0].length < t.length) t = t.slice(cue[0].length);
  return t.replace(/^["'`]+|["'`]+$/g, "").replace(/[\s.!?,;:]+$/, "").trim();
}

const normText = (s: string) =>
  bareAnswer(s).toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const LETTER = /^\(?([a-f])\)?[.):]?$/i;
const LABELLED = /^\(?([a-f])[).:]\s+(.+)$/i;

/** The option text an answer names: "B", "(b)", "B) whale" → "whale"; else null. */
function optionText(answer: string, options?: ReadonlyMap<string, string>): string | null {
  if (!options?.size) return null;
  const t = bareAnswer(answer);
  const letter = LETTER.exec(t)?.[1] ?? LABELLED.exec(t)?.[1];
  if (letter) return options.get(letter.toUpperCase()) ?? null;
  const lower = t.toLowerCase();
  for (const text of options.values()) if (text.toLowerCase() === lower) return text;
  return null;
}

const YES = new Set(["yes", "true", "yep", "yeah"]);
const NO = new Set(["no", "false", "nope"]);

/** The key's value when the key is one plain number, with at most a unit or three words after it. */
function keyNumber(key: string): { n: FoundNumber; unit: string | null } | null {
  const t = bareAnswer(key);
  if (NOT_PLAIN.test(t)) return null;
  const nums = numbersIn(t);
  if (nums.length !== 1) return null;
  const [n] = nums;
  const rest = `${t.slice(0, n.from)} ${t.slice(n.to)}`.replace(/[()[\],.;:!?]/g, " ").trim();
  if (rest && rest.split(/\s+/).length > 3) return null;
  return { n, unit: unitAfter(t, n.to) };
}

/**
 * The student's answer when it is one value and nothing else: "72", "seventy-two", "it's 72?",
 * "72 cm", "x = 4", "I think it's 72 stickers". Null otherwise.
 */
function loneValue(answer: string): { n: FoundNumber; unit: string | null; text: string } | null {
  const t = bareAnswer(answer);
  const nums = numbersIn(t);
  if (nums.length !== 1) return null;
  const [n] = nums;
  if (n.from !== 0) return null;
  const rest = t.slice(n.to).trim();
  if (rest && (rest.split(/\s+/).length > 3 || /\d/.test(rest))) return null;
  return { n, unit: unitAfter(t, n.to), text: t };
}

const unitsDiffer = (a: string | null, b: string | null) => !!a && !!b && a !== b;

/**
 * Whether `student` gives the answer `key` names (see the file comment for the rules). Never "match"
 * or "mismatch" on a doubt.
 */
export function compareToKey(key: string, student: string, ctx: CompareContext = {}): KeyMatch {
  if (!key.trim() || !student.trim()) return "undecided";

  // Lettered options: both sides naming an option decides it.
  const keyOption = optionText(key, ctx.options);
  const studentOption = optionText(student, ctx.options);
  if (keyOption !== null && studentOption !== null) return keyOption === studentOption ? "match" : "mismatch";

  const k = normText(keyOption ?? key);
  const s = normText(studentOption ?? student);
  if (k && k === s) return "match";

  // Yes / no, true / false, as the whole answer.
  if ((YES.has(k) || NO.has(k)) && (YES.has(s) || NO.has(s))) return YES.has(k) === YES.has(s) ? "match" : "mismatch";

  const keyed = keyNumber(key);
  if (!keyed || NOT_PLAIN.test(bareAnswer(student))) return "undecided";
  const kv = keyed.n;

  const lone = loneValue(student);
  if (lone) {
    if (agree(lone.n.value, kv.value)) return unitsDiffer(lone.unit, keyed.unit) ? "undecided" : "match";
    if (approximates(lone.n, kv) || unitsDiffer(lone.unit, keyed.unit)) return "undecided";
    return "mismatch";
  }

  // An answer in a sentence: the numbers the student wrote that the question does not hold.
  const asked = new Set(numbersIn(ctx.question ?? "").map((n) => n.value));
  const text = bareAnswer(student);
  const all = numbersIn(text).filter((n) => !n.loneOne);
  const theirs = all.filter((n) => !asked.has(n.value));
  if (!theirs.length) return "undecided";
  if (theirs.some((n) => agree(n.value, kv.value))) {
    const distinct = new Set(theirs.map((n) => n.value));
    const last = all[all.length - 1];
    return distinct.size === 1 || agree(last.value, kv.value) ? "match" : "undecided";
  }
  if (theirs.some((n) => approximates(n, kv))) return "undecided";
  if (theirs.some((n) => unitsDiffer(unitAfter(text, n.to), keyed.unit))) return "undecided";
  return "mismatch";
}

// ── Options in the tutor's message ──────────────────────────────────────────────────────────────

const LINE_OPTION = /^[ \t]*(?:[-*•>][ \t]*)?(?:\*\*)?\(?([A-F])(?:\)|\.|:)(?:\*\*)?[ \t]+(.+?)[ \t]*$/gm;
const INLINE_OPTION = /(?<=\s|^)\(?([A-F])\)[ \t]+(.+?)(?=[ \t]+\(?[A-F]\)[ \t]|[?\n]|$)/g;

/** The lettered options in the tutor's message (at least A and B), letter → text; empty when none. */
export function optionsIn(message: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const re of [LINE_OPTION, INLINE_OPTION]) {
    for (const m of message.matchAll(re)) {
      const letter = m[1].toUpperCase();
      if (!found.has(letter)) found.set(letter, m[2].replace(/\*\*/g, "").replace(/[.;,]$/, "").trim());
    }
    if (found.has("A") && found.has("B")) break;
    found.clear();
  }
  return found;
}
