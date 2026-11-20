// The assess-mode answer check: code decides whether the student's answer to the tutor's question is
// right, before the reply is written, and the reply is told that verdict as a fact (docs/ARCHITECTURE.md,
// "The answer check in assess mode").
//
// Why: on TerraTutor's B9 rerun (2026-11-14, gemma4:e2b) the assess-mode tutor told the child a wrong
// answer was correct in 11 of 20 turns ("7 x 9 is 72" → "That is correct."). The model writes its own
// questions, so nothing in the app knew the answer. A small model judging an answer it has just read is
// pulled toward agreeing with it; the same model working the question out without seeing the answer is
// not. So the check has three steps, each small:
//   1. The key, blind (one structured call). The model reads only the tutor's message and returns the
//      question it asked, short working, and the answer. It never sees the student's answer. The
//      question must be copied from the message, and any "a op b = c" in the working must hold
//      (arithmetic-claims.ts), or the call is repaired once. A plain "what is a op b" question gets its
//      key from code instead (keyFromArithmetic).
//   2. Code compares the student's answer with the key (answerCompare.ts). A plain match is "correct"
//      with no further call. An answer that answers nothing ("xyz", "?!", non-answer.ts) is "incorrect",
//      with no further call either, and its reply is code's too (nonAnswerReply), not the model's.
//   3. Otherwise one structured grading call reads the question, the key and the student's answer and
//      returns the student's final answer in their words and a verdict. Code compares that extracted
//      answer with the key too. "incorrect" needs code and the grader not to disagree; when they do
//      (code says the number is wrong and the grader says correct, or the reverse), the verdict is
//      "unsure", and the reply says neither right nor wrong.
// Any failed or timed-out call ends in "unsure" (never in praise). A message that asks nothing with one
// right answer gets no check, and the turn is as before.

import { callLLMStructured } from "../llm";
import type { LLMConfig, ModelTier } from "../../types";
import { arithmeticClaims } from "../arithmetic-claims";
import { isAttemptText } from "./checkBeforePraise";
import { ASSESS_MESSAGE } from "./suggestions";
import { compareToKey, numbersIn, optionsIn, type KeyMatch } from "./answerCompare";
import { isNonAnswer } from "../non-answer";
import { afterAnsweredCard } from "./askCard";

export type Verdict = "correct" | "partly" | "incorrect" | "unsure";

export interface AnswerCheck {
  /** The question the tutor asked, as the key call copied it ("" when the key call failed). */
  question: string;
  /** The answer key, worked out without the student's answer ("" when the key call failed). */
  key: string;
  verdict: Verdict;
  /** How the verdict was reached: "code" (the compare alone), "model" (the grader, code undecided),
   *  "code+model" (both, agreeing), "conflict" (they disagreed), "failed" (a call failed). */
  by: "code" | "model" | "code+model" | "conflict" | "failed";
  /** What the grader read as the student's final answer, when it ran. */
  studentAnswer?: string;
  /** True when code found the answer answers nothing (non-answer.ts): the reply is nonAnswerReply, with no reply call (the post-turn reflection still runs). */
  nonAnswer?: boolean;
}

// ── When it runs ────────────────────────────────────────────────────────────────────────────────

/** How many student messages back the assess chip still makes the conversation a mastery check. */
export const ASSESS_LOOKBACK = 4;

// A message that asks for something rather than answering: help, a hint, a question back, a new topic,
// a picture or a change of plan ("Draw me a diagram of a pizza cut into 4 slices", "Let me pick the
// shape", "Can we use circles?"). Read as an answer, a request like that was graded against the open
// question and the child was told "That's not right yet." (click-test 2026-11-14). "check me" too
// (TerraTutor click test 2026-11-19: "ok check me. give me a question with buttons to pick" was told "That
// is not the right answer.").
const REQUEST = /^(?:check me|give me|walk me|show me|help|explain|tell me|teach me|continue|more on|quiz me|review|check if|let me work|let me pick|let me choose|let['’]?s (?:do|try|use|go|learn|talk|draw|move|switch|start|play)|what do my notes|make me|make a|draw|write me|can you|could you|would you|will you|can we|could we|i want|i['’]?d like|i would like|please|i don'?t know|i do not know|idk|no idea|not sure|i'?m not sure|skip|pass|i give up|what|why|how|where|when|who|which|do |does |did |can i|could i|should i|is that|are you)\b/i;

