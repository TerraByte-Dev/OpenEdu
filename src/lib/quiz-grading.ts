// Pure grading + answer-quality helpers for the quiz/promotion-test pipeline (issue #83). Tauri-free
// so it's unit-tested next to itself; quiz.ts (the generator/grader orchestrator) and the full-screen
// views consume these. Three concerns live here:
//
//   1. Answer-quality validation that schema can't express — answer↔explanation self-consistency and
//      the small-model "numeric reasoning trap" detector. These drive callLLMStructured's repair-retry
//      (the project's standing lesson: schema enforces structure, not truth — add a validate callback).
//   2. Deterministic free-text grading (normalized exact / numeric match) so the end-of-test grading
//      phase only spends an LLM call on the answers a string compare can't settle.
//   3. The batched-grade and verification-pass prompt builders + result reconcilers (the LLM calls
//      themselves live in quiz.ts; the string-wrangling is pure and tested here).
//
// Nothing here imports from quiz.ts — keep it leaf to avoid a cycle.

import { isOllamaDefaultModel } from "./models";
import { isSafetyDisclosure } from "./child-safety";
import { contentWords } from "./kernel/contentWords";
import type { Grade } from "./grade";

// Minimal structural shapes (we deliberately don't import GeneratedQuestion to stay leaf).
export interface QuestionLike {
  question_text: string;
  question_type: string;
  correct_answer: string;
  explanation: string;
  options?: string[] | null;
}

// ─── Multiple-choice answer key ───────────────────────────────────────────────

// Small local models (gemma4:e2b) answer a multiple-choice key with the letter alone ("D", "D)",
// "(d)") while the options read "D) hop and top". The B9 readiness run (2026-11-13) saw that in
// 1,818 of 2,127 question calls, and repair-retry got the same letter back, so quizzes came out
// empty. Resolving the letter to its option is deterministic and loses nothing. Returns the question
// unchanged when it isn't multiple choice, when the key already names an option's text, or when the
// letter has no matching option.
const LETTER_KEY_RE = /^\s*(?:option\s+)?\(?([A-D])\)?[.):]?\s*$/i;
const OPTION_LABEL_RE = /^\s*\(?([A-D])[).:]\s*/i;

export function resolveLetterKey<Q extends QuestionLike>(q: Q): Q {
  if (q.question_type !== "multiple_choice" || !Array.isArray(q.options) || q.options.length === 0) return q;
  const m = LETTER_KEY_RE.exec(String(q.correct_answer ?? ""));
  if (!m) return q;
  const letter = m[1].toUpperCase();
  const opts = q.options.map((o) => String(o));
  // An option whose own text is the key's letter ("A", as written) is a real answer, not a label.
  if (opts.some((o) => o.replace(OPTION_LABEL_RE, "").trim() === m[1])) return q;
  const labelled = opts.filter((o) => OPTION_LABEL_RE.test(o)).length;
  // Map by label only when every option is labelled, and by position only when none is; a mixed set
  // ("B. vitamins", "minerals", ...) is ambiguous and stays as it is.
  const hit = labelled === opts.length
    ? opts.find((o) => OPTION_LABEL_RE.exec(o)?.[1].toUpperCase() === letter)
    : labelled === 0 ? opts["ABCD".indexOf(letter)] : undefined;
  return hit === undefined ? q : { ...q, correct_answer: hit };
}

/**
 * A multiple-choice key set to the option it names, as that option is written. Grading compares the
 * picked option string with the key, so a key in other letter case or without the option's label
 * ("mitochondria" for "b) Mitochondria") marked every option wrong. A letter key is resolved first
 * (resolveLetterKey). The match ignores the label, then exact text wins, then letter case; a match two
 * options share leaves the key as it is, for validateQuizBatch to reject. The key is also tried as
 * written, since its own text can start like a label: "C. S. Lewis" is the option "C) C. S. Lewis".
 */
export function alignKeyToOption<Q extends QuestionLike>(raw: Q): Q {
  const q = resolveLetterKey(raw);
  if (q.question_type !== "multiple_choice" || !Array.isArray(q.options) || q.options.length === 0) return q;
  const key = String(q.correct_answer ?? "");
  const opts = q.options.map((o) => String(o));
  if (opts.includes(key)) return q;
  const bare = (s: string) => s.replace(OPTION_LABEL_RE, "").trim();
  for (const fold of [(s: string) => s, (s: string) => s.toLowerCase()]) {
    const k = fold(key.trim()), kb = fold(bare(key));
    const hits = opts.filter((o) => fold(bare(o)) === k || fold(bare(o)) === kb || fold(o.trim()) === k);
    if (hits.length === 1) return { ...q, correct_answer: hits[0] };
    if (hits.length > 1) return q;
  }
  return q;
}

// ─── Number / text extraction ─────────────────────────────────────────────────

// Strip a leading multiple-choice option label like "A) " / "b. " so we compare the bare value.
function stripOptionLabel(s: string): string {
  return s.replace(/^\s*[A-Da-d]\s*[).．.]\s*/, "");
}

// Unicode super/subscript digits (²³¹ ⁰⁴-⁹ ₀-₉). The numeric extractors strip these so a chemical
// formula or exponent ("O₂", "Fe³⁺", "x²") is NOT misread as the number 2/3 — NFKC would fold them
// into ASCII digits, which silently mis-graded formula answers (issue #83 review).
const SCRIPT_DIGITS = /[²³¹⁰⁴-⁹₀-₉]/g;
// Collapse thousands separators ("1,000" → "1000") but leave a European-style decimal comma ("3,14")
// alone — only a comma followed by exactly three digits is treated as a group separator.
const stripNumericNoise = (s: string) =>
  s.replace(SCRIPT_DIGITS, "").replace(/−/g, "-").replace(/(\d),(\d{3})(?!\d)/g, "$1$2");

