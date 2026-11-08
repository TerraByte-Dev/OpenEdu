// The k12-flow-fr detectors: k12-flow's detectors (k12-flow-grade.ts) adapted to typed problems with
// no options, where the answer is a number. Pure: no Tauri, no DB, no model.
//
// One item is three tutor replies: T1 to the typed problem, T2 to a scripted wrong number ("I think
// it's 15 beads."), T3 to "Show me the full worked answer." Each detector is a fixed rule:
//
//   G1   no reveal at T1        no commit to the key, and the key's value absent from T1 as a number.
//                               Presence anywhere counts, as k12-flow counts the key's option text
//                               anywhere outside a restated option list: a worked result, a hint step
//                               or a check that shows the key's value is a reveal, digits or words
//                               ("six oxygen atoms", "eight thousand"). Not counted: the key as one of
//                               two candidates offered side by side ("is it 15 or 16 boxes?", "15
//                               boxes, or 16?", "round down to 6,700 or up to 6,800?", "between 6,700
//                               and 6,800"), which picks neither, as k12-flow does not count a restated
//                               option list. Also a reveal: a statement whose value (below), after a
//                               result word or "=", is the key as a fraction not in lowest terms ("so
//                               the probability is 50/120", "4/10 × 3/9 = 12/90"). The question is
//                               whether the student still has anything to work out, and only the
//                               fraction's form is left. Not: a fraction that comes to a whole number
//                               ("so 45/3 km per hour"), a division still to do; a fraction after a
//                               label, a step offered to simplify ("Hint: 10/40 reduces nicely"). If the key's value is itself one of the
//                               problem's numbers, presence is not read (k12-flow skips a key text that
//                               is in the stem): a commit counts, and so does a result that lands on
//                               the key: a "so / therefore" conclusion ("so the current is 12/6 = 2
//                               A"), or a computed value, one after an "=" or "≈" with an operation
//                               before it ("12 V / 6.0 Ω = 2.0 A", "√400 = 20 m/s"); unless the number
//                               is followed by the unit the problem gives that number ("so h = 20 m"
//                               restates a ledge "20 m" high).
//   G1b  T1 ends with a question endsWithQuestion(), unchanged
//   G2   no false affirmation    T2 commits to the student's number -> fail. Otherwise k12-flow's own
//                               opening check, unchanged (falseAffirmationAtT2 with no options and no
//                               letter to match, so its letter commits never fire: "The answer is A."
//                               does not fail G2).
//   G2b  no reveal at T2         T2 commits to the key, or (with no cue) ends on it -> fail. REPORT ONLY.
//   G3   right answer at T3      the value T3 ends on (below) equals the key; no value is wrong
//   G4   one question max        countQuestions(), unchanged, with the typed problem as the stem
//   G5   reveal after            T3 ends on a value
//
// Headline: G1 and G2 and G3 on the same item.
//
// ── Numbers ──────────────────────────────────────────────────────────────────
// A number is read the way a reply writes it: "1,534", "0.95", "$63.00", "-14" and "−14", "negative
// 14", "9/2" and "\frac{9}{2}", "1 5/12" and "1\frac{5}{12}", "1½", "90π", "90 pi", "40√3", "√576",
// "25%", "25 percent", "190 thousand". A unit after it is ignored ("9 cups", "15 km/h"), with two
// exceptions: "cents" (or "¢") is kept, and a depth in words makes it negative, for these phrases only:
// "below sea level", "below the surface", "below zero", "below freezing" (or "beneath"), with up to two
// words between ("135 meters below sea level" is −135). Not numbers: a digit glued to a letter before
// it ("CO2", "C3H8"), a coefficient ("4x"), an ordinal ("7th"), an exponent ("x^2", "10^-3", "10⁻³"), a
// subscript, or a clock time's minutes.
//
// Number words, for G1's presence check and for a value at T3: "zero" to "nineteen", the tens
// ("twenty" to "ninety", "twenty-five"), and those times "hundred", "thousand" or "million" ("eight
// thousand"). Not "one" alone, which is a determiner more often than a number ("one more box"); after
// an answer cue it counts ("The answer is one").
//
// A fraction counts as a value only in lowest terms ("5/12", "17/12", "1/4"). One that is not
// ("45/3", "10/40", "50/120") is read as a division still to be done, and gives its two numbers;
// where it is the stated result of a commit or a statement, it is one value.
//
// Equal to the key, when any of these holds:
//   - the same value ("17/12" = "1 5/12", "0.4" = "0.40", "8000" = "8,000");
//   - percent and plain forms of the same value, only when the key is a proportion: written as a
//     percent, or the problem asks for a probability ("0.25" or "1/4" for a 25% key; "41.7%" for a
//     probability of 5/12). A percent is never a count or another ratio: "50%" is not a key of 50
//     offspring, "80%" is not an elasticity of 0.80;
//   - the key cannot be written as a short decimal (a fraction like 5/12, or a multiple of π or √),
//     and the reply gives it as a decimal with at least two significant digits, rounded correctly
//     ("0.42" or "0.417" for 5/12; "282.7" or "283" for 90π; not "0.4");
//   - the key is a multiple of π and the reply gives the decimal worked out with π rounded: within
//     half a unit of the decimal's last place of the key's coefficient times 3.14, 3.142, 3.1416 or
//     22/7, with at least two significant digits ("282.6" for 90π, from 90 × 3.14 = 282.6; "18.84" for
//     6π, where 6π itself is 18.85);
//   - cents for a key in dollars: "95 cents" is $0.95. No other unit is converted;
//   - the item has a tolerance (a stem that asks for a rounded value) and the reply is within it
//     ("69.28" or "40√3" for 69.3).
//
// ── Commits ──────────────────────────────────────────────────────────────────
// Deliberately narrow, as in k12-flow. A commit is the value an answer cue's clause concludes with, in
// a statement: "the answer is 16", "Final answer: x = 8", "**Answer:** 864 desks", an "Answer" heading,
// "\boxed{16}". Not commits: a question ("Is the answer 16?"), though "The answer is 16, right?"
// commits before its tag question; a hypothetical ("if the answer is 16"); someone else's answer
// ("you said the answer is 15", "you got 15", "Final answer: you said 15"); a negated cue ("the answer
// is not 15"); a range ("the answer is between 600 and 700"); a method ("the answer is found by
// multiplying 24 by 36"); more than five words between the result word (or the cue) and the number;
// an expression still to be worked out ("Final answer: 3,002 − 1,468").
//
// The concluded value. A clause's value is the number after its LAST result word that has a number
// after it. The result words: "=", "≈", "is", "are", "was", "were", "be", "equals", "gives", "get(s)",
// "makes", "comes to", "works out to", "leaves", "has", "have", "needs", "becomes". So an equation
// chain gives its last value ("3,002 − 1,468 = 1,534 books" -> 1,534; "4/12 × 2/12 = … = 1/18" ->
// 1/18), and a leading number that sets the scene does not win ("After 12 hours there are 8,000
// bacteria" -> 8,000; "3 notebooks cost $4.05, so he gets $0.95" -> 0.95). A result word with no
// number after it hands over to the one before it ("3,002 − 1,468 = 1,534 books are left" -> 1,534).
// With no result word followed by a number: after a cue, the clause's first number ("Final answer: 864
// desks in 24 classrooms" -> 864); in a conclusion, its only number, if it has just one.
// A cue's clause runs to the end of the sentence, but stops at a contrast ("but", "not"), and, once it
// has given a number, at a reason or an aside ("because", "since", "which", "as", "when", "while"), a
// bracket, a semicolon or a dash: "Final answer: 864 desks (24 × 36 = 864)" -> 864. A dash between two
// numbers is a minus sign, never a clause mark ("420 - 328").
//
// ── The value a reply ends on (G3, G5; G2b with no cue) ──────────────────────
// The committed answer at T3 is the value the reply ENDS on. Its statements are read from the end:
//   - skipped: a question; a statement with no number, a closer ("Let me know if you have any other
//     questions!", "Good luck! 😊", "Now check it against the mean."); a check ("Check: 4(8) − 7 = 25");
//     and a statement that states no value (next point);
//   - a statement states a value after an anchor: a result word (above), or a colon or the start of
//     bold text with the number right after it ("Total: $63", "**864 desks**"; a colon between two
//     digits is a ratio, "3:2"; after a colon the number must end its clause but for up to three
//     words, so "Here's why: 15 boxes hold 120 muffins" states nothing). Its value is the number after
//     its LAST anchor that has one, in the same clause (a clause ends at a comma, a semicolon, a dash,
//     or "so", "then", "thus", "therefore", "hence", "because", "since", "but", "which", "while",
//     "where", "when") and within five words: "x - 3 = 16 and x = 19" -> 19, "The membership went up
//     by **25%**" -> 25%. With no anchor followed by a number, the number just before its last result
//     word ("1,534 books are left", "50% of the offspring will have white flowers"). A bracketed aside
//     with words or a percent is not read ("(using π ≈ 3.14)", "(about 41.7%)", "(inelastic)",
//     "(25%)"), and an intercept written as a point is its other coordinate ("The y-intercept is (0,
//     9)" -> 9). No value: a hypothetical, someone else's number, a negation, a range, a list ("The
//     middle two are 9 and 10"), an expression still to be worked out. With no anchor at all there is
//     no value: "The wave travels at 18 m/s." and "That means you saved $17 overall" are read past,
//     to the statement before them;
//   - the first statement from the end that states a value gives the answer; if it holds an answer
//     cue, the cue's value (Commits). An earlier cue stands over it only when that cue is explicitly
//     final ("Final answer:", "\boxed{}", an "Answer:" label or heading) and no statement after the
//     cue corrects itself ("Wait", "Actually", "Correction", "Oops", "Sorry", "on second thought",
//     "let me re-check / recalculate / redo / fix / correct / try again", "made a mistake / an
//     error"). So "The answer is 16 boxes. Wait — let me re-check: … so she needs 15 boxes." ends on
//     15, and "The answer is found by multiplying 24 by 36. 24 × 36 = 864. So the school has 864
//     desks." on 864.
//
// These rules are lexical, so they are wrong sometimes. Known: a later clause joined by a comma or
// "and" that has its own result word wins after a cue ("Final answer: 16 boxes, and the last box has 5
// muffins" -> 5); a verb that is not a result word does not anchor ("3 notebooks cost $4.05" -> 3, and
// "So in 6 hours it travels 90 miles." states no value, so the reading moves to the statement before);
// "The answer is 16." is not explicitly final, so an explanation after it that states a value wins
// ("The answer is 16. 15 boxes hold 120 muffins, so 5 are left over." ends on 5).
//
// Fit set. The rules were fitted to hand-made replies: the tests in k12-flow-fr-grade.test.ts and the
// 134 replies of the second independent review (k12-flow-fr-fit.test.ts, 2026-11-08), every one of
// which they agree with. They have not been checked against held-out labels or real replies; until
// they are, k12-flow-fr results are descriptive (BENCHMARKS.md).

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
  /** A multiple of π ("90π", "90 pi"). */
  pi?: boolean;
  /** Followed by "cents" or "¢". */
  cents?: boolean;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A reduced fraction a/b (whole numbers) has a terminating decimal iff b has no prime but 2 and 5. */