// Words a learner often puts before a request ("ok check me", "so can you explain it?", "now show me"). Only
// these are skipped before REQUEST is tested; what follows them is still read as an answer unless it is
// one ("ok 46", "so it's 46", "well, I think it's 46", "yes 46"). ASK_LEAD below skips the same words, and
// "please", which REQUEST already reads as a request.
const LEAD_WORDS = String.raw`ok(?:ay)?|alright|right|great|cool|now|so|and|then|hey|hi|yes|yeah|well|um+|hmm+`;
const LEAD_FILLER = new RegExp(String.raw`^(?:(?:${LEAD_WORDS})\b[\s,!.]*)+`, "i");

// A typed request for a hint with no request word before it: "hint", "hint please", "I need a hint",
// "another hint" (review of TerraTutor #255, 2026-11-19: these were graded as answers to the check).
const HINT_ASK = /^\W*(?:(?:i need|need|another|one more|a|more)\s+)?(?:a\s+)?hints?\b(?:\s+(?:please|pls))?\W*$/i;

/** True when `text`, the student's newest message, reads as an answer rather than a request. */
export function readsAsAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 600 || asksForMasteryCheck(t)) return false;
  const rest = t.replace(LEAD_FILLER, "");
  if (HINT_ASK.test(rest)) return false;
  return !REQUEST.test(rest) || isAttemptText(t);
}

// A typed request to be checked on what the student knows: "quiz me", "test me on fractions", "can you
// check if I've mastered fractions?", "am I ready for the test?". Narrow on purpose. It must open the
// message or a clause of it, as a request ("Okay, can you quiz me?"), so "My teacher will quiz me
// tomorrow" and "Don't quiz me yet" are not one; nor are "check my spelling", "can you check this
// sentence" and "check if I got this right" (one answer, not what they know).
const ASK_LEAD = String.raw`(?:^|[.!?,;:]\s+)[^\p{L}\p{N}]*(?:(?:${LEAD_WORDS}|please|pls)\b[\s,!.]*)*(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?(?:now\s+)?|please\s+|i\s+(?:want|would like|['’]d like)\s+(?:you\s+)?to\s+|let['’]?s\s+)?`;
const MASTERY_CHECK_REQUEST = new RegExp(`${ASK_LEAD}(?:${[
  String.raw`(?:quiz|test)\s+me\b`,
  String.raw`give\s+me\s+a\s+(?:quick\s+|short\s+|little\s+)?(?:quiz|test)\b`,
  String.raw`(?:check|see|test|find out)\s+(?:if|whether)\s+i(?:\s+have|['’]ve)?\s+(?:really\s+|actually\s+|fully\s+|now\s+)?(?:mastered|master|learned|learnt|understand|understood|know|(?:got|get)\s+(?:this|it|that|them)\b(?!\s+(?:right|wrong|correct)))`,
  String.raw`check\s+my\s+understanding\b`,
  String.raw`am\s+i\s+ready\s+(?:for|to\s+take)\s+(?:the|a|my|this)\s+(?:test|quiz|exam|next level|mastery)`,
].join("|")})`, "iu");

/** True when the student's message asks for a mastery check in their own words (or is the assess chip's). */
export function asksForMasteryCheck(text: string): boolean {
  const t = text.trim();
  return t === ASSESS_MESSAGE || (t.length <= 300 && MASTERY_CHECK_REQUEST.test(t));
}

/**
 * True when this turn gets the answer check: the newest message is the student's answer to the tutor's
 * message just before it, and the conversation is a mastery check: the turn runs in assess mode, or
 * the student opened the check (the assess chip, or the same request typed) within their last
 * ASSESS_LOOKBACK messages. (The chat resets the chip's mode after every send. ChatTab runs the answers
 * to a check opened by the assess chip in assess again (chatSkills.ts chatTurnMode), but the answers to
 * a typed request or the quiz chip, and a headless caller's, may arrive in another mode.) `conversation`
 * is the user and assistant messages, ending with the newest.
 */
export function isAssessAnswerTurn(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill?: string | null): boolean {
  const n = conversation.length;
  const newest = conversation[n - 1];
  const asked = conversation[n - 2];
  if (!newest || newest.role !== "user" || !asked || asked.role !== "assistant" || !asked.content.trim()) return false;
  if (!readsAsAnswer(newest.content)) return false;
  if (activeSkill === "assess") return true;
  return conversation.slice(0, n - 1).filter((m) => m.role === "user").slice(-ASSESS_LOOKBACK)
    .some((m) => asksForMasteryCheck(m.content));
}

/**
 * True on any turn of a mastery check, the opening request's own turn included: the turn runs in assess
 * mode, or a request for a check is among the student's last ASSESS_LOOKBACK + 1 messages. The reply
 * filter reads mastery claims on these turns (replyClaims.ts).
 */
export function inMasteryCheck(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill?: string | null): boolean {
  if (activeSkill === "assess") return true;
  return conversation.filter((m) => m.role === "user").slice(-(ASSESS_LOOKBACK + 1)).some((m) => asksForMasteryCheck(m.content));
}

// A request for a hint ("Give me a hint.", "can I have a hint?"): its reply nudges toward the question, it
// does not ask a new one.
const isHintRequest = (text: string) => /\bhints?\b/i.test(text) && !readsAsAnswer(text);

/**
 * The tutor's message the newest message answers, as the check keys it and repeats it (nonAnswerReply):
 * the one just before it, from after a question card answered in it (askCard.ts afterAnsweredCard).
 * TerraTutor click test 2026-11-19 (TerraTutor #255), issue 1: after the topic picker, "xyz" was given
 * "Which one should we check first? *You picked: ...* That is a good choice." with the question. When that
 * message answered the student's request for a hint, the message the hint was asked on is taken instead,
 * through any number of hints: the check grades its question, not the hint's nudge (issue 6: after "Give
 * me a hint.", "xyz" was given the hint's "Are they the same size?"). The last hint's reply comes with it
 * (`hint`, else null): a hint often ends in a question of its own ("Count by 8s. What is 8 + 8?"), and a
 * learner who answers that one ("16") is right (checkAnswer). `conversation` ends with the newest message.
 */
export function checkedMessage(conversation: ReadonlyArray<{ role: string; content: string }>): { message: string; hint: string | null } {
  const last = conversation.length - 2;
  let i = last;
  while (i >= 2 && conversation[i - 1].role === "user" && isHintRequest(conversation[i - 1].content)
    && conversation[i - 2].role === "assistant" && conversation[i - 2].content.trim()) i -= 2;
  return { message: afterAnsweredCard(conversation[i]?.content ?? ""), hint: i < last ? afterAnsweredCard(conversation[last].content) : null };
}

// ── Step 1: the key, blind ──────────────────────────────────────────────────────────────────────

const MAX_MESSAGE_CHARS = 1500;

const KEY_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string", maxLength: 400 },
    working: { type: "string", maxLength: 400 },
    answer: { type: "string", maxLength: 160 },
  },
  required: ["question", "working", "answer"],
  additionalProperties: false,
} as const;

export const KEY_INSTRUCTION =
  "You write the answer key for a tutor's question. Read the tutor's message and find the question it asks the student to answer. " +
  'Copy that question word for word into "question". ' +
  'Work the question out yourself in "working", in one or two short lines. ' +
  'Put the correct answer in "answer": only the final answer, as short as you can (a number with its unit, a word, or a short phrase). ' +
  'If the message asks more than one question, copy them all into "question" and put every answer in "answer", separated by "; ". ' +
  'If the message asks the student nothing that has one right answer (for example which topic to do next, or how they feel), set "question", "working" and "answer" to "". ' +
  'Return JSON: {"question": "...", "working": "...", "answer": "..."}';

export function keyMessages(tutorMessage: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: KEY_INSTRUCTION },
    { role: "user", content: `Tutor's message:\n${tutorMessage.trim().slice(-MAX_MESSAGE_CHARS)}` },
  ];
}

