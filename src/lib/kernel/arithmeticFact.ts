// The arithmetic-fact note on a "what is 7 times 8" turn (docs/BENCHMARKS.md section 3, lever 20).
// Ported from TerraTutor #250.
//
// TerraTutor's click test 2026-11-19: "what is 7 times 8 in the times tables?" in a Fractions course
// got 56 from gemma4:e2b in 1 of 5 replies. The others put it off ("a topic for
// later", "find the row for 7 and the column for 8, what number do you find?"); in part 2 one reply was
// "I can look that up for you." with a base-conversion chip and no 56.
//
// The thesis, as for the dictionary note (defineWord.ts): deterministic code owns facts, the small model
// only phrases them. When the student's newest message plainly asks one arithmetic FACT, code works it
// out and appends it, with a short note, after the student's text, in the same place as the other
// notes: code decides when, from the conversation alone; no model call is added; the system prompt
// stays byte-identical; the note is not saved, because ChatTab saves what the student typed. A turn it
// does not fire on is sent exactly as it was before this file.
//
// Facts, not exercises (Fable's decision for TerraTutor, 2026-11-19, as the maintainer's delegate). The attempt-first
// policy holds a problem the student types (B4 G1, "no reveal at T1", on k12-flow-fr: "what's 407 +
// 285?"), and a fraction or decimal sum is a lesson's own exercise. So E is one operation on whole
// numbers of fact size, and the answer is always a whole number:
//   a + b              both 0 to 100
//   a − b              both 0 to 100, and a ≥ b
//   a × b              both 0 to 12
//   a ÷ b              b 1 to 12, even, quotient at most 12
//   double a           a 0 to 100
// No a/b fractions, no decimals, no negatives, and no "half / a third / a quarter of a": a fraction of a
// set is a Fractions course's own exercise, for the same reason a fraction sum is. Known gap: in a course
// that teaches addition or the times tables, "15 + 27" or "7 × 8" is the exercise itself, and this still
// states it.
//
// What fires (askedArithmetic): the last sentence of the message, after a little chatter ("um", "ok",
// "quick question"), is one of the forms below, and no sentence before it holds a number (digits or a
// number word). "I was doing my worksheet. What is 7 times 8?" fires; "Sam has 5 apples and gets 3 more.
// What is 5 + 3?" does not (a problem the student typed, B4 G1), nor a pasted list of questions, nor a
// try before the question ("is it 56? what is 7 times 8"). The forms:
//   what is / what's / whats / how much is [the answer to] E
//   what does / do E equal / make / come to
//   (can you) tell me / do you know / I forgot / I don't know / I can't remember   what E is
//   E = ?        E equals what?        E is what?
// optionally followed by "in the times tables", "again", "exactly", "for me", "please" and closing
// punctuation, and nothing else. Operators: + plus add; − - (spaced) minus "take away"; × x * times
// "multiplied by"; ÷ / (spaced) "divided by". An operand is digits or a number word (zero to twenty,
// thirty ... ninety).
//
// What does not fire, on purpose:
//   - anything after E that is not in that short list: a unit or thing ("7 times 8 apples"), a second
//     operation ("3 times 4 times 5", "5 + 3 and then double it"), another base ("1 + 1 in binary");
//   - a number past the limits above ("407 + 285", "13 × 14", "7 ÷ 2", "double 101"), a fraction or a
//     decimal ("1/2 + 1/4", "0.5 + 0.25"), a lone number ("what is 12/25", "what's 9/11"), an unspaced
//     hyphen ("what is 9-11", a date, an event or a range), a clock time ("3:30"), a variable ("2x + 3",
//     "x times 8");
//   - "times" in other senses ("how many times", "3 times a day", "what times are the classes");
//   - a try or a check ("is 7 x 8 56?", "I think it's 54"), a word problem's own question ("how many
//     apples?"): no head; a word problem typed before the question: a number in an earlier sentence;
//   - a message that asks to be quizzed or to work it out, anywhere in it: "quiz me", "test me", "ask
//     me", "give me a problem", "hint", "don't tell me", "let me try", "I want to figure it out",
//     "my answer", "I think", "I got";
//   - (arithmeticFactTurn) any turn of a mastery check (answerCheck.ts inMasteryCheck: assess mode, or
//     a request for a check among the student's last messages), so the answer to a question the tutor
//     asked in a check or quiz is never given away;
//   - (arithmeticFactTurn) a question that one of the tutor's last TUTOR_LOOKBACK messages may have
//     asked: it holds every operand ("A baker has 7 trays of 8 buns..." then "hmm", a hint, then "what's
//     7 times 8?"), or the answer and an operand ("What is 54 ÷ 6?" then "what's 6 times 9?"), counting
//     "half", "twice" and "double" as 2, "third" and "triple" as 3, "quarter" as 4 and "dozen" as 12
//     ("What is half of 16?" then "what is 16 / 2"). This also covers a check's question asked past
//     inMasteryCheck's window. The student's own messages from that stretch are read the same way, so a
//     word problem typed one message before the question ("Sam has 7 bags with 8 marbles in each. How
//     many marbles?", the tutor's reply, then "what is 7 times 8?") is held too. Asking one piece of the
//     tutor's question is the student's own work and is answered ("What is 7 × 8?" then "what is 7 times
//     4?"), and so is a question more than TUTOR_LOOKBACK tutor messages back;
//   - (TutorEngine) a safety-disclosure turn, a first-turn hold or check-before-praise turn, a meaning
//     question, a turn the app makes a flashcard on, or the eval switch `arithmeticFacts: "off"`.

