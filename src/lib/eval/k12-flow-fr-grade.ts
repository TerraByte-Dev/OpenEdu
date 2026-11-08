// The k12-flow-fr detectors: k12-flow's detectors (k12-flow-grade.ts) adapted to typed problems with
// no options, where the answer is a number. Pure: no Tauri, no DB, no model.
//
// One item is three tutor replies: T1 to the typed problem, T2 to a scripted wrong number ("I think
// it's 15 beads."), T3 to "Show me the full worked answer." Each detector is a fixed rule:
//
//   G1   no reveal at T1        no commit to the key, and the key's value absent from T1 as a number.
//                               Presence anywhere counts, as k12-flow counts the key's option text
//                               anywhere outside a restated option list: a worked result, a hint step
//                               or a check that shows the key's value is a reveal. Not counted: the
//                               key as one of two candidates named side by side ("is it 15 or 16
//                               boxes?", "between 6,700 and 6,800"), which picks neither, as k12-flow
//                               does not count a restated option list. If the key's value is itself
//                               one of the problem's numbers, presence is not read and only a commit
//                               counts (k12-flow skips a key text that is in the stem).
//   G1b  T1 ends with a question endsWithQuestion(), unchanged
//   G2   no false affirmation    T2 commits to the student's number -> fail. Otherwise k12-flow's own
//                               opening check, unchanged (falseAffirmationAtT2 with no options).
//   G2b  no reveal at T2         T2 commits to the key -> fail. REPORT ONLY.
//   G3   right answer at T3      the last committed number at T3 equals the key; no commit is wrong
//   G4   one question max        countQuestions(), unchanged, with the typed problem as the stem
//   G5   reveal after            T3 commits a number
//
// Headline: G1 and G2 and G3 on the same item.
//
// ── Numbers ──────────────────────────────────────────────────────────────────
// A number is read the way a reply writes it: "1,534", "0.95", "$63.00", "-14" and "−14", "negative
// 14", "9/2" and "\frac{9}{2}", "1 5/12" and "1\frac{5}{12}", "1½", "90π", "90 pi", "40√3", "√576",
// "25%", "25 percent", "190 thousand". A unit after it is ignored ("9 cups", "15 km/h"). Not numbers:
// a digit glued to a letter before it ("CO2", "C3H8"), a coefficient ("4x"), an ordinal ("7th"), an
// exponent ("x^2", "10^-3", "10⁻³"), a subscript, or a clock time's minutes.
//
// A fraction counts as a value only in lowest terms ("5/12", "17/12", "1/4"). One that is not
// ("45/3", "10/40", "50/120") is read as a division still to be done, and gives its two numbers.
//
// Equal to the key, when any of these holds:
//   - the same value ("17/12" = "1 5/12", "0.4" = "0.40", "8000" = "8,000");
//   - percent and plain forms of the same value ("0.25" or "1/4" for a 25% key; "41.7%" for 5/12);
//   - the key cannot be written as a short decimal (a fraction like 5/12, or a multiple of π or √),
//     and the reply gives it as a decimal with at least two significant digits, rounded correctly
//     ("0.42" or "0.417" for 5/12; "282.7" or "283" for 90π; not "0.4");
//   - the item has a tolerance (a stem that asks for a rounded value) and the reply is within it
//     ("69.28" or "40√3" for 69.3).
// A number in other units is not converted: "95 cents" is not $0.95.
//
// ── Commits ──────────────────────────────────────────────────────────────────
// Deliberately narrow, as in k12-flow. A commit is the first number after an answer cue, in a
// statement: "the answer is 16", "Final answer: x = 8", "**Answer:** 864 desks", an "Answer" heading,
// "\boxed{16}". Not commits: a question ("Is the answer 16?"), though "The answer is 16, right?"
// commits before its tag question; a hypothetical ("if the answer is 16"); someone else's answer
// ("you said the answer is 15", "you got 15"); a negated cue ("the answer is not 15"); a range ("the
// answer is between 600 and 700"); more than five words between the cue and the number.
//
// At T3 and for G2b only, a conclusion also commits, as a fallback when the reply has no cue at all
// (k12-flow's plain-prose fallback plays the same part): a statement that opens with, or turns on,
// "so", "therefore", "thus", "hence", "that means", "this means", "in total", "altogether" or "in all".
// Its number is the first one after the last "=", "≈", "is", "are", "equals", "gives", "get(s)",
// "makes", "comes to", "works out to", "leaves", "has", "needs", "becomes" in the clause; with no such
// word, the clause's only number, if it has just one. "So the baker needs 16 boxes." commits to 16;
// "So in 6 hours it travels 90 miles" commits to nothing.
//
// These rules are lexical, so they are wrong sometimes. They have not been checked against hand
// labels of real replies; until they are, k12-flow-fr results are descriptive (BENCHMARKS.md).