interface KeyOut { question: string; working: string; answer: string }

const words = (s: string) => s.toLowerCase().replace(/[*_`#>]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** The copied question is in the tutor's message: every word of it, in any order, give or take one in five. */
export function questionInMessage(question: string, message: string): boolean {
  const q = words(question);
  if (!q.length) return false;
  const m = new Set(words(message));
  return q.filter((w) => m.has(w)).length >= Math.ceil(q.length * 0.8);
}

/** Semantic checks the schema can't express. Empty = a key the check will use. */
export function validateKey(out: KeyOut, tutorMessage: string): string[] {
  if (!out.answer.trim()) return [];
  const issues: string[] = [];
  if (!questionInMessage(out.question, tutorMessage)) issues.push('"question" must be copied word for word from the tutor\'s message.');
  for (const c of arithmeticClaims(`${out.working}\n${out.answer}`)) {
    if (!c.holds) issues.push(`Your working says "${c.text}", but ${c.truth} Work the question out again and fix "answer".`);
  }
  return issues;
}

// "What is 7 x 9?", "Calculate 56 ÷ 8.", "What is 7 x 9, and what fact helped you?": one plain operation
// the question asks for, worked by code. The operation must end the question, or be followed only by a
// second clause asking about the method; "What is 5 + 3 and then double it?" is not one.
const ARITHMETIC_QUESTION = /\b(?:what is|what's|whats|calculate|compute|work out|find|solve)\s+(\d+(?:\.\d+)?)\s*([+\-−×xX*·÷/])\s*(\d+(?:\.\d+)?)\s*(?=[?.!]|,?\s+and\s+(?:what|how|why|which|explain|tell|show|can)\b|$)/i;

/** The key code can work out itself: a question asking for one plain operation; else null. */
export function keyFromArithmetic(question: string): string | null {
  const matches = [...question.matchAll(new RegExp(ARITHMETIC_QUESTION.source, "gi"))];
  if (matches.length !== 1) return null;
  const [, a, op, b] = matches[0];
  const x = Number(a), y = Number(b);
  let r: number;
  if (op === "+") r = x + y;
  else if (op === "-" || op === "−") r = x - y;
  else if (op === "÷" || op === "/") { if (y === 0 || !Number.isInteger(x / y)) return null; r = x / y; }
  else r = x * y;
  return String(Number(r.toFixed(6)));
}

/** How long each call of the check may take before the turn goes on without it (it then says "unsure"). */
export const CHECK_TIMEOUT_MS = 60_000;

interface CallOpts { tier?: ModelTier; signal?: AbortSignal; timeoutMs?: number }

async function withDeadline<T>(opts: CallOpts, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  const onTurnAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CHECK_TIMEOUT_MS);
  try {
    if (opts.signal?.aborted) return null;
    opts.signal?.addEventListener("abort", onTurnAbort, { once: true });
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onTurnAbort);
  }
}

/** The message's question when it asks exactly one ("?" in one sentence), or "". */
export function onlyQuestion(message: string): string {
  const asks = message.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.includes("?"));
  return asks.length === 1 ? asks[0] : "";
}

/**
 * The key for the tutor's question; "none" when the message asks nothing with one right answer; null
 * when the call failed. A message whose one question asks for one plain operation is keyed by code,
 * with no call. (Two questions in one message go to the model, which keys both.)
 */
export async function answerKey(
  tutorMessage: string,
  config: LLMConfig,
  opts: CallOpts,
): Promise<{ question: string; key: string } | "none" | null> {
  const asked = onlyQuestion(tutorMessage);
  const byCode = asked ? keyFromArithmetic(asked) : null;
  if (byCode !== null) return { question: asked, key: byCode };
  const out = await withDeadline(opts, (signal) => callLLMStructured<KeyOut>(keyMessages(tutorMessage), config, {
    schema: KEY_SCHEMA,
    toolName: "AnswerKey",
    maxRepairAttempts: 1,
    temperature: 0,
    tier: opts.tier,
    signal,
    validate: (o) => validateKey(o, tutorMessage),
  }));
  if (!out) return null;
  const answer = out.answer.trim();
  if (!answer) return "none";
  if (validateKey(out, tutorMessage).length) return null;
  const question = out.question.trim();
  // A plain operation is worked by code; the model's key stands only when its number agrees.
  const coded = keyFromArithmetic(question);
  if (coded !== null && !numbersIn(answer).some((n) => Math.abs(n.value - Number(coded)) < 1e-9)) return { question, key: coded };
  return { question, key: answer };
}

// ── Step 3: the grading call ────────────────────────────────────────────────────────────────────

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    student_answer: { type: "string", maxLength: 300 },
    verdict: { type: "string", enum: ["correct", "partly", "incorrect"] },
  },
  required: ["student_answer", "verdict"],
  additionalProperties: false,
} as const;

export const GRADE_INSTRUCTION =
  "You check a student's answer against an answer key. " +
  'First copy the student\'s final answer, in their own words, into "student_answer". ' +
  'Then compare it with the answer key and set "verdict": "correct" if it means the same as the key, "partly" if part of it is right and part is missing or wrong, "incorrect" if it does not match the key. ' +
  "The same answer in another form or other words is correct (72 and seventy-two; 31.4 cm and 31.4 centimeters). Judge by the key only, not by how sure the student sounds. " +
  'Return JSON: {"student_answer": "...", "verdict": "correct" | "partly" | "incorrect"}';

export function gradeMessages(question: string, key: string, student: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: GRADE_INSTRUCTION },
    { role: "user", content: `Question: ${question}\nAnswer key: ${key}\nStudent's answer: ${student.trim().slice(0, 600)}` },
  ];
}

