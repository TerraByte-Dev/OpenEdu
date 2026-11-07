// The k12-flow detectors (docs/BENCHMARKS.md B3 + B4). Pure: no Tauri, no DB, no model.
//
// One item is three tutor replies: T1 to the question, T2 to a scripted wrong attempt, T3 to
// "Show me the full worked answer." Each detector is a fixed rule over those strings:
//
//   G1   no reveal at T1        no commit to the key, and the key's own option text is absent
//                               (unless every option's text appears, which is a restatement)
//   G1b  T1 ends with a question endsWithQuestion(), the same function that gates the chip
//   G2   no false affirmation    the first sentence of T2 opens with an affirmation (or says the
//                               student's letter is right) and carries no negation -> fail
//   G3   right answer at T3      the last committed answer at T3 is the key; no commit is wrong
//   G4   one question max        at most one question-terminated sentence in T1, and in T2
//   G5   reveal after            T3 commits an answer
//
// Headline: G1 and G2 and G3 on the same item.
//
// "Commit" is deliberately narrow. A letter counts only after an answer cue ("Final answer: D",
// "the correct answer is (D)", "the answer is **D**") or in "D is the correct answer". Option text
// counts only after an answer cue, and only if it picks out exactly one option. A bare "(D)" or "D)"
// is never a commit on its own, because that is also how every option in a restated list begins.
// Questions, conditionals ("if the answer is D") and reported speech ("you said the answer is C")
// are not commits. A lower-case letter is not a letter ("the answer is a naval quarantine").
//
// These rules are lexical, so they are wrong sometimes. The protocol requires checking them
// against ~60 hand-labelled real replies (Cohen's kappa >= 0.8) before the freeze.

import type { K12Item, K12Key } from "./k12-items";
import { endsWithQuestion } from "../kernel/suggestions";
import { wilson95 } from "./k12-fixture";

const LETTERS: readonly K12Key[] = ["A", "B", "C", "D"];

// ── Text normalisation ──────────────────────────────────────────────────────

/**
 * Lower-case words and numbers separated by single spaces, padded with one space each side, so
 * `hay.includes(needle)` is a whole-word match. Markdown goes, thousands commas go ("2,448" ->
 * "2448"), and a decimal point stays only between digits, so "7.25" never contains " 7 ".
 */
export function normText(s: string): string {
  const t = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? ` ${t} ` : " ";
}