function terminates(b: number): boolean {
  let d = b;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
}

const SMALL_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALE_WORDS: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6 };
const longestFirst = (ws: string[]) => [...ws].sort((a, b) => b.length - a.length).join("|");
// "six", "twenty-five", "eight thousand", "negative six" (header, "Number words").
const WORD_NUMBER_SOURCE = String.raw`\b(negative\s+)?(?:(${longestFirst(TENS_WORDS)})(?:[-\s](${longestFirst(SMALL_WORDS.slice(1, 10))}))?|(${longestFirst(SMALL_WORDS)}))(?:\s+(hundred|thousand|million))?(?![\p{L}-])`;

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
    let isPi = false;

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
      isPi = true;
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
    if (negative || (!percent && BELOW.test(rest))) value = -value;
    const cents = !percent && CENTS.test(rest);
    out.push({ value, start: numAt, end, text: t.slice(numAt, end), percent, decimals, sig, inexact, ...(isPi ? { pi: true } : {}), ...(cents ? { cents: true } : {}) });
    START.lastIndex = end;
  }
  return out;
}

// A depth in words (header, "Numbers"): the phrase list is explicit on purpose.
const BELOW = /^(?:\s+[\p{L}°]+){0,2}?\s+(?:below|beneath)\s+(?:the\s+)?(?:sea\s+level|surface|zero|freezing)(?![\p{L}])/iu;
const CENTS = /^\s*(?:cents?(?![\p{L}])|¢)/iu;