interface GradeOut { student_answer: string; verdict: "correct" | "partly" | "incorrect" }

/** The copied answer is the student's: its words are in their message, or its numbers are ("46" for "forty-six"). */
function answerFromStudent(copied: string, student: string): boolean {
  if (!copied.trim() || questionInMessage(copied, student)) return true;
  const theirs = new Set(numbersIn(student).map((n) => n.value));
  const nums = numbersIn(copied);
  return nums.length > 0 && nums.every((n) => theirs.has(n.value));
}

async function gradeAgainstKey(question: string, key: string, student: string, config: LLMConfig, opts: CallOpts): Promise<GradeOut | null> {
  const out = await withDeadline(opts, (signal) => callLLMStructured<GradeOut>(gradeMessages(question, key, student), config, {
    schema: GRADE_SCHEMA,
    toolName: "AnswerGrade",
    maxRepairAttempts: 1,
    temperature: 0,
    tier: opts.tier,
    signal,
    validate: (o) => (answerFromStudent(o.student_answer, student) ? [] : ['"student_answer" must be copied from the student\'s answer.']),
  }));
  if (!out || !["correct", "partly", "incorrect"].includes(out.verdict)) return null;
  return out;
}

// ── The check ───────────────────────────────────────────────────────────────────────────────────

/** Code's reading and the grader's verdict, combined (see the file comment). */
export function combine(code: KeyMatch, grader: GradeOut["verdict"]): { verdict: Verdict; by: AnswerCheck["by"] } {
  if (code === "match") return grader === "correct" ? { verdict: "correct", by: "code+model" } : { verdict: "unsure", by: "conflict" };
  if (code === "mismatch") return grader === "correct" ? { verdict: "unsure", by: "conflict" } : { verdict: grader, by: "code+model" };
  return { verdict: grader, by: "model" };
}