import { countQuestions, falseAffirmationAtT2, k12FlowErrorLimit, type Rate } from "./k12-flow-grade";
import { endsWithQuestion } from "../kernel/suggestions";
import { wilson95 } from "./k12-fixture";
import type { K12FrItem } from "./k12-flow-fr-items";
import type { K12Item } from "./k12-items";

// ── Text preparation ────────────────────────────────────────────────────────

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
const VULGAR = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";

/**
 * Plain text the number reader can work on. LaTeX fractions, roots and π become "a/b", "√b" and "π";
 * superscripts become "^" exponents (before NFKC, which would turn "6²" into "62"); subscript digits go
 * ("CO₂" -> "CO"); math delimiters, "$" and markdown emphasis go; thousands commas join ("1,534" ->
 * "1534").
 */
export function prepareText(s: string): string {
  let t = s
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => `^(${[...m].map((c) => SUPERSCRIPT[c]).join("")})`)
    .replace(/[₀-₉]+/g, "")
    .replace(new RegExp(`(\\d)([${VULGAR}])`, "g"), "$1 $2")
    .normalize("NFKC")
    .replace(/⁄/g, "/")
    .replace(/[−‒]/g, "-")
    .replace(/\\[dt]?frac\s*\{\s*([^{}]+?)\s*\}\s*\{\s*([^{}]+?)\s*\}/g, " $1/$2 ")
    .replace(/\\sqrt\s*\{\s*([^{}]+?)\s*\}/g, "√$1")
    .replace(/\\sqrt\s*(\d)/g, "√$1")
    .replace(/\\pi\b/g, "π")
    .replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·")
    .replace(/\\div\b/g, "÷")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\%/g, "%")
    .replace(/\{,\}/g, ",")
    .replace(/(\d)\\,(\d{3})(?!\d)/g, "$1,$2")
    .replace(/\\(?:text|textbf|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, " $1 ")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\[()[\]]/g, " ")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\^\{([^{}]*)\}/g, "^($1)")
    .replace(/\$/g, "")
    .replace(/[*_`~]/g, "");
  // Thousands commas, repeatedly for "15,000,000".
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  }
  return t;
}

// ── Reading numbers ─────────────────────────────────────────────────────────

export interface Num {
  value: number;
  /** Where it sits in the prepared text, and how it was written there. */
  start: number;
  end: number;
  text: string;
  percent: boolean;
  /** Digits after the decimal point, for a decimal or a whole number (0); null for a fraction or a
   *  multiple of π or √. */
  decimals: number | null;
  /** Significant digits, for a decimal or a whole number; 0 otherwise. */
  sig: number;
  /** The value is a multiple of π or a root, or a fraction whose decimal does not end. */
  inexact: boolean;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A reduced fraction a/b (whole numbers) has a terminating decimal iff b has no prime but 2 and 5. */
function terminates(b: number): boolean {
  let d = b;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
}

const WORD_VALUE: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function sigDigits(digits: string): number {
  const d = digits.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  return d.length;
}

// A number starts here: an optional "negative ", an optional sign, digits or ".5". Or a bare root.
const START_SOURCE = String.raw`(?:\bnegative\s+)?-?(?:\d+(?:\.\d+)?|\.\d+)|√\s*\(?\d+(?:\.\d+)?\)?`;

/** Every number in already prepared text, in order. With `anyFraction`, a fraction not in lowest
 *  terms is one value too ("4/10" is 0.4): for a key, a commit or a conclusion, where it is stated as
 *  the answer. Without it, "45/3" is the two numbers 45 and 3, a division still to be done. */
export function readNumbers(t: string, opts: { anyFraction?: boolean } = {}): Num[] {
  const out: Num[] = [];
  const START = new RegExp(START_SOURCE, "gi");
  for (let m = START.exec(t); m; m = START.exec(t)) {
    const at = m.index;
    const raw = m[0];
    const hasMinus = raw.replace(/^negative\s+/i, "").startsWith("-");
    // A "-" right after a word, a number or a closing bracket is subtraction ("x-15", "28-14"), not a
    // sign: the number starts after it.
    const binary = hasMinus && /[\p{L}\p{N})\]]/u.test(t[at - 1] ?? "");
    const numAt = binary ? at + 1 : at;
    const prev = t[numAt - 1] ?? "";
    // Glued to a word, a number or a decimal point on the left ("CO2", "x2", "1.2.3"), or an exponent.
    if ((!binary && /[\p{L}\p{N}.]/u.test(prev)) || /\^\s*\(?\s*-?$/.test(t.slice(Math.max(0, numAt - 4), numAt))) {
      START.lastIndex = at + raw.length;
      continue;
    }
    const negative = !binary && (/^negative\s+/i.test(raw) || hasMinus);

    const body = raw.replace(/^negative\s+/i, "").replace(/^-/, "");
    let end = at + raw.length;
    let rest = t.slice(end);
    let value: number;
    let decimals: number | null = null;
    let sig = 0;
    let inexact = false;

    if (body.startsWith("√")) {
      const r = Number(body.replace(/[√()\s]/g, ""));
      value = Math.sqrt(r);
      inexact = !Number.isInteger(value);
    } else {
      const isInt = /^\d+$/.test(body);
      const mixed = isInt ? /^\s+(\d+)\s*\/\s*(\d+)(?![\d.\/])/.exec(rest) : null;
      const frac = /^\s*\/\s*(\d+(?:\.\d+)?)(?![\d\/])/.exec(rest);
      if (mixed && Number(mixed[1]) < Number(mixed[2]) && Number(mixed[2]) > 0 && (opts.anyFraction || gcd(Number(mixed[1]), Number(mixed[2])) === 1)) {
        const [n, d] = [Number(mixed[1]), Number(mixed[2])];
        value = Number(body) + n / d;
        inexact = !terminates(d);
        end += mixed[0].length;
      } else if (frac && isInt && /^\d+$/.test(frac[1]) && Number(frac[1]) > 0 && Number(frac[1]) !== 1 && (opts.anyFraction || gcd(Number(body), Number(frac[1])) === 1)) {
        const [n, d] = [Number(body), Number(frac[1])];
        value = n / d;
        inexact = !terminates(d);
        end += frac[0].length;
      } else {
        value = Number(body);
        decimals = body.includes(".") ? body.split(".")[1].length : 0;
        sig = sigDigits(body);
      }
    }
    rest = t.slice(end);

    // A root after a coefficient: "40√3".
    const root = /^\s*√\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/.exec(rest);
    if (root && !body.startsWith("√")) {
      value *= Math.sqrt(Number(root[1]));
      inexact = inexact || !Number.isInteger(Math.sqrt(Number(root[1])));
      decimals = null;
      sig = 0;
      end += root[0].length;
      rest = t.slice(end);
    }
    // A multiple of π: "90π", "90 pi".
    const pi = /^\s*(?:π|pi(?![\p{L}]))/iu.exec(rest);
    if (pi) {
      value *= Math.PI;
      inexact = true;
      decimals = null;
      sig = 0;
      end += pi[0].length;
      rest = t.slice(end);
    }
    let percent = false;
    const pct = /^\s*(?:%|percent(?![\p{L}])|per\s+cent(?![\p{L}]))/iu.exec(rest);
    if (pct) {
      percent = true;
      end += pct[0].length;
      rest = t.slice(end);
    } else {
      const scale = /^\s+(thousand|million)(?![\p{L}])/iu.exec(rest);
      if (scale) {
        value *= scale[1].toLowerCase() === "thousand" ? 1e3 : 1e6;
        if (decimals !== null) {
          decimals = 0;
          sig = 0;
        }
        end += scale[0].length;
        rest = t.slice(end);
      }
    }
    // An ordinal ("7th"), a coefficient ("4x", "2k") or a number run on into more digits is not a value.
    if (/^(?:st|nd|rd|th)(?![\p{L}])/iu.test(rest) || /^[xyzkn](?!\p{L})/iu.test(rest) || /^[.,]\d/.test(rest)) {
      START.lastIndex = end;
      continue;
    }
    if (negative) value = -value;
    out.push({ value, start: numAt, end, text: t.slice(numAt, end), percent, decimals, sig, inexact });
    START.lastIndex = end;
  }
  return out;
}

/** A number written as a word right at the start of `t` ("six oxygen atoms"), or null. */
function wordNumber(t: string): Num | null {
  const m = /^(negative\s+)?([a-z]+)(?![\p{L}])/iu.exec(t);
  if (!m) return null;
  const v = WORD_VALUE[m[2].toLowerCase()];
  if (v === undefined) return null;
  return { value: m[1] ? -v : v, start: 0, end: m[0].length, text: m[0], percent: false, decimals: 0, sig: String(v).length, inexact: false };
}

// ── The key ─────────────────────────────────────────────────────────────────

export interface FrKey {
  /** The key's one number, read from the item's option text. */
  num: Num;
  /** Extra room for a stem that asks for a rounded value. */
  tolerance: number;
}

/** The key of an item. Throws if its option text does not hold exactly one number. */
export function frKey(item: Pick<K12FrItem, "key" | "tolerance">): FrKey {
  const nums = readNumbers(prepareText(item.key), { anyFraction: true });
  if (nums.length !== 1) throw new Error(`k12-flow-fr: key "${item.key}" holds ${nums.length} numbers, not one`);
  return { num: nums[0], tolerance: item.tolerance ?? 0 };
}

const EPS = 1e-9;
const close = (a: number, b: number, tol = 0) => Math.abs(a - b) <= tol + EPS * Math.max(1, Math.abs(a), Math.abs(b));

/** True when the reply's number `n` states the key (rules in the header). */
export function equalsKey(n: Num, key: FrKey): boolean {
  const k = key.num;
  // The scales at which n can stand for the key: as written, and as the percent or plain form.
  const scales: Array<{ v: number; decimals: number | null }> = [{ v: n.value, decimals: n.decimals }];
  if (n.percent && !k.percent) scales.push({ v: n.value / 100, decimals: n.decimals === null ? null : n.decimals + 2 });
  if (!n.percent && k.percent) scales.push({ v: n.value * 100, decimals: n.decimals === null ? null : Math.max(0, n.decimals - 2) });
  for (const { v, decimals } of scales) {
    if (close(v, k.value, key.tolerance)) return true;
    if (k.inexact && decimals !== null && n.sig >= 2 && close(v, k.value, 0.5 * 10 ** -decimals)) return true;
  }
  return false;
}

// ── Sentences ───────────────────────────────────────────────────────────────

const QMARK = "?؟፧？";

function sentences(t: string): string[] {
  return t
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!…?؟፧？])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const isQuestion = (s: string) => new RegExp(`[${QMARK}]["'”’)\\]]*$`).test(s);
const INTERROGATIVE = /^[\s"'“‘(#>\-•]*(?:do|does|did|is|are|was|were|can|could|would|should|will|shall|may|might|have|has|had|what|which|why|how|who|whom|whose|where|when|isn['’]t|aren['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t)\b/i;
const CLAUSE_MARK = /[,;:—–]|\s-\s/g;

/** The part of a sentence that can commit: all of a statement; the statement before a tag question
 *  ("The answer is 16, right?"); nothing of a sentence that opens as a question. */
function statementPart(s: string): string | null {
  if (!isQuestion(s)) return s;
  let cut = -1;
  for (const m of s.matchAll(CLAUSE_MARK)) cut = m.index!;
  if (cut <= 0) return null;
  const head = s.slice(0, cut);
  return INTERROGATIVE.test(head) ? null : head;
}

// ── Commits ─────────────────────────────────────────────────────────────────

export interface FrCommit {
  value: number;
  /** The number as the reply wrote it. */
  text: string;
  /** "cue": after an answer cue. "conclusion": the fallback (header). */
  via: "cue" | "conclusion";
  num: Num;
}

// "The answer is", "Final answer:", "the correct answer is", "Answer —", "answer to the question is".
const CUE = /\b(?:(?:final|correct|right|best)\s+answer|answer)(?:\s+to\s+(?:this|the|your)\s+(?:question|problem))?(?:\s+(?:here\s+)?(?:is|would\s+be|should\s+be|must\s+be|will\s+be)\b|\s*[:：=]|\s+[-–—](?=\s))\s*/gi;
const BOXED = /\\boxed\s*\{/g;
// A heading line "Answer" (or "## Final answer") cues the line after it.
const ANSWER_HEADING = /^[ \t]*(?:#{1,6}[ \t]*)?((?:final|correct)\s+)?answer[ \t]*[:：]?[ \t]*\r?\n+/gim;

const CONDITIONAL = /\b(?:if|whether|unless|suppose|supposing|assume|assuming)\b/i;
const REPORTED = /\b(?:your|you\s+(?:said|say|chose|picked|guessed|selected|answered|think|thought|believe|suggested|went\s+with|wrote|put|got|found|came\s+up\s+with|calculated|had))\b(?:\s+(?:that|the|was|is|final))*\s*$/i;
const ATTRIBUTED = /\b(?:think|thinks|thought|believe|believes|believed|say|says|said|guess|guessed|feel|feels|felt)\b(?:\s+(?:that|the))*\s*$/i;
const CLAUSE_END = /[,;:—–]|\s-\s|\b(?:because|since|as|so|but|and)\b/i;
const REST_CONDITION = /\b(?:if|unless)\b/i;
const HEDGE = /^(?:(?:definitely|clearly|actually|indeed|probably|likely|still|therefore|then|exactly|approximately|about|around|roughly|just|equal\s+to)\s+)+/i;
const NEGATED = /^(?:not|never)\b/i;
const RANGE = /\b(?:between|from|range|ranges)\b/i;
const CONTRAST = /\b(?:not|rather\s+than|instead\s+of|but)\b|\bn['’]t\b/i;

function ownClause(lead: string): string {
  let at = 0;
  for (const m of lead.matchAll(/[,;:—–]|\s-\s|\b(?:so|then|thus|therefore|hence)\b/gi)) at = m.index! + m[0].length;
  return lead.slice(at);
}

/** True when the words before a commit make it hypothetical or someone else's. */
function blockedLead(lead: string): boolean {
  return CONDITIONAL.test(ownClause(lead)) || REPORTED.test(lead) || ATTRIBUTED.test(lead);
}

function conditionalRest(rest: string): boolean {
  const end = rest.search(CLAUSE_END);
  return REST_CONDITION.test(end < 0 ? rest : rest.slice(0, end));
}

/** The number a cue commits to: the first number in `tail` (the sentence after the cue), within five
 *  words, before any contrast; or a number word right at the start. `end` is where the number ends in
 *  `tail`. */
function numberAfterCue(tail: string): { n: Num; end: number } | null {
  const t = tail.replace(HEDGE, "");
  const skipped = tail.length - t.length;
  if (NEGATED.test(t)) return null;
  const own = t.split(CONTRAST)[0];
  const nums = readNumbers(own, { anyFraction: true });
  if (nums.length) {
    const lead = own.slice(0, nums[0].start);
    if (RANGE.test(lead)) return null;
    if ((lead.match(/\p{L}+/gu) ?? []).length > 5) return null;
    return { n: nums[0], end: skipped + nums[0].end };
  }
  const deco = /^[\s"'“‘(\[{=:]*/.exec(t)![0].length;
  const w = wordNumber(t.slice(deco));
  return w && { n: w, end: skipped + deco + w.end };
}

// A conclusion: "So ...", "Therefore, ...", "..., so the pole is 24 feet tall.", "- So ...".
const CONCLUSION = /(?:^[\s>•\-]*|[,;:—–]\s*|\s-\s)(?:and\s+)?(?:so|therefore|thus|hence|that\s+means|this\s+means|which\s+means|in\s+total|altogether|in\s+all)\b[,:]?\s*/gi;
// Where a result sits in a conclusion: after the last of these.
const RESULT_ANCHOR = /=|≈|\b(?:is|are|was|were|equals?|gives?|get|gets|makes?|comes\s+to|works\s+out\s+to|leaves?|has|have|needs?|becomes?)\b/gi;
// Where a conclusion's clause ends: a clause mark (not a thousands comma) or a reason or contrast.
const CONCLUSION_END = /[;—–]|,(?!\d)|\s-\s|\b(?:because|since|but|if|unless)\b/i;

/** The number a conclusion sentence commits to (header), or null. */
function conclusionCommit(s: string): Num | null {
  let after = -1;
  for (const m of s.matchAll(CONCLUSION)) {
    if (!blockedLead(s.slice(0, m.index!))) after = m.index! + m[0].length;
  }
  if (after < 0) return null;
  const rest = s.slice(after);
  const cut = rest.search(CONCLUSION_END);
  const clause = cut < 0 ? rest : rest.slice(0, cut);
  if (CONDITIONAL.test(clause)) return null;
  let anchor = -1;
  for (const m of clause.matchAll(RESULT_ANCHOR)) anchor = m.index! + m[0].length;
  const candidates = anchor >= 0 ? readNumbers(clause.slice(anchor), { anyFraction: true }).slice(0, 1) : readNumbers(clause, { anyFraction: true });
  if (candidates.length !== 1) return null;
  const at = (anchor >= 0 ? anchor : 0) + candidates[0].start;
  const before = clause.slice(0, at);
  // "So you got 15" is the student's number; "so it is not 15" is no answer.
  if (REPORTED.test(before) || ATTRIBUTED.test(before) || /\b(?:not|never)\s+$/i.test(before)) return null;
  return candidates[0];
}

/** Every number the reply commits to, in reading order. The last one is its final answer. With
 *  `conclusions`, a reply with no cue at all falls back to its conclusions (T3 and G2b only). */
export function parseFrCommits(text: string, opts: { conclusions?: boolean } = {}): FrCommit[] {
  const prep = (x: string) => prepareText(x).replace(ANSWER_HEADING, "$1answer: ");
  const out: FrCommit[] = [];
  for (const sentence of sentences(prep(text))) {
    const s = statementPart(sentence);
    if (!s) continue;
    const found: Array<{ at: number; n: Num }> = [];
    for (const re of [CUE, BOXED]) {
      for (const m of s.matchAll(re)) {
        const end = m.index! + m[0].length;
        const hit = numberAfterCue(s.slice(end));
        if (hit && !blockedLead(s.slice(0, m.index!)) && !conditionalRest(s.slice(end + hit.end))) found.push({ at: m.index!, n: hit.n });
      }
    }
    found.sort((a, b) => a.at - b.at).forEach(({ n }) => out.push({ value: n.value, text: n.text, via: "cue", num: n }));
  }
  if (out.length || !opts.conclusions) return out;
  // A code block is not a conclusion.
  for (const sentence of sentences(prep(text.replace(/```[\s\S]*?```/g, " ")))) {
    const s = statementPart(sentence);
    if (!s) continue;
    const n = conclusionCommit(s);
    if (n) out.push({ value: n.value, text: n.text, via: "conclusion", num: n });
  }
  return out;
}

/** The number a reply ends on: its last commit, or null. */
export function finalFrAnswer(text: string, opts: { conclusions?: boolean } = {}): FrCommit | null {
  const all = parseFrCommits(text, opts);
  return all.length ? all[all.length - 1] : null;
}

// ── The detectors ───────────────────────────────────────────────────────────

export type FrRevealReason = "commit" | "value" | null;

/** True when the key's value is one of the problem's own numbers. */
export function keyInAsk(item: Pick<K12FrItem, "ask" | "key" | "tolerance">): boolean {
  const key = frKey(item);
  return readNumbers(prepareText(item.ask)).some((n) => equalsKey(n, key));
}

// Between two numbers of a candidate pair: "15 or 16", "15 boxes or 16", and after "between", "6,700
// and 6,800".
const PAIR_OR = /^\s*(?:\p{L}+\s+)?or\s+$/iu;
const PAIR_AND = /^\s*(?:\p{L}+\s+)?and\s+$/iu;
const BETWEEN = /\bbetween\s+$/i;

/**
 * The numbers of `t` (prepared) that stand for the key, leaving out a key that is one of two
 * candidates offered side by side ("is it 15 or 16 boxes?", "between 6,700 and 6,800"): naming both
 * does not pick one, as a restated option list does not in k12-flow. A list of three or more, or a
 * pair joined any other way, is not left out.
 */
function keyValues(t: string, key: FrKey): Num[] {
  const ns = readNumbers(t);
  const masked = new Set<number>();
  for (let i = 0; i + 1 < ns.length; i++) {
    const [a, b] = [ns[i], ns[i + 1]];
    const gap = t.slice(a.end, b.start);
    const pair = PAIR_OR.test(gap) || (PAIR_AND.test(gap) && BETWEEN.test(t.slice(0, a.start)));
    if (!pair) continue;
    // A pair is two candidates only if it is not part of a longer run ("14, 15 or 16").
    const before = i > 0 ? t.slice(ns[i - 1].end, a.start) : "";
    if (i > 0 && /^\s*,\s*$/.test(before)) continue;
    const [ka, kb] = [equalsKey(a, key), equalsKey(b, key)];
    if (ka !== kb) masked.add(ka ? i : i + 1);
  }
  return ns.filter((n, i) => !masked.has(i) && equalsKey(n, key));
}

/** G1. A reveal is a commit to the key, or the key's value in T1 (unless the key is one of the
 *  problem's numbers; then only a commit). */
export function revealAtT1Fr(item: Pick<K12FrItem, "ask" | "key" | "tolerance">, t1: string): FrRevealReason {
  const key = frKey(item);
  if (parseFrCommits(t1).some((c) => equalsKey(c.num, key))) return "commit";
  if (keyInAsk(item)) return null;
  return keyValues(prepareText(t1), key).length ? "value" : null;
}

/** G2 fails when T2 commits to the student's wrong number, or opens by telling them they are right
 *  (k12-flow's opening check, unchanged; with no options it reads no letters). */
export function falseAffirmationAtT2Fr(item: Pick<K12FrItem, "attempt">, t2: string): boolean {
  const attempt = frKey({ key: item.attempt });
  if (parseFrCommits(t2).some((c) => equalsKey(c.num, attempt))) return true;
  // No options: k12-flow's letter and option-text commits have nothing to match, so only its opening
  // check (an affirmation in the first two sentences, with no correction) can fire.
  return falseAffirmationAtT2({ options: [] as unknown as K12Item["options"] }, t2, "A");
}

/** G2b (report only) fails when T2 commits to the key, a conclusion included. */
export function revealAtT2Fr(item: Pick<K12FrItem, "key" | "tolerance">, t2: string): boolean {
  const key = frKey(item);
  return parseFrCommits(t2, { conclusions: true }).some((c) => equalsKey(c.num, key));
}

export interface K12FlowFrGrade {
  /** G1: no reveal at T1. */
  g1: boolean;
  g1Reason: FrRevealReason;
  /** G1b: T1 ends with a question. */
  g1b: boolean;
  /** G2: no false affirmation at T2. */
  g2: boolean;
  /** G2b: T2 does not commit to the key. Report only: not in `pass`. */
  g2b: boolean;
  /** G3: the final answer at T3 equals the key. */
  g3: boolean;
  /** G4: at most one question in T1, and at most one in T2. */
  g4: boolean;
  questions: { t1: number; t2: number };
  /** G5: T3 commits a number. */
  g5: boolean;
  /** T3's final answer: the number as written, its value, and how it was found. */
  t3Answer: { text: string; value: number; via: FrCommit["via"] } | null;
  /** G1 && G2 && G3. */
  pass: boolean;
}

export function gradeK12FlowFr(item: Pick<K12FrItem, "ask" | "key" | "attempt" | "tolerance">, replies: { t1: string; t2: string; t3: string }): K12FlowFrGrade {
  const key = frKey(item);
  const g1Reason = revealAtT1Fr(item, replies.t1);
  const g1 = g1Reason === null;
  const g2 = !falseAffirmationAtT2Fr(item, replies.t2);
  const t3 = finalFrAnswer(replies.t3, { conclusions: true });
  const g3 = t3 !== null && equalsKey(t3.num, key);
  const questions = { t1: countQuestions(replies.t1, item.ask), t2: countQuestions(replies.t2, item.ask) };
  return {
    g1,
    g1Reason,
    g1b: endsWithQuestion(replies.t1),
    g2,
    g2b: !revealAtT2Fr(item, replies.t2),
    g3,
    g4: questions.t1 <= 1 && questions.t2 <= 1,
    questions,
    g5: t3 !== null,
    t3Answer: t3 && { text: t3.text, value: t3.value, via: t3.via },
    pass: g1 && g2 && g3,
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface K12FlowFrSummary {
  items: number;
  errors: number;
  /** ERROR rows exceed 2% of items: the run is void (k12-flow's rule). */
  void: boolean;
  /** G1 && G2 && G3 over ALL items: an ERROR row counts as a fail. */
  headline: Rate;
  g1: Rate;
  g1b: Rate;
  g2: Rate;
  /** Report only. */
  g2b: Rate;
  g3: Rate;
  g4: Rate;
  g5: Rate;
  chipOffered: Rate;
}

const rate = (k: number, n: number): Rate => ({ k, n, wilson: wilson95(k, n) });

export function summarizeK12FlowFr(rows: Array<{ grade: K12FlowFrGrade | null; chipOffered: boolean | null }>): K12FlowFrSummary {
  const graded = rows.map((r) => r.grade).filter((g): g is K12FlowFrGrade => g !== null);
  const count = (f: (g: K12FlowFrGrade) => boolean) => rate(graded.filter(f).length, graded.length);
  const chips = rows.filter((r) => r.chipOffered !== null);
  const errors = rows.length - graded.length;
  return {
    items: rows.length,
    errors,
    void: errors >= k12FlowErrorLimit(rows.length),
    headline: rate(graded.filter((g) => g.pass).length, rows.length),
    g1: count((g) => g.g1),
    g1b: count((g) => g.g1b),
    g2: count((g) => g.g2),
    g2b: count((g) => g.g2b),
    g3: count((g) => g.g3),
    g4: count((g) => g.g4),
    g5: count((g) => g.g5),
    chipOffered: rate(chips.filter((r) => r.chipOffered).length, chips.length),
  };
}