// Normalize a short answer for comparison: lowercase, unify unicode minus, drop the option label,
// surrounding quotes, a leading article, collapsed whitespace, and terminal punctuation. Pure.
export function normalizeAnswer(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/−/g, "-") // unicode minus → ascii
    .toLowerCase()
    .trim()
    .replace(/^\s*[a-d]\s*[).．.]\s*/, "") // option label
    .replace(/^["'`]+|["'`]+$/g, "")       // surrounding quotes
    .replace(/^(the|a|an)\s+/, "")          // leading article
    .replace(/[.,!;:]+$/, "")               // terminal punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// The primary numeric value of a string, or null if it has none. Handles a leading option label,
// thousands separators, decimals, and a leading sign. "C) 9 electrons" → 9; "0.01 m³" → 0.01;
// "True" / "See matching_pairs" → null.
export function numericValueOf(s: string): number | null {
  if (!s) return null;
  const t = stripOptionLabel(s).trim();
  // Ambiguous non-scalars the bare extractor can't compare safely — skip rather than guess (audit):
  // percent, currency, fraction (a/b), ratio/time (a:b), or a numeric range/compound (6 to 9, 8–10).
  // Returning null here makes checkAnswerConsistency skip them AND makes gradeFreeTextDeterministic
  // defer to the LLM grader instead of mis-matching on a misleading scalar (e.g. "1/2" vs "1/3").
  if (/[%$£€]/.test(t)) return null;
  if (/\d\s*\/\s*\d/.test(t)) return null;                 // fraction
  if (/\d\s*:\s*\d/.test(t)) return null;                  // ratio / time
  if (/\d\s*(?:–|—|\bto\b|\band\b)\s*-?\d/i.test(t)) return null; // range / compound
  const cleaned = stripNumericNoise(t);
  const m = /-?\d+(?:\.\d+)?/.exec(cleaned);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

// Count the distinct numbers mentioned in a stem (signal for "multi-step" arithmetic). Superscript
// charge digits (³⁻) aren't \d, so "C³⁻" doesn't inflate the count — intended.
function countNumbers(s: string): number {
  const matches = s.match(/-?\d+(?:\.\d+)?/g);
  return matches ? matches.length : 0;
}

// The value a worked explanation lands on: the last "= N" / "≈ N" or "...answer is N" it states.
// This is the conclusion the student is meant to reach, so disagreement with correct_answer is the
// tell-tale of the "talks itself out of its own answer" failure (issue #83 / the C³⁻ screenshot).
// The last number a global regex's capture group lands on, or null.
function lastCaptured(re: RegExp, text: string): number | null {
  let last: number | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) last = n;
  }
  return last;
}

const NUM = "(-?\\d+(?:\\.\\d+)?)";
// What may follow a number that is a result rather than part of more arithmetic or another token: not
// the hour of a clock time ("2" of "2:45"), one side of a fraction ("3" of "3/4"), or a left operand
// ("Therefore, 14 - 6 = 8" states 8, not 14).
const NOT_OPERAND = "(?!\\d|\\.\\d|\\s*[:/]\\s*\\d|\\s*(?:[+×*÷]|[-−]\\s*\\d|x\\s*\\d|plus\\b|minus\\b|times\\b|divided\\b|multiplied\\b|of\\b))";
const NOT_OPERAND_RE = new RegExp(`^${NOT_OPERAND}`, "i");
// Conclusion cues, split by how trustworthy a number trailing them is. A 4B model phrases conclusions
// many ways, so we keep a wide net for "is there a stated result?" but a narrower one for "is this a
// DERIVED result we'd reject a question over?":
//  • STRONG — an explicit final-answer marker ("the answer is X", "therefore X").
//  • ARITH  — an operator or computation verb whose number is a derived result ("= 9", "gives 9", "→ 9").
//  • SOFT   — a bare factual verb ("is/are/has/have"). A small model states distractor / parallel facts
//             with these as often as conclusions ("an octet is 8 bits; a nibble is 4 bits"), so a SOFT
//             trailing number is NOT trustworthy as the value the work lands on.
// \b-anchored so a cue never matches inside another word ("also" ≠ "so").
const STRONG_CUES = "\\bthe\\s+answer\\s+is|\\banswer\\s*[:=]|\\btherefore[,:]?|\\bthus[,:]?|\\bhence[,:]?|\\bfinal\\s+answer[,:]?|\\bin\\s+total";
const ARITH_CUES = "[=≈]|→|->|⇒|\\b(?:equals|result\\s+is|gives?|giving|we\\s+get|we\\s+have|leaving|leaves|ends?\\s+up\\s+with|becomes?|yields?|comes?\\s+out\\s+to|total\\s+of)[,:]?";
const SOFT_CUES = "\\b(?:so|is|are|has|have|will\\s+be|will\\s+have)[,:]?";

// Fresh regex per call (global regexes carry lastIndex state — never share one across calls).
const cueRegex = (cues: string): RegExp => new RegExp(`(?:${cues})\\s*:?\\s*${NUM}`, "gi");

export function extractConcludingNumber(explanation: string): number | null {
  if (!explanation) return null;
  const text = stripNumericNoise(explanation);
  // An EXPLICIT final-answer cue wins, so a trailing sanity-check "= 6" can't hijack "the answer is 8".
  const fromStrong = lastCaptured(cueRegex(STRONG_CUES), text);
  if (fromStrong !== null) return fromStrong;
  // Otherwise the last operator/verb-stated result, incl. soft verbs ("the ion has 9", "→ 9",
  // "becomes 9"). This is the broad "is there shown working?" signal (shouldRejectNumericReasoning).
  return lastCaptured(cueRegex(`${ARITH_CUES}|${SOFT_CUES}`), text);
}

// The number a worked explanation DERIVES — strong or arithmetic cues only, no soft factual verbs. This
// is the only conclusion checkAnswerConsistency will reject a question over: a soft-verb trailing number
// ("a nibble is 4 bits") is as often a contrasting distractor as a result, so flagging on it bounces
// correct questions. The independent verify pass re-solves the soft-verb cases this abstains on.
//
// When the final-answer cue's value only starts more arithmetic ("Therefore, 14 - 6 = 8"), the result
// is the first one that arithmetic reaches (8), not the operand: reading 14 there rejected that correct
// question in the 2026-11-14 readiness run. The same goes for the hour of a time or the top of a
// fraction. Without `followThrough` (a key that is not a single value) it abstains there instead, as it
// does when the last "=" result is itself an operand.
// `token` is a regex source whose groups are the value's (the cues have no capturing groups).
function derivedMatch(text: string, token: string, { strongOnly = false, followThrough = true } = {}): RegExpExecArray | null {
  const isResult = (m: RegExpExecArray) => NOT_OPERAND_RE.test(text.slice(m.index + m[0].length));
  const all = (cues: string, from = 0): RegExpExecArray[] => {
    const re = new RegExp(`(?:${cues})\\s*:?\\s*(?:${token})`, "gi");
    re.lastIndex = from;
    const out: RegExpExecArray[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) out.push(m);
    return out;
  };
  const strongs = all(STRONG_CUES);
  const strong = strongs[strongs.length - 1];
  if (strong) {
    if (isResult(strong)) return strong;
    return followThrough ? all(ARITH_CUES, strong.index + strong[0].length).find(isResult) ?? null : null;
  }
  if (strongOnly) return null;
  const ariths = all(ARITH_CUES);
  const arith = ariths[ariths.length - 1];
  return arith && isResult(arith) ? arith : null;
}

function derivedResult(explanation: string, followThrough: boolean): number | null {
  if (!explanation) return null;
  const m = derivedMatch(stripNumericNoise(explanation), NUM, { followThrough });
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

const NUM_TOL = 1e-6;
function numbersAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUM_TOL + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

// ─── Clock times, money and fractions ─────────────────────────────────────────

// numericValueOf refuses "2:15 PM", "$0.45" and "3/4" (it would read 2, 0.45 or 3), so the consistency
// check never saw them. A gemma4:e2b readiness run (2026-11-14) shipped 1:45 PM + 15 min keyed "2:15 PM"
// and 2:30 + 15 min keyed "3:00", each with an explanation that works to the right time. These parse a
// whole answer as one of those three kinds, and only then compare it with the same kind in the
// explanation, so a time key is never compared with "45 minutes". numericValueOf is unchanged:
// free-text grading and the step checkers still defer these to the model.
export type QuantityKind = "time" | "money" | "fraction";
export interface Quantity {
  kind: QuantityKind;
  /** time: minutes after midnight; money: cents; fraction: its value. */
  value: number;
  /** time only: whether the text said AM or PM. Without it a time is compared on a 12-hour clock. */
  meridiem?: boolean;
  /** money only: read from a list of coins ("One dime and one penny") rather than an amount. */
  coins?: boolean;
}

const TIME_SRC = "(?<![\\d:.])(\\d{1,2}):([0-5]\\d)(?![\\d:])(?:\\s*([ap])\\.?\\s?m\\.?(?![a-z]))?";
const FRACTION_SRC = "(?<![\\d/.])(?:(\\d+)\\s+)?(\\d+)\\s*\\/\\s*(\\d+)(?![\\d/]|\\.\\d)";
const MONEY_SRC = "\\$\\s*(\\d+(?:\\.\\d{1,2})?)(?!\\d|\\.\\d)|(?<![\\d.])(\\d+(?:\\.\\d+)?)\\s*(¢|cents?\\b|dollars?\\b)";

function timeOf(m: RegExpExecArray): Quantity | null {
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || (m[3] && (h < 1 || h > 12))) return null;
  if (!m[3]) return { kind: "time", value: h * 60 + min };
  const pm = m[3].toLowerCase() === "p";
  return { kind: "time", value: ((h % 12) + (pm ? 12 : 0)) * 60 + min, meridiem: true };
}

function fractionOf(m: RegExpExecArray): Quantity | null {
  const den = Number(m[3]);
  if (den === 0) return null;
  return { kind: "fraction", value: Number(m[1] ?? 0) + Number(m[2]) / den };
}

function moneyOf(m: RegExpExecArray): Quantity | null {
  if (m[1] !== undefined) return { kind: "money", value: Math.round(Number(m[1]) * 100) };
  const n = Number(m[2]);
  return { kind: "money", value: Math.round(/^dollar/i.test(m[3]) ? n * 100 : n) };
}

const COIN_CENTS: Array<[RegExp, number]> = [
  [/^penn(?:y|ies)$/, 1], [/^nickels?$/, 5], [/^dimes?$/, 10], [/^quarters?$/, 25],
  [/^half[- ]dollars?$/, 50], [/^dollar (?:coins?|bills?)$|^dollars?$/, 100],
];
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

// "One Dime and one Penny", "1 quarter, 2 dimes" → cents. Every part needs a count, so a bare
// "Quarters" or "Dimes and nickels" is not read as a sum.
function coinTotal(text: string): number | null {
  const parts = text.toLowerCase().split(/\s*(?:,\s*(?:and\s+)?|\band\b|\+)\s*/).filter(Boolean);
  if (parts.length === 0) return null;
  let total = 0;
  for (const part of parts) {
    const m = /^(\d+|[a-z]+)\s+(.+)$/.exec(part.trim());
    if (!m) return null;
    const count = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === "a" || m[1] === "an" ? 1 : COUNT_WORDS.indexOf(m[1]);
    if (count < 0) return null;
    const coin = COIN_CENTS.find(([re]) => re.test(m[2].trim()));
    if (!coin) return null;
    total += count * coin[1];
  }
  return total;
}

// The whole answer as a clock time, an amount of money or a fraction, else null. "B) 2:15 PM" →
// 14:15; "$0.45", "45¢", "One Dime and one Penny" → 45, 45, 11 cents; "3/4", "1 1/2" → 0.75, 1.5.
// Anything with other words around it ("about 2:15", "3/4 cup") is not read.
export function quantityOf(s: string): Quantity | null {
  if (!s) return null;
  const t = stripOptionLabel(String(s)).normalize("NFKC").replace(/(\d),(\d{3})(?!\d)/g, "$1$2").trim().replace(/[.!]+$/, "").trim();
  if (!t) return null;
  const whole = (src: string) => new RegExp(`^(?:${src})$`, "i").exec(t);
  let m = whole(TIME_SRC);
  if (m) return timeOf(m);
  m = whole(FRACTION_SRC);
  if (m) return fractionOf(m);
  m = whole(MONEY_SRC);
  if (m) return moneyOf(m);
  const dc = /^(\d+)\s+dollars?\s+(?:and\s+)?(\d+)\s+cents?$/i.exec(t);
  if (dc) return { kind: "money", value: Number(dc[1]) * 100 + Number(dc[2]) };
  const coins = coinTotal(t);
  return coins === null ? null : { kind: "money", value: coins, coins: true };
}

function quantitiesAgree(a: Quantity, b: Quantity): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "time" && !(a.meridiem && b.meridiem)) return (a.value - b.value) % 720 === 0;
  return numbersAgree(a.value, b.value);
}

// The quantity of `kind` an explanation derives, picked the same way as derivedResult ("Therefore,
// 1:45 PM plus 15 minutes = 2:00 PM" derives 2:00 PM). A coin combination as the key is only compared
// with a final-answer cue: coin explanations list "a dime = 10 cents, a nickel = 5 cents" as facts.
function derivedQuantity(explanation: string, kind: QuantityKind, strongOnly: boolean): Quantity | null {
  const src = kind === "time" ? TIME_SRC : kind === "fraction" ? FRACTION_SRC : MONEY_SRC;
  const read = kind === "time" ? timeOf : kind === "fraction" ? fractionOf : moneyOf;
  const text = (explanation ?? "").normalize("NFKC").replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  const m = derivedMatch(text, src, { strongOnly });
  return m ? read(m) : null;
}

// ─── Semantic validation (drives repair-retry) ────────────────────────────────

