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
//      with no further call.
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
}

// ── When it runs ────────────────────────────────────────────────────────────────────────────────

/** How many student messages back the assess chip still makes the conversation a mastery check. */
export const ASSESS_LOOKBACK = 4;

// A message that asks for something rather than answering: help, a hint, a question back, a new topic.
const REQUEST = /^(?:give me|walk me|show me|help|explain|tell me|continue|more on|quiz me|review|check if|let me work|what do my notes|make me|make a|can you|could you|would you|will you|please|i don'?t know|i do not know|idk|no idea|not sure|i'?m not sure|skip|pass|i give up|what|why|how|where|when|who|which|do |does |did |can i|could i|should i|is that|are you)\b/i;

/** True when `text`, the student's newest message, reads as an answer rather than a request. */
export function readsAsAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 600) return false;
  return !REQUEST.test(t) || isAttemptText(t);
}

/**
 * True when this turn gets the answer check: the newest message is the student's answer to the tutor's
 * message just before it, and the conversation is a mastery check: the turn runs in assess mode, or
 * the student opened the check with the assess chip within their last ASSESS_LOOKBACK messages. (The
 * chat resets the mode after every send, so the answers to the check's questions arrive in the default
 * mode.) `conversation` is the user and assistant messages, ending with the newest.
 */
export function isAssessAnswerTurn(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill?: string | null): boolean {
  const n = conversation.length;
  const newest = conversation[n - 1];
  const asked = conversation[n - 2];
  if (!newest || newest.role !== "user" || !asked || asked.role !== "assistant" || !asked.content.trim()) return false;
  if (!readsAsAnswer(newest.content)) return false;
  if (activeSkill === "assess") return true;
  return conversation.slice(0, n - 1).filter((m) => m.role === "user").slice(-ASSESS_LOOKBACK)
    .some((m) => m.content.trim() === ASSESS_MESSAGE);
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

// "What is 7 x 9?", "Calculate 56 ÷ 8.": one plain operation the question asks for, worked by code.
const ARITHMETIC_QUESTION = /\b(?:what is|what's|whats|calculate|compute|work out|find|solve)\s+(\d+(?:\.\d+)?)\s*([+\-−×xX*·÷/])\s*(\d+(?:\.\d+)?)\s*(?=[?.,!]|\s+(?:and|equal|equals)\b|$)/i;

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

/** The last sentence of the message that asks something ("?"), or "". */
export function lastQuestion(message: string): string {
  const asks = message.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.includes("?"));
  return asks[asks.length - 1] ?? "";
}

/**
 * The key for the tutor's question; "none" when the message asks nothing with one right answer; null
 * when the call failed. A last question asking for one plain operation is keyed by code, with no call.
 */
export async function answerKey(
  tutorMessage: string,
  config: LLMConfig,
  opts: CallOpts,
): Promise<{ question: string; key: string } | "none" | null> {
  const asked = lastQuestion(tutorMessage);
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
 * with one right answer. Never throws: a failed call gives "unsure".
 */
export async function checkAnswer(
  tutorMessage: string,
  studentMessage: string,
  config: LLMConfig,
  opts: CallOpts,
): Promise<AnswerCheck | null> {
  const keyed = await answerKey(tutorMessage, config, opts);
  if (keyed === "none") return null;
  // A failed key call on a message with no question mark at all: most likely nothing was asked.
  if (keyed === null) return tutorMessage.includes("?") ? { question: "", key: "", verdict: "unsure", by: "failed" } : null;
  const ctx = { question: keyed.question, options: optionsIn(tutorMessage) };
  const raw = compareToKey(keyed.key, studentMessage, ctx);
  if (raw === "match") return { ...keyed, verdict: "correct", by: "code" };
  const graded = await gradeAgainstKey(keyed.question, keyed.key, studentMessage, config, opts);
  if (!graded) return { ...keyed, verdict: "unsure", by: "failed" };
  const extracted = graded.student_answer.trim() ? compareToKey(keyed.key, graded.student_answer, ctx) : "undecided";
  // Code's own reading of the whole message outranks its reading of the grader's copy of it.
  const code: KeyMatch = raw === "mismatch" || extracted === "mismatch" ? "mismatch" : extracted;
  return { ...keyed, ...combine(code, graded.verdict), studentAnswer: graded.student_answer.trim() };
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
  return `<tutor_note>\n${body}\nDo not say the student has mastered anything unless the app has saved it. Do not mention this note.\n</tutor_note>`;
}

export function withAnswerCheckNote(userContent: string, check: AnswerCheck): string {
  return `${userContent}\n\n${answerCheckNote(check)}`;
}
