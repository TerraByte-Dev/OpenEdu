// The turn classifier: what kind of message did the student just send? (docs/BENCHMARKS.md section 3,
// lever 9b.) Code decides, from the text; no model call.
//
//   options-problem  a problem with a lettered option list and no try (attemptFirst.ts, unchanged).
//   typed-problem    a problem typed without options, to work out: arithmetic or algebra to compute,
//                    solve, simplify or evaluate, an equation with an unknown, or a word problem with
//                    numbers that asks for a quantity. No try of the student's own in the message.
//   fact-lookup      a request for information with no computation asked: what/who/when/where/which,
//                    how tall/far/many..., define, "explain what X is", "what do my notes say about X".
//   other            everything else, and anything unsure. Gets no note: the status quo.
//
// Why a fact lookup gets a note at all. The rules every generated course stores (curriculum.ts) say
// "Guide the student to discover answers rather than giving them immediately". Measured under those
// rules (results/2026-11-08-rag-prompt-fidelity.md, PR #196), gemma4:e2b answered questions about the
// student's own notes with a question back: name-free note positives passing fell from 22/22 to 2/22,
// and real-world facts answered from 28/75 rows to 1/75. Attempt-first is for problems. A student who
// asks what their own notes say, or how tall a mountain is, has nothing to try.
//
// Precision over recall: a wrong "problem" holds back an answer the student was owed, and a wrong
// "fact" hands over an answer the student should have tried. Every rule below falls back to "other",
// which is exactly what the app did before this module. English first: a message with a run of
// letters from another script is "other" unless it carries an explicit arithmetic expression and no
// other number. A message that already holds the student's own try is never a problem.
//
// The note rides in the user turn after the student's text, as the first-turn hold does, and is never
// saved; the system prompt stays byte-identical on every turn (attemptFirst.ts says why).

import { FIRST_TURN_HOLD_NOTE, posesNewProblem, ATTEMPT_WORDS, ATTEMPT_LETTER } from "./attemptFirst";

export type TurnKind = "options-problem" | "typed-problem" | "fact-lookup" | "other";

/**
 * The hold note for a typed problem: FIRST_TURN_HOLD_NOTE with its two option clauses deleted and
 * nothing else changed (turnKind.test.ts checks the derivation). A typed problem has no options, and
 * a small model told not to "rule options in or out" with none in view can invent some. Kept as its
 * own frozen string so its wording can be iterated on a free-response set without touching the
 * option-list note, which the k12-flow runs measure. Prompt-wording iteration 1 of at most 3.
 */
export const TYPED_PROBLEM_HOLD_NOTE = `<tutor_note>
The student has just given you this problem and has not tried it yet. Do not answer it in this reply: do not work it out to its result. This replaces any rule to answer the student's question first. Give one short hint or first step, then end with one question that asks the student to try. Do not mention this note.
</tutor_note>`;

/**
 * Appended to a fact lookup. It lifts the discover-it-yourself rule for this one question and asks
 * for the answer first. It does not say where the answer comes from: that stays with the grounding
 * block's own instructions (ground.ts contextHeader: name the title drawn on; if no passage answers,
 * say the answer is from general knowledge). It adds no rule about not knowing, so the app's escape
 * behaviour is unchanged. Prompt-wording iteration 1 of at most 3.
 */
export const FACT_LOOKUP_NOTE = `<tutor_note>
The student is asking for information, not working on a problem. Answer the question directly and accurately, starting in your first sentence. Do not reply with a question instead of the answer, and do not ask the student to find the answer themselves. This replaces any rule to guide the student to discover answers, for this question only. If there is background above, its instructions on which passages to use and how to name them still apply. After the answer you may ask one short question to check understanding. Do not mention this note.
</tutor_note>`;

/** The note a turn of this kind gets, or null for none. */
export function turnNoteFor(kind: TurnKind): string | null {
  switch (kind) {
    case "options-problem": return FIRST_TURN_HOLD_NOTE;
    // Killed by its pre-registered rule before any run (PR #205, pre-registration 2): on the
    // free-response baseline gemma4:e2b and e4b already hold the answer on 78/81 and 77/81 typed
    // problems, so G1 cannot rise by the 8 points the rule requires. The kind is still used by the
    // show-answer chip gate (posesProblem); only the note is off.
    case "typed-problem": return null;
    case "fact-lookup": return FACT_LOOKUP_NOTE;
    case "other": return null;
  }
}