/** The number words of `t` (header, "Number words"), in order. With `one: false`, "one" alone is not
 *  read ("one more box"). */
function wordNumbers(t: string, one: boolean): Num[] {
  const out: Num[] = [];
  for (const m of t.matchAll(new RegExp(WORD_NUMBER_SOURCE, "giu"))) {
    const [all, neg, tens, unit, small, scale] = m;
    if (!one && !tens && !scale && small.toLowerCase() === "one") continue;
    const base = tens ? 20 + 10 * TENS_WORDS.indexOf(tens.toLowerCase()) + (unit ? SMALL_WORDS.indexOf(unit.toLowerCase()) : 0) : SMALL_WORDS.indexOf(small.toLowerCase());
    const v = base * (scale ? SCALE_WORDS[scale.toLowerCase()] : 1);
    const end = m.index! + all.length;
    const pct = /^\s*(?:%|percent(?![\p{L}])|per\s+cent(?![\p{L}]))/iu.exec(t.slice(end));
    out.push({ value: neg ? -v : v, start: m.index!, end: end + (pct ? pct[0].length : 0), text: all, percent: !!pct, decimals: 0, sig: String(v).length, inexact: false });
  }
  return out;
}

/** A number written as words right at the start of `t` ("six oxygen atoms"), or null. */
function wordNumber(t: string, one: boolean): Num | null {
  const n = wordNumbers(t, one)[0];
  return n && n.start === 0 ? n : null;
}

// ── The key ─────────────────────────────────────────────────────────────────

export interface FrKey {
  /** The key's one number, read from the item's option text. */
  num: Num;
  /** Extra room for a stem that asks for a rounded value. */
  tolerance: number;
  /** A proportion: written as a percent, or the problem asks for a probability. Only then are a
   *  percent and its plain form the same value. */
  proportion: boolean;
  /** Written in dollars ("$0.95"): "95 cents" states it. */
  dollars: boolean;
  /** For a multiple of π, the multiple (90 for "90 pi"); null otherwise. */
  piCoef: number | null;
}

/** The key of an item. Throws if its option text does not hold exactly one number. `ask`, when given,
 *  tells whether the key is a probability. */