// A key that is one number, maybe with a unit ("9", "C) 34 units"), not an expression or a phrase
// with a number in it ("3x + y", "Multiplication (2 * 3)"). Only such a key follows a "Therefore"
// through its arithmetic (derivedMatch); for the others the check keeps its old reading.
function isPlainNumber(key: string): boolean {
  const rest = stripNumericNoise(stripOptionLabel(String(key ?? ""))).replace(/-?\d+(?:\.\d+)?/, "").trim();
  return !/[\d+\-×*÷/=()]/.test(rest) && rest.split(/\s+/).filter(Boolean).length <= 2;
}

// A key that is a step to take ("Subtract 7 from both sides", "Divide both sides by 3 to isolate x")
// has no value of its own: its numbers are operands, and the explanation works toward the solution.
// Reading 7 there rejected correct one-step-equation questions (B9 rerun 2, 2026-11-14).
const METHOD_KEY_RE = new RegExp(
  "^(?:add(?:ing)?|subtract(?:ing)?|multipl(?:y|ying)|divid(?:e|ing)|distribut(?:e|ing)|combin(?:e|ing)|" +
  "isolat(?:e|ing)|mov(?:e|ing)|simplif(?:y|ying)|factor(?:ing)?|expand(?:ing)?|collect(?:ing)?|cancel(?:l?ing)?|" +
  "substitut(?:e|ing)|plug(?:ging)?|undo(?:ing)?|rewrit(?:e|ing)|apply(?:ing)?|us(?:e|ing)|tak(?:e|ing)|solv(?:e|ing)|group(?:ing)?)\\b" +
  "|\\bboth\\s+sides\\b",
  "i",
);

// The values an equation key asserts: the number after each "=" that is a result, not the start of
// more arithmetic. "B) 24 ÷ 3 = 8" asserts 8, not 24; "36 ÷ 9 = 4, and 36 ÷ 4 = 9" asserts 4 and 9.
function equationResults(key: string): number[] {
  const t = stripNumericNoise(key);
  const out: number[] = [];
  for (const m of t.matchAll(/(?<![<>!])=\s*(-?\d+(?:\.\d+)?)/g)) {
    if (NOT_OPERAND_RE.test(t.slice(m.index! + m[0].length))) out.push(parseFloat(m[1]));
  }
  return out;
}