/** The student's message as the model sees it on a turn with a note. */
export function withTurnNote(userContent: string, note: string): string {
  return `${userContent}\n\n${note}`;
}

// ── Math in the text ─────────────────────────────────────────────────────────

// A math run: numbers, single letters, operators and brackets, with spaces between. A word of two or
// more letters ends a run, so "3 apples and 4 pears" is two runs ("3", "4"), not an expression.
const ATOM = String.raw`(?:[$£€]?\d+(?:[.,]\d+)*|(?<!\p{L})[A-Za-z](?!\p{L})|[-+−–×*·÷/^=()%²³√])`;
const MATH_RUN = new RegExp(`${ATOM}(?:[ \\t]*${ATOM})*`, "gu");
const TOKEN = /[$£€]?\d+(?:[.,]\d+)*|[A-Za-z]|[-+−–×*·÷/^=()%²³√]/g;
const BINARY_OP = /^[-+−–×*·÷/^]$/;

interface MathRun {
  /** The run's shape: n number, v letter, o binary operator, = ( ) % p (² ³) r (√). */
  shape: string;
  text: string;
  /** Where the run starts in the message. */
  start: number;
}

function mathRuns(text: string): MathRun[] {
  const runs: MathRun[] = [];
  for (const m of text.matchAll(MATH_RUN)) {
    const toks = m[0].match(TOKEN) ?? [];
    const kinds = toks.map((t) => /\d/.test(t) ? "n" : /^[A-Za-z]$/.test(t) ? "v" : BINARY_OP.test(t) ? "o" : t === "²" || t === "³" ? "p" : t === "√" ? "r" : t);
    // "3 x 4": an x between two numbers is a times sign.
    for (let i = 1; i < kinds.length - 1; i++) {
      if (kinds[i] === "v" && /^[xX]$/.test(toks[i]) && kinds[i - 1] === "n" && kinds[i + 1] === "n") kinds[i] = "o";
    }
    runs.push({ shape: kinds.join(""), text: m[0].trim(), start: m.index! });
  }
  return runs;
}