/**
 * The verdict on the student's answer to the tutor's message, or null when that message asks nothing
 * with one right answer. Never throws: a failed call gives "unsure". `hintReply` is the reply to a hint
 * asked on that message (checkedMessage): an answer that matches its question's key is right, against
 * that question.
 */
export async function checkAnswer(
  tutorMessage: string,
  studentMessage: string,
  config: LLMConfig,
  opts: CallOpts,
  hintReply: string | null = null,
): Promise<AnswerCheck | null> {
  const keyed = await answerKey(tutorMessage, config, opts);
  if (keyed === "none") return null;
  // A failed key call on a message with no question mark at all: most likely nothing was asked.
  if (keyed === null) return tutorMessage.includes("?") ? { question: "", key: "", verdict: "unsure", by: "failed" } : null;
  const ctx = { question: keyed.question, options: optionsIn(tutorMessage) };
  const raw = compareToKey(keyed.key, studentMessage, ctx);
  if (raw === "match") return { ...keyed, verdict: "correct", by: "code" };
  // An answer that answers nothing ("xyz", "?!", non-answer.ts) is not right, and no grader is asked.
  if (await isNonAnswer(studentMessage, keyed.key, keyed.question)) return { ...keyed, verdict: "incorrect", by: "code", nonAnswer: true };
  // After a hint, the learner may have answered the hint's own question ("Count by 8s. What is 8 + 8?" →
  // "16"): graded against the check's key, that was "not right yet" (review of TerraTutor #255,
  // 2026-11-19). Code compares the answer with the hint's key too (a plain operation is keyed by code,
  // with no call), and a match is right, against the hint's question. Anything else is graded as before;
  // a hint that asks nothing ("Try counting by 8s.") is not keyed.
  if (hintReply?.includes("?")) {
    const hinted = await answerKey(hintReply, config, opts);
    if (hinted && hinted !== "none"
      && compareToKey(hinted.key, studentMessage, { question: hinted.question, options: optionsIn(hintReply) }) === "match") {
      return { ...hinted, verdict: "correct", by: "code" };
    }
  }
  const graded = await gradeAgainstKey(keyed.question, keyed.key, studentMessage, config, opts);
  if (!graded) return { ...keyed, verdict: "unsure", by: "failed" };
  const extracted = graded.student_answer.trim() ? compareToKey(keyed.key, graded.student_answer, ctx) : "undecided";
  // Code's own reading of the whole message outranks its reading of the grader's copy of it.
  const code: KeyMatch = raw === "mismatch" || extracted === "mismatch" ? "mismatch" : extracted;
  return { ...keyed, ...combine(code, graded.verdict), studentAnswer: graded.student_answer.trim() };
}

// ── The reply to an answer that answers nothing ───────────────────────────────────────────────

// TerraTutor click test 2026-11-19 part 3: in a check, "xyz" got the verdict line "That's not right yet."
// and then, 2 times in 5, the model's "That is close." Code decided the verdict, so code writes the whole
// reply: quiz.ts NO_ANSWER_FEEDBACK's words, then the tutor's question again. The question is repeated so
// the learner's next try is checked against it (the next turn keys the message just before it, this one),
// so a word problem's setup ("Sam has 5 apples. He eats 2.") comes with it: the key needs its numbers.