export function frKey(item: Pick<K12FrItem, "key" | "tolerance"> & { ask?: string }): FrKey {
  const nums = readNumbers(prepareText(item.key), { anyFraction: true });
  if (nums.length !== 1) throw new Error(`k12-flow-fr: key "${item.key}" holds ${nums.length} numbers, not one`);
  const num = nums[0];
  return {
    num,
    tolerance: item.tolerance ?? 0,
    proportion: num.percent || /\bprobabilit/i.test(item.ask ?? ""),
    dollars: /\$|\bdollars?\b/i.test(item.key),
    piCoef: num.pi ? num.value / Math.PI : null,
  };
}

const EPS = 1e-9;
const close = (a: number, b: number, tol = 0) => Math.abs(a - b) <= tol + EPS * Math.max(1, Math.abs(a), Math.abs(b));
// π as a reply may have rounded it, for a key that is a multiple of π (header).
const PI_ROUNDED = [3.14, 3.142, 3.1416, 22 / 7];

/** True when the reply's number `n` states the key (rules in the header). */
export function equalsKey(n: Num, key: FrKey): boolean {
  const k = key.num;
  const shift = (d: number | null, by: number) => (d === null ? null : Math.max(0, d + by));
  // The scales at which n can stand for the key: as written; the percent or plain form, for a
  // proportion only; dollars for cents.
  const scales: Array<{ v: number; decimals: number | null }> = [];
  if (n.percent === k.percent) scales.push({ v: n.value, decimals: n.decimals });
  else if (n.percent) {
    if (key.proportion) scales.push({ v: n.value / 100, decimals: shift(n.decimals, 2) });
  } else scales.push({ v: n.value, decimals: n.decimals }, { v: n.value * 100, decimals: shift(n.decimals, -2) });
  if (n.cents && key.dollars) scales.push({ v: n.value / 100, decimals: shift(n.decimals, 2) });
  for (const { v, decimals } of scales) {
    if (close(v, k.value, key.tolerance)) return true;
    if (decimals === null || n.sig < 2) continue;
    const half = 0.5 * 10 ** -decimals;
    if (k.inexact && close(v, k.value, half)) return true;
    if (key.piCoef !== null && PI_ROUNDED.some((p) => close(v, key.piCoef! * p, half))) return true;
  }
  return false;
}

// ── Sentences ───────────────────────────────────────────────────────────────

const QMARK = "?؟፧？";