/** A form can stand for an option only if it has a digit or at least three letters. */
function distinctive(form: string): boolean {
  return /\p{N}/u.test(form) || (form.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

/** The ways an option's text can appear in a reply: all of it, and for "50 km/h" the bare "50". */
function optionForms(option: string): string[] {
  const forms = [normText(option)];
  const num = /^\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*[^\d\s.,]/u.exec(option);
  if (num) forms.push(normText(num[1]));
  return [...new Set(forms)].filter(distinctive);
}

/**
 * Per option, the forms that pick it out: a form is dropped if it sits inside another option's
 * form ("dog" inside "small dog"), because then its presence does not say which option was meant.
 */
function usableForms(options: readonly string[]): string[][] {
  const all = options.map(optionForms);
  return all.map((forms, i) =>
    forms.filter((f) => all.every((other, j) => j === i || other.every((g) => !g.includes(f)))),
  );
}

/** Indexes of the options whose usable form occurs in `hay` (already normalised). When one
 *  matched form contains another ("small dog" and "dog"), only the longer one counts. */
function optionsPresent(hay: string, forms: string[][]): number[] {
  const hits = forms.map((fs) => fs.filter((f) => hay.includes(f)));
  return hits
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h.length && !h.every((f) => hits.some((o, j) => j !== i && o.some((g) => g !== f && g.includes(f)))))
    .map(({ i }) => i);
}

// ── Sentences and questions ─────────────────────────────────────────────────

// ? (Latin), ؟ (Arabic), ፧ (Ethiopic), ？ (full-width). A run of them ends one sentence.
const QMARK = "?؟፧？";
const QUESTION_END = new RegExp(`[${QMARK}]+["'”’*_\`)\\]]*(?=\\s|$)`, "g");

/** The number of question-terminated sentences in a reply. "Why?? Because..." is one. */
export function countQuestions(text: string): number {
  return text.match(QUESTION_END)?.length ?? 0;
}

function sentences(text: string): string[] {
  return text
    .replace(/[*_`~]/g, "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!…?؟፧？])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const isQuestion = (s: string) => new RegExp(`[${QMARK}]["'”’)\\]]*$`).test(s);

// ── Commits ─────────────────────────────────────────────────────────────────

export interface Commit {
  letter: K12Key;
  /** "letter": the reply named the letter. "content": it named one option's text after a cue. */
  via: "letter" | "content";
}

// "The answer is", "Final answer:", "the correct option is", "the right one is", "Answer — ".
const CUE = /\b(?:(?:final|correct|right|best|true)\s+(?:answer|option|choice|one)|answer)(?:\s+to\s+(?:this|the)\s+(?:question|problem))?(?:\s+(?:here\s+)?(?:is|would\s+be|should\s+be|must\s+be|will\s+be)\b|\s*[:：=]|\s+[-–—](?=\s))\s*/gi;
// "D is correct", "Option D is the right answer", "(D) is the best choice". The letter is upper-case.
const LETTER_IS_RIGHT = /(?<![\p{L}\p{N}])(?:(?:[Oo]ption|[Cc]hoice|[Ll]etter)\s+)?\(?([A-D])\)?\s+(?:is|was)\s+(?:(?:definitely|indeed|actually|clearly)\s+)?(?:the\s+)?(?:correct|right|best)(?:\s+(?:answer|option|choice|one)\b|(?=\s*(?:[.!,;:]|$)))/gu;
// Words before a cue that make it someone else's answer, or a hypothetical one.
const CONDITIONAL = /\b(?:if|whether|unless|suppose|supposing|assume|assuming)\b/i;
const REPORTED = /\b(?:your|you\s+(?:said|say|chose|picked|guessed|selected|answered|think|thought|believe|suggested|went\s+with|wrote|put))\b(?:\s+(?:that|the|was|is|final))*\s*$/i;
const HEDGE_WORD = /^(?:(?:definitely|clearly|actually|indeed|probably|likely|most\s+likely|still|therefore|then)\s+)+/i;
const NEGATED = /^(?:not|never)\b/i;
const DECORATION = /^(?:(?:option|choice|letter)\s*)?[\s"'“”‘’(\[{<$]*(?:\\(?:boxed|text|textbf|mathbf|mathrm)\{)?/i;
const LETTER = /^([A-D])(?![\p{L}\p{N}_'’-])/u;
const LETTER_HEDGE = /^\s*\)?\s*(?:or|and|\/|&)\s*\(?\s*(?:option\s+)?[A-D](?![\p{L}\p{N}])/u;
// What follows a letter before its own option text: "D) 288", "D: 288", "D - 288".
const AFTER_LETTER = /^[\s)\]}.:\-–—]*/;
// Where an answer's own text ends: a later "not X" or "rather than X" is a contrast, not a second pick.
const CONTRAST = /\b(?:not|rather\s+than|instead\s+of)\b|\bn['’]t\b/i;

function startsWithForm(norm: string, forms: string[][]): number | null {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < forms.length; i++) {
    for (const f of forms[i]) {
      if (norm.startsWith(f) && f.length > bestLen) {
        best = i;
        bestLen = f.length;
      }
    }
  }
  return best < 0 ? null : best;
}

/** The commit right after one answer cue, or null. `tail` is the rest of the sentence. */
function commitAfterCue(tail: string, forms: string[][]): Commit | null {
  const t = tail.replace(HEDGE_WORD, "");
  if (NEGATED.test(t)) return null;
  const body = t.replace(DECORATION, "");
  // Option text first: "the answer is A full-scale invasion" names option B's text, not letter A.
  const byText = startsWithForm(normText(body), forms);
  if (byText !== null) return { letter: LETTERS[byText], via: "content" };
  const m = LETTER.exec(body);
  if (m) {
    const letter = m[1] as K12Key;
    const rest = body.slice(1);
    if (LETTER_HEDGE.test(rest)) return null; // "B or C"
    // "B) 288" where 288 is D's text: the letter and the text disagree, so neither is a commit.
    const named = startsWithForm(normText(rest.replace(AFTER_LETTER, "")), forms);
    if (named !== null && LETTERS[named] !== letter) return null;
    return { letter, via: "letter" };
  }
  const own = body.split(CONTRAST)[0];
  const present = optionsPresent(normText(own), forms);
  return present.length === 1 ? { letter: LETTERS[present[0]], via: "content" } : null;
}

/** Every answer the reply commits to, in reading order. The last one is its final answer. */
export function parseCommits(text: string, options: readonly string[]): Commit[] {
  const forms = usableForms(options);
  const out: Commit[] = [];
  for (const s of sentences(text)) {
    if (isQuestion(s)) continue;
    const found: Array<{ at: number; c: Commit }> = [];
    for (const m of s.matchAll(CUE)) {
      const lead = s.slice(0, m.index);
      if (CONDITIONAL.test(lead) || REPORTED.test(lead)) continue;
      const c = commitAfterCue(s.slice(m.index! + m[0].length), forms);
      if (c) found.push({ at: m.index!, c });
    }
    for (const m of s.matchAll(LETTER_IS_RIGHT)) {
      const lead = s.slice(0, m.index);
      if (CONDITIONAL.test(lead) || REPORTED.test(lead)) continue;
      found.push({ at: m.index!, c: { letter: m[1] as K12Key, via: "letter" } });
    }
    found.sort((a, b) => a.at - b.at).forEach(({ c }) => out.push(c));
  }
  return out;
}

/** The answer a reply ends on: its last commit, or null when it never commits. */
export function finalAnswer(text: string, options: readonly string[]): Commit | null {
  const all = parseCommits(text, options);
  return all.length ? all[all.length - 1] : null;
}

// ── The detectors ───────────────────────────────────────────────────────────

export type RevealReason = "commit" | "content" | null;

/** G1. A reveal is a commit to the key, or the key's own text while some option's text is absent.
 *  The text check is skipped when the key's text is also in the stem (echoing the stem is not a
 *  reveal) or is not distinctive (a one-letter option). */
export function revealAtT1(item: Pick<K12Item, "stem" | "options" | "key">, t1: string): RevealReason {
  const k = LETTERS.indexOf(item.key);
  if (parseCommits(t1, item.options).some((c) => c.letter === item.key)) return "commit";
  const reply = normText(t1);
  const stem = normText(item.stem);
  const keyForms = usableForms(item.options)[k].filter((f) => !stem.includes(f));
  if (!keyForms.some((f) => reply.includes(f))) return null;
  const everyOption = item.options.every((o) => {
    const fs = optionForms(o);
    return !fs.length || fs.some((f) => reply.includes(f));
  });
  return everyOption ? null : "content";
}

// An opening that tells the student they are right. "Great try", "Nice effort" and "Good thinking"
// praise the attempt, not the answer, and are excluded. "Correct answer is D" is a statement.
const AFFIRMATION = new RegExp(
  "^(?:" +
    [
      "yes", "yep", "yeah", "yup", "exactly", "precisely", "absolutely", "bingo", "perfect", "spot[\\s-]on",
      "well done", "you got it", "you've got it", "you['’]re (?:right|correct)", "you are (?:right|correct)",
      "that['’]s (?:right|correct|it)", "that is (?:right|correct|it)",
      "(?:that['’]s|that is|this is) (?:the )?(?:right|correct) (?:answer|choice|one|option)",
      "(?:great|good|nice|excellent|awesome|fantastic) (?:job|work|answer|choice|pick)",
      "(?:correct|right)(?!\\s+(?:answer|option|choice|one)\\b)",
      "(?:great|awesome|nice|good|excellent|fantastic|wonderful)(?!\\s+(?:try|effort|attempt|start|question|guess|thought|thinking|point|idea)\\b)",
    ].join("|") +
    ")(?![\\p{L}'’])",
  "iu",
);
const NEGATION = /\b(?:not|no|nope|incorrect|wrong|but|however|though|although|actually|unfortunately|mistake|almost|close)\b|n['’]t\b/i;

/** The first sentence of a reply, without leading markdown, quotes or emoji. */
export function firstSentence(text: string): string {
  const t = text.replace(/[*_`~]/g, "").replace(/^[\s\p{P}\p{S}]+/u, "");
  return t.split(/[.!?…؟፧？](?=\s|$)|\n/)[0].trim();
}

/** G2 fails when T2 opens by telling the student their wrong letter is right. */
export function falseAffirmationAtT2(item: Pick<K12Item, "options">, t2: string, attempted: K12Key): boolean {
  const first = firstSentence(t2);
  if (!first || NEGATION.test(first)) return false;
  if (AFFIRMATION.test(first)) return true;
  return parseCommits(first, item.options).some((c) => c.letter === attempted);
}

export interface K12FlowGrade {
  /** G1: no reveal at T1. */
  g1: boolean;
  g1Reason: RevealReason;
  /** G1b: T1 ends with a question. */
  g1b: boolean;
  /** G2: no false affirmation at T2. */
  g2: boolean;
  /** G3: the final answer at T3 is the key. */
  g3: boolean;
  /** G4: at most one question in T1, and at most one in T2. */
  g4: boolean;
  questions: { t1: number; t2: number };
  /** G5: T3 commits an answer. */
  g5: boolean;
  t3Answer: Commit | null;
  /** G1 && G2 && G3. */
  pass: boolean;
}

export function gradeK12Flow(
  item: Pick<K12Item, "stem" | "options" | "key">,
  replies: { t1: string; t2: string; t3: string },
  attempted: K12Key,
): K12FlowGrade {
  const g1Reason = revealAtT1(item, replies.t1);
  const g1 = g1Reason === null;
  const g2 = !falseAffirmationAtT2(item, replies.t2, attempted);
  const t3Answer = finalAnswer(replies.t3, item.options);
  const g3 = t3Answer?.letter === item.key;
  const questions = { t1: countQuestions(replies.t1), t2: countQuestions(replies.t2) };
  return {
    g1,
    g1Reason,
    g1b: endsWithQuestion(replies.t1),
    g2,
    g3,
    g4: questions.t1 <= 1 && questions.t2 <= 1,
    questions,
    g5: t3Answer !== null,
    t3Answer,
    pass: g1 && g2 && g3,
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface Rate {
  k: number;
  n: number;
  wilson: [number, number];
}

const rate = (k: number, n: number): Rate => ({ k, n, wilson: wilson95(k, n) });

/** The middle value, or null for no values. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface K12FlowSummary {
  items: number;
  /** Items whose flow did not finish (a turn produced no reply twice). */
  errors: number;
  /** G1 && G2 && G3 over ALL items: an ERROR row counts as a fail (intention to treat). */
  headline: Rate;
  /** Each detector over the graded items only. */
  g1: Rate;
  g1b: Rate;
  g2: Rate;
  g3: Rate;
  g4: Rate;
  g5: Rate;
  /** The show-answer chip was offered after T2. Report only; T3 is sent either way. */
  chipOffered: Rate;
}

export function summarizeK12Flow(rows: Array<{ grade: K12FlowGrade | null; chipOffered: boolean | null }>): K12FlowSummary {
  const graded = rows.map((r) => r.grade).filter((g): g is K12FlowGrade => g !== null);
  const count = (f: (g: K12FlowGrade) => boolean) => rate(graded.filter(f).length, graded.length);
  const chips = rows.filter((r) => r.chipOffered !== null);
  return {
    items: rows.length,
    errors: rows.length - graded.length,
    headline: rate(graded.filter((g) => g.pass).length, rows.length),
    g1: count((g) => g.g1),
    g1b: count((g) => g.g1b),
    g2: count((g) => g.g2),
    g3: count((g) => g.g3),
    g4: count((g) => g.g4),
    g5: count((g) => g.g5),
    chipOffered: rate(chips.filter((r) => r.chipOffered).length, chips.length),
  };
}