import { inMasteryCheck } from "./answerCheck";

export interface ArithmeticFact {
  /** The operation as the note writes it: "7 × 8", "15 + 27", "double 8". */
  expression: string;
  /** The answer, a whole number: "56". */
  answer: string;
  /** Each operand in digits ("7", "8"), for the check against the tutor's last messages. */
  operands: string[];
}

const WORD_NUMBERS: Record<string, number> = Object.fromEntries([
  ..."zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    .split(" ").map((w, i) => [w, i] as const),
  ...["thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].map((w, i) => [w, 30 + 10 * i] as const),
]);
const NUMBER_WORDS = Object.fromEntries(Object.entries(WORD_NUMBERS).map(([w, n]) => [n, w]));

const value = (text: string): number => WORD_NUMBERS[text.toLowerCase()] ?? Number(text);

// ── The detector ─────────────────────────────────────────────────────────────

const WORD_NUMBER = Object.keys(WORD_NUMBERS).join("|");
// One operand, not run into a letter, digit or separator (but "7x8"), so "1/2", "0.5", "1,000", "3:30"
// and "3x" are never read as a whole number, nor "007" as 7. Group names are filled in per use.
const OPERAND = (g: string) => String.raw`(?<${g}>0|[1-9]\d{0,2}|(?:${WORD_NUMBER}))(?!(?![xX]\d)[\p{L}\p{N}/.,:])`;
// A binary operator. Symbols may touch the numbers ("7x8", "15+27"); "-" and "/" must have spaces round
// them, since "9-11" and "3/4" are not sums; words need spaces.
const BINARY = String.raw`(?:\s*(?<sym>[+×*÷·−])\s*|\s+(?<spaced>[-/])\s+|(?<=\d)\s*(?<x>[xX])\s*(?=\d)|\s+(?<x2>[xX])\s+|\s+(?<word>plus|add|minus|take\s+away|times|multiplied\s+by|divided\s+by)\s+)`;
const UNARY = String.raw`(?<unary>double)\s+`;
const EXPR = String.raw`(?:${UNARY}${OPERAND("u")}|${OPERAND("a")}${BINARY}${OPERAND("b")})`;

const FILLER = String.raw`(?:(?:hey|hi|um+|uh+|so|ok|okay|oh|wait|sorry|and|but|also|quick\s+question|hmm+|btw|please|pls|plz)[,!:]?\s+)*`;
const TAIL = String.raw`(?:\s+(?:in\s+(?:the\s+)?(?:times|multiplication)\s+tables?|again|exactly|for\s+me|real\s+quick))*\s*(?:,?\s*(?:please|pls|plz))?\s*[?.!]*\s*$`;
const FORGOT = String.raw`(?:(?:can|could|would)\s+(?:you|u)\s+(?:please\s+)?tell\s+me|tell\s+me|do\s+(?:you|u)\s+know|i\s+(?:forgot|forget|don['’]?t\s+know|dont\s+know|do\s+not\s+know|don['’]?t\s+remember|can['’]?t\s+remember|cannot\s+remember))`;

const HEADS = [
  String.raw`(?:what\s+is|what['’]?s|how\s+much\s+is)\s+(?:the\s+answer\s+(?:to|of)\s+)?${EXPR}${TAIL}`,
  String.raw`what\s+(?:does|do)\s+${EXPR}\s+(?:equal|make|come\s+to)${TAIL}`,
  String.raw`${FORGOT}\s+what\s+${EXPR}\s+(?:is|equals|makes)${TAIL}`,
  String.raw`${EXPR}\s*(?:=|equals|is)\s*(?:what\s*)?\?+\s*$`,
];
const PATTERNS = HEADS.map((h) => new RegExp(String.raw`^\s*${FILLER}${h}`, "iu"));

// Anywhere in the message: the student wants to be asked, or to work it out, or is offering an answer.
const NOT_ASKING = /\b(?:quiz|test)\s+me\b|\bask\s+me\b|\bgive\s+me\s+(?:a|an|another|some|more)\s+(?:problems?|questions?|ones?|hints?|clues?)\b|\bhints?\b|\bclues?\b|\b(?:don['’]?t|dont|do\s+not)\s+(?:tell|give|say|show)\b|\bwithout\s+(?:telling|giving|saying|showing)\b|\blet\s+me\s+(?:try|work|figure|do|guess|think|solve)\b|\bi\s+(?:want|wanna|would\s+like|['’]d\s+like)\s+to\s+(?:try|work|figure|do|solve|guess)\b|\bi['’]?ll\s+(?:try|work|figure|solve)\b|\bmy\s+(?:answer|guess)\b|\bi\s+(?:think|got|get|guess)\b/i;

/** The message's sentences: split after ".", "!" or "?" followed by a space, and at line breaks. */
function sentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// A number in the text before the question: digits or a number word ("sevens", "a dozen", "half").
const HAS_NUMBER = new RegExp(String.raw`\d|\b(?:${WORD_NUMBER}|dozen|hundred|thousand|million|half|halves|twice|double|triple)(?:e?s)?\b`, "i");

type Op = "+" | "−" | "×" | "÷";
function binaryOp(g: Record<string, string | undefined>): Op {
  const s = (g.sym ?? g.spaced ?? (g.x || g.x2 ? "x" : undefined) ?? g.word ?? "").toLowerCase().replace(/\s+/g, " ");
  if (s === "+" || s === "plus" || s === "add") return "+";
  if (s === "-" || s === "−" || s === "minus" || s === "take away") return "−";
  if (s === "/" || s === "÷" || s === "divided by") return "÷";
  return "×";
}

/** The answer when `a op b` is a fact inside the limits (file comment), else null. */
function binaryFact(a: number, op: Op, b: number): number | null {
  if (op === "+") return a <= 100 && b <= 100 ? a + b : null;
  if (op === "−") return a <= 100 && b <= a ? a - b : null;
  if (op === "×") return a <= 12 && b <= 12 ? a * b : null;
  return b >= 1 && b <= 12 && a % b === 0 && a / b <= 12 ? a / b : null;
}

/**
 * The arithmetic fact the student's message plainly asks for, worked out; null when the message is not
 * such a question or the operation is not a fact (see the file comment for what does and does not fire).
 */
export function askedArithmetic(message: string): ArithmeticFact | null {
  const t = message.trim();
  if (!t || t.length > 300 || NOT_ASKING.test(t)) return null;
  const parts = sentences(t);
  // A word problem, a pasted list of questions or a try typed before the question is not a plain ask.
  if (HAS_NUMBER.test(parts.slice(0, -1).join(" "))) return null;
  const sentence = parts[parts.length - 1] ?? "";
  for (const re of PATTERNS) {
    const g = re.exec(sentence)?.groups;
    if (!g) continue;
    if (g.unary !== undefined) {
      const a = value(g.u!);
      return a <= 100 ? { expression: `double ${a}`, answer: String(a * 2), operands: [String(a)] } : null;
    }
    const a = value(g.a!), b = value(g.b!), op = binaryOp(g);
    const r = binaryFact(a, op, b);
    return r === null ? null : { expression: `${a} ${op} ${b}`, answer: String(r), operands: [String(a), String(b)] };
  }
  return null;
}

// ── The turn ─────────────────────────────────────────────────────────────────

// The other words HAS_NUMBER counts as numbers, by the number each stands for: "What is half of 16?"
// asks 16 ÷ 2, and "a dozen times 3" asks 12 × 3.
const NUMBER_SENSES: Record<number, string> = {
  2: "half|halves|halve[ds]?|twice|double[ds]?",
  3: "thirds?|triple[ds]?",
  4: "quarters?",
  12: "dozens?",
};

/**
 * True when the whole number `digits` is written in `text`: as digits, as a word ("seven", "sevens"), or
 * as a word that stands for it ("half" for 2, "dozen" for 12).
 */
function mentions(text: string, digits: string): boolean {
  if (new RegExp(String.raw`(?<![\d.])${digits}(?!\d|\.\d)`).test(text)) return true;
  const word = NUMBER_WORDS[Number(digits)];
  if (word && new RegExp(`\\b${word}(?:e?s)?\\b`, "i").test(text)) return true;
  const sense = NUMBER_SENSES[Number(digits)];
  return !!sense && new RegExp(`\\b(?:${sense})\\b`, "i").test(text);
}

/**
 * How many of the tutor's newest messages the echo check reads. A quiz question can sit behind a hint
 * or two ("hmm", a hint, then "what is 7 times 8"), and a long quiz runs past inMasteryCheck's window of
 * the student's last ASSESS_LOOKBACK + 1 messages; this is the same five, on the tutor's side. The
 * student's own messages from that stretch are read too: a word problem the student typed one message
 * before the question ("Sam has 7 bags with 8 marbles in each...", the tutor's reply, then "what is 7
 * times 8?") is the student's own exercise, held by the attempt-first policy (B4 G1).
 */
export const TUTOR_LOOKBACK = 5;

/**
 * The messages before the newest that the echo check reads: the tutor's last TUTOR_LOOKBACK messages and
 * every student message from the one just before the oldest of them up to the newest.
 */
function recentMessages<M extends { role: string }>(conversation: ReadonlyArray<M>): M[] {
  const earlier = conversation.slice(0, -1);
  let start = earlier.length;
  for (let seen = 0; start > 0 && seen < TUTOR_LOOKBACK;) if (earlier[--start].role === "assistant") seen++;
  while (start > 0 && earlier[start - 1].role === "user") start--;
  return earlier.slice(start);
}

/** True when a message may have asked this fact: it holds every operand, or the answer and one. */
function mayHaveAsked(text: string, fact: ArithmeticFact): boolean {
  return fact.operands.every((o) => mentions(text, o))
    || (mentions(text, fact.answer) && fact.operands.some((o) => mentions(text, o)));
}

/**
 * The fact this turn's note gives, or null: the newest message is the student's and plainly asks one
 * arithmetic fact (askedArithmetic), the conversation is not in a mastery check (inMasteryCheck), and
 * no message in the tutor's last TUTOR_LOOKBACK, or the student's own from that stretch, may have asked
 * it (mayHaveAsked). `conversation` is the user and assistant messages, ending with the newest.
 */
export function arithmeticFactTurn(
  conversation: ReadonlyArray<{ role: string; content: string }>,
  activeSkill?: string | null,
): ArithmeticFact | null {
  const newest = conversation[conversation.length - 1];
  if (!newest || newest.role !== "user") return null;
  const fact = askedArithmetic(newest.content);
  if (!fact || inMasteryCheck(conversation, activeSkill)) return null;
  return recentMessages(conversation).some((m) => mayHaveAsked(m.content, fact)) ? null : fact;
}

/** The note after the student's text. Prompt-wording iteration 1 of at most 3. */
export function arithmeticFactNote(fact: ArithmeticFact): string {
  return `<arithmetic_fact>
${fact.expression} = ${fact.answer}
</arithmetic_fact>
<tutor_note>
The student asked for this fact, and the line above is worked out exactly. Give it in your first sentence: ${fact.expression} = ${fact.answer}. Do not ask the student to work it out first, and do not put it off for later. After that you may link it to what you are working on, in one or two short sentences. Do not mention this note.
</tutor_note>`;
}

/** The student's message as the model sees it on an arithmetic-fact turn. */
export function withArithmeticFactNote(userContent: string, fact: ArithmeticFact): string {
  return `${userContent}\n\n${arithmeticFactNote(fact)}`;
}