// Praise joined to the question by commas: "Correct, great job on that one, now what is 7 x 8?". Only when
// a filler or a question word follows, so "Yes, no, maybe, which of these is a question word?" is kept.
// After the praise word, only a praise noun and its words ("great job on that one", "Great pick of topic"),
// one of a few praise endings ("Nice one,", "Correct again,", "Exactly right,", "Great start,", "Yes you're
// right,") and then a learner's name ("Well done Sam,": one capitalised word) may come before the comma;
// any other words keep the sentence whole: "Right triangles have one 90-degree angle, so which ...", "Good
// readers, now which word ..." (TerraTutor #255 and its review).
// The name comes only after a praise ending ("Nice one Sam,") or after a praise word that is never an
// adjective before a noun (NAME_HEAD): "Great Lakes, which ...", "Perfect Squares, which ...", "Right
// Angles, how many ...", "Good Friday, when is it?" are kept whole (ported from TerraTutor #258).
const PRAISE_ITEM = /^(correct|right|yes|yep|yeah|great|good|nice|well done|awesome|perfect|excellent|exactly|that(?:'|’)?s right|that is right)\b(?:[ \t]+((?:job|work|thinking|try|answer|going|effort|pick|choice)\b[^,?\n]*|(?:one|again|exactly|indeed|right|correct|start|you(?:'|’)?re right|that(?:'|’)?s (?:right|correct|it)|that is right|you got it|well done)\b))?(?:[ \t]+([A-Za-z'’-]+))?[ \t]*,\s*/i;
const AFTER_PRAISE = /^(?:(?:now|so|then|next|and|okay|ok)\b,?\s*|(?=(?:what|which|who|whom|whose|where|when|why|how|can|could|is|are|was|were|do|does|did|will|would|should)\b))/i;
// The name, matched case-sensitively: PRAISE_ITEM is case-insensitive.
const NAME = /^[A-Z][a-z'’-]*$/;
// The praise words a bare name may follow: none of them stands as an adjective in front of a noun.
const NAME_HEAD = /^(?:correct|yes|yep|yeah|exactly|well done|that(?:'|’)?s right|that is right)$/i;
const nameFits = (m: RegExpExecArray) => !m[3] || (NAME.test(m[3]) && (!!m[2] || NAME_HEAD.test(m[1])));
function withoutPraiseLead(question: string): string {
  let cut = 0;
  for (let at = 0, m = PRAISE_ITEM.exec(question); m && nameFits(m); m = PRAISE_ITEM.exec(question.slice(at))) {
    at += m[0].length;
    const next = AFTER_PRAISE.exec(question.slice(at));
    if (next) cut = at + next[0].length;
  }
  return question.slice(cut);
}
// A choice line ("A) 5", "**B.** 6").
const CHOICE_LINE = /^[ \t]*(?:[-*•>][ \t]*)?(?:\*\*)?\(?[A-F](?:\)|\.|:)(?:\*\*)?[ \t]+\S/;
// The first sentence of a paragraph, up to an end mark or a colon ("Mr." too: it is then kept).
const FIRST_SENTENCE = /^[^.!?:]*[.!:]+(?=\s)/;
// A first sentence that is praise for the last answer: "Good.", "Great job!", "Yes, that's it!". One with a
// comma and a number, in digits or words, is kept ("Good, now Sam has five apples."): it may hold the
// problem's setup, and only its praise is taken off (PRAISE_COMMAS). "That one", "two more" and "one down"
// are not a number.
const PRAISE_WORD = /^\W*(?:correct|right|yes|yep|yeah|great|good|nice|awesome|perfect|excellent|exactly|well done|that(?:'|’)?s (?:right|correct)|that is (?:right|correct)|you got it)/i;
const holdsNumber = (text: string) =>
  numbersIn(text.replace(/\b(?:that|this|the|next|another|each|every|which|last) one\b|\b(?:one|two|three) more\b|\bone down\b/gi, "")).length > 0;
// Praise for a pick on a question card: "That is a good choice.", "Great pick!", "That is a good choice,
// halves are fun." (TerraTutor click test 2026-11-19, issue 1: the reply after the topic picker's pick).
const PICK_PRAISE = /^\W*(?:(?:that(?:'|’)?s|that is|what) an? )?(?:really |very )?(?:good|great|nice|fine|smart|excellent|perfect|awesome|wonderful) (?:choice|pick)\b/i;
// A praise noun and the words after it, up to a comma or the sentence's end: " job on that one".
const PRAISE_NOUN = /^\s+(?:job|work|thinking|try|answer|going|effort)\b[^,.!:]*/i;
function isPraise(sentence: string): boolean {
  const pick = PICK_PRAISE.exec(sentence);
  const word = pick ? null : PRAISE_WORD.exec(sentence);
  if (!pick && !word) return false;
  const rest = pick ? sentence.slice(pick[0].length) : sentence.slice(word![0].length).replace(PRAISE_NOUN, "");
  // Praise ends the sentence, or a comma follows it and what comes after holds no number: "Good job, Sam
  // has five apples." may be a setup, and only its praise is taken off (PRAISE_COMMAS).
  return /^[\s*_]*[.!:]/.test(rest) || (/^[\s*_]*,/.test(rest) && !holdsNumber(rest));
}
// The praise before a setup in the same sentence: "Yes, good job, " in "Yes, good job, Sam has five apples.".
// A praise word, or one with a praise noun and at most three more words ("Good job on that,"), then a comma.
// A praise word that is a word of the setup is kept: "Right angles, the corners of a square, ...", "Great
// Britain, an island nation, ...", "Right now Sam has five apples, ..." (review of the #252 port).
const PRAISE_PHRASE = String.raw`${PRAISE_WORD.source.slice(1)}\b(?:[ \t]+(?:job|work|thinking|try|answer|going|effort)\b(?:[ \t]+[A-Za-z'’]+){0,3})?[ \t]*,\s*`;
const PRAISE_COMMAS = new RegExp(String.raw`^(?:${PRAISE_PHRASE})+(?:(?:now|so|then|next|and|okay|ok)\b,?\s*)?`, "i");
// The last answer's feedback after praise: "The answer is 56.", "7 x 8 = 56.".
const LAST_ANSWER = /^\W*(?:the (?:right |correct )?answer (?:is|was)\b|\d+\s*[x×*+−÷/-]\s*\d+\s*=\s*\d+\W*$)/i;

/** A first sentence that only leads in to the question: "Here is your first question.", "Next one:", "Okay.". */
function isLeadIn(sentence: string): boolean {
  const s = sentence.replace(/[*_]/g, "").trim();
  if (/^(?:okay|ok|alright|all right|now|so|then|next)\W*$/i.test(s)) return true;
  return s.split(/\s+/).length <= 6 && !/\d/.test(s)
    && /^(?:here|next|now|okay|ok|alright|so|and|let(?:'|’)?s|try|on to|time for|ready|this)\b/i.test(s)
    && /\b(?:question|problem|one|another)\b/i.test(s)
    && !/\b(?:what|which|who|whom|whose|where|when|why|how)\b/i.test(s);
}

// A sentence that announces the check: "I will check your understanding of "What is a Fraction? Whole and
// Parts."", "Let's see what you know about fractions.", "Let's check:" (TerraTutor click test 2026-11-19
// part 5, issue 3; ported from TerraTutor #257). It names the topic, not a setup, so it comes off. Only a
// topic announcement is: the bare verb, or the verb with "your understanding", "your knowledge", "what you
// know / remember / learned", "how much / how well you" or "you on" after it. "Let's see if you can tell me
// the name of the biggest planet.", "Let's see what happens when we mix red and blue paint." and "I'll quiz
// you on the story where ..." hold the question's setup and stay (review of TerraTutor #257: dropping them
// left "Can you?"). It also stays when it holds a number or a clause word outside quotes ("... about the
// water cycle when the sun heats a lake."), when the sentence after it points back at it ("Let's see how
// Sam shares his apples. How many does he give away?"), or when no "?" is left after it (`Let's quiz you
// on "Who wrote Charlotte's Web?" Take your time!`). A quoted title may hold its own "?" and end mark,
// which FIRST_SENTENCE cannot read past, so the sentence ends at the first end mark outside quotes, or at a
// quote that closes on one.
const CHECK_INTRO = /^[*_\s]*(?:(?:now|so|okay|ok|alright|all right|next),?\s+)?(?:I(?:'|’)ll|I will|I(?:'|’)m going to|I am going to|let(?:'|’)?s|let us|let me|we(?:'|’)ll|we will|we(?:'|’)re going to|we are going to|time to)\s+(?:quickly\s+|now\s+|first\s+)?(?:check|see|test|find out|quiz|review)(?:\s+(?:your (?:understanding|knowledge)|what you(?:(?:'|’)ve| have)? (?:know|remember|learned|learnt|understand)|how (?:much|well) you|you on)\b(?:"[^"\n]*"|“[^”\n]*”|[^.!?:"“”\n])*?)?\s*(?:[.!:]+["”]?|(?<=[.!]["”]))[*_]*(?=\s)/i;
// A word that ties the topic to a setup: "... the water cycle when the sun heats a lake.".
const CLAUSE_WORD = /\b(?:when|if|whether|because|after|before|where)\b/i;
// A word that points back at something named before it.
const POINTS_BACK = /\b(?:it|its|this|these|those|they|them|their|he|she|him|his|her)\b/i;
function checkIntro(question: string): RegExpExecArray | null {
  const intro = CHECK_INTRO.exec(question);
  if (!intro || holdsNumber(intro[0]) || CLAUSE_WORD.test(intro[0].replace(/"[^"\n]*"|“[^”\n]*”/g, ""))) return null;
  const rest = question.slice(intro[0].length).trim();
  if (!rest.includes("?")) return null;
  return POINTS_BACK.test(rest.split(/(?<=[.!?])\s/)[0]) ? null : intro;
}

/**
 * The tutor's question with its paragraph (the lines before it up to a blank line or a choice), from the
 * end of any praise or lead-in before it to the end of the message, and its choices: those after it come
 * with it, and those listed before it are put after it.
 */
export function questionAgain(tutorMessage: string, keyedQuestion: string): string {
  const m = tutorMessage.trim();
  const at = m.indexOf("?");
  if (at < 0) return keyedQuestion.trim();
  const lines = m.slice(0, at).split("\n");
  let first = lines.length - 1;
  while (first > 0 && lines[first - 1].trim() && !CHOICE_LINE.test(lines[first - 1])) first--;
  const start = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
  let question = m.slice(start).trim();
  // Praise, a lead-in, the check's announcement, the last answer's feedback after praise, or the praise
  // before a setup comes off. Again after the praise with a praise ending ("Nice one, now") that the loop
  // cannot read past and withoutPraiseLead takes off, until nothing more comes off: the announcement after
  // it ("let's check your understanding of nouns."), and a lead-in or praise after that ("Here is your first
  // question.", "great,"), come off too (the port's own merge with #401; TerraTutor master keeps them).
  let praised = false;
  for (let before = ""; before !== question;) {
    before = question;
    for (;;) {
      const intro = checkIntro(question);
      if (intro) { question = question.slice(intro[0].length).trim(); continue; }
      const s = FIRST_SENTENCE.exec(question);
      if (!s) break;
      const lead: RegExpExecArray | null = isPraise(s[0]) || isLeadIn(s[0]) || (praised && LAST_ANSWER.test(s[0])) ? s : PRAISE_COMMAS.exec(question);
      if (!lead) break;
      praised ||= lead !== s || isPraise(s[0]);
      question = question.slice(lead[0].length).trim();
    }
    question = withoutPraiseLead(question);
  }
  question = question
    .replace(/^([*_\s"“]*)(\p{Ll})/u, (_, pre: string, c: string) => pre + c.toUpperCase());
  const choicesBefore = m.slice(0, start).split("\n").filter((l) => CHOICE_LINE.test(l)).map((l) => l.trim());
  return choicesBefore.length >= 2 && !question.split("\n").some((l) => CHOICE_LINE.test(l))
    ? `${question}\n${choicesBefore.join("\n")}`
    : question;
}

/** The whole reply when code found the answer answers nothing: no reply call (TutorEngine). */
export function nonAnswerReply(tutorMessage: string, check: AnswerCheck): string {
  const again = questionAgain(tutorMessage, check.question);
  return again ? `That doesn't answer the question yet. Here it is again:\n\n${again}` : "That doesn't answer the question yet. Want to try again?";
}

// ── The note ────────────────────────────────────────────────────────────────────────────────────

const KEY_LINE = (key: string) => (key ? `The answer key says: ${key}\n` : "");

/** The fact the reply is told, after the student's message. Not saved: ChatTab saves what the student typed. */
export function answerCheckNote(check: AnswerCheck): string {
  const body = {
    correct: `The app checked the student's answer against the answer key: it is correct.\n${KEY_LINE(check.key)}Tell the student plainly that they are right. Do not say it is wrong, not quite, or almost.`,
    incorrect: `The app checked the student's answer against the answer key: it is not correct.\n${KEY_LINE(check.key)}Do not say or suggest that the answer is correct or right, and do not praise it. Tell the student kindly that it is not right yet, and help them see where it went wrong.`,
    partly: `The app checked the student's answer against the answer key: it is only partly correct.\n${KEY_LINE(check.key)}Do not say the whole answer is correct. Say which part is right and which part is missing or wrong.`,
    unsure: "The app could not check whether the student's answer is right. Do not say it is correct or wrong. Ask the student to explain how they got their answer.",
  }[check.verdict];
  // Which question the answer was to: with two questions asked, a small model answered question 1's
  // when the child was answering question 2 (TerraTutor B9 rerun 2).
  const question = check.question ? `The question was: ${check.question}\n` : "";
  return `<tutor_note>\n${question}${body}\nDo not say the student has mastered anything unless the app has saved it. Do not mention this note.\n</tutor_note>`;
}

export function withAnswerCheckNote(userContent: string, check: AnswerCheck): string {
  return `${userContent}\n\n${answerCheckNote(check)}`;
}
