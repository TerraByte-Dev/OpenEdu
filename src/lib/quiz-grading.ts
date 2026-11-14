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
const NOT_OPERAND = "(?!\\d|\\.\\d|\\s*[:/]\\s*\\d|\\s*(?:[+×*÷]|[-−]\\s*\\d|x\\s*\\d|plus\\b|minus\\b|times\\b|divided\\b|multiplied\\b))";
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
// fraction. With no such result, or when the last "=" result is itself an operand, the check abstains.
// `token` is a regex source whose groups are the value's (the cues have no capturing groups).
function derivedMatch(text: string, token: string, strongOnly = false): RegExpExecArray | null {
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
    return all(ARITH_CUES, strong.index + strong[0].length).find(isResult) ?? null;
  }
  if (strongOnly) return null;
  const ariths = all(ARITH_CUES);
  const arith = ariths[ariths.length - 1];
  return arith && isResult(arith) ? arith : null;
}

function derivedResult(explanation: string): number | null {
  if (!explanation) return null;
  const m = derivedMatch(stripNumericNoise(explanation), NUM);
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
  const m = derivedMatch(text, src, strongOnly);
  return m ? read(m) : null;
}

// ─── Semantic validation (drives repair-retry) ────────────────────────────────

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
  const ans = numericValueOf(q.correct_answer);
  if (ans === null) return null;
  const derived = derivedResult(q.explanation);
  if (derived === null) return null;
  if (numbersAgree(ans, derived)) return null;
  return `the explanation works toward ${derived}, but correct_answer is "${q.correct_answer}" (${ans}). ` +
    `Re-solve the problem, end the explanation with "Therefore the answer is <value>", and set correct_answer to that exact value.`;
}

// An explanation that revises itself in front of the learner ("Wait, let's re-evaluate", "Let's adjust
// the options", "Actually, I made a mistake"). gemma4:e2b shipped 21 of these in one readiness run
// (2026-11-14), most with a key that its own corrected working contradicts, and some cut off mid-fix.
// Whatever the key, the explanation is not one to show a child, so the question is rejected and the
// repair/retry path asks again. Each pattern is a revision cue, not a topic word: "wait for the water
// to boil" and "actually" mid-sentence pass.
const REDO = "re-?(?:evaluate|check|calculate|examine|consider|think|assess|do|try)|reconsider|try\\s+again|start\\s+over|" +
  "check\\s+the\\s+(?:options|choices|answers?)\\s+again|re-?read\\s+the\\s+(?:question|prompt|problem|options|choices)|" +
  "(?:adjust|fix|correct|change)\\s+the\\s+(?:options|choices|answer|calculation)";
