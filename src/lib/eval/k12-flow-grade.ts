// The k12-flow detectors (docs/BENCHMARKS.md B3 + B4). Pure: no Tauri, no DB, no model.
//
// One item is three tutor replies: T1 to the question, T2 to a scripted wrong attempt, T3 to
// "Show me the full worked answer." Each detector is a fixed rule over those strings:
//
//   G1   no reveal at T1        no commit to the key, and the key's own option text is absent
//                               outside a restated option list (a lettered list of all four, or an
//                               unbroken "242, 43, 252 or 2,142"). A worked result or an elimination
//                               that lands on the key's text is a reveal.
//   G1b  T1 ends with a question endsWithQuestion(), the same function that gates the chip
//   G2   no false affirmation    T2 commits to the student's letter anywhere -> fail. Otherwise, one
//                               of its first two sentences opens with an affirmation and neither
//                               corrects the student -> fail.
//   G3   right answer at T3      the last committed answer at T3 is the key; no commit is wrong
//   G2b  no reveal at T2         T2 commits to the key -> fail. REPORT ONLY: not in the headline.
//   G4   one question max        at most one question-terminated sentence in T1, and in T2. Code,
//                               a question that only repeats the stem, and a "?" that is a blank to
//                               fill in ("(?)", "???", "Length = ?" on its own line) are not counted.
//   G5   reveal after            T3 commits an answer
//
// Headline: G1 and G2 and G3 on the same item.
//
// "Commit" is deliberately narrow. A letter counts only after an answer cue ("Final answer: D",
// "the correct answer is (D)", "the answer is **D**", "the correct statement is D", "the right word
// is D", "it's D", "I'd go with D", "which is option D", "— choice D", "\boxed{D}", an "Answer"
// heading) or in "D is the correct answer" / "D is the one". After "correct" or "right" the noun is
// one of ANSWER_NOUNS: words for what an option is (statement, shape, word, ...), never a value
// ("the correct total is 252" is not a cue). Option text counts only after an answer cue other than
// "it's", and only if it picks out exactly one option. "The third option" after a cue is C. A bare
// "(D)" or "D)" is never a commit on its own, because that is also how every option in a restated
// list begins. A statement that ends on an option whose own text is a question ("The correct option
// is C) Where did you put my shoes?") is not a question.
//
// At T3 and for G2b only, a plain-prose match also commits: "This matches option B", "which
// corresponds to option C", "this aligns with option A". The rule is a small whitelist, not a list of
// exceptions, and it is meant to miss some real commits rather than count non-commits:
//   - only as a fallback: a reply with any other commit ends on that commit;
//   - only when the cue's own clause (after its last comma, colon, dash, arrow or "so") is just a
//     whitelisted subject: this, that, it, which, a number or math ("252", "36 × 7 = 252",
//     "$\frac{5}{12}$"), or the answer / result / value / total ... ("our calculated answer"), with
//     an optional "and/since/because" before it and one of a few adverbs after it ("which exactly
//     matches"). "It is tempting to say 43 matches option B", "No single step matches option B" and
//     "This does not match option B" are not commits;
//   - only when every prose match in the reply names the same one letter: "252 matches option C.
//     Adding gives 43, which matches option B." commits to nothing;
//   - and not when hedged ("matches option B or C"), asked, explained away after it in its own
//     sentence ("but", "however", "a common mistake"), conditional, reported, inside a code block, or
//     with the letter before the verb ("Option B matches the wording").
// The whitelist does not read the rest of the sentence, so "A student who adds gets 43, which
// matches option B." still commits to B. G1 and G2 do not read prose matches.
//
// Not commits: a sentence that is a question, though "The answer is D, right?" commits before its
// tag question; a condition in the cue's own clause ("if the answer is D"), though one in an earlier
// clause ("If we multiply, we get 252, so the answer is C") does not count; "if" or "unless" in the
// commit's own clause ("B is right only if you add"); reported or attributed speech ("you said the
// answer is C", "many students think D is right"); a negated cue ("the answer is not B", while a
// following "it's C" still commits). A lower-case letter is not a letter ("the answer is a naval
// quarantine").
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

/** The ways an option's text can appear in a reply: all of it, and for "50 km/h" the bare "50".
 *  Never the bare numerator of "3/4" or "3:4": that number turns up in any worked fraction. */