const YEAR_RANGE = /^(?:1\d{3}|20\d{2})\s*[-–]\s*(?:\d{2}|\d{4})$/;
const DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const LONE_FRACTION = /^\d+\s*\/\s*\d+$/;
// "3-4 times a week", "pages 10-12": a range. Read as a subtraction only right after "what is" and the like.
const RANGE = /^\d+(?:\.\d+)?[-–]\d+(?:\.\d+)?$/;
const RANGE_AS_SUM = /\b(?:what(?:'s| is)|whats|calculate|compute|evaluate|work out|solve)\s*$/i;
// An operator with an operand on each side, or a root, square or cube of a number.
const SHAPE_EXPR = /[nv)p%]\(*o\(*[nvr(]|r\(*n|np/;

function isExpression(r: MathRun, text: string): boolean {
  if (!r.shape.includes("n")) return false;
  if (YEAR_RANGE.test(r.text) || DATE.test(r.text) || LONE_FRACTION.test(r.text)) return false;
  if (RANGE.test(r.text) && !RANGE_AS_SUM.test(text.slice(0, r.start))) return false;
  return SHAPE_EXPR.test(r.shape.replace(/=.*$/, "")) || SHAPE_EXPR.test(r.shape.replace(/^.*=/, ""));
}

const NUMBER_SHAPE = /^o?n(?:on)?%?$/; // 12, -3, 3/4, 25%
// Givens, not a try: "if y = 3", "when n = 4", "given x = 2".
const GIVEN_BEFORE = /\b(?:if|when|where|given|with|let|and|that)\s*$/i;

type Equation = "none" | "blank" | "result" | "solution" | "unknown";

/** What the run's "=" says: a blank to fill (3 + 4 = ?), a result (3 + 4 = 7), a solution (x = 7), an
 *  equation with an unknown (2x + 5 = 17), or no equation. */
function equation(r: MathRun, text: string): Equation {
  const at = r.shape.indexOf("=");
  if (at < 0) return "none";
  const lhs = r.shape.slice(0, at);
  const rhs = r.shape.slice(at + 1).replace(/=.*$/, "");
  if (!lhs) return "none";
  if (!rhs) return isExpression(r, text) ? "blank" : "none";
  if (lhs === "v" && NUMBER_SHAPE.test(rhs)) {
    return GIVEN_BEFORE.test(text.slice(0, r.start)) ? "none" : "solution";
  }
  if (!lhs.includes("v") && /o/.test(lhs) && NUMBER_SHAPE.test(rhs)) return "result";
  if (r.shape.includes("v") && r.shape.includes("n")) return "unknown";
  return "none";
}

const NUMW = String.raw`(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)`;
const WORD_OP = String.raw`(?:plus|minus|times|multiplied by|divided by)`;
const WORD_EXPR = new RegExp(String.raw`\b${NUMW}\s+${WORD_OP}\s+${NUMW}\b`, "i");
const WORD_RESULT = new RegExp(String.raw`\b${NUMW}\s+${WORD_OP}\s+${NUMW}\s+(?:is|equals|makes|=)\s+-?${NUMW}\b`, "i");
// "15% of 80", "3/4 of 20", "square root of 144", "9 squared", "2 to the power of 5", "0.25 as a fraction".
const MATH_PHRASE = [
  /\b\d+(?:\.\d+)?\s*(?:%|percent\b|per cent\b)\s*of\s+[$£€]?\d/i,
  /\b\d+\s*\/\s*\d+\s+of\s+[$£€]?\d/,
  /\b(?:square|cube) root of\s+\d/i,
  /\b\d+(?:\.\d+)?\s+(?:squared|cubed)\b/i,
  /\b\d+(?:\.\d+)?\s+to the power of\s+\d/i,
  /\b\d+(?:[.,/]\d+)*\s*%?\s+(?:as an?|in|into)\s+(?:decimal|fraction|percent(?:age)?|simplest form|lowest terms)\b/i,
];

// ── Tries ────────────────────────────────────────────────────────────────────

const MORE_ATTEMPT = /\b(?:i (?:tried|did|added|subtracted|multiplied|divided|worked (?:it )?out|calculated|computed|found|wrote|put|said|used|keep getting|ended up with|came up with)|i['’]m getting|i['’]ve got|i am getting|check my (?:work|working|answer)|is (?:this|that|it|my answer) (?:right|correct)|am i (?:right|correct))\b/i;
const NUMBER_GUESS = /\b(?:is it|is the answer|it['’]?s|it is|the answer is|answer is|would it be|should it be|shouldn['’]?t it be|could it be|equals)\s*[$£€]?-?\d/i;
// A message opening like a tentative try ("so 8 × 3?", "maybe 12?").
const TENTATIVE = /^(?:so|maybe|then|or|like|um+|uh+|hmm+)\b/i;

/** True when the message holds a try of the student's own: an answer, a result, a solution. */
function hasAttempt(text: string, runs: MathRun[]): boolean {
  if (ATTEMPT_WORDS.test(text) || ATTEMPT_LETTER.test(text) || MORE_ATTEMPT.test(text) || NUMBER_GUESS.test(text) || WORD_RESULT.test(text)) return true;
  return runs.some((r) => { const e = equation(r, text); return e === "result" || e === "solution"; });
}

// ── Problems ─────────────────────────────────────────────────────────────────

// A run of two or more letters from a script other than Latin. One letter (π, θ) is maths, not a language.
const NON_LATIN = /(?:(?!\p{Script=Latin})\p{L}){2,}/u;
const POLITE = /^(?:(?:hi|hey|hello|ok(?:ay)?|so|also|and|but|well|please|quick question|question|sorry|wait)\b[\s,:!.-]*)*(?:(?:can|could|would|will) you (?:please )?)?(?:please )?/i;
const HELP_FRAME = /^(?:help me(?: with| to)?|how (?:do|would|can|should) (?:i|you|we)|i (?:need|have|want) to|i need help(?: with)?)\s+/i;
// An instruction to compute. "find" only with a maths noun after it: "Find the 3 main causes of the war"
// is not a problem to work out.
const IMPERATIVE = /^(?:solve|simplify|evaluate|compute|calculate|work out|figure out|factori[sz]e|factor|expand|convert|round|estimate|add|subtract|multiply|divide|find (?:the )?(?:area|perimeter|volume|circumference|sum|product|difference|quotient|remainder|mean|average|median|value|slope|gradient|total|ratio|missing|square root|cube root|lcm|gcf|gcd|hcf|lowest common|least common|greatest common|highest common))\b/i;
const EXPR_FRAME = /\b(?:what(?:['’]s| is| are| was| does| do| would)|whats|how much|calculate|compute|evaluate|simplify|solve|work out|figure out|find|equals?|help(?: me)? with|can you do|write|express|convert|change|turn)\b/i;
const EQ_FRAME = /\b(?:solve|find|work out|figure out|what(?:['’]s| is)|whats|simplify|rearrange|factori[sz]e|expand|for [a-z]|value of [a-z]|help(?: me)? with)\b/i;
const QUANTITY_Q = /\b(?:how (?:many|much|far|long|fast|old|tall|heavy|high|wide|deep)|what (?:is|was|will be|would be|are) the (?:total|sum|difference|product|quotient|remainder|average|mean|median|area|perimeter|volume|cost|price|speed|distance|ratio|probability|change)|what fraction|what percent(?:age)?|find the|calculate the|work out the)\b/i;
const ORDINAL_AFTER = /^(?:st|nd|rd|th)\b/i;
const YEAR_BEFORE = /(?:\b(?:in|since|by|from|until|till|to|and|between|of|year|years|before|after|during|around|circa)\s*|\d[-–]\s*)$/i;
const YEAR_AFTER = /^\s*(?:bc|ad|bce|ce|s)\b/i;

const NUMBER_WORD = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen)\b/gi;

// "ten-hour day", "3-year-old": a number joined to a word by a hyphen describes it; it is not a quantity.
const COMPOUND_AFTER = /^-\p{L}/u;

/** Numbers that stand for quantities: not ordinals (3rd), not years (in 1990), not inside a name (CO2),
 *  not a compound adjective (ten-hour). Number words from two up count too ("three apples"); "one" is
 *  left out, it is too often a pronoun. */
function quantityCount(text: string): number {
  let n = 0;
  for (const m of text.matchAll(NUMBER_WORD)) if (!COMPOUND_AFTER.test(text.slice(m.index! + m[0].length))) n++;
  for (const m of text.matchAll(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)*(?!\d)/gu)) {
    const after = text.slice(m.index! + m[0].length);
    if (ORDINAL_AFTER.test(after) || COMPOUND_AFTER.test(after)) continue;
    const year = /^\d{4}$/.test(m[0]) && Number(m[0]) >= 1000 && Number(m[0]) <= 2099;
    if (year && (YEAR_BEFORE.test(text.slice(0, m.index!)) || YEAR_AFTER.test(after))) continue;
    n++;
  }
  return n;
}

const sentences = (text: string) => text.split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const stripPolite = (s: string) => s.replace(POLITE, "").replace(HELP_FRAME, "");

/** True for a typed problem in a Latin-script message with no try (checked by the caller). */
function posesTypedProblem(text: string, runs: MathRun[]): boolean {
  const expr = runs.some((r) => isExpression(r, text) && equation(r, text) !== "unknown") || MATH_PHRASE.some((re) => re.test(text)) || WORD_EXPR.test(text);
  const unknown = runs.some((r) => equation(r, text) === "unknown");
  const pureMath = !/\p{L}{2,}/u.test(text);
  if (pureMath) {
    // "48 ÷ 6 =" or "48 ÷ 6 = ?" is a blank to fill. "48 ÷ 6?" alone could be a tentative try.
    return runs.some((r) => equation(r, text) === "blank");
  }
  if (TENTATIVE.test(text)) return false;
  if (expr && (text.includes("?") || EXPR_FRAME.test(text))) return true;
  if (unknown && EQ_FRAME.test(text)) return true;
  const quantities = quantityCount(text);
  if (quantities >= 2 && QUANTITY_Q.test(text)) return true;
  // "Find the area of a circle with radius 5", "Convert 5 km to metres", "Round 3.456 to one place".
  return quantities >= 1 && sentences(text).some((s) => IMPERATIVE.test(stripPolite(s)));
}

// ── Fact lookups ─────────────────────────────────────────────────────────────

const ASK = /^(?:(?:tell|remind) me|let me know|i (?:want|need|would like|['’]d like) to know|do you know|i(?: was)? wonder(?:ing)?)\b[\s,:]*/i;
const NOTES_LEAD = /^(?:according to|in|from|based on|using) (?:my|the) notes?,?\s*/i;
// "what/who/when/where/which ...", "in what year", "at what temperature", "how tall/far/many ...", "define".
const OPENER = /^(?:(?:(?:in|at|on|by|for|from|to|of|during|since|until|after|before|past|above|below|over|under|around|about) (?:what|which|whom|whose)\s)|(?:what|who|whom|whose|when|where|which)(?:['’]s\b|\s)|how (?:tall|big|far|long|old|high|deep|heavy|hot|cold|many|much|large|small|wide|fast|often|thick)\b|(?:define|definition of|meaning of)\b|(?:explain|describe) (?:what|who|when|where)\b)/i;
// A yes/no question ("Is the river navigable in winter?") may sit beside a lookup without making
// the message unsure. It is never a lookup on its own.
const YES_NO = /^(?:is|are|was|were|does|do|did|can|has|have|had)\b/i;
// What a lookup about the student's own notes says ("what do my notes say about", "what did I write
// about"). Removed before the first-person check below, so "my" and "I" there do not count against it.
const NOTES_PHRASE = /\b(?:(?:my|the) notes?|what (?:did|do) i (?:write|note|put down|have) (?:about|on|for)|i (?:wrote|noted|put down))\b/gi;
const NOTES_ASK = /^what (?:did|do) i (?:write|note|put down|have) (?:about|on|for)\b/i;
const NOT_A_LOOKUP = /^(?:what if|what about|what now|what else|what next|which one|which of|what['’]?s up|what['’]?s new|what['’]?s going on|what['’]?s happening|what (?:do|does|did|should|would|could|can|shall|will) (?:i|we|you)\b|what (?:am|are) (?:i|we|you)\b)|\b(?:value of|solve for|find) [a-z]\b(?!['’])/i;
// A message about the problem at hand, the exchange, or a test: never a lookup.
const PROBLEM_TALK = /\b(?:answer|answers|solution|solutions|solve|hint|hints|step|mistake|mistakes|option|options|choice|choices|wrong|correct|incorrect|next|homework|worksheet|exercise|quiz|test|exam|problem|true or false)\b/i;
// A question about the tutor ("Who are you?", "What do you mean?").
const ABOUT_TUTOR = /\b(?:you|your|yours|yourself)\b/i;
// Words that may point back at something the code cannot see ("When was it built?", "What is that?").
// In a message that says little else they do; in one that describes its subject ("the bridge over
// the old canal", "the bird that eats only figs") they point inside the message. So they rule a lookup
// out only when the message has fewer than MIN_CONTENT_WORDS other content words.
const POINTER = /\b(?:it|this|that|these|those|they|them|he|she|him|her|its|their|his)\b/gi;
const MIN_CONTENT_WORDS = 3;
const OPINION = /\b(?:better|best|worse|worst|favou?rite|easier|harder|opinion)\b/i;
const STOP = new Set(["the", "and", "for", "are", "was", "were", "what", "who", "whom", "whose", "when", "where", "which", "how", "does", "did", "about", "with", "from", "into", "than", "that", "this", "these", "those", "they", "them", "their", "his", "her", "him", "she", "its", "say", "says", "notes", "note", "define", "definition", "meaning", "explain", "describe", "tell", "has", "have", "had", "will", "would", "could", "should", "can", "get", "got"]);

const contentWords = (s: string) => (s.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:es|s)$/, ""));

/** The question, with the asking frame removed, if this clause opens a fact lookup; else null. */
function lookupClause(clause: string): string | null {
  let s = stripPolite(clause).replace(ASK, "").replace(NOTES_LEAD, "");
  if (/^about\s+\S/i.test(s) && ASK.test(stripPolite(clause))) s = `what is ${s}`; // "tell me about X"
  if (!OPENER.test(s) || (NOT_A_LOOKUP.test(s) && !NOTES_ASK.test(s))) return null;
  if (contentWords(s.replace(OPENER, "")).length === 0) return null;
  return s;
}

/** True when the sentence is a lookup: it opens with one, or a lead-in clause comes first ("The metal
 *  used in old church bells: when does it melt?", "For that recipe, how much salt goes in?"). */
function isLookupSentence(sentence: string, text: string): boolean {
  const clauses = [sentence, ...sentence.split(/\s*(?:[,:;]|\s[—–-]\s)\s*/).slice(1)];
  if (!clauses.some((c) => lookupClause(c) !== null)) return false;
  if (ABOUT_TUTOR.test(stripPolite(sentence).replace(ASK, "")) || OPINION.test(sentence)) return false;
  if (POINTER.test(sentence)) {
    const words = contentWords(text.replace(NOTES_PHRASE, " ").replace(POINTER, " ")).filter((w) => !/^(?:what|who|when|where|which|how)$/.test(w));
    if (words.length < MIN_CONTENT_WORDS) return false;
  }
  return true;
}

function asksFactLookup(text: string, runs: MathRun[]): boolean {
  if (PROBLEM_TALK.test(text)) return false;
  if (runs.some((r) => isExpression(r, text) || equation(r, text) !== "none")) return false;
  // Numbers to work with: "How many legs do three spiders have?", "Which is bigger, 3/4 or 2/3?".
  const quantities = quantityCount(text);
  if (quantities >= 2 || (quantities > 0 && QUANTITY_Q.test(text))) return false;
  // Two or more numbers of any kind, years included, with a word that sets up a calculation are
  // something to work out rather than a fact to recall ("75 years after 1969", "how old ... born in
  // 1809 ... president in 1861"). A plain range ("between 1939 and 1945") stays a lookup.
  if ((text.match(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)*(?!\d)/gu) ?? []).length >= 2 && /\b(?:after|before|later|earlier|ago|old|older|younger|if|until|from now)\b/i.test(text)) return false;
  const parts = sentences(text);
  const lookups = parts.filter((s) => isLookupSentence(s, text));
  if (lookups.length === 0) return false;
  // Another question in the same message that is not a lookup or a yes/no question ("How do I use
  // it?") makes it unsure.
  return parts.every((s) => lookups.includes(s) || !s.endsWith("?") || YES_NO.test(stripPolite(s)));
}

// ── The classifier ───────────────────────────────────────────────────────────

/** What kind of message `text` is, from the text alone. */
export function classifyMessage(raw: string): TurnKind {
  if (posesNewProblem(raw)) return "options-problem";
  const text = raw.trim().replace(/^["'\s]+/, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (!text) return "other";
  const runs = mathRuns(text);
  if (hasAttempt(text, runs)) return "other";
  if (NON_LATIN.test(text)) {
    // Another language: only an explicit arithmetic expression, and no number outside it (a number
    // elsewhere may be the student's answer, written in words the code cannot read).
    const exprRuns = runs.filter((r) => isExpression(r, text) || equation(r, text) === "blank" || equation(r, text) === "unknown");
    if (exprRuns.length === 0) return "other";
    const outside = runs.filter((r) => !exprRuns.includes(r) && r.shape.includes("n"));
    return outside.length === 0 ? "typed-problem" : "other";
  }
  if (posesTypedProblem(text, runs)) return "typed-problem";
  if (asksFactLookup(text, runs)) return "fact-lookup";
  return "other";
}

/** True when `text` poses a new problem, with lettered options or typed. The chip gate uses it. */
export function posesProblem(text: string): boolean {
  const kind = classifyMessage(text);
  return kind === "options-problem" || kind === "typed-problem";
}

const endsOnQuestion = (s: string) => /\?["'*`)\]]*$/.test(s.trim());

/**
 * What kind of turn this is. `conversation` is the user and assistant messages, ending with the
 * newest. Only the student's newest message is classified. One guard uses the reply before it: a
 * lookup that repeats the question the tutor just asked ("What is the powerhouse of the cell?" back
 * at the tutor who asked it) is the student's turn to try, so it is "other".
 */
export function classifyTurn(conversation: ReadonlyArray<{ role: string; content: string }>): TurnKind {
  const newest = conversation[conversation.length - 1];
  if (!newest || newest.role !== "user") return "other";
  const kind = classifyMessage(newest.content);
  if (kind !== "fact-lookup") return kind;
  const prev = conversation[conversation.length - 2];
  if (prev?.role === "assistant" && endsOnQuestion(prev.content)) {
    const asked = new Set(contentWords(sentences(prev.content.trim()).slice(-1)[0] ?? ""));
    const words = contentWords(newest.content);
    if (words.length && words.filter((w) => asked.has(w)).length / words.length >= 0.6) return "other";
  }
  return kind;
}