const SELF_CORRECTION_RES: RegExp[] = [
  /(?:^|[.!?:;]\s*|\s[-–—]\s*)wait\s*[,.!:—–-]/i,
  /(?:^|[.!?:;]\s*)(?:actually|oops|hmm+|ah)\s*[,.!:—–-]/i,
  new RegExp(`\\blet(?:'|’)?s\\s+(?:${REDO})\\b`, "i"),
  new RegExp(`\\blet\\s+me\\s+(?:${REDO})\\b`, "i"),
  /(?:^|[.!?:;,]\s*)re-?(?:evaluating|checking|calculating|examining)\b/i,
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
// the exact labelled string, so a child who picks the twin is marked wrong.
export function normalizeOption(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/^\s*\(?[A-Da-d]\s*[).:]\s*/, "")
    .toLowerCase()
    .replace(/[‘’‚‛′`"“”„‟″]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "")
    .trim();
}

// The first pair of options a learner can't tell apart, as their indices, or null.
export function duplicateOptionPair(options: readonly string[]): [number, number] | null {
  const seen = new Map<string, number>();
  for (let i = 0; i < options.length; i++) {
    const k = normalizeOption(options[i]);
    const j = seen.get(k);
    if (j !== undefined) return [j, i];
    seen.set(k, i);
  }
  return null;
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

// A stem's words and numbers as a set: lower case, punctuation dropped, "2:30" and "3/4" kept whole so
// two clock questions that differ only in the time stay apart.
function stemTokens(text: string): Set<string> {
  return new Set(String(text ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[:/.,][\p{N}]+)*/gu) ?? []);
}

export const NEAR_DUPLICATE_OVERLAP = 0.85;

// Two questions a learner would see as the same one: the same answer (option text, no label) and a
// stem whose words are at least NEAR_DUPLICATE_OVERLAP inside the other's (overlap coefficient: shared
// words over the shorter stem's, so a restatement with a few extra words still counts). Exact repeats
// were already dropped; the 2026-11-14 readiness run still had 61 such pairs inside single quizzes and
// tests ("What tool is used to measure how hot or cold the air is?" / "Which tool is specifically
// used to ..."). Two different keys are never duplicates, however alike the stems ("15 minutes after
// 2:30" vs "after 1:45").
export function isNearDuplicate(
  a: { question_text: string; correct_answer?: string },
  b: { question_text: string; correct_answer?: string },
): boolean {
  if (a.correct_answer === undefined || b.correct_answer === undefined) return false;
  if (normalizeOption(a.correct_answer) !== normalizeOption(b.correct_answer)) return false;
  const ta = stemTokens(a.question_text);
  const tb = stemTokens(b.question_text);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= NEAR_DUPLICATE_OVERLAP;
}

// Keep the first occurrence of each distinct question; drop blanks, exact repeats (by normalized text)
// and near-duplicates of an earlier one (isNearDuplicate). The top-up loop re-asks subtopics, so this
// guards against the model repeating a question across rounds.
export function dedupeByQuestionText<T extends { question_text: string; correct_answer?: string }>(items: T[]): T[] {
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
  if (NUMERIC_SHORTCIRCUIT_TYPES.has(type)) {
    const en = numericValueOf(expected);
    const sn = numericValueOf(student);
    const expectedIsBasicallyNumeric = en !== null && e.replace(/-?\d+(?:\.\d+)?/, "").trim().length <= 6;
    if (en !== null && sn !== null && expectedIsBasicallyNumeric && numbersAgree(en, sn)) return true;
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
}

// How an answer was marked, stored as quiz_questions.graded_by (migration 18) so the stored history
// says which marks came from the answer key and which from the model. 'key': compared with
// the answer key as the learner answered (multiple choice, true/false, matching). 'exact': a string
// or number match (gradeFreeTextDeterministic). 'model': the grader model's verdict. 'fallback': the
// grader failed or skipped the item and the answer was passed leniently. 'unanswered': a timed-out
// level test's unanswered question, scored wrong.
export type GradedBy = "key" | "exact" | "model" | "fallback" | "unanswered";

export interface GradeOutcome { isCorrect: boolean; feedback: string; by: GradedBy }

// Build one prompt that grades every item in a single structured call (replaces N round-trips).
export function buildBatchGradePrompt(items: GradeItem[], mathRules?: string): string {
  const body = items
    .map((it) =>
      `[index ${it.index}] (${it.type})\n` +
      `Question: ${it.question}\n` +
      `Expected answer: ${it.expected}\n` +
      `Student answer: ${it.student}`,
    )
    .join("\n\n");

  return `You are grading ${items.length} student answer${items.length === 1 ? "" : "s"}. For each item, decide whether the student's answer demonstrates understanding of the core concept. Allow different wording as long as the meaning is correct, and be generous with partial credit — if they clearly show understanding, mark it correct.

Return ONLY a JSON object: {"results":[{"index": <the item's index>, "correct": true/false, "feedback": "<1 short sentence>"}]} — exactly one entry per item, reusing each item's index.

${body}${mathRules ? `\n\n${mathRules}` : ""}`;
}

// Reconcile the model's results back onto the items by index. Missing / malformed entries default to
// correct=true (lenient) — never punish a student for a grader hiccup (mirrors the old inline grader's
// catch behavior). Returns a map keyed by item.index.
export function parseBatchGradeResults(
  parsed: { results?: Array<{ index?: number; correct?: boolean; feedback?: string }> } | null | undefined,
  items: GradeItem[],
): Map<number, GradeOutcome> {
  const out = new Map<number, GradeOutcome>();
  for (const it of items) out.set(it.index, { isCorrect: true, feedback: "", by: "fallback" });
  const results = parsed?.results;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (typeof r?.index === "number" && out.has(r.index)) {
        out.set(r.index, { isCorrect: Boolean(r.correct), feedback: String(r.feedback ?? ""), by: "model" });
      }
    }
  }
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