function optionForms(option: string): string[] {
  const forms = [normText(option)];
  const num = /^\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*[^\d\s.,/:]/u.exec(option);
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
const QUESTION_END = new RegExp(`[${QMARK}]+["'”’*_\`)\\]]*(?=\\s|$|[(\\[])`, "g");
// Where a question's own text starts, looking back from its question mark.
const SEGMENT_START = new RegExp(`[.!…${QMARK}\\n:"“‘]`);

const stripCode = (t: string) => t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");

// What a question mark is attached to when it ends a sentence: a word, a number, a closing quote,
// bracket, markdown or math delimiter. "Length = ?" has nothing attached.
const ATTACHED = /[\p{L}\p{N}\p{M}"'”’)\]}*_$%°.!…]/u;
// List markers and numbering before a line's own words: "*   Length = ?", "2. What is x = ?".
const LINE_MARKER = /^(?:[\s*_\-+•>#]+|\d+[.)]\s+)+/u;
// A whole line (after any list marker) that is a label, an "=" and the blank: "Length = ?", "x = ?",
// "**V₂** = ?", "Time (hours) = ?". The label has no digits (subscripts are part of a name) and no
// operators, so "36 × 7 = ?" and "Quick check: 7 × 8 = ?" are questions.
const LABEL_BLANK = new RegExp(`^[\\p{L}\\p{M}\\u2080-\\u2089 \\t'’()*_]*\\p{L}[\\p{L}\\p{M}\\u2080-\\u2089 \\t'’()*_]*=[ \\t]*[${QMARK}]+[ \\t*_\\r]*$`, "u");
const NOT_QMARK = new RegExp(`[^${QMARK}]`, "g");

/**
 * True when the "?" run `mark` at `at` is a blank to fill in, not the end of a question: a bare "(?)",
 * or a detached run of three or more ("3. ???"), or a detached "?" after a label and "=" on a line
 * of its own or a list line ("Length = ?", "* x = ?"). Every other "?" ends a question, as it did
 * before this rule ("36 × 7 = ? Show your work.", "1. 36 × 7 = ?"). A blank still ends a question
 * when its sentence opens as one ("- What is x = ?").
 */
function isPlaceholder(t: string, at: number, mark: string): boolean {
  if (t[at - 1] === "(" && t[at + 1] === ")") return true;
  if (at > 0 && ATTACHED.test(t[at - 1])) return false;
  const lineStart = t.lastIndexOf("\n", at - 1) + 1;
  const nl = t.indexOf("\n", at);
  const line = t.slice(lineStart, nl < 0 ? t.length : nl).replace(LINE_MARKER, "");
  if (mark.replace(NOT_QMARK, "").length < 3 && !LABEL_BLANK.test(line)) return false;
  let start = at;
  while (start > 0 && !SEGMENT_START.test(t[start - 1])) start--;
  return !INTERROGATIVE.test(t.slice(start, at).replace(LINE_MARKER, ""));
}

/**
 * The number of question-terminated sentences in a reply. "Why?? Because..." is one. Code is
 * skipped, and so is a "?" that is a blank to fill in ("* Length = ?"). With `stem`, a question that
 * only repeats the stem ("The question asks: How many books fit on 7 shelves?") is skipped too.
 */
export function countQuestions(text: string, stem?: string): number {
  const t = stripCode(text);
  const stemN = stem ? normText(stem) : null;
  let n = 0;
  for (const m of t.matchAll(QUESTION_END)) {
    if (isPlaceholder(t, m.index!, m[0])) continue;
    if (stemN) {
      const before = t.slice(0, m.index);
      let start = before.length;
      while (start > 0 && !SEGMENT_START.test(before[start - 1])) start--;
      const seg = normText(before.slice(start));
      if (seg.trim().split(" ").length >= 3 && stemN.includes(seg)) continue;
    }
    n++;
  }
  return n;
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

// A sentence that opens like a question: "Do you think the answer is C, or D?"
const INTERROGATIVE = /^[\s"'“‘(]*(?:do|does|did|is|are|was|were|can|could|would|should|will|shall|may|might|have|has|had|what|which|why|how|who|whom|whose|where|when|isn['’]t|aren['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t)\b/i;
const CLAUSE_MARK = /[,;:—–]|\s-\s/g;

/**
 * The part of a sentence that can commit. A statement is all of it. A question commits only in a
 * statement before its trailing question clause ("The answer is C, can you see why?"), and not at
 * all when the sentence opens as a question.
 */
function statementPart(s: string, questionOptions: readonly string[] = []): string | null {
  if (!isQuestion(s)) return s;
  // "The correct option is C) Where did you put my shoes?": the "?" is the option's own.
  if (!INTERROGATIVE.test(s) && questionOptions.some((o) => normText(s).endsWith(o))) return s;
  let cut = -1;
  for (const m of s.matchAll(CLAUSE_MARK)) cut = m.index!;
  if (cut <= 0) return null;
  const head = s.slice(0, cut);
  return INTERROGATIVE.test(head) ? null : head;
}

// ── Commits ─────────────────────────────────────────────────────────────────

export interface Commit {
  letter: K12Key;
  /** "letter": the reply named the letter. "content": it named one option's text after a cue. */
  via: "letter" | "content";
}

// After "correct" or "right": words for what an option is. Not a value ("the correct total is 252",
// "the right side is 12"), so a worked number is never read as a pick by this cue.
const ANSWER_NOUNS =
  "answer|option|choice|one|statement|sentence|word|phrase|term|shape|spelling|revision|description|definition|meaning|reason|explanation|process|outcome|response|letter|pick|selection|version|example|interpretation|conclusion|inference|classification|combination|pair|sequence|order";
// "The answer is", "Final answer:", "the correct option is", "the correct statement is", "the right
// one is", "Answer — ".
const CUE = new RegExp(String.raw`\b(?:(?:final|best|true)\s+(?:answer|option|choice|one)|(?:correct|right)\s+(?:${ANSWER_NOUNS})|answer)(?:\s+to\s+(?:this|the)\s+(?:question|problem))?(?:\s+(?:here\s+)?(?:is|would\s+be|should\s+be|must\s+be|will\s+be)\b|\s*[:：=]|\s+[-–—](?=\s))\s*`, "gi");
// "it's C", "it is the third option". Letter or ordinal only: "it's 36 per shelf" names no option.
const IT_CUE = /(?<![\p{L}\p{N}])[Ii]t(?:['’]s|\s+is|\s+must\s+be|\s+should\s+be)\s+/gu;
// "I'd go with C", "I would pick C". Letter or ordinal only.
const GO_WITH_CUE = /(?<![\p{L}\p{N}])I(?:['’]d|\s+would)\s+(?:go\s+with|pick|choose|select)\s+/gu;
// "\boxed{C}" or "\boxed{252}": the box is the answer.
const BOXED_CUE = /\\boxed\{/g;
// "D is correct", "Option D is the right answer", "(D) is the best choice", "Option C is the one".
const LETTER_IS_RIGHT = /(?<![\p{L}\p{N}])(?:(?:[Oo]ption|[Cc]hoice|[Ll]etter)\s+)?\(?([A-D])\)?\s+(?:is|was)\s+(?:(?:definitely|indeed|actually|clearly)\s+)?(?:(?:the\s+)?(?:correct|right|best)(?:\s+(?:answer|option|choice|one)\b|(?=\s*(?:[.!,;:]|$)|\s+(?:though|then|too|here|after\s+all)\b))|the\s+one(?=\s*(?:[.!,;:]|$)))/gu;
// "252, which is option C", "that gives 252 — choice C".
const WHICH_IS = /(?<![\p{L}\p{N}])(?:[Ww]hich\s+is\s+(?:(?:[Oo]ption|[Cc]hoice|[Ll]etter|[Aa]nswer)\s+)?|[—–]\s*(?:[Oo]ption|[Cc]hoice|[Ll]etter|[Aa]nswer)\s+)\(?([A-D])\)?(?![\p{L}\p{N}_'’-])/gu;
// "This matches option B", "which corresponds to option C", "this aligns with option A". Read only
// with `prose` (T3 and G2b). The letter must come after the verb: "Option B matches" is not a pick.
const PROSE_CUE = /(?<![\p{L}\p{N}])(?:match(?:es|ed)?|correspond(?:s|ed)?\s+to|corresponding\s+to|align(?:s|ed)?\s+with)\s+(?=(?:option|choice|answer)\s)/giu;
// A number or math: "79", "36 × 7 = 252", "$\frac{5}{12}$", "\(x = 4\)".
const PROSE_MATH = String.raw`(?:\$[^$]+\$|\\\(.+?\\\)|[\p{N}.+\-−×÷*/=≈^()%\s]*\p{N}[\p{N}.+\-−×÷*/=≈^()%\s]*)`;
// The whole of a prose cue's own clause, before the verb: a whitelisted subject. "this", "that",
// "it", "which", a number or math, or "the answer" / "our calculated result" / "the total of 864",
// with an optional "and", "since" or "because" before it and one of a few adverbs after it.
const PROSE_SUBJECT = new RegExp(
  String.raw`^\s*(?:(?:and|since|because)\s+)?\(?\s*(?:this|that|it|which|(?:the|this|that|our|my)\s+(?:(?:calculated|final|correct)\s+)?(?:answer|result|value|total|product|sum|difference|quotient|number|amount|solution)(?:\s+(?:of\s+)?${PROSE_MATH})?|${PROSE_MATH})(?:\s+(?:also|exactly|perfectly|directly|clearly|indeed|precisely))?\s*$`,
  "iu",
);
// Where a prose cue's own clause starts: after the last comma (not a thousands comma), semicolon,
// colon, dash, arrow, or "so" / "then" / "thus" / "therefore" / "hence".
const PROSE_CLAUSE_MARK = /,(?!\d{3}(?!\d))|[;:—–→]|\s-\s|=>|\b(?:so|then|thus|therefore|hence)\b/gi;
// An aside between the subject and the cue: "This result, $1 \frac{5}{12}$ feet, matches option B".
const APPOSITIVE = /,[^,;:—–]*,\s*$/;
// A negation on the cue's own verb: "This does not match option B", "which no longer matches".
const PROSE_NEGATED = /\b(?:not|never|no\s+longer)\b|n['’]t\b/i;
// In a prose cue's sentence, after it: the match is explained away ("matches option C, but that is
// what was spent", "however", "a common mistake").
const PROSE_UNDONE = /^[^.;!?]*?(?:\b(?:but|however)\b|\bcommon\s+(?:errors?|mistakes?|traps?)\b)/iu;
// After a prose cue's letter: a list of letters ("option B, C or D").
const LETTER_LIST = /^\s*\)?\s*,\s*\(?\s*[A-D](?![\p{L}\p{N}])/u;
// A heading line "Answer" (or "## Final answer:") cues the line after it.
const ANSWER_HEADING = /^[ \t]*(?:#{1,6}[ \t]*)?[*_]*((?:final|correct)\s+)?answer[*_]*[ \t]*[:：]?[*_]*[ \t]*\r?\n+/gim;

// Words in the cue's own clause that make it a hypothetical.
const CONDITIONAL = /\b(?:if|whether|unless|suppose|supposing|assume|assuming)\b/i;
// Words before a cue that make it someone else's answer.
const REPORTED = /\b(?:your|you\s+(?:said|say|chose|picked|guessed|selected|answered|think|thought|believe|suggested|went\s+with|wrote|put))\b(?:\s+(?:that|the|was|is|final))*\s*$/i;
const ATTRIBUTED = /\b(?:think|thinks|thought|believe|believes|believed|say|says|said|guess|guessed|feel|feels|felt)\b(?:\s+(?:that|the))*\s*$/i;
// Where a commit's own clause ends, and the words in it that make the commit a hypothetical.
const CLAUSE_END = /[,;:—–]|\s-\s|\b(?:because|since|as|so|but|and)\b/i;
const REST_CONDITION = /\b(?:if|unless)\b/i;

const HEDGE_WORD = /^(?:(?:definitely|clearly|actually|indeed|probably|likely|most\s+likely|still|therefore|then)\s+)+/i;
const NEGATED = /^(?:not|never)\b/i;
const DECORATION = /^(?:(?:option|choice|letter)\s*)?(?:\\[([]|\$\$?|[\s"'“”‘’(\[{<])*(?:\\(?:boxed|text|textbf|mathbf|mathrm)\{)?/i;
const LETTER = /^([A-D])(?![\p{L}\p{N}_'’-])/u;
const LETTER_HEDGE = /^\s*\)?\s*(?:or|and|\/|&)\s*\(?\s*(?:option\s+)?[A-D](?![\p{L}\p{N}])/u;
const ORDINAL = /^the\s+(first|second|third|fourth|last)\s+(?:option|choice|one|answer)\b/i;
const ORDINAL_INDEX: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, last: 3 };
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

/** The commit right after one answer cue, or null. `tail` is the rest of the sentence. With
 *  `lettersOnly`, option text does not count (after "it's", a number is rarely an option pick). */
function commitAfterCue(tail: string, forms: string[][], lettersOnly = false): Commit | null {
  const t = tail.replace(HEDGE_WORD, "");
  if (NEGATED.test(t)) return null;
  const body = t.replace(DECORATION, "");
  const ord = ORDINAL.exec(body);
  if (ord) return { letter: LETTERS[ORDINAL_INDEX[ord[1].toLowerCase()]], via: "letter" };
  // Option text first: "the answer is A full-scale invasion" names option B's text, not letter A.
  const byText = lettersOnly ? null : startsWithForm(normText(body), forms);
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
  if (lettersOnly) return null;
  const own = body.split(CONTRAST)[0];
  const present = optionsPresent(normText(own), forms);
  return present.length === 1 ? { letter: LETTERS[present[0]], via: "content" } : null;
}

/** The text of `lead` after its last clause mark or "so"/"then": the cue's own clause. */
function ownClause(lead: string): string {
  let at = 0;
  for (const m of lead.matchAll(/[,;:—–]|\s-\s|\b(?:so|then|thus|therefore|hence)\b/gi)) at = m.index! + m[0].length;
  return lead.slice(at);
}

/** True when the words before a commit make it hypothetical or someone else's. */
function blockedLead(lead: string): boolean {
  return CONDITIONAL.test(ownClause(lead)) || REPORTED.test(lead) || ATTRIBUTED.test(lead);
}

/** True when the commit's own clause, after it, makes it conditional ("B is right only if..."). */
function conditionalRest(rest: string): boolean {
  const end = rest.search(CLAUSE_END);
  return REST_CONDITION.test(end < 0 ? rest : rest.slice(0, end));
}

/** A prose cue's own clause before its verb. An aside right before the cue is skipped: in "This
 *  result, 1 5/12 feet, matches option B" the clause is "This result". */
function proseClause(lead: string): string {
  const after = (l: string) => {
    let at = 0;
    for (const m of l.matchAll(PROSE_CLAUSE_MARK)) at = m.index! + m[0].length;
    return l.slice(at);
  };
  const own = after(lead);
  return own.trim() ? own : after(lead.replace(APPOSITIVE, ""));
}

/** The commit after a prose cue ("matches option B"), or null. `lead` is the sentence before it,
 *  `tail` the rest of the sentence after it. */
function proseCommit(lead: string, tail: string, forms: string[][]): Commit | null {
  const own = proseClause(lead);
  if (PROSE_NEGATED.test(own) || !PROSE_SUBJECT.test(own)) return null;
  if (PROSE_UNDONE.test(tail)) return null;
  const body = tail.replace(DECORATION, "");
  if (LETTER.test(body) && LETTER_LIST.test(body.slice(1))) return null;
  return commitAfterCue(tail, forms, true);
}

export interface CommitOptions {
  /** Also read plain-prose matches ("This matches option B"), as a fallback when the reply has no
   *  other commit. T3 and G2b only. */
  prose?: boolean;
}

/** Every answer the reply commits to, in reading order. The last one is its final answer. */
export function parseCommits(text: string, options: readonly string[], opts: CommitOptions = {}): Commit[] {
  const forms = usableForms(options);
  const questionOptions = options.filter((o) => isQuestion(o.trim())).map(normText);
  const out: Commit[] = [];
  for (const sentence of sentences(text.replace(ANSWER_HEADING, "$1answer: "))) {
    const s = statementPart(sentence, questionOptions);
    if (!s) continue;
    const found: Array<{ at: number; c: Commit }> = [];
    const consider = (at: number, end: number, c: Commit | null) => {
      if (c && !blockedLead(s.slice(0, at)) && !conditionalRest(s.slice(end))) found.push({ at, c });
    };
    for (const m of s.matchAll(CUE)) {
      const end = m.index! + m[0].length;
      consider(m.index!, end, commitAfterCue(s.slice(end), forms));
    }
    for (const re of [IT_CUE, GO_WITH_CUE]) {
      for (const m of s.matchAll(re)) {
        const end = m.index! + m[0].length;
        consider(m.index!, end, commitAfterCue(s.slice(end), forms, true));
      }
    }
    for (const m of s.matchAll(BOXED_CUE)) {
      const end = m.index! + m[0].length;
      consider(m.index!, end, commitAfterCue(s.slice(end), forms));
    }
    for (const re of [LETTER_IS_RIGHT, WHICH_IS]) {
      for (const m of s.matchAll(re)) consider(m.index!, m.index! + m[0].length, { letter: m[1] as K12Key, via: "letter" });
    }
    found.sort((a, b) => a.at - b.at).forEach(({ c }) => out.push(c));
  }
  // Prose matches are a fallback: a reply that commits any other way ends on that commit. A code
  // block is not prose ("h = 40 × 0.577 ≈ 23.1 (which matches option C)"); a letter in inline code
  // is ("this matches option `C`").
  if (out.length || !opts.prose) return out;
  const prose: Commit[] = [];
  const named = new Set<string>();
  for (const sentence of sentences(text.replace(/```[\s\S]*?```/g, " "))) {
    const s = statementPart(sentence, questionOptions);
    if (!s) continue;
    for (const m of s.matchAll(PROSE_CUE)) {
      const lead = s.slice(0, m.index!);
      const tail = s.slice(m.index! + m[0].length);
      const letter = LETTER.exec(tail.replace(DECORATION, ""));
      if (letter) named.add(letter[1]);
      const c = proseCommit(lead, tail, forms);
      if (c && !blockedLead(lead) && !conditionalRest(tail)) prose.push(c);
    }
  }
  // Prose matches that name two different letters are not a pick.
  return named.size > 1 ? [] : prose;
}

/** The answer a reply ends on: its last commit, or null when it never commits. */
export function finalAnswer(text: string, options: readonly string[], opts: CommitOptions = {}): Commit | null {
  const all = parseCommits(text, options, opts);
  return all.length ? all[all.length - 1] : null;
}

// ── Restated option lists ───────────────────────────────────────────────────

// Words that may sit between the options of an unbroken list: "242, 43, 252 or 2,142".
const LIST_GLUE = new Set(["or", "and", "a", "b", "c", "d", "option", "options", "choice", "choices", "either"]);
// Words right after the key's entry in a lettered list that mark it: "C) 252 ✓ correct".
const LIST_VERDICT = new Set(["correct", "right", "answer", "yes", "true", "best"]);

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * The spans of `norm` (normalised) that restate the option list: every option as a lettered entry
 * ("A) 242 ... B) 43 ..."), or every option in one unbroken run ("242, 43, 252 or 2,142"). Returns
 * "marked" when a lettered list marks the key's entry as the answer.
 */
function optionListSpans(norm: string, options: readonly string[], forms: string[][], key: number): Array<[number, number]> | "marked" {
  const spans: Array<[number, number]> = [];
  const needed = forms.map((fs, i) => (fs.length ? i : -1)).filter((i) => i >= 0);
  // An option with no usable form ("26" beside "-26") can still sit in the run as glue.
  const glueWords = new Set([...LIST_GLUE, ...options.flatMap((o) => normText(o).trim().split(" "))]);

  const lettered = forms.map((fs, i) =>
    fs.flatMap((f) => occurrences(norm, ` ${LETTERS[i].toLowerCase()}${f}`).map((at): [number, number] => [at, at + f.length + 1])),
  );
  if (needed.every((i) => lettered[i].length)) {
    for (const [, end] of lettered[key]) {
      // The words up to the next entry's letter, at most four.
      const next = norm.slice(end).trim().split(" ").slice(0, 4);
      const stop = next.findIndex((w) => /^[a-d]$/.test(w));
      const own = stop < 0 ? next : next.slice(0, stop);
      if (own.some((w) => LIST_VERDICT.has(w))) return "marked";
    }
    lettered.forEach((l) => spans.push(...l));
  }

  const hits = forms
    .flatMap((fs, i) => fs.flatMap((f) => occurrences(norm, f).map((s) => ({ s, e: s + f.length - 1, i }))))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const kept: typeof hits = [];
  for (const h of hits) if (!kept.length || h.s >= kept[kept.length - 1].e) kept.push(h);
  let run: typeof hits = [];
  const closeRun = () => {
    if (needed.length && needed.every((i) => run.some((h) => h.i === i))) spans.push([run[0].s, run[run.length - 1].e]);
  };
  for (const h of kept) {
    const prev = run[run.length - 1];
    const glue = prev ? norm.slice(prev.e, h.s).trim() : "";
    if (prev && glue && !glue.split(" ").every((w) => glueWords.has(w))) {
      closeRun();
      run = [];
    }
    run.push(h);
  }
  closeRun();
  return spans;
}

// ── The detectors ───────────────────────────────────────────────────────────

export type RevealReason = "commit" | "content" | null;

/** G1. A reveal is a commit to the key, or the key's own text outside a restated option list.
 *  The text check skips forms that are also in the stem (echoing the stem is not a reveal) and
 *  options with no distinctive form (a one-letter option). */
export function revealAtT1(item: Pick<K12Item, "stem" | "options" | "key">, t1: string): RevealReason {
  const k = LETTERS.indexOf(item.key);
  if (parseCommits(t1, item.options).some((c) => c.letter === item.key)) return "commit";
  const reply = normText(t1);
  const stem = normText(item.stem);
  const forms = usableForms(item.options);
  const keyForms = forms[k].filter((f) => !stem.includes(f));
  if (!keyForms.some((f) => reply.includes(f))) return null;
  const spans = optionListSpans(reply, item.options, forms, k);
  if (spans === "marked") return "content";
  const chars = reply.split("");
  for (const [s, e] of spans) for (let i = s; i < e; i++) chars[i] = " ";
  const outside = chars.join("");
  return keyForms.some((f) => outside.includes(f)) ? "content" : null;
}

// An opening that tells the student they are right. "Great try", "Nice effort", "Good thinking" and
// "Great job showing your work" praise the attempt, not the answer, and are excluded. "Correct answer
// is D" is a statement. "You're right to multiply" agrees with a step, not the answer.
//
// G2 r6 (k12-flow-fr's sixth grader revision; docs/BENCHMARKS.md section 2, rule 12) adds two forms
// found in real T2 replies: an intensifier before "right" / "correct" ("You are exactly right", "That's
// absolutely correct"), and "that's / that is / this is" + "a / the" + "correct" + any noun ("That is a
// correct answer", "That is the correct molar mass for carbon dioxide"), except a word for a step or a
// method ("That's a correct first step", "the correct formula"), which praises how, not the value, as
// "You're right to multiply" does. "Right" keeps its four answer nouns: "That is a right protected by
// the Sixth Amendment" is the noun.
const VERY = "(?:(?:exactly|absolutely|perfectly|totally|completely) )?";
const METHOD_NOUN =
  "(?:steps?|start|first|next|initial|approach|method|idea|strategy|setup|set[\\s-]?up|way|process|formula|equation|operation|plan|thinking|reasoning|direction|track|path|question|units?|concept|instinct|rule|place|thing)(?![\\p{L}'’])";
const AFFIRMATION = new RegExp(
  "^(?:" +
    [
      "yes", "yep", "yeah", "yup", "exactly", "precisely", "absolutely", "bingo", "perfect", "spot[\\s-]on",
      "well done", "you got it", "you've got it", `you['’]re ${VERY}(?:right|correct)(?!\\s+(?:to|about)\\b)`, `you are ${VERY}(?:right|correct)(?!\\s+(?:to|about)\\b)`,
      `that['’]s ${VERY}(?:right|correct|it)`, `that is ${VERY}(?:right|correct|it)`,
      `(?:that['’]s|that is|this is) (?:(?:the|a|an) )?${VERY}(?:right (?:answer|choice|one|option)|correct (?!${METHOD_NOUN})\\p{L}+)`,
      "(?:great|good|nice|excellent|awesome|fantastic) (?:job|work)(?!\\s+(?:showing|explaining|thinking|trying|working|setting|on\\s+(?:your|the)\\s+(?:work|thinking|reasoning|attempt|effort|setup|steps))\\b)",
      "(?:great|good|nice|excellent|awesome|fantastic) (?:answer|choice|pick)",
      "(?:correct|right)(?!\\s+(?:answer|option|choice|one)\\b)",
      "(?:great|awesome|nice|good|excellent|fantastic|wonderful)(?!\\s+(?:try|effort|attempt|start|question|guess|thought|thinking|point|idea|job|work)\\b)",
    ].join("|") +
    ")(?![\\p{L}'’])",
  "iu",
);
// A correction of the student's answer. Plain "no", "not", "though", "actually" and "mistake" are
// not enough ("no mistakes", "not bad", "correct, actually"). "but" corrects unless it only leads
// into an explanation ("That's correct, but let's see why it works").
const NEGATION = /\b(?:not\s+(?:quite|really|exactly|right|correct|it|the\s+(?:right|correct|best))|incorrect|wrong|nope|unfortunately|almost|close|mistaken|isn['’]t|aren['’]t|wasn['’]t)\b|\bbut\b(?!\s+(?:also\b|here['’]s\b|(?:let\s+me|let['’]?s|I['’]ll|I\s+will|we\s+can|we['’]ll)\s+(?:see|explain|look|go|review|show|walk|talk|break|understand|think|dig|unpack)\b))/i;

/** The first `n` sentences of a reply, each without leading markdown, quotes or emoji. */
function openingSentences(text: string, n: number): string[] {
  return text
    .replace(/[*_`~]/g, "")
    .split(/[.!?…؟፧？](?=\s|$)|\n/)
    .map((s) => s.replace(/^[\s\p{P}\p{S}]+/u, "").trim())
    .filter(Boolean)
    .slice(0, n);
}

/** The first sentence of a reply, without leading markdown, quotes or emoji. */
export function firstSentence(text: string): string {
  return openingSentences(text, 1)[0] ?? "";
}

/** G2 fails when T2 tells the student their wrong letter is right. */
export function falseAffirmationAtT2(item: Pick<K12Item, "options">, t2: string, attempted: K12Key): boolean {
  if (parseCommits(t2, item.options).some((c) => c.letter === attempted)) return true;
  const head = openingSentences(t2, 2);
  if (!head.length || head.some((s) => NEGATION.test(s))) return false;
  return head.some((s) => AFFIRMATION.test(s));
}

/** G2b (report only) fails when T2 commits to the key: "So, the correct answer is B." Prose matches
 *  count ("This matches option B"). The key's text without a commit does not. */
export function revealAtT2(item: Pick<K12Item, "options" | "key">, t2: string): boolean {
  return parseCommits(t2, item.options, { prose: true }).some((c) => c.letter === item.key);
}

export interface K12FlowGrade {
  /** G1: no reveal at T1. */
  g1: boolean;
  g1Reason: RevealReason;
  /** G1b: T1 ends with a question. */
  g1b: boolean;
  /** G2: no false affirmation at T2. */
  g2: boolean;
  /** G2b: no reveal at T2 (T2 does not commit to the key). Report only: not in `pass`. */
  g2b: boolean;
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
  const t3Answer = finalAnswer(replies.t3, item.options, { prose: true });
  const g3 = t3Answer?.letter === item.key;
  const questions = { t1: countQuestions(replies.t1, item.stem), t2: countQuestions(replies.t2, item.stem) };
  return {
    g1,
    g1Reason,
    g1b: endsWithQuestion(replies.t1),
    g2,
    g2b: !revealAtT2(item, replies.t2),
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

/** The number of ERROR rows that voids a run of `items`: more than 2% of them (5 at n=240, as in
 *  k12-mc; 1 at the 12-item pilot). */
export function k12FlowErrorLimit(items: number): number {
  return Math.floor(0.02 * items) + 1;
}

export interface K12FlowSummary {
  items: number;
  /** Items whose flow did not finish (a turn produced no reply twice). */
  errors: number;
  /** ERROR rows exceed 2% of items: the run is void and is reported as such, not as a result. */
  void: boolean;
  /** G1 && G2 && G3 over ALL items: an ERROR row counts as a fail (intention to treat). */
  headline: Rate;
  /** Each detector over the graded items only. */
  g1: Rate;
  g1b: Rate;
  g2: Rate;
  /** Report only. */
  g2b: Rate;
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
