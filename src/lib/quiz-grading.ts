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

// Minimal structural shapes (we deliberately don't import GeneratedQuestion to stay leaf).
export interface QuestionLike {
  question_text: string;
  question_type: string;
  correct_answer: string;
  explanation: string;
  options?: string[] | null;
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
function derivedResult(explanation: string): number | null {
  if (!explanation) return null;
  const text = stripNumericNoise(explanation);
  const fromStrong = lastCaptured(cueRegex(STRONG_CUES), text);
  if (fromStrong !== null) return fromStrong;
  return lastCaptured(cueRegex(ARITH_CUES), text);
}

const NUM_TOL = 1e-6;
function numbersAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUM_TOL + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

// ─── Semantic validation (drives repair-retry) ────────────────────────────────

// Self-consistency: when a question has a numeric correct_answer AND its explanation DERIVES a number
// (a strong "therefore X" or an arithmetic "… = X" — see derivedResult), the two must agree. Conservative
// on purpose: it ignores soft factual verbs, so a correct question whose explanation merely ends on a
// contrasting distractor ("an octet is 8 bits; a nibble is 4 bits", answer 8) is never falsely flagged —
// only a genuine "works itself to a different number" (the C³⁻ screenshot) is. The independent verify
// pass re-solves the soft-verb cases this abstains on. Returns an issue string or null.
export function checkAnswerConsistency(q: QuestionLike): string | null {
  const ans = numericValueOf(q.correct_answer);
  if (ans === null) return null;
  const derived = derivedResult(q.explanation);
  if (derived === null) return null;
  if (numbersAgree(ans, derived)) return null;
  return `the explanation works toward ${derived}, but correct_answer is "${q.correct_answer}" (${ans}). ` +
    `Re-solve the problem, end the explanation with "Therefore the answer is <value>", and set correct_answer to that exact value.`;
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

// Keep the first occurrence of each distinct question (by normalized text); drop blanks/dupes. The
// top-up loop re-asks subtopics, so this guards against the model repeating a question across rounds.
export function dedupeByQuestionText<T extends { question_text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = questionKey(it.question_text);
    if (!k || seen.has(k)) continue;
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

export interface GradeOutcome { isCorrect: boolean; feedback: string }

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
  for (const it of items) out.set(it.index, { isCorrect: true, feedback: "" });
  const results = parsed?.results;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (typeof r?.index === "number" && out.has(r.index)) {
        out.set(r.index, { isCorrect: Boolean(r.correct), feedback: String(r.feedback ?? "") });
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