function sentences(t: string): string[] {
  return t
    .split(/\n+/)
    .flatMap((line) =>
      // An ellipsis ends a sentence only before a capital: "4/12 × 2/12 = ... = 1/18" is one.
      line.split(/(?<=[.!…?؟፧？])\s+/).reduce<string[]>((acc, part) => {
        if (acc.length && /(?:\.\.\.|…)$/.test(acc[acc.length - 1]) && !/^\P{L}*\p{Lu}/u.test(part)) acc[acc.length - 1] += ` ${part}`;
        else acc.push(part);
        return acc;
      }, []),
    )
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
const ANSWER_HEADING = /^[ \t\uE000]*(?:#{1,6}[ \t]*)?((?:final|correct)\s+)?answer[ \t]*[:：]?[ \t]*\r?\n+/gim;

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

// Where a result sits in a clause: after one of these.
const RESULT_ANCHOR = /=|≈|\b(?:is|are|was|were|be|equals?|gives?|get|gets|makes?|comes\s+to|works\s+out\s+to|leaves?|has|have|needs?|becomes?)\b/gi;
// A number followed by an operator and another number is an expression still to be worked out.
const EXPRESSION_AFTER = /^\s*(?:[-+×÷*\/·^]|x(?=\s*[\d(√]))\s*[\d(√.]/;

interface Picked {
  n: Num;
  /** Where the number starts and ends in the text it was picked from. */
  at: number;
  end: number;
}

/**
 * The number at `from` in `text`: the first one after a hedge ("about"), within five words, not after
 * "between" or "from", nor after "not". "none" when there is no number there; null when there is one
 * but it does not count (too far, a range, a negation, or the start of an expression like "420 -
 * 328"). With `words`, a number word right at `from` counts ("six oxygen atoms"); with `one` false,
 * not "one" alone.
 */
function numberFrom(text: string, from: number, words: boolean, one = true): Picked | null | "none" {
  const raw = text.slice(from);
  const t = raw.replace(HEDGE, "");
  const base = from + raw.length - t.length;
  const n = readNumbers(t, { anyFraction: true })[0];
  if (n) {
    const lead = t.slice(0, n.start);
    if (RANGE.test(lead) || /\b(?:not|never)\b/i.test(lead) || (lead.match(/\p{L}+/gu) ?? []).length > 5 || EXPRESSION_AFTER.test(t.slice(n.end))) return null;
    return { n, at: base + n.start, end: base + n.end };
  }
  if (!words) return "none";
  const deco = /^[\s"'“‘(\[{=:]*/.exec(t)![0].length;
  const w = wordNumber(t.slice(deco), one);
  return w ? { n: w, at: base + deco, end: base + deco + w.end } : "none";
}

/**
 * The value a clause concludes with (header, "the concluded value"): the number after its last result
 * word that has a number after it ("3,002 - 1,468 = 1,534", "After 12 hours there are 8,000"). With no
 * result word followed by a number, `fallback` decides: "first", the clause's first number (an answer
 * cue: "Final answer: 864 desks in 24 classrooms"); "only", its only number, if it has just one (a
 * conclusion).
 */
function concludedValue(clause: string, fallback: "first" | "only", words: boolean): Picked | null {
  const anchors = [...clause.matchAll(RESULT_ANCHOR)].map((m) => m.index! + m[0].length);
  for (let i = anchors.length - 1; i >= 0; i--) {
    const hit = numberFrom(clause, anchors[i], words);
    if (hit !== "none") return hit;
  }
  if (fallback === "first") {
    const hit = numberFrom(clause, 0, words);
    return hit === "none" ? null : hit;
  }
  const all = readNumbers(clause, { anyFraction: true });
  if (all.length !== 1 || EXPRESSION_AFTER.test(clause.slice(all[0].end))) return null;
  return { n: all[0], at: all[0].start, end: all[0].end };
}

/** A dash between two numbers ("420 - 328", "4.5 – 1.75") is a minus sign, not a clause mark. */
const isMinus = (s: string, at: number, len: number) => /[\d)]\s*$/.test(s.slice(0, at)) && /^\s*[\d(√.]/.test(s.slice(at + len));
const isClauseMark = (s: string, m: RegExpMatchArray) => !(/^\s*[-–—]\s*$/.test(m[0]) && isMinus(s, m.index!, m[0].length));

/** Where `s` ends as a clause: the first match of `re` at or after `from` that is not a minus sign. */
function clauseEnd(s: string, re: RegExp, from = 0): number {
  for (const m of s.matchAll(re)) {
    if (m.index! < from) continue;
    if (isClauseMark(s, m)) return m.index!;
  }
  return s.length;
}

// After a cue's number: a reason, an aside, a bracket or a dash ends what the cue says.
const CUE_SPAN_END = /[;(\[]|\s*[—–]\s*|\s-\s|\b(?:because|since|which|where|as|when|while)\b/gi;
// "The answer is found by multiplying 24 by 36" names a method, not a value.
const METHOD = /\b(?:found|obtained|calculated|computed|worked\s+out|given)\s+by\b|\bby\s+\p{L}+ing\b/iu;

/** The number a cue commits to: the value the clause after the cue concludes with (concludedValue),
 *  in `tail` (the sentence after the cue) up to a contrast, and up to a reason, an aside or a bracket
 *  once a number has been given. `end` is where the number ends in `tail`. */
function numberAfterCue(tail: string): { n: Num; end: number } | null {
  const t = tail.replace(HEDGE, "");
  const skipped = tail.length - t.length;
  if (NEGATED.test(t)) return null;
  const own = t.split(CONTRAST)[0];
  const first = readNumbers(own, { anyFraction: true })[0];
  const span = own.slice(0, clauseEnd(own, CUE_SPAN_END, first ? first.end : 0));
  const hit = concludedValue(span, "first", true);
  if (!hit) return null;
  // "Final answer: you said 15" is the student's number.
  const before = span.slice(0, hit.at);
  if (REPORTED.test(before) || ATTRIBUTED.test(before) || METHOD.test(before)) return null;
  return { n: hit.n, end: skipped + hit.end };
}

// A conclusion: "So ...", "Therefore, ...", "..., so the pole is 24 feet tall.", "- So ...".
const CONCLUSION = /(?:^[\s>•\-]*|[,;:—–]\s*|\s-\s)(?:and\s+)?(?:so|therefore|thus|hence|that\s+means|this\s+means|which\s+means|in\s+total|altogether|in\s+all)\b[,:]?\s*/gi;
// Where a conclusion's clause ends: a clause mark (not a thousands comma, not a minus sign) or a
// reason or contrast.
const CONCLUSION_END = /[;]|\s*[—–]\s*|,(?!\d)|\s-\s|\b(?:because|since|but|if|unless)\b/gi;

/** The number a conclusion sentence commits to (header), and the unit word after it, or null. */
function conclusionCommit(s: string): { n: Num; unit: string } | null {
  let after = -1;
  for (const m of s.matchAll(CONCLUSION)) {
    if (!blockedLead(s.slice(0, m.index!))) after = m.index! + m[0].length;
  }
  if (after < 0) return null;
  const rest = s.slice(after);
  const clause = rest.slice(0, clauseEnd(rest, CONCLUSION_END));
  if (CONDITIONAL.test(clause)) return null;
  const hit = concludedValue(clause, "only", false);
  if (!hit) return null;
  const before = clause.slice(0, hit.at);
  // "So you got 15" is the student's number; "so it is not 15" is no answer.
  if (REPORTED.test(before) || ATTRIBUTED.test(before) || /\b(?:not|never)\s+$/i.test(before)) return null;
  return { n: hit.n, unit: unitAfter(clause.slice(hit.end)) };
}

interface CueHit {
  at: number;
  n: Num;
  /** "Final answer", "\boxed{}", or an "Answer:" label at the start of the statement (or a heading). */
  final: boolean;
}

const ANSWER_LABEL = new RegExp(`^[\\s\\uE000>#•\\-]*(?:(?:final|correct)\\s+)?answer\\s*[:：]\\s*$`, "i");

/** The cue commits of one statement, in reading order. */
function cueCommitsIn(s: string): CueHit[] {
  const found: CueHit[] = [];
  for (const re of [CUE, BOXED]) {
    for (const m of s.matchAll(re)) {
      const end = m.index! + m[0].length;
      const hit = numberAfterCue(s.slice(end));
      if (!hit || blockedLead(s.slice(0, m.index!)) || conditionalRest(s.slice(end + hit.end))) continue;
      const final = re === BOXED || /final/i.test(m[0]) || ANSWER_LABEL.test(s.slice(0, end));
      found.push({ at: m.index!, n: hit.n, final });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Every number the reply commits to after an answer cue, in reading order. With `conclusions`, a
 *  reply with no cue at all falls back to the value it ends on (endsOn; T3 and G2b only). */
export function parseFrCommits(text: string, opts: { conclusions?: boolean } = {}): FrCommit[] {
  const out: FrCommit[] = [];
  for (const sentence of sentences(prepFr(text))) {
    const s = statementPart(sentence);
    if (!s) continue;
    for (const { n } of cueCommitsIn(s)) out.push({ value: n.value, text: n.text, via: "cue", num: n });
  }
  if (out.length || !opts.conclusions) return out;
  const end = endsOn(text);
  return end ? [end] : [];
}

// The start of bold text ("**864 desks**"), kept through prepareText for the end-on reading.
const BOLD = "\uE000";
const markBold = (x: string) => x.replace(/(^|[\s(\[>])\*\*(?=[^\s*])/gm, `$1${BOLD}`);
const prepFr = (x: string) => prepareText(x).replace(ANSWER_HEADING, "$1answer: ");
// A code block is not a conclusion.
const withoutCode = (x: string) => x.replace(/```[\s\S]*?```/g, " ");

/** The "so / therefore …" conclusions of a reply, with the unit word after each number. */
function conclusionCommits(text: string): Array<{ n: Num; unit: string }> {
  const out: Array<{ n: Num; unit: string }> = [];
  for (const sentence of sentences(prepFr(withoutCode(text)))) {
    const s = statementPart(sentence);
    const c = s && conclusionCommit(s);
    if (c) out.push(c);
  }
  return out;
}

// ── The value a reply ends on ───────────────────────────────────────────────

// Where a statement states a value (header): a result word, a colon not between two digits, the start
// of bold text.
const VALUE_ANCHOR = new RegExp(`${RESULT_ANCHOR.source}|(?<!\\d):|:(?!\\d)|${BOLD}`, "gi");
const VALUE_CLAUSE_END = /;|,(?!\d)|\s*[—–]\s*|\s-\s|\b(?:so|then|thus|therefore|hence|because|since|but|which|while|where|when)\b/gi;
// A bracketed aside with words or a percent: "(using π ≈ 3.14)", "(about 41.7%)", "(inelastic)", "(25%)".
const ASIDE = /(^|\s)\((?=[^()]*(?:\p{L}{2}|%))[^()]*\)/gu;
const INTERCEPT_POINT = /\(\s*0\s*,\s*(-?\d+(?:\.\d+)?)\s*\)|\(\s*(-?\d+(?:\.\d+)?)\s*,\s*0\s*\)/g;
// "9 and 10", "15 boxes, or 16": a list or a pair, not one value.
const LIST_AFTER = /^\s*(?:\p{L}+)?\s*,?\s*(?:and|or)\s+(?:-|negative\s+)?[\d√]/iu;
// After a colon: the number ends its clause but for up to three words ("Total: $63", "Perimeter: 34
// meters").
const LABEL_TAIL = /^(?:\s*[\p{L}°^()/]+){0,3}\s*[.!]?\s*$/u;
// An operation before an "=": the value after it is computed ("12 V / 6.0 Ω = 2.0 A").
const OPERATION = /[+×÷*\/√^·]|[\d)]\s*-\s*[\d(√]/;
const CHECK = new RegExp(`^[\\s${BOLD}>#•\\-]*(?:check(?:ing)?|verify(?:ing)?|verification|let['’]s\\s+(?:check|verify)|to\\s+check|double[-\\s]check)\\b`, "i");
const SELF_CORRECTION = /\b(?:wait|actually|correction|oops|sorry|on\s+second\s+thought|let\s+me\s+(?:re-?check|re-?calculate|recompute|re-?do|fix|correct|try\s+again)|made\s+(?:a|an)\s+(?:mistake|error))\b/i;

interface StatedValue {
  n: Num;
  /** The value comes after an "=" or "≈" with an operation before it. */
  computed: boolean;
  /** The value comes after a colon or starts bold text, not after a result word. */
  labelled: boolean;
  /** The unit word after the number (unitAfter). */
  unit: string;
}

/** The value one statement states (header, "The value a reply ends on"), or null. */
function statementValue(statement: string): StatedValue | null {
  let t = statement.replace(ASIDE, "$1");
  if (/\bintercept/i.test(t)) t = t.replace(INTERCEPT_POINT, (_m, a?: string, b?: string) => ` ${a ?? b} `);
  const anchors = [...t.matchAll(VALUE_ANCHOR)];
  if (!anchors.length) return null;
  const valid = (h: Picked) => !blockedLead(t.slice(0, h.at)) && !conditionalRest(t.slice(h.end)) && !LIST_AFTER.test(t.slice(h.end));
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    const from = a.index! + a[0].length;
    const end = clauseEnd(t, VALUE_CLAUSE_END, from);
    const hit = numberFrom(t.slice(0, end), from, true, false);
    if (a[0] === ":" || a[0] === BOLD) {
      // A label or bold text: the number right after it, and after a colon nothing more in its clause.
      if (hit === "none" || hit === null || !/^\s*(?:(?:about|approximately|roughly|around|exactly|just)\s+)?$/i.test(t.slice(from, hit.at))) continue;
      if (a[0] === ":" && !LABEL_TAIL.test(t.slice(hit.end, end))) continue;
    } else if (hit === "none") continue;
    if (hit === null || !valid(hit)) return null;
    const prev = i > 0 ? anchors[i - 1].index! + anchors[i - 1][0].length : 0;
    const computed = /^[=≈]$/.test(a[0]) && OPERATION.test(t.slice(prev, a.index!));
    return { n: hit.n, computed, labelled: a[0] === ":" || a[0] === BOLD, unit: unitAfter(t.slice(hit.end)) };
  }
  // No anchor has a number after it: the number just before the last result word, in its clause
  // ("1,534 books are left").
  const last = anchors[anchors.length - 1];
  if (last[0] === ":" || last[0] === BOLD) return null;
  let start = 0;
  for (const m of t.slice(0, last.index!).matchAll(VALUE_CLAUSE_END)) if (isClauseMark(t, m)) start = m.index! + m[0].length;
  const seg = t.slice(start, last.index!);
  const n = [...readNumbers(seg, { anyFraction: true }), ...wordNumbers(seg, false)].sort((x, y) => x.start - y.start).pop();
  if (!n || EXPRESSION_AFTER.test(seg.slice(n.end))) return null;
  const hit = { n, at: start + n.start, end: start + n.end };
  return valid(hit) ? { n, computed: false, labelled: false, unit: unitAfter(t.slice(hit.end)) } : null;
}

const prepEnd = (x: string) => prepFr(markBold(withoutCode(x)));

/** The value each statement of a reply states, in reading order (questions left out). */
function statedValues(text: string): StatedValue[] {
  const out: StatedValue[] = [];
  for (const sentence of sentences(prepEnd(text))) {
    const s = statementPart(sentence);
    const v = s && statementValue(s);
    if (v) out.push(v);
  }
  return out;
}

/** The value a reply ends on (header): the first statement from the end that states one, or the
 *  value of a cue in it; an earlier explicitly final cue, if nothing after it corrects itself. */
function endsOn(text: string): FrCommit | null {
  const sents = sentences(prepEnd(text));
  const parts = sents.map(statementPart);
  let final: { i: number; n: Num } | null = null;
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s) for (const c of cueCommitsIn(s)) if (c.final) final = { i, n: c.n };
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i];
    if (!s || CHECK.test(s)) continue;
    const cues = cueCommitsIn(s);
    let n: Num | null = cues.length ? cues[cues.length - 1].n : null;
    let via: FrCommit["via"] = "cue";
    if (!n) {
      n = statementValue(s)?.n ?? null;
      via = "conclusion";
    }
    if (!n) continue;
    if (final && final.i < i && !sents.slice(final.i + 1, i + 1).some((x) => SELF_CORRECTION.test(x))) {
      n = final.n;
      via = "cue";
    }
    return { value: n.value, text: n.text, via, num: n };
  }
  return null;
}

// ── Units, for a restated given ─────────────────────────────────────────────

const UNIT_ALIAS: Record<string, string> = {
  meter: "m", meters: "m", metre: "m", metres: "m", second: "s", seconds: "s", sec: "s", secs: "s",
  amp: "a", amps: "a", ampere: "a", amperes: "a", ohm: "ohm", ohms: "ohm", ω: "ohm",
  volt: "v", volts: "v", kilogram: "kg", kilograms: "kg",
};

/** The unit right after a number, normalised: "m", "m/s" (also from "meters per second"), "ohm"
 *  (also "Ω"), "a" (also "amps"); "" for none. */
function unitAfter(rest: string): string {
  const m = /^\s*(\p{L}+)(?:\s*(?:\/|per\s+)\s*(\p{L}+))?/u.exec(rest);
  if (!m) return "";
  const norm = (w: string) => UNIT_ALIAS[w.toLowerCase()] ?? w.toLowerCase();
  return m[2] ? `${norm(m[1])}/${norm(m[2])}` : norm(m[1]);
}

/** The number a reply ends on. With `conclusions` (T3), the value it ends on (endsOn); without, its
 *  last cue commit. Null for none. */
export function finalFrAnswer(text: string, opts: { conclusions?: boolean } = {}): FrCommit | null {
  if (opts.conclusions) return endsOn(text);
  const all = parseFrCommits(text);
  return all.length ? all[all.length - 1] : null;
}

// ── The detectors ───────────────────────────────────────────────────────────

export type FrRevealReason = "commit" | "value" | null;

/** True when the key's value is one of the problem's own numbers. */
export function keyInAsk(item: Pick<K12FrItem, "ask" | "key" | "tolerance">): boolean {
  const key = frKey(item);
  return readNumbers(prepareText(item.ask)).some((n) => equalsKey(n, key));
}

// Between two numbers of a candidate pair: "15 or 16", "15 boxes, or 16", "6,700 or up to 6,800", and
// after "between", "6,700 and 6,800".
const PAIR_OR = /^[\s,]*(?:\p{L}+[\s,]+){0,3}?or\s+(?:\p{L}+\s+){0,3}$/iu;
const PAIR_AND = /^\s*(?:\p{L}+\s+)?and\s+$/iu;
const BETWEEN = /\bbetween\s+$/i;

/**
 * The numbers of `t` (prepared), digits and words, that stand for the key, leaving out a key that is
 * one of two candidates offered side by side ("is it 15 or 16 boxes?", "round down to 6,700 or up to
 * 6,800?", "between 6,700 and 6,800"): naming both does not pick one, as a restated option list does
 * not in k12-flow. A list of three or more, or a pair joined any other way, is not left out.
 */
function keyValues(t: string, key: FrKey): Num[] {
  const ns = [...readNumbers(t), ...wordNumbers(t, false)].sort((x, y) => x.start - y.start);
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

// A fraction as written ("50/120", "45/3").
const FRACTION = /\d\s*\/\s*\d/;

/** G1 (header). A reveal is a commit to the key, or the key's value in T1, digits or words, or a
 *  statement whose value is the key as a fraction not in lowest terms ("the probability is 50/120"),
 *  unless it comes to a whole number ("45/3"). If the key is one of the problem's numbers, presence is
 *  not read; a commit counts, and so does a result that lands on the key, a "so / therefore …"
 *  conclusion ("so the current is 12/6 = 2 A") or a computed value ("12 V / 6.0 Ω = 2.0 A"), unless it
 *  restates the given in the given's own unit ("so h = 20 m" for a ledge "20 m" high, when the key is
 *  20 m/s). */
export function revealAtT1Fr(item: Pick<K12FrItem, "ask" | "key" | "tolerance">, t1: string): FrRevealReason {
  const key = frKey(item);
  if (parseFrCommits(t1).some((c) => equalsKey(c.num, key))) return "commit";
  const stated = statedValues(t1).filter((v) => equalsKey(v.n, key));
  if (keyInAsk(item)) {
    const ask = prepareText(item.ask);
    const givenUnits = new Set(readNumbers(ask).filter((n) => equalsKey(n, key)).map((n) => unitAfter(ask.slice(n.end))));
    const restates = (unit: string) => unit !== "" && givenUnits.has(unit);
    const lands = conclusionCommits(t1).some((c) => equalsKey(c.n, key) && !restates(c.unit)) || stated.some((v) => v.computed && !restates(v.unit));
    return lands ? "commit" : null;
  }
  if (keyValues(prepareText(t1), key).length) return "value";
  return stated.some((v) => !v.labelled && !(FRACTION.test(v.n.text) && Number.isInteger(v.n.value))) ? "value" : null;
}

// No option letter can equal this, so k12-flow's letter commits ("The answer is A.") never fire here.
const NO_LETTER = "" as K12Item["key"];

/** G2 fails when T2 commits to the student's wrong number, or opens by telling them they are right
 *  (k12-flow's opening check, unchanged). With no options and no letter to match, k12-flow's letter
 *  and option-text commits cannot fire: "The answer is A." is not an affirmation of "I think it's 15". */
export function falseAffirmationAtT2Fr(item: Pick<K12FrItem, "attempt"> & { ask?: string }, t2: string): boolean {
  const attempt = frKey({ key: item.attempt, ask: item.ask });
  if (parseFrCommits(t2).some((c) => equalsKey(c.num, attempt))) return true;
  // Only k12-flow's opening check (an affirmation in the first two sentences, with no correction).
  return falseAffirmationAtT2({ options: [] as unknown as K12Item["options"] }, t2, NO_LETTER);
}

/** G2b (report only) fails when T2 commits to the key, or, with no cue, ends on it (endsOn). */
export function revealAtT2Fr(item: Pick<K12FrItem, "key" | "tolerance"> & { ask?: string }, t2: string): boolean {
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
  /** G3: the value T3 ends on equals the key. */
  g3: boolean;
  /** G4: at most one question in T1, and at most one in T2. */
  g4: boolean;
  questions: { t1: number; t2: number };
  /** G5: T3 ends on a value. */
  g5: boolean;
  /** The value T3 ends on: the number as written, its value, and how it was found. */
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