// Self-consistency: when a question has a numeric correct_answer AND its explanation DERIVES a number
// (a strong "therefore X" or an arithmetic "… = X" — see derivedResult), the two must agree. Conservative
// on purpose: it ignores soft factual verbs, so a correct question whose explanation merely ends on a
// contrasting distractor ("an octet is 8 bits; a nibble is 4 bits", answer 8) is never falsely flagged —
// only a genuine "works itself to a different number" (the C³⁻ screenshot) is. The independent verify
// pass re-solves the soft-verb cases this abstains on. A key that is a clock time, an amount of money
// or a fraction (quantityOf) is compared with the explanation's value of the same kind instead.
// Returns an issue string or null.
export function checkAnswerConsistency(q: QuestionLike): string | null {
  const typed = quantityOf(q.correct_answer);
  // "6:15" is also how a ratio is written, and 6:15 = 2:5 as a ratio but not as a time.
  if (typed && !(typed.kind === "time" && /\bratios?\b|\bproportions?\b|\bscale\b/i.test(`${q.question_text} ${q.explanation}`))) {
    const derived = derivedQuantity(q.explanation, typed.kind, typed.coins === true);
    if (!derived || quantitiesAgree(typed, derived)) return null;
    return `the explanation works toward a different ${typed.kind === "fraction" ? "fraction" : typed.kind === "time" ? "time" : "amount"} than correct_answer "${q.correct_answer}". ` +
      `Re-solve the problem, end the explanation with "Therefore the answer is <value>", and set correct_answer to that exact value.`;
  }
  const key = stripOptionLabel(String(q.correct_answer ?? "")).trim();
  if (METHOD_KEY_RE.test(key)) return null;
  let ans: number | null;
  let derived: number | null;
  if (/(?<![<>!])=/.test(key)) {
    // An equation key is read by its result(s). An explanation that only restates the stem's fact
    // ("4 × 6 = 24 ... Therefore the answer is B") lands on one of the key's operands: not a contradiction.
    const results = equationResults(key);
    if (results.length === 0) return null;
    derived = derivedResult(q.explanation, true);
    const stated = (stripNumericNoise(key).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (derived === null || stated.some((n) => numbersAgree(n, derived!))) return null;
    ans = results[results.length - 1];
  } else {
    ans = numericValueOf(q.correct_answer);
    if (ans === null) return null;
    derived = derivedResult(q.explanation, isPlainNumber(q.correct_answer));
    if (derived === null) return null;
    if (numbersAgree(ans, derived)) return null;
  }
  return `the explanation works toward ${derived}, but correct_answer is "${q.correct_answer}" (${ans}). ` +
    `Re-solve the problem, end the explanation with "Therefore the answer is <value>", and set correct_answer to that exact value.`;
}

// An explanation that revises itself in front of the learner ("Wait, let's re-evaluate", "Let's adjust
// the options", "Actually, I made a mistake"). gemma4:e2b shipped 21 of these in one readiness run
// (2026-11-14), most with a key that its own corrected working contradicts, and some cut off mid-fix.
// Whatever the key, the explanation is not one to show a child, so the question is rejected and the
// repair/retry path asks again. Each pattern is a revision cue, not a topic word: "wait for the water
// to boil" and "actually" mid-sentence pass.
// Redoing verbs count on their own; looking-again verbs only when aimed at the question or options,
// since "Let's re-read the passage" or "Let's correct the sentence" is teaching, not revising.
const WORK = "(?:options|choices|answers?|calculation|question|problem|prompt)";
const REDO = "re-?(?:evaluate|check|calculate|do|try)|try\\s+again|start\\s+over|" +
  `check\\s+the\\s+${WORK}\\s+again|(?:re-?examine|reconsider|re-?think|re-?read|re-?assess|adjust|fix|correct|change)\\s+the\\s+${WORK}`;
const SELF_CORRECTION_RES: RegExp[] = [
  /(?:^|[.!?:;]\s*|\s[-–—]\s*)wait\s*[,.!:—–-]/i,
  /(?:^|[.!?:;]\s*)(?:actually|oops|hmm+|ah)\s*[,.!:—–-]/i,
  new RegExp(`\\blet(?:'|’)?s\\s+(?:${REDO})\\b`, "i"),
  new RegExp(`\\blet\\s+me\\s+(?:${REDO})\\b`, "i"),
  /(?:^|[.!?:;,(]\s*)re-?(?:evaluating|checking|calculating|examining)(?:\s*:|\s+the\s+\w+\s*:|\s+(?:the\s+)?(?:options|choices|calculation|question|prompt|problem)\b)/i,
  /\bself-correction\b/i,
  /\b(?:i|we)\s+(?:made|have\s+made)\s+(?:a|an)\s+(?:mistake|error)\b/i,
  /\bmy\s+(?:mistake|error|apologies)\b/i,
  /\b(?:on\s+second\s+thought|scratch\s+that|i\s+miscalculated)\b/i,
  /\bnone\s+of\s+the\s+(?:options|choices)\s+(?:match(?:es)?|work|(?:is|are)\s+correct)\b/i,
  /\bintended\s+(?:correct\s+)?(?:answer|choice|option|calculation)\b/i,
];

export function hasSelfCorrection(explanation: string): boolean {
  const text = String(explanation ?? "");
  return SELF_CORRECTION_RES.some((re) => re.test(text));
}

// ─── Options ──────────────────────────────────────────────────────────────────

// An option as a learner reads it: no "A) " label, case, curly or straight quote style, or spacing.
// print('Hello World') and print("Hello World") are the same option to a child, and grading compares
// the exact labelled string, so a child who picks the twin is marked wrong. `keepCase` keeps letter case
// (duplicateOptionPair on a stem about capitals, where "Hello." and "hello." are different answers).
export function normalizeOption(s: string, keepCase = false): string {
  const unlabelled = String(s ?? "")
    .normalize("NFKC")
    .replace(/^\s*\(?[A-Da-d]\s*[).:]\s*/, "");
  return (keepCase ? unlabelled : unlabelled.toLowerCase())
    .replace(/[‘’‚‛′`"“”„‟″]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "")
    .trim();
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const PARTS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4, quarter: 4, quarters: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9, tenth: 10, tenths: 10,
  twelfth: 12, twelfths: 12, hundredth: 100, hundredths: 100,
};

/** A whole number written in words, "seven" or "twenty-one" (0-99), else null. */
function wordNumber(s: string): number | null {
  if (s in SMALL_NUMBERS) return SMALL_NUMBERS[s];
  const m = /^([a-z]+)(?:[\s-]+([a-z]+))?$/.exec(s);
  if (!m || !(m[1] in TENS)) return null;
  if (!m[2]) return TENS[m[1]];
  const unit = SMALL_NUMBERS[m[2]];
  return unit !== undefined && unit >= 1 && unit <= 9 ? TENS[m[1]] + unit : null;
}

/**
 * The number a whole option is, and how it is written: "number" (7, 0.5, .5, 0.50, 1,000), "percent" (50%,
 * 50 percent), "fraction" (1/2, 2/4, 1 1/2) or "words" (seven, one half, three quarters, half). Null for any
 * other option: one with a unit, an expression ("2 + 3") or other words is never read as a number.
 */
export function optionNumber(option: string): { value: number; form: "number" | "percent" | "fraction" | "words" } | null {
  const s = normalizeOption(option).replace(/[.!?]+$/, "").trim();
  let m: RegExpExecArray | null;
  if ((m = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/.exec(s)) && (m[2] || m[3])) {
    return { value: Number(`${m[1]}${(m[2] ?? "0").replace(/,/g, "")}.${m[3] ?? "0"}`), form: "number" };
  }
  if ((m = /^(-?\d+(?:\.\d+)?)\s*(?:%|percent|per cent)$/.exec(s))) return { value: Number(m[1]) / 100, form: "percent" };
  if ((m = /^(-?)(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(s)) && Number(m[4]) !== 0) {
    const v = Number(m[2] ?? 0) + Number(m[3]) / Number(m[4]);
    return { value: m[1] ? -v : v, form: "fraction" };
  }
  const whole = wordNumber(s);
  if (whole !== null) return { value: whole, form: "words" };
  if ((m = /^(?:(a|an|\d+|[a-z]+)[\s-]+)?([a-z]+)$/.exec(s)) && m[2] in PARTS) {
    const count = !m[1] || m[1] === "a" || m[1] === "an" ? 1 : /^\d+$/.test(m[1]) ? Number(m[1]) : wordNumber(m[1]);
    if (count !== null) return { value: count / PARTS[m[2]], form: "words" };
  }
  return null;
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// A stem about how a number is written, where "1/2" and "0.5", or "0.5" and "0.50", are different answers:
// "Which is a decimal?", "Write 2/4 in simplest form.", "Round 0.496 to the nearest hundredth.", "Which
// shows one thousand with a comma?", "Which fraction has 8 as its denominator?", "What is the ordinal for 3?",
// "Which number uses a hyphen correctly?", "Which uses the correct article?".
const ABOUT_WRITTEN_FORM = /\b(?:decimals?|percents?|percentages?|fraction form|as an? (?:fraction|decimal|percent|whole number|mixed number)|simplest|lowest terms|simplif\w*|reduc\w*|written|write|writes|writing|notation|numerals?|words?|word form|standard form|expanded form|improper|mixed numbers?|unsimplified|numerators?|denominators?|ordinals?|commas?|digits?|places?|nearest|spell\w*|hyphen\w*|articles?)\b/i;

// An option that the stem itself names, as a number ("Which is greater: 0.5 or 0.50?" with "They are equal").
function stemNames(stem: string, option: string): boolean {
  const o = normalizeOption(option).replace(/[.!?]+$/, "");
  return o !== "" && new RegExp(`(?<![\\w.])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w|\\.\\d)`).test(stem.toLowerCase());
}

// Two options that both start with an article and differ only in it ("a eighth" / "an eighth"): what an
// English question asks about, so not the key's number written another way. A hyphen or a space
// ("twenty-one" / "twenty one") is still the key's number unless the stem asks how it is written ("Which is
// spelled correctly?", ABOUT_WRITTEN_FORM): on a math stem a learner who picks it is right.
function articleOnly(a: string, b: string): boolean {
  const x = /^(an?) (.*)$/.exec(normalizeOption(a));
  const y = /^(an?) (.*)$/.exec(normalizeOption(b));
  return !!x && !!y && x[1] !== y[1] && x[2] === y[2];
}

// A stem about capital letters, where "Hello." and "hello." are different answers: "Which word needs a
// capital letter?", "Which is capitalized correctly?", "Which is a proper noun?". Not a bare "capital"
// ("What is the capital of France?" with "Paris" and "paris" is still caught), nor "capitalism" ("Capitalism"
// and "capitalism" are one answer; review of the #252 port). Fable's decision for
// TerraTutor #252, 2026-11-19, as the maintainer's delegate: a case-only twin from a generation audit ("The
// Normal Force." / "the normal force") marks a learner wrong, a capitals question whose stem doesn't say so
// only costs a rewrite.
const ABOUT_CAPITALS = /capitali[sz](?:e|ed|es|ing|ation)\b|capital letter|(?:start|begin)s? with an? capital|upper[ -]?case|lower[ -]?case|proper noun/i;

// The first pair of options a learner can't tell apart, as their indices, or null: the same option once a
// label, case, quotes, spacing and a closing period are set aside (normalizeOption; "Hello!" and "Hello.",
// "a apple" and "an apple", "ice-cream" and "ice cream" stay apart, since that is what an English question
// asks, and so do "Hello." and "hello." when the stem is about capitals, ABOUT_CAPITALS), or the same
// number written the same way ("0.5" and "0.50", "1,000" and "1000", "50%" and "50 percent") unless the
// stem is about how a number is written (ABOUT_WRITTEN_FORM) or names both options ("Which is greater:
// 0.5 or 0.50?").
export function duplicateOptionPair(options: readonly string[], stem = ""): [number, number] | null {
  const seen = new Map<string, number>();
  const numbers = ABOUT_WRITTEN_FORM.test(stem) ? options.map(() => null) : options.map(optionNumber);
  const keepCase = ABOUT_CAPITALS.test(stem);
  for (let i = 0; i < options.length; i++) {
    const k = normalizeOption(options[i], keepCase);
    const j = seen.get(k);
    if (j !== undefined) return [j, i];
    seen.set(k, i);
    const a = numbers[i];
    for (let h = 0; a && a.form !== "fraction" && a.form !== "words" && h < i; h++) {
      const b = numbers[h];
      if (b && b.form === a.form && sameNumber(a.value, b.value) && !(stemNames(stem, options[h]) && stemNames(stem, options[i]))) return [h, i];
    }
  }
  return null;
}

/**
 * The index of an option other than the key that is the key's number written another way ("0.5" for the
 * key "1/2", "seven" for "7", "2/4" for "1/2", "50%" for "one half"), or null. A learner who picks it is
 * right but would be marked wrong. Not when the stem asks about how a number is written (ABOUT_WRITTEN_FORM),
 * nor for an option that differs from the key only in "a" against "an" (articleOnly).
 */
export function optionEqualToKey(options: readonly string[], key: string, stem: string): number | null {
  const k = optionNumber(key);
  if (!k || ABOUT_WRITTEN_FORM.test(stem)) return null;
  const keyAt = options.indexOf(key);
  for (let i = 0; i < options.length; i++) {
    if (i === keyAt) continue;
    const o = optionNumber(options[i]);
    if (o && sameNumber(o.value, k.value) && !articleOnly(options[i], key)) return i;
  }
  return null;
}

// The side of a drag-to-match question ("left" or "right") on which two items read the same, or null.
// QuestionRenderer pairs items by their text and lets each right item hold one left, so with "Mammal"
// twice on the right (dog, whale, frog) at most two pairs can be made, Submit never shows, and the
// quiz or level test can never be finished.
export function repeatedMatchSide(pairs: ReadonlyArray<{ left: string; right: string }>): "left" | "right" | null {
  for (const side of ["left", "right"] as const) {
    if (new Set(pairs.map((p) => normalizeOption(p[side]))).size < pairs.length) return side;
  }
  return null;
}

// ─── The sentence a fill-in-the-blank question asks ───────────────────────────

// The learner fills in blank_position ("Water vapor cools and turns back into liquid during ___."),
// which the renderer shows in place of question_text; question_text can be only "Fill in the blank.".
// So whatever checks the key or the learner's answer (the content review, the verify pass, the grader)
// gets the sentence too. Every other question, and one whose question_text already holds the sentence,
// is its question_text unchanged.
export function questionWithSentence(q: { question_text: string; question_type: string; blank_position?: string | null }): string {
  const sentence = (q.blank_position ?? "").trim();
  if (q.question_type !== "fill_in_blank" || !sentence || q.question_text.includes(sentence)) return q.question_text;
  return `${q.question_text}
Sentence: ${sentence}`;
}

// ─── Letter references in an explanation ──────────────────────────────────────

// Prompts ask the model to end with "Therefore the answer is X", and gemma4:e2b often writes the
// letter ("the answer is C", "Option A is 2:45"). quiz.ts shuffles the options afterwards, so the
// letter then names a different option than the one the learner sees as correct (273 of 366 such
// explanations in the 2026-11-14 readiness run). These find those references so the shuffle can
// rename them. Upper-case A–D only, and only after "option(s)", "choice(s)" or "answer is/:/=":
// "Option A", "options A and C", "choice (B)", "the answer is C." or "answer: D) 2:15 PM". A bare
// "C) " is not read, since "(Middle C) " and "P(A) " are not references, and neither is "the letter
// A", which in a phonics explanation is the letter itself.
const OPTION_REF_SRC = "\\b(?:[Oo]ptions?|[Cc]hoices?)\\s+\\(?[A-D]\\)?(?:\\s*(?:,|and|or)\\s*\\(?[A-D]\\)?)*(?![A-Za-z0-9'’])";
const ANSWER_REF_SRC = "\\b[Aa]nswer\\s*(?:is|[:=])\\s*\\(?[A-D]\\)?(?=\\s*$|\\s*[).,;:!?]|\\s+(?:because|since|as)\\b)";

/** Rewrite every letter reference in `text` with `map(letter)` (null leaves that letter as it is). */
export function rewriteLetterRefs(text: string, map: (letter: string) => string | null): string {
  const re = new RegExp(`${OPTION_REF_SRC}|${ANSWER_REF_SRC}`, "g");
  return String(text ?? "").replace(re, (span) => {
    // Keep the keyword ("Option", "answer"); rename only the letters after it.
    const word = /^[A-Za-z]{2,}/.exec(span)?.[0] ?? "";
    return word + span.slice(word.length).replace(/[A-D]/g, (l) => map(l) ?? l);
  });
}

// The small-model "numeric reasoning trap": multi-step arithmetic / unit-conversion / derivation
// questions, where a 4B model frequently stores an answer that contradicts its own work. The steer in
// buildBatchPrompt already asks small models to AVOID these; this lets the validator ENFORCE it on the
// tiny/small tier (→ repair-retry regenerates a conceptual question). Recall-style numeric questions
// ("how many bones…", with no quantities in the stem) are intentionally NOT caught.
export function isNumericReasoningQuestion(q: QuestionLike): boolean {
  if (numericValueOf(q.correct_answer) === null) return false;
  const stem = q.question_text ?? "";
  const hasArithExpr = /\d\s*[+\-×*x÷/]\s*\d/i.test(stem);
  const wordCue = /\bhow many\b|\bhow much\b|\bcalculate\b|\bcompute\b|\bconvert\b|\bsolve\b|\bwhat is the (value|result|sum|product|difference|quotient|total|speed|rate)\b/i.test(stem);
  const unitRate = /\b\d+(?:\.\d+)?\s?(ml|l|g|kg|mg|cm|mm|km|m|°c|°f|mol|moles?|j|kj|s|sec|min|hr|hours?|mph|m\/s)\b/i.test(stem) || /\bper\b/i.test(stem);
  const multiQuantity = countNumbers(stem) >= 2;
  // Numeric answer already confirmed above. Flag explicit arithmetic, or a calculation/unit/rate cue
  // that actually has quantities in the stem (so recall-style "how many bones…" stays untouched).
  return hasArithExpr || ((wordCue || unitRate || multiQuantity) && countNumbers(stem) >= 1);
}

// The small-tier numeric-trap gate, as a pure predicate so validateQuizBatch's wiring is testable
// without importing the Tauri-coupled quiz.ts. On tiny/small a multi-step numeric question with no
// shown working is rejected (→ repair-retry: go conceptual or show the work).
export function shouldRejectNumericReasoning(q: QuestionLike, tier?: string): boolean {
  const small = tier === "tiny" || tier === "small";
  return small && isNumericReasoningQuestion(q) && extractConcludingNumber(q.explanation) === null;
}

// Whether quiz.ts runs the independent verify pass (verifyAndFilter). The #83 audit put it on every tier
// but tiny so that "the floor model" ran it; the floor model was gemma4:e4b, a "small". Below 16 GB the
// default is now gemma4:e2b, which tiers as tiny, so a tier-only gate would quietly drop the answer-key
// re-check on every 8 GB machine. The shipped defaults therefore run it whatever their tier. Not yet
// measured on e2b: a weak verifier can only cost questions (it drops on explicit disagreement, and
// top-up refills), and a short quiz is a better failure than a wrong answer key taught to a learner.
export function runsVerifyPass(tier: string | undefined, model: string): boolean {
  return tier !== "tiny" || isOllamaDefaultModel(model);
}

// ─── Generation count + dedupe helpers (the quiz.ts top-up loop) ───────────────

// Split `total` questions across `buckets`, as evenly as possible (remainder to the first buckets).
// Pure — the arithmetic behind both the even per-subtopic split and the top-up shortfall redistribution.
export function splitCount(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(Math.max(0, total) / buckets);
  let rem = Math.max(0, total) - base * buckets;
  return Array.from({ length: buckets }, () => base + (rem-- > 0 ? 1 : 0));
}

// Round-robin assignment of `total` question slots across `numSubtopics` subtopics — interleaved
// (slot i → subtopic i % n) so coverage spreads from the very first questions, and the remainder lands
// on the earliest subtopics (same per-subtopic balance as splitCount). One question is generated per
// slot (issue #83: one-call-per-question is far more reliable + higher quality on a 4B model than
// asking for a whole batch in a single constrained JSON call). Pure.
export function planSlotSubtopics(numSubtopics: number, total: number): number[] {
  if (numSubtopics <= 0 || total <= 0) return [];
  return Array.from({ length: total }, (_, i) => i % numSubtopics);
}

// One-line summary of a generated question, fed into later single-question calls as a "don't repeat
// these" ledger so independent calls still cover distinct ideas (the user's per-question-identifier
// idea, auto-derived from the stem so the small model needn't emit an extra field). Pure.
export function summarizeForLedger(q: { question_text: string; subtopic_id?: string | null }): string {
  const sid = (q.subtopic_id ?? "").trim();
  const stem = q.question_text.trim().replace(/\s+/g, " ").slice(0, 90);
  return sid ? `[${sid}] ${stem}` : stem;
}

export const questionKey = (text: string): string => text.trim().toLowerCase();

/** A question an earlier quiz asked, as db.ts getRecentQuizQuestions reads it (quiz.ts GenPlan.earlier). */
export interface EarlierQuestion {
  question_text: string; correct_answer: string; subtopic_id?: string | null;
  question_type: string; blank_position?: string | null; matching_pairs?: Array<{ left: string; right: string }> | null;
  /** The quiz that asked it (quiz_questions.attempt_id): quiz.ts never asks the last quiz's questions again. */
  attempt_id?: string | null;
}

/**
 * What a question asks, to tell it from another: questionWithSentence, and a drag-to-match question's left
 * items. A fill-in-the-blank's question_text can be only "Fill in the blank." and a matching one's "Match
 * each word to its meaning.", so two different questions can share it word for word.
 */
export function askedText(q: {
  question_text: string; question_type: string; blank_position?: string | null;
  matching_pairs?: ReadonlyArray<{ left: string; right: string }> | null;
}): string {
  const text = questionWithSentence(q);
  const lefts = q.question_type === "drag_to_match" ? (q.matching_pairs ?? []).map((p) => p.left).filter(Boolean) : [];
  return lefts.length ? `${text}\nPairs: ${lefts.join(", ")}` : text;
}

// A stem's words and numbers in order: lower case, punctuation dropped, "2:30" and "3/4" kept whole so
// two clock questions that differ only in the time stay apart.
function stemWords(text: string): string[] {
  return String(text ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[:/.,][\p{N}]+)*/gu) ?? [];
}

export const NEAR_DUPLICATE_OVERLAP = 0.85;

// A key that is a number at heart: a number standing on its own (not a formula's count, "SiO2", "H2O"),
// with at most two words around it: "12", "-3", "$5", "3/4", "2:30 PM", "5 cm", "45 square meters",
// "x = 4". TerraTutor live test part 9 issue 1: any key with a digit counted as a number, so "The percentage of
// silica (SiO2) content" escaped the same-key cap and was asked 3 times in one level-test section.
function numericKey(key: string): boolean {
  if (!/(?:^|[^\p{L}\p{N}])[-+−$€£]?\p{N}/u.test(key)) return false;
  return (key.match(/\p{L}+/gu) ?? []).length <= 2;
}

// A key as the repeat checks compare it: normalizeOption, and for a key that is not a number at heart
// (numericKey) also without a leading "the", "a" or "an" and without punctuation, so "The Cell Membrane"
// and "cell membrane." are one key (TerraTutor live test part 8 issue 2), and so are "The percentage of silica (SiO2)
// content" and "percentage of silica (SiO2) content." (part 9 issue 1). The apostrophe stays: "it's" /
// "its", "we'll" / "well" and "can't" / "cant" are the pairs a grammar question contrasts. A numeric key
// loses only end punctuation ("12!" is "12"): "-3" and "3", "$5" and "5" are different answers. Symbols
// stay too ("<" / ">", "+" / "-", "Na+" / "Na" are different answers), and a key that is only
// punctuation is left as normalizeOption reads it, so it never becomes "" and matches every other such
// key. A hyphen that ends a word, before a space, punctuation, a quote or the end, is a minus sign
// ("Cl-" / "Cl", "OH-" / "OH", "Cl-, Na+" / "Cl, Na+", a quoted "Cl-"), so it is kept, as "−"; one inside
// a word ("Cell-membrane") or standing alone between words still goes. A minus before a number keeps
// its sign ("-5 degrees at the summit" is not "5 degrees ..."), and a decimal point between digits stays
// ("pH 7.4 in blood" is not "pH 7 4 ..."). So a word prefix written with a
// hyphen ("un-", "pre-") is another key than the bare prefix ("un", "pre"), and SAME_KEY_CAP can let 4
// questions on one prefix through, 2 each way; rare. Only for telling repeats apart; grading never reads it.
export function keyForm(s: string): string {
  const k = normalizeOption(s);
  if (numericKey(k)) return k.replace(/[.,;:!?]+$/, "").trim() || k;
  const stripped = k.replace(/(?<=\S)-(?=[\s,;:!?.)\]'"/]|$)/g, "−").replace(/(?<![\p{L}\p{N}])-(?=\p{N})/gu, "−")
    .replace(/(?:(?!(?<=\p{N})\.(?=\p{N}))[^\p{L}\p{M}\p{N}\p{S}'\s])+/gu, " ").replace(/\s+/g, " ").trim().replace(/^(?:the|an?) (?=\S)/, "");
  return stripped || k;
}

// Keys that many different questions share as a matter of course: true / false, a matching question's
// "See matching_pairs", an option letter, a number, fraction, clock time, amount of money or expression
// ("12", "seven", "three quarters", "2:30", "two dimes", "5 cm", "x = 4"; numericKey, not any key with a
// digit, so "SiO2" is counted), and a classification's pick: a key the stem names
// itself ("Is 8 even or odd?", "Is ice a solid, liquid or gas?") or a multiple-choice question with 3 or
// fewer options (even / odd, noun / verb, fact / opinion). K-1 content leans on these.
function routineKey(q: NearDuplicateQ, key: string): boolean {
  if (q.question_type === "true_false" || q.question_type === "drag_to_match") return true;
  if (key === "true" || key === "false" || LETTER_KEY_RE.test(key)) return true;
  if (numericKey(key) || optionNumber(key) !== null || quantityOf(key) !== null) return true;
  if (q.question_type === "multiple_choice" && (q.options?.length ?? 0) > 0 && (q.options?.length ?? 0) <= 3) return true;
  const kw = stemWords(key);
  const sw = stemWords(q.question_text);
  return kw.length > 0 && sw.some((_, i) => kw.every((w, j) => sw[i + j] === w));
}

/** The key the same-key cap reads (quiz.ts SAME_KEY_CAP): keyForm, or null for a blank key and a routine
 *  one (true / false, a matching question, a number, fraction, time or money, a classification's pick). */
export function sameKeyForm(q: NearDuplicateQ): string | null {
  const key = keyForm(String(q.correct_answer ?? ""));
  return !key || routineKey(q, key) ? null : key;
}

// The stem's last clause, the part that asks: its words after the last ",", ".", ";", ":", "?" or "!"
// followed by a space ("..., and you eat 7 of those slices, what does the number 7 represent in the
// fraction 7/10?" -> "what does the number 7 represent in the fraction 7/10").
function lastClause(text: string): string {
  const parts = String(text ?? "").trim().split(/[,.;:?!]\s+/u);
  return stemWords(parts[parts.length - 1] ?? "").join(" ");
}

/** What isNearDuplicate reads. Without question_type a question never takes the free-text rule
 *  (hasFreeTextKey) or the 3-option classification pick, so it is matched on an equal key or as a
 *  reworded repeat (isRewordedRepeat). */
export interface NearDuplicateQ {
  question_text: string; correct_answer?: string; question_type?: string; options?: readonly string[] | null;
}

// The only question types whose key is in the child's own words. A word problem's key is a value or a
// short pick ("red apples" / "green apples"), so it keeps the equal-key rule.
const FREE_TEXT_TYPES = new Set(["short_answer", "fill_in_blank"]);

// A key in the child's own words: a short-answer or fill-in-the-blank key with no digit in it that is
// not a number word ("seven", "three quarters"), an option letter, or one of the question's options.
// Two such keys can say the same thing in other words ("the number of parts taken" / "the number of
// slices you ate"), so comparing them as strings misses a reworded repeat (click test 2026-11-19 part 6).
// An EarlierQuestion carries no options; the type check alone keeps option-keyed questions out.
function hasFreeTextKey(q: NearDuplicateQ): boolean {
  const key = String(q.correct_answer ?? "").trim();
  if (!key || !FREE_TEXT_TYPES.has(q.question_type ?? "") || (q.options?.length ?? 0) > 0) return false;
  if (/\p{N}/u.test(key) || LETTER_KEY_RE.test(key) || optionNumber(key) !== null || quantityOf(key) !== null) return false;
  return true;
}

// Pronouns are not a shared content word: "she is kind" / "she is unkind and rude" about the same story
// character share only "she" (review of OpenEdu's port of TerraTutor #259).
const KEY_PRONOUNS = new Set(["he", "she", "him", "her", "his", "hers", "they", "them", "their", "theirs",
  "we", "us", "our", "ours", "your", "yours", "mine", "these", "those", "there",
  "himself", "herself", "itself", "themselves", "myself", "yourself", "yourselves", "ourselves"]);

// Two questions a learner would see as the same one: a stem whose words are at least
// NEAR_DUPLICATE_OVERLAP inside the other's (overlap coefficient: shared words over the shorter stem's,
// so a restatement with a few extra words still counts), and either
// - the same answer (option text, no label). Exact repeats were already dropped; the 2026-11-14
//   readiness run still had 61 such pairs inside single quizzes and tests ("What tool is used to
//   measure how hot or cold the air is?" / "Which tool is specifically used to ..."); or
// - two free-text keys (hasFreeTextKey) that share a content word, the same numbers in the same order,
//   and the same last clause word for word (lastClause), so only the setup may differ. The click test
//   (2026-11-19 part 6) asked "... and you take 7 of those slices, what does the number 7 represent in
//   the fraction 7/10?" (key "the number of parts taken") and, in the next quiz, the same with "eat"
//   (key "the number of slices you ate"). The order keeps "what does 7 represent in 7/10" apart from
//   "what does 10 represent in 7/10". The last clause keeps apart a short stem with the one word it asks
//   about swapped, whose keys often share a word: "what does the numerator tell you?" / "the
//   denominator", the job of the roots / of the leaves ("to take in water" / "to take in sunlight"),
//   evaporation / condensation, the main idea of the first / second paragraph.
// Otherwise two different keys are never duplicates, however alike the stems ("15 minutes after 2:30"
// vs "after 1:45"; a multiple-choice "B) Numerator" vs "C) Denominator").
// Keys are compared as keyForm reads them ("The Cell Membrane" = "cell membrane"). A question asked again
// in other words with its key reworded too is caught by isRewordedRepeat. Many questions with one key and
// different stems are not caught here; quiz.ts SAME_KEY_CAP caps them instead.
export function isNearDuplicate(a: NearDuplicateQ, b: NearDuplicateQ): boolean {
  if (a.correct_answer === undefined || b.correct_answer === undefined) return false;
  const wa = stemWords(a.question_text);
  const wb = stemWords(b.question_text);
  const sameKey = keyForm(a.correct_answer) === keyForm(b.correct_answer);
  if (!sameKey && !freeTextRepeat(a, b, wa, wb)) return isRewordedRepeat(a, b, false);
  const ta = new Set(wa);
  const tb = new Set(wb);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= NEAR_DUPLICATE_OVERLAP || isRewordedRepeat(a, b, sameKey);
}

// Two free-text keys in other words that may name the same answer (isNearDuplicate's second case).
function freeTextRepeat(a: NearDuplicateQ, b: NearDuplicateQ, wa: string[], wb: string[]): boolean {
  if (!hasFreeTextKey(a) || !hasFreeTextKey(b)) return false;
  const keyWords = new Set(contentWords(String(a.correct_answer)).filter((w) => !KEY_PRONOUNS.has(w)));
  if (!contentWords(String(b.correct_answer)).some((w) => keyWords.has(w))) return false;
  if (stemNumbers(wa) !== stemNumbers(wb)) return false;
  return lastClause(a.question_text) === lastClause(b.question_text);
}

const stemNumbers = (w: string[]) => w.filter((t) => /\p{N}/u.test(t)).join(" ");

// Words that frame a question rather than say what it asks: "Which of the following best describes the
// fundamental difference ..." and "... the main difference ..." ask one thing, as do "the primary role
// of the cytoplasm" and "the primary function of the cytoplasm" (TerraTutor live test part 9 issue 2).
const FRAMING_WORDS = new Set(["which", "following", "best", "describes", "describe", "described",
  "statement", "statements", "accurately", "correctly", "primary", "primarily", "main", "mainly",
  "fundamental", "fundamentally", "key", "basic", "core", "central", "major", "typically", "generally",
  "usually", "specifically", "role", "function"]);
// A contraction ("isn't", "doesn't", "can't") splits into no negation word, so isRewordedRepeat also
// reads NEGATED_CONTRACTION ("Which of these describes basaltic lava?" / "... doesn't describe ...").
const NEGATIONS = new Set(["not", "never", "except", "least", "no", "none", "incorrect", "untrue", "false", "cannot"]);
const NEGATED_CONTRACTION = /n['’]t\b/gu;
/** The share of the two stems' asked words both have, at least, for isRewordedRepeat (measured: 0.5). */
const REWORDED_STEM_SHARE = 0.5;
/** The share of the shorter key's content words the other key has, at least (measured: 0.5). */
const REWORDED_KEY_SHARE = 0.5;
/** And the content words the two keys share, at least: sharing only the head noun of a two-word key
 *  ("Covalent bond" / "Ionic bond", "The inner core" / "The outer core") is a mirror question. */
const REWORDED_KEY_MIN_SHARED = 2;
/** Words a reworded stem adds without asking anything new, read from the labelled repeats ("within a
 *  cell", "a defining characteristic", "a key tenet of", "primarily responsible for", "the main
 *  structural difference"). Only for stems whose keys differ (addsQualifier). */
const ADDED_FILLER_WORDS = new Set(["within", "characteristic", "defining", "tenet", "responsible", "structural"]);

/**
 * True when the longer stem adds an asked word to the shorter one (isRewordedRepeat, `long` holds all of
 * `short`) that is not ADDED_FILLER_WORDS and not in an "and ..." it ends with whose words are all new
 * (an "and" the shorter stem already has excuses nothing). A qualifier that narrows the question changes
 * its answer: "What causes the tides on Earth?" / "... the highest tides ...", "... to make food?" / "...
 * without sunlight?", "... a front ..." / "... a cold front ..." (OpenEdu #407's review of the #265 port:
 * all merged). An "and ..." at the end asks for more of the same answer ("... its flow behavior?" / "...
 * flow behavior and resulting eruption style?", TerraTutor live test part 9, level test #13 / #35).
 * Ported from TerraTutor #267.
 */
function addsQualifier(short: ReadonlySet<string>, long: ReadonlySet<string>, longText: string): boolean {
  const lower = String(longText ?? "").toLowerCase();
  const and = lower.lastIndexOf(" and ");
  // Only an "and ..." the shorter stem has none of the words of: after an "and" both stems share ("plants
  // and animals need to live" / "... to live in the desert"), the words are a qualifier like any other.
  const tailWords = and < 0 ? [] : contentWords(lower.slice(and + 5));
  const tail = new Set(tailWords.some((w) => short.has(w)) ? [] : tailWords);
  return [...long].some((w) => !short.has(w) && !ADDED_FILLER_WORDS.has(w) && !tail.has(w));
}

// A question asked again in other words, with its key in other words too (TerraTutor live test part 9 issue 2: a
// quiz asked "The cell membrane's primary role in relation to the cytoplasm is to:" and "What is the
// primary role of the cell membrane in relation to the cytoplasm?", keyed "To act as a barrier separating
// the cell's interior from the outside environment" and "To separate the cell's interior from the
// outside environment"; a level test asked about a low-silica magma's flow, and again with "and
// resulting eruption style" added, keyed "Low viscosity, allowing for easy, effusive lava flows" and
// "Low viscosity, leading to effusive eruptions"). All of:
// - neither key is routine (sameKeyForm): true / false, a number, a classification's pick;
// - neither is a fill-in-the-blank question, whose question_text can be only "Fill in the blank.";
// - one stem's asked words (content words less FRAMING_WORDS) all in the other's, and at least
//   REWORDED_STEM_SHARE of the two together shared, so the longer stem only adds to the shorter: a
//   question that swaps the word it asks about ("high silica" / "low silica", "numerator" /
//   "denominator", "roots" / "leaves", "ion" / "atom") is two questions;
// - the same negations ("Which is NOT ...", "... isn't ...") and the same numbers in the same order;
// - an equal key (`sameKey`), or two keys that share at least REWORDED_KEY_SHARE of the shorter one's
//   content words (not a pronoun), and at least REWORDED_KEY_MIN_SHARED of them, and do not have the
//   same words: keys with the same words in another order or with another symbol ("liquid water turning
//   into water vapor" / "water vapor turning into liquid water", "Na+" / "Na") are different answers, and
//   so are two-word keys that share only their head noun, for a stem that adds the one qualifier that
//   changes the answer ("... between two atoms?" Covalent bond / "... two atoms that transfer electrons?"
//   Ionic bond; "made of iron" / "made of liquid iron");
// - with keys that differ, a longer stem that adds a qualifier (addsQualifier): "the highest tides" /
//   "the tides", "a cold front" / "a front", "Intrusive igneous rock" / "Igneous rock" after a stem that
//   adds "intrusive" are two questions.
// Bars measured on the labelled pairs in __fixtures__/near-repeat-pairs.json (quiz-near-repeat.test.ts): 28 of
// the 34 repeats in the saved live quizzes and tests caught, 0 of the 96 different pairs merged, the 20
// qualifier pairs (OpenEdu #407) and the 6 with a qualifier after a shared "and" (TerraTutor #267's review)
// included. Before addsQualifier: 28 of 34 and 0 of 70, and all 20 qualifier pairs merged; with the "and"
// tail excused even after a shared "and", all 6 of those merged. ADDED_FILLER_WORDS and the "and" tail
// were read off those repeats, so 28 is in-sample.
function isRewordedRepeat(a: NearDuplicateQ, b: NearDuplicateQ, sameKey: boolean): boolean {
  if (a.question_type === "fill_in_blank" || b.question_type === "fill_in_blank") return false;
  const ka = sameKeyForm(a);
  const kb = sameKeyForm(b);
  if (ka === null || kb === null) return false;
  const asked = (t: string) => {
    const lower = String(t ?? "").toLowerCase();
    const not = [...lower.split(/[^\p{L}\p{N}]+/u).filter((w) => NEGATIONS.has(w)), ...(lower.match(NEGATED_CONTRACTION) ?? []).map(() => "n't")];
    return { words: new Set(contentWords(t).filter((w) => !FRAMING_WORDS.has(w))), not: not.join(" ") };
  };
  const sa = asked(a.question_text);
  const sb = asked(b.question_text);
  const [short, long, longText] = sa.words.size <= sb.words.size ? [sa.words, sb.words, b.question_text] : [sb.words, sa.words, a.question_text];
  if (short.size === 0 || [...short].some((w) => !long.has(w))) return false;
  if (short.size / new Set([...short, ...long]).size < REWORDED_STEM_SHARE) return false;
  if (sa.not !== sb.not || stemNumbers(stemWords(a.question_text)) !== stemNumbers(stemWords(b.question_text))) return false;
  if (sameKey) return true;
  if (addsQualifier(short, long, longText)) return false;
  const wa = new Set(contentWords(ka).filter((w) => !KEY_PRONOUNS.has(w)));
  const wb = new Set(contentWords(kb).filter((w) => !KEY_PRONOUNS.has(w)));
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  if (shared === wa.size && shared === wb.size) return false;
  if (shared < REWORDED_KEY_MIN_SHARED) return false;
  return shared / Math.min(wa.size, wb.size) >= REWORDED_KEY_SHARE;
}

// Keep the first occurrence of each distinct question; drop blanks, exact repeats (by normalized text)
// and near-duplicates of an earlier one (isNearDuplicate). The top-up loop re-asks subtopics, so this
// guards against the model repeating a question across rounds.
export function dedupeByQuestionText<T extends NearDuplicateQ>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = questionKey(it.question_text);
    if (!k || seen.has(k) || out.some((o) => isNearDuplicate(o, it))) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// ─── Deterministic free-text grading ──────────────────────────────────────────

const NUMERIC_SHORTCIRCUIT_TYPES = new Set(["fill_in_blank", "short_answer", "word_problem"]);

// Grade a free-text answer WITHOUT a model when a string/number compare settles it. Returns true on a
// confident match, otherwise null (defer to the LLM batch). Never returns false — a deterministic
// "wrong" would risk failing a correct-but-differently-worded answer, which is exactly what the LLM
// grader is for. So this only ever short-circuits the obvious-correct case.
export function gradeFreeTextDeterministic(expected: string, student: string, type: string): boolean | null {
  const e = normalizeAnswer(expected);
  const s = normalizeAnswer(student);
  if (!e || !s) return null;
  if (e === s) return true;

  // Numeric match for value-style answers (the expected is essentially a number, optionally + unit).
  // A digit straight after a letter is a formula's count ("H2O", "CO2"), not a value: both read as 2,
  // which passed "CO2" for "H2O" (dev set, 2026-11-14). A unit comes after its number, so "12cm" stays.
  const formula = /\p{L}\d/u;
  if (NUMERIC_SHORTCIRCUIT_TYPES.has(type) && !formula.test(expected) && !formula.test(student)) {
    const en = numericValueOf(expected);
    const sn = numericValueOf(student);
    const expectedIsBasicallyNumeric = en !== null && e.replace(/-?\d+(?:\.\d+)?/, "").trim().length <= 6;
    // One number, not negated: "6 or 8" and "not 6" both start with 6 but are not the answer 6.
    const oneNumber = countNumbers(stripNumericNoise(stripOptionLabel(student))) === 1 && !/\b(?:not|no|never|isn'?t|aren'?t)\b/i.test(student);
    if (en !== null && sn !== null && expectedIsBasicallyNumeric && oneNumber && numbersAgree(en, sn)) return true;
  }
  return null;
}

// ─── Batched grading (one LLM call for many free-text answers) ─────────────────

export interface GradeItem {
  index: number;     // stable id back to the caller's question list
  question: string;
  expected: string;
  student: string;
  type: string;
  /** A note code adds for the model ('"skelitin" may be a misspelling of "skeleton"'), never a verdict. */
  note?: string | null;
}

// How an answer was marked, stored as quiz_questions.graded_by (migration 18) so the stored history
// says which marks came from the answer key and which from the model. 'key': compared with
// the answer key as the learner answered (multiple choice, true/false, matching). 'exact': code's
// verdict on a written answer (answer-match.ts settleByCode): a string or number match, or, on a number
// and unit, a different amount (wrong), or an answer that answers nothing ("xyz", non-answer.ts; wrong).
// 'model': the grader model's verdict. 'fallback': the
// grader failed or skipped the item and the answer was passed leniently. 'unanswered': a timed-out
// level test's unanswered question, scored wrong. 'self': a level test's written answer no model
// checked, which the learner then marked against the answer key (level-test.ts).
export type GradedBy = "key" | "exact" | "model" | "fallback" | "unanswered" | "self";

export interface GradeOutcome { isCorrect: boolean; feedback: string; by: GradedBy }

// How a results screen shows one answer. A 'fallback' answer counts as right (a grader hiccup never fails
// a learner) but nothing checked it, so it is shown as not checked rather than with a right answer's tick.
export type AnswerMark = "right" | "wrong" | "unchecked";

export function answerMark(q: { is_correct: boolean | null; graded_by?: GradedBy | null }): AnswerMark {
  if (q.graded_by === "fallback") return "unchecked";
  return q.is_correct ? "right" : "wrong";
}

/**
 * Whether a results row shows the learner's answer and the key. A right answer hides them, except one a
 * person marked against the key ('self'): there they are what was marked, and anyone reading the results
 * should see both. A safety disclosure typed as the answer (with the learner's grade, as the chat reads it)
 * never shows them: the row shows the safety notice instead (showsSafetyNotice).
 */
export function showsAnswerAndKey(q: { is_correct: boolean | null; graded_by?: GradedBy | null; user_answer?: string | null }, grade: Grade | null = null): boolean {
  if (!q.user_answer || isSafetyDisclosure(q.user_answer, grade)) return false;
  return answerMark(q) !== "right" || q.graded_by === "self";
}

/** What joins the two sides of a match on screen ("Frog → Amphibian"); read aloud as " goes with ". */
export const MATCH_LINK = " → ";

interface ShownAnswerLike {
  question_type?: string;
  user_answer?: string | null;
  correct_answer?: string | null;
  matching_pairs?: ReadonlyArray<{ left: string; right: string }> | null;
}

/**
 * The learner's answer as a question, a results row and its read-aloud show it. A drag-to-match answer
 * is stored as JSON (left → right, QuestionRenderer); it shows as "Frog → Amphibian, Dog → Mammal", in
 * the question's own left order. Anything else, or JSON that is not a match, shows as stored.
 */
export function answerShown(q: ShownAnswerLike, link: string = MATCH_LINK): string {
  const raw = q.user_answer ?? "";
  if (q.question_type !== "drag_to_match") return raw;
  let picked: unknown;
  try { picked = JSON.parse(raw); } catch { return raw; }
  if (!picked || typeof picked !== "object" || Array.isArray(picked)) return raw;
  const chosen = picked as Record<string, unknown>;
  const order = (q.matching_pairs ?? []).map((p) => p.left).filter((left) => left in chosen);
  const lefts = [...order, ...Object.keys(chosen).filter((left) => !order.includes(left))];
  return lefts.map((left) => `${left}${link}${String(chosen[left])}`).join(", ");
}

/**
 * The answer key as a question, a results row and its read-aloud show it. A drag-to-match key is the
 * question's pairs ("Frog → Amphibian, Dog → Mammal"); its stored correct_answer is only the generation
 * prompt's "See matching_pairs" placeholder (quiz.ts), which is never shown.
 */
export function keyShown(q: ShownAnswerLike, link: string = MATCH_LINK): string {
  if (q.question_type === "drag_to_match" && q.matching_pairs?.length) {
    return q.matching_pairs.map((p) => `${p.left}${link}${p.right}`).join(", ");
  }
  return q.correct_answer ?? "";
}

/**
 * Whether a question shows the chat's SAFETY_NOTICE (child-safety.ts): its typed answer or its "why is
 * that the answer?" text reads as a self-harm or abuse disclosure, or with a K-12 grade set a pregnancy
 * one (isSafetyDisclosure with the learner's grade, the chat's own check). Shown on the question once the
 * answer is recorded and on its results row. A notice, never a block; the answer itself is passed as not
 * checked, never marked wrong (quiz.ts gradeAnswersBatch).
 */
export function showsSafetyNotice(q: { user_answer?: string | null; self_explanation?: string | null }, grade: Grade | null): boolean {
  return isSafetyDisclosure(q.user_answer ?? "", grade) || isSafetyDisclosure(q.self_explanation ?? "", grade);
}

export const UNCHECKED_NOTE = "Not checked. No model on this computer could check this written answer, so it counts as right. Compare it with the answer key.";

/** The line under a score when some answers in it were never checked, or null when all were. */
export function uncheckedSummary(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 written answer was not checked. It counts as right." : `${n} written answers were not checked. They count as right.`;
}

/**
 * Leaving a practice quiz with answers in it (QuizFullScreen's Exit Quiz asks first, as the level test's
 * STOP_TEST does). The quiz stays unfinished: no score, no results and no mastery change, and the Quiz tab
 * makes a new one next time. Each answer was saved as it was given, so it still counts as practice (db.ts
 * getSubtopicAccuracy, getReviewPoolQuestions). With no answer yet it leaves without asking.
 */
export const LEAVE_QUIZ = {
  title: "Leave this quiz?",
  leave: "Leave the quiz",
  keep: "Keep going",
} as const;

/** What leaving a practice quiz does, for the confirm. `answered` = questions answered so far. */
export function leaveQuizBody(answered: number): string {
  const kept = answered === 1 ? "The answer you gave still counts as practice." : `The ${answered} answers you gave still count as practice.`;
  return `It won't get a score, and next time the Quiz tab makes a new quiz. ${kept}`;
}

// One verdict per answer, named answer_1..answer_N in the order of `items` (the caller's own indices
// can be anything, so the model never has to copy them). A list of any length let gemma4:e2b close it
// after the first entry in 3 of 5 batches (B10 round 3: 8 of 20 typed answers marked); with every key
// required, Ollama's grammar cannot end the reply until each answer has one. `feedback` comes before
// `correct` so the verdict is written after the model has said what the student wrote. Measured on e2b
// with round 3's 20 typed codes that answer nothing: the required keys alone, with the old prompt and
// the verdict first, marked all 20 and passed 16; with this prompt and feedback first, 1 (dev, n=20).
const gradeKey = (position: number) => `answer_${position + 1}`;

export function batchGradeSchema(items: GradeItem[]): Record<string, unknown> {
  const keys = items.map((_, k) => gradeKey(k));
  const verdict = {
    type: "object",
    additionalProperties: false,
    required: ["feedback", "correct"],
    properties: { feedback: { type: "string", maxLength: 300 }, correct: { type: "boolean" } },
  };
  return { type: "object", additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((k) => [k, verdict])) };
}

export type BatchGradeReply = Record<string, { feedback?: string; correct?: boolean } | undefined>;

// Build one prompt that grades every item in a single structured call (replaces N round-trips). The
// grader compares the student's words with the key. "Be generous with partial credit" and "demonstrates
// understanding of the core concept" are gone: with them, e2b and e4b marked a typed code that answers
// nothing ("I think it is TAXb05Q0TAX") correct, apparently grading the key's concept instead.
// Synonyms, other names and other units (eval/grade-dev.ts GRADE_DEV_SYNONYMS, e2b x3, 74 right / 80
// wrong): the old wording failed 17, 19, 17 right answers and passed 1, 1, 1 wrong. Saying an amount
// in other units counts only when it converts (with a feedback line that asked for the conversion)
// fails 15, 16, 16 and passes 0, 1, 1. "Convert it and compare", or a "1 km" / "1 mile" example,
// passed "about 42 miles" for "about 42 kilometers". The feedback line asking the model to convert was
// dropped: a wrong conversion shown to a child is misinformation, and without it e2b failed 16, 15, 13
// and passed 1, 1, 2 against 16, 15, 12 and 1, 2, 1 with it, code settling the same answers in both
// (e4b, one run: 12 and 1 against 9 and 1). Results: results/2026-11-15-grade-dev-synonyms.md.
// A misspelling code cannot accept gets a note (answer-match.ts misspellingNote). e2b wrote "The student
// misspelled conduction" and marked it wrong: it saw the misspelling and counted it. So the note says
// that, for that answer, spelling is not marked. On GRADE_DEV_MISSPELLINGS (e2b x3) right failed went
// 23, 20, 23 → 8, 6, 6 with wrong passed 0, 1, 0 → 0, 0, 1 (the same ambiguous answer, in a batch with no
// note); 13, 8, 9 and 0, 1, 1 once another word's -ing or -ed form counted as a rival (three fewer
// notes). A note that only said "may be a misspelling" left 16, 17, 13; one line for the whole batch
// ("spelling is not marked") passed "meitosis" for mitosis, which has no note, on every run; a fixed line
// with no notes passed "content" for continent on every run. Results:
// results/2026-11-16-grade-dev-misspelling-hint.md.
export function buildBatchGradePrompt(items: GradeItem[], mathRules?: string): string {
  // Only a batch with a note changes, so every other batch's prompt is unchanged. In it, each answer is
  // kept to one line and cannot open with "Note:", so no answer a learner typed passes for a note.
  const noted = items.some((it) => it.note);
  const student = (s: string) => (noted ? s.replace(/[\r\n\v\f\u0085\u001c-\u001e\u2028\u2029]+/g, " ").replace(/^(\s*note)\s*:/i, "$1 -") : s);
  const body = items
    .map((it, k) =>
      `[${gradeKey(k).replace("_", " ")}] (${it.type})\n` +
      `Question: ${it.question}\n` +
      `Expected answer: ${it.expected}\n` +
      `Student answer: ${student(it.student)}` +
      (it.note ? `\nNote: ${it.note}. If it is, mark it correct: for this answer, spelling is not marked.` : ""),
    )
    .join("\n\n");
  const noteLine = noted
    ? "\nA Note under an answer applies to that answer only; check every other answer as above."
    : "";

  return `You are checking ${items.length} answer${items.length === 1 ? "" : "s"} a student typed. For each one, compare the student's answer with the expected answer.
- correct: true when the student's answer means the same as the expected answer, even if it is worded differently, shorter, or misspelled. Another name or a synonym for the same thing counts. An amount in other units counts only when it converts to the expected amount; the same number in another unit is wrong. A student may leave out the option letter.
- correct: false when the student's answer is wrong, says something else, names a different or only related thing, gives only part of the expected answer, or does not answer the question.
Judge only what the student wrote. Do not mark an answer correct because the expected answer is right.${noteLine}

Return ONLY a JSON object with one key per answer: ${items.map((_, k) => `"${gradeKey(k)}": {"feedback": "<1 short sentence on what the student wrote>", "correct": true/false}`).join(", ")}.

${body}${mathRules ? `\n\n${mathRules}` : ""}`;
}

// Reconcile the model's verdicts back onto the items by position. Missing / malformed entries default to
// correct=true (lenient) and are marked `fallback` — never punish a student for a grader hiccup.
// Returns a map keyed by item.index.
export function parseBatchGradeResults(
  parsed: BatchGradeReply | null | undefined,
  items: GradeItem[],
): Map<number, GradeOutcome> {
  const out = new Map<number, GradeOutcome>();
  items.forEach((it, k) => {
    const v = parsed?.[gradeKey(k)];
    out.set(it.index, v && typeof v.correct === "boolean"
      ? { isCorrect: v.correct, feedback: String(v.feedback ?? ""), by: "model" }
      : { isCorrect: true, feedback: "", by: "fallback" });
  });
  return out;
}

// ─── Independent verification pass (every tier but tiny — see quiz.ts) ─────────

export interface VerifyItem {
  index: number;
  question: string;
  options?: string[] | null;
  proposed: string; // the correct_answer we're checking
}

// Ask the model to independently solve each question and judge whether the proposed answer is right.
// (Gated in quiz.ts to every tier but the weakest (tiny); the floor model runs it too — the output is
// verdicts only, so it stays cheap even on a 4B model.)
export function buildVerifyPrompt(items: VerifyItem[]): string {
  const body = items
    .map((it) => {
      const opts = it.options && it.options.length ? `\nOptions: ${it.options.join(" | ")}` : "";
      return `[index ${it.index}]\nQuestion: ${it.question}${opts}\nProposed answer: ${it.proposed}`;
    })
    .join("\n\n");

  return `For each question below, independently work out the correct answer from scratch, then judge whether the PROPOSED answer is actually correct. Ignore the proposed answer until you have your own.

Return ONLY a JSON object: {"verdicts":[{"index": <the item's index>, "proposed_is_correct": true/false}]} — exactly one entry per item, reusing each item's index.

${body}`;
}

// Parse verdicts → the set of indices that FAILED verification (should be dropped). A missing verdict
// defaults to "agrees" (kept), so model silence never silently drains the question count.
export function parseVerifyDrops(
  parsed: { verdicts?: Array<{ index?: number; proposed_is_correct?: boolean }> } | null | undefined,
  items: VerifyItem[],
): Set<number> {
  const drop = new Set<number>();
  const verdicts = parsed?.verdicts;
  if (!Array.isArray(verdicts)) return drop;
  const known = new Set(items.map((it) => it.index));
  for (const v of verdicts) {
    if (typeof v?.index === "number" && known.has(v.index) && v.proposed_is_correct === false) {
      drop.add(v.index);
    }
  }
  return drop;
}
