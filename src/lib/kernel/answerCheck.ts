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
import { compareToKey, numbersIn, optionsIn, type CompareContext, type KeyMatch } from "./answerCompare";
import { isNonAnswer } from "../non-answer";
import { afterAnsweredCard } from "./askCard";
import { replyFromPersisted } from "./persistedReply";

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
  /** "hint" when the answer was to a hint's own question, not the check's (checkAnswer): it never counts toward
   *  mastery (TutorEngine refuses the mark), and the check's question stays open (hintAnswerBack). */
  on?: "hint";
  /** With `on: "hint"`, the check's own question as its key call copied it. */
  checkQuestion?: string;
}

// ── When it runs ────────────────────────────────────────────────────────────────────────────────

/** How many of the student's messages a check stays open for, hint requests, hint answers and non-answers aside (openCheck). */
export const ASSESS_LOOKBACK = 4;

/**
 * The most student messages a check stays open for after the request that opened it, the newest
 * included, whatever they are (openCheck). assess.md asks one or two questions; a question can take a
 * hint request, an answer to the hint, a non-answer, another hint and a wrong try before the right one
 * (TerraTutor click test 2026-11-19 part 7, issue 1: six messages for one question), so two questions fit in 12,
 * and a check left behind for a chat about something else ends.
 */
export const CHECK_MAX_MESSAGES = 12;

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

type Message = { role: string; content: string };

/** How code's reply to an answer that answers nothing starts (nonAnswerReply). */
const NON_ANSWER_LEAD = "That doesn't answer the question yet.";
// Code's reply to it, before the question asked again, and when there is no question to ask again.
const NON_ANSWER_AGAIN = `${NON_ANSWER_LEAD} Here it is again:`;
const NON_ANSWER_RETRY = `${NON_ANSWER_LEAD} Want to try again?`;

/**
 * The message that opened the mastery check the newest message is in, or null when none is open. A
 * check opens with the student's request (the assess chip, or the same request typed: asksForMasteryCheck)
 * and stays open until ASSESS_LOOKBACK of the student's messages after it have been used, the student
 * opens a new check (the newest request wins), or CHECK_MAX_MESSAGES of their messages have followed it.
 * A hint request, an answer to a hint's question and an answer that answered nothing (the replies code
 * wrote to them, codeRepeat) use none of it: TerraTutor click test 2026-11-19 part 7, issue 1, counted every message,
 * so "hint", the hint's answer, "xyz", "hint" and then the right answer was never graded. Any other message
 * uses one, a request ("can you explain it again?") too, so a check left open for a chat ends as before.
 * A new thread is a new conversation. The newest message itself is not read: `conversation` ends with it.
 */
export function openCheck(conversation: ReadonlyArray<Message>): string | null {
  const before = conversation.slice(0, -1);
  const memo = new Map<number, number>();
  let learner = 0;
  let used = 0;
  for (let j = before.length - 1; j >= 0; j--) {
    const m = before[j];
    if (m.role !== "user") continue;
    if (asksForMasteryCheck(m.content)) return m.content;
    if (++learner >= CHECK_MAX_MESSAGES) return null;
    const free = isHintRequest(m.content) || (j + 1 < before.length && codeRepeat(before, j + 1, memo));
    if (!free && ++used >= ASSESS_LOOKBACK) return null;
  }
  return null;
}

/**
 * True when this turn gets the answer check: the newest message is the student's answer to the tutor's
 * message just before it, and the conversation is a mastery check: the turn runs in assess mode, or a
 * check the student opened (the assess chip, or the same request typed) is still open (openCheck). (The
 * chat resets the chip's mode after every send. ChatTab runs the answers to a check opened by the assess
 * chip in assess again (chatSkills.ts chatTurnMode), but the answers to a typed request or the quiz chip,
 * and a headless caller's, may arrive in another mode.) `conversation` is the user and assistant
 * messages, ending with the newest.
 */
export function isAssessAnswerTurn(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill?: string | null): boolean {
  const n = conversation.length;
  const newest = conversation[n - 1];
  const asked = conversation[n - 2];
  if (!newest || newest.role !== "user" || !asked || asked.role !== "assistant" || !asked.content.trim()) return false;
  if (!readsAsAnswer(newest.content)) return false;
  if (activeSkill === "assess") return true;
  return openCheck(conversation) !== null;
}

/**
 * True on any turn of a mastery check, the opening request's own turn included: the turn runs in assess
 * mode, the newest message asks for a check, or a check is still open (openCheck). The reply filter
 * reads mastery claims on these turns (replyClaims.ts).
 */
export function inMasteryCheck(conversation: ReadonlyArray<{ role: string; content: string }>, activeSkill?: string | null): boolean {
  if (activeSkill === "assess") return true;
  const newest = conversation[conversation.length - 1];
  if (newest?.role === "user" && asksForMasteryCheck(newest.content)) return true;
  return openCheck(conversation) !== null;
}

// A request for a hint ("Give me a hint.", "can I have a hint?"): its reply nudges toward the question, it
// does not ask a new one.
const isHintRequest = (text: string) => /\bhints?\b/i.test(text) && !readsAsAnswer(text);

/**
 * The tutor's message the newest message answers, as the check keys it and repeats it (nonAnswerReply):
 * the one just before it, from after a question card answered in it (askCard.ts afterAnsweredCard).
 * TerraTutor click test 2026-11-19, issue 1: after the topic picker, "xyz" was given "Which one should we check
 * first? *You picked: ...* That is a good choice." with the question. When that message answered the
 * student's request for a hint, the message the hint was asked on is taken instead, through any number
 * of hints: the check grades its question, not the hint's nudge (issue 6: after "Give me a hint.", "xyz"
 * was given the hint's "Are they the same size?"). The last hint's reply comes with it (`hint`, else
 * null): a hint that ends in a question of its own ("Count by 8s. What is 8 + 8?") makes the next
 * message an answer to it, unless code finds it right for the check's question (checkAnswer).
 * Code's own repeats of the check's question are stepped back over the same way, to the message they
 * repeat: the reply to an answer that answered nothing (nonAnswerReply) and the reply to an answer to a
 * hint's question, which ends with the check's question after HINT_ANSWER_BACK (hintAnswerBack). A
 * repeat leaves out the check's announcement, and with it a topic named only there ("Let's quiz you on
 * Charlotte's Web. Who is Wilbur?" repeats as "Who is Wilbur?"; OpenEdu #402 review): keyed from the
 * repeat, the next try's key had no topic. Keyed from the message itself, it has, and the next try is
 * still graded against the check's question, not against anything a reply asked before the repeat.
 * Only a repeat code wrote is stepped over (codeRepeat): a model reply that copies its opening ("That
 * doesn't answer the question yet. Let's try a different one: ...") asks its own question, and is keyed.
 * Only when the message the repeat follows is the tutor's; else the repeat is keyed, from after
 * HINT_ANSWER_BACK (without a stalled reply's saved marker, persistedReply.ts).
 * `conversation` ends with the newest message.
 */
export function checkedMessage(conversation: ReadonlyArray<Message>): { message: string; hint: string | null } {
  const last = conversation.length - 2;
  const hinted = last >= 2 && conversation[last - 1].role === "user" && isHintRequest(conversation[last - 1].content) && tutorAt(conversation, last - 2);
  return {
    message: keyedText(conversation, checkedAt(conversation, last, new Map())),
    hint: hinted ? afterAnsweredCard(conversation[last].content) : null,
  };
}

const tutorAt = (conversation: ReadonlyArray<Message>, k: number) =>
  k >= 0 && conversation[k].role === "assistant" && !!conversation[k].content.trim();

/** The text of the tutor's message at `i` the check keys: after an answered card, and after HINT_ANSWER_BACK. */
function keyedText(conversation: ReadonlyArray<Message>, i: number): string {
  const message = afterAnsweredCard(conversation[i]?.content ?? "");
  const back = message.lastIndexOf(HINT_ANSWER_BACK);
  return back < 0 ? message : replyFromPersisted(message.slice(back + HINT_ANSWER_BACK.length)).text.trim();
}

/**
 * The index of the tutor's message the answer after `last` is checked against (checkedMessage): `last`, or
 * the message before a hint request or a repeat code wrote, stepped back over any number of them. `memo`
 * keeps each index's result for one read of the conversation.
 */
function checkedAt(conversation: ReadonlyArray<Message>, last: number, memo: Map<number, number>): number {
  const known = memo.get(last);
  if (known !== undefined) return known;
  let i = last;
  while (i >= 2 && conversation[i - 1].role === "user" && tutorAt(conversation, i - 2)
    && (isHintRequest(conversation[i - 1].content) || codeRepeat(conversation, i, memo))) i -= 2;
  memo.set(last, i);
  return i;
}

/**
 * True when the tutor's message at `k` is a reply code wrote that repeats the check's question: the reply to
 * an answer that answered nothing (nonAnswerReply), or one that ends with HINT_ANSWER_BACK and the check's
 * question (hintAnswerBack), each built from the message the answer before it was checked against
 * (checkedAt). A model reply that only starts the same way ("That doesn't answer the question yet. Let's try
 * a different one: ...", review of TerraTutor #260) or copies the line before its own
 * question is not: it asks something new. When that message holds no "?", code's repeat was the keyed
 * question, which code cannot rebuild, so any question there is taken as the repeat.
 */
function codeRepeat(conversation: ReadonlyArray<Message>, k: number, memo: Map<number, number>): boolean {
  if (k < 2 || !tutorAt(conversation, k) || !tutorAt(conversation, k - 2)) return false;
  const text = afterAnsweredCard(conversation[k].content).trim();
  const nonAnswer = text.startsWith(NON_ANSWER_LEAD);
  const back = text.lastIndexOf(HINT_ANSWER_BACK);
  if (!nonAnswer && back < 0) return false;
  const base = keyedText(conversation, checkedAt(conversation, k - 2, memo));
  const again = (asked: string) => !!asked && asked === questionAgain(base, asked).trim();
  if (nonAnswer) {
    if (text === NON_ANSWER_RETRY) return true;
    if (text.startsWith(NON_ANSWER_AGAIN) && again(text.slice(NON_ANSWER_AGAIN.length).trim())) return true;
  }
  return back >= 0 && again(replyFromPersisted(text.slice(back + HINT_ANSWER_BACK.length)).text.trim());
}

/** The line code puts before the check's question, after the reply to an answer to a hint's own question. */
export const HINT_ANSWER_BACK = "Now back to the question:";

/**
 * What code adds after the reply when the learner answered the hint's own question (`on: "hint"`), or null
 * on any other turn: the check's question again, so it stays open and the next try is checked against it
 * (checkedMessage). The answer to the hint never passes the check (TutorEngine's mastery gate).
 */
export function hintAnswerBack(tutorMessage: string, check: AnswerCheck | null): string | null {
  if (check?.on !== "hint") return null;
  const again = questionAgain(tutorMessage, check.checkQuestion ?? "");
  return again ? `${HINT_ANSWER_BACK}\n\n${again}` : null;
}

// A line after a question that asks nothing new and gives no feedback: "Take your time!", "You can do it.".
// "Keep going!", "Let me know!" and "I believe in you!" only as the whole line, with nothing but marks or an
// emoji after them: "Keep going, count the slices." goes on with help (OpenEdu's take-back of TerraTutor #264,
// item 2; ported from TerraTutor #266).
const AFTER_QUESTION = /^[\W_]*(?:(?:take your time|you can do it|you(?:'|’)ve got this|give it a (?:try|go|shot)|try it|have a go|think about it|good luck|no rush)\b[^?]*|(?:keep going|let me know|i believe in you)[^\p{L}\p{N}?]*)$/iu;
// A sentence's end in streamed text: an end mark or a colon with any closing marks after it, then spaces; or
// a line break. The spaces are the group.
const SENTENCE_BREAK = /(?:[.!?:][*_"”')\]]*|(?=\n))(\s+)/;

/**
 * The reply to an answer to a hint's own question, as it streams, without its trailing question
 * (TutorEngine, when hintAnswerBack adds the check's question after it): code asks the check's question
 * next, so a question the model ends on ("What is 16 + 8?", or the check's own question) would leave two
 * open questions on screen, or the same one twice (TerraTutor click test 2026-11-19 part 8, issue 4; ported from TerraTutor #262). A sentence
 * with a "?" is held back, with a lead-in before it ("Here is another one:") and what follows it that is
 * no feedback (a choice line, an emoji, "Take your time!"); feedback after it lets it all out, so a
 * question inside the feedback stays. What is still held when the reply ends is dropped (end). The
 * praise and feedback before it are kept as they came; a reply that was only a question shows nothing
 * here, and the turn's verdict line takes its place (TutorEngine).
 */
export class TrailingQuestionHold {
  private buf = "";
  // Everything after the last sentence let out: the spaces before the held sentences, and those sentences.
  private kept = "";
  // A question is held: what follows it with no feedback in it is held with it.
  private asked = false;

  /** The text that may be shown now. */
  push(text: string): string {
    this.buf += text;
    let out = "";
    for (let m = SENTENCE_BREAK.exec(this.buf); m; m = SENTENCE_BREAK.exec(this.buf)) {
      const spaces = m[1];
      const end = m.index + m[0].length;
      // The spaces run to the end of what came so far: more may follow, so the sentence waits.
      if (end === this.buf.length) break;
      out += this.sentence(this.buf.slice(0, end - spaces.length), spaces);
      this.buf = this.buf.slice(end);
    }
    return out;
  }

  /** What is held back or not yet read, as it would be shown. */
  get held(): string {
    return this.kept + this.buf;
  }

  /** Lets out everything held: something follows it (a tool round), or nothing will be added after it. */
  flush(): string {
    const out = this.held;
    this.buf = "";
    this.kept = "";
    this.asked = false;
    return out;
  }

  /** The end of the reply: the last sentence is read, and a question still held there is dropped. */
  end(): string {
    const last = this.buf.replace(/\s+$/, "");
    this.buf = "";
    const out = last ? this.sentence(last, "") : "";
    this.kept = "";
    this.asked = false;
    return out;
  }

  private sentence(text: string, spaces: string): string {
    const s = text.trim();
    const held = !s || s.includes("?") || /:[*_"”')\]]*$/.test(s)
      || (this.asked && (!/[\p{L}\p{N}]/u.test(s) || CHOICE_LINE.test(s) || AFTER_QUESTION.test(s)));
    if (held) {
      if (s.includes("?")) this.asked = true;
      this.kept += text + spaces;
      return "";
    }
    const out = this.kept + text;
    this.kept = spaces;
    this.asked = false;
    return out;
  }
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
 * asked on that message (checkedMessage): when it asks a question of its own, the answer is graded against
 * the check's question first, and only an answer that is not right there can be the hint's, tagged
 * `on: "hint"` (right or partly right for the hint's question; when feedback follows the hint's question,
 * only code's match with the hint's key; "unsure" when the hint ends on a question with no key).
 * Anything else keeps the check's verdict.
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
  // After a hint that asks a question of its own ("Count by 8s. What is 8 + 8?"), a child may answer either
  // question. The check's comes first (TerraTutor decision on its click test 2026-11-19 part 8, issue 1; ported from TerraTutor #262): graded
  // against the hint's question first, "the whole is the complete thing, like a whole pizza, before you cut
  // it into equal parts" was right for the hint's "What is that complete object called in our lesson?" and
  // never reached the check's "what the whole is", "one half" was the hint's when both keys were "1/2", and
  // the mark was refused. So: code's match with the check's key is the check's (above); a hint whose key is
  // the check's, or that asks the check's question again ("Think of words for people and places. What is a
  // noun? You can do it!"), is not keyed apart; otherwise the grader reads the answer against the check's
  // question, and "correct" there is the check's answer, which can pass. Only an answer that is not right
  // for the check's question is tried against the hint's: right or partly right there is the hint's, tagged
  // `on: "hint"` (it never counts toward mastery, and code asks the check's question again, hintAnswerBack);
  // else the check's verdict stands. The grader's leniency is not special-cased: "break it into equal
  // pieces", the answer to the hint's chocolate-bar question, passes when the grader finds it right for
  // "what a fraction is", as it would with no hint (part 7, issue 2). A hint "ends on" its question when
  // nothing after it but what TrailingQuestionHold holds with a question ("What is 8 + 8? Try it!", "What is
  // 8 + 8? 😊", endsOnQuestion); one with feedback after its question ("Is it more than 40? Count by 8s.") is
  // tried by code's match only, with no grader call on the hint's question (OpenEdu #404). A hint that ends
  // on a question with no one right answer ("Think of a time you shared food. What did you notice? You can
  // do it!", OpenEdu #405's note), or whose key call failed, has nothing to grade the answer against: an
  // answer right for the check's question is the check's; anything else is "unsure", tagged `on: "hint"`, so
  // no verdict is said, the mark is refused and the check's question is asked again, as before check-first
  // (review of TerraTutor #262, 2026-11-20: "the pieces were the same size" was "not right yet" for the
  // check's question). At most two grader calls: the check's, then the hint's.
  if (hintReply?.includes("?")) {
    const hinted = await answerKey(hintReply, config, opts);
    const hintKey = hinted && hinted !== "none" && !sameKey(hinted.key, keyed.key) && !asksSameQuestion(hinted, keyed) ? hinted : null;
    if (hintKey) {
      const onHint = { on: "hint" as const, checkQuestion: keyed.question };
      const hintCtx = { question: hintKey.question, options: optionsIn(hintReply) };
      const hintRaw = compareToKey(hintKey.key, studentMessage, hintCtx);
      // Code matched the hint's key and not the check's ("16" for 8 + 8, when the check's key is 48): the
      // grader could not make it right for the check's question (combine), so it is not asked.
      if (hintRaw === "match" && raw === "mismatch") return { ...hintKey, verdict: "correct", by: "code", ...onHint };
      const onTheCheck = await graded(keyed, ctx, raw, studentMessage, config, opts);
      if (onTheCheck.verdict === "correct") return onTheCheck;
      if (hintRaw === "match") return { ...hintKey, verdict: "correct", by: "code", ...onHint };
      if (endsOnQuestion(hintReply)) {
        const onTheHint = await graded(hintKey, hintCtx, hintRaw, studentMessage, config, opts);
        if (onTheHint.verdict === "correct" || onTheHint.verdict === "partly") return { ...onTheHint, ...onHint };
      }
      return onTheCheck;
    }
    const asked = onlyQuestion(hintReply);
    if ((hinted === "none" || hinted === null) && endsOnQuestion(hintReply) && !(asked && asksSameQuestion({ question: asked }, keyed))) {
      const onTheCheck = await graded(keyed, ctx, raw, studentMessage, config, opts);
      if (onTheCheck.verdict === "correct") return onTheCheck;
      return { question: asked, key: "", verdict: "unsure", by: hinted === null ? "failed" : "model", on: "hint", checkQuestion: keyed.question };
    }
  }
  return graded(keyed, ctx, raw, studentMessage, config, opts);
}

/** True when two keys are the same once case, punctuation, spacing and a leading article are set aside ("1/2", "1/2."). */
function sameKey(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[*_`"“”'’.,!?;:()]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:the|a|an) /, "");
  return !!norm(a) && norm(a) === norm(b);
}

/** True when the hint's keyed question is the check's own, asked again: each is in the other, both ways. */
function asksSameQuestion(hinted: { question: string }, keyed: { question: string }): boolean {
  return questionInMessage(hinted.question, keyed.question) && questionInMessage(keyed.question, hinted.question);
}

/**
 * True when the hint's reply ends on its question: nothing after its last "?" but what TrailingQuestionHold
 * holds with a question (a choice line, an emoji, "You can do it!", a lead-in), so the reply run through
 * it drops that question ("What did you notice? You can do it!", "What is 8 + 8? 😊"). Feedback after it
 * ("Is it more than 40? Count by 8s.") lets the question out: it is not the one left open (OpenEdu #404,
 * #405's note). A line that opens with one of AFTER_QUESTION's phrases is held whatever follows it ("Try it
 * with 4 friends and 1 pizza."), so such a hint ends on its question too; its verdict is the hint's, no mark.
 */
function endsOnQuestion(text: string): boolean {
  const reply = replyFromPersisted(text).text;
  const hold = new TrailingQuestionHold();
  const shown = hold.push(reply) + hold.end();
  return questionMarks(shown) < questionMarks(reply);
}

const questionMarks = (s: string) => s.split("?").length - 1;

/** The grader's verdict on the answer against `keyed`, with code's reading of it (see the file comment). */
async function graded(
  keyed: { question: string; key: string },
  ctx: CompareContext,
  raw: KeyMatch,
  studentMessage: string,
  config: LLMConfig,
  opts: CallOpts,
): Promise<AnswerCheck> {
  const grade = await gradeAgainstKey(keyed.question, keyed.key, studentMessage, config, opts);
  if (!grade) return { ...keyed, verdict: "unsure", by: "failed" };
  const extracted = grade.student_answer.trim() ? compareToKey(keyed.key, grade.student_answer, ctx) : "undecided";
  // Code's own reading of the whole message outranks its reading of the grader's copy of it.
  const code: KeyMatch = raw === "mismatch" || extracted === "mismatch" ? "mismatch" : extracted;
  return { ...keyed, ...combine(code, grade.verdict), studentAnswer: grade.student_answer.trim() };
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
// Angles, how many ...", "Good Friday, when is it?" are kept whole (ported from TerraTutor #258), and
// only praise before them comes off: "Yes, Great Lakes, which ..." (review of the port).
const PRAISE_ITEM = /^(correct|right|yes|yep|yeah|great|good|nice|well done|awesome|perfect|excellent|exactly|that(?:'|’)?s right|that is right)\b(?:[ \t]+((?:job|work|thinking|try|answer|going|effort|pick|choice)\b[^,?\n]*|(?:one|again|exactly|indeed|right|correct|start|you(?:'|’)?re right|that(?:'|’)?s (?:right|correct|it)|that is right|you got it|well done)\b))?(?:[ \t]+([A-Za-z'’-]+))?[ \t]*,\s*/i;
const AFTER_PRAISE = /^(?:(?:now|so|then|next|and|okay|ok)\b,?\s*|(?=(?:what|which|who|whom|whose|where|when|why|how|can|could|is|are|was|were|do|does|did|will|would|should)\b))/i;
// The name, matched case-sensitively: PRAISE_ITEM is case-insensitive.
const NAME = /^[A-Z][a-z'’-]*$/;
// The praise words a bare name may follow: none of them stands as an adjective in front of a noun.
const NAME_HEAD = /^(?:correct|yes|yep|yeah|exactly|well done|that(?:'|’)?s right|that is right)$/i;
const nameFits = (m: RegExpExecArray) => !m[3] || (NAME.test(m[3]) && (!!m[2] || NAME_HEAD.test(m[1])));
function withoutPraiseLead(question: string): string {
  let cut = 0;
  for (let at = 0, m = PRAISE_ITEM.exec(question); m; m = PRAISE_ITEM.exec(question.slice(at))) {
    // The question's own subject after praise ("Yes, Great Lakes, which ..."): the praise before it comes
    // off, the subject stays (review of the port).
    if (!nameFits(m)) { cut = Math.max(cut, at); break; }
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
// `inSetup`: the text is a paragraph before the question (setupBefore), so no "?" is left after it and the
// question is not in it: the announcement comes off whatever follows it.
function checkIntro(question: string, inSetup = false): RegExpExecArray | null {
  const intro = CHECK_INTRO.exec(question);
  if (!intro || holdsNumber(intro[0]) || CLAUSE_WORD.test(intro[0].replace(/"[^"\n]*"|“[^”\n]*”/g, ""))) return null;
  if (inSetup) return intro;
  const rest = question.slice(intro[0].length).trim();
  if (!rest.includes("?")) return null;
  return POINTS_BACK.test(rest.split(/(?<=[.!?])\s/)[0]) ? null : intro;
}

/**
 * The text without what leads in to it: praise, a lead-in, the check's announcement, the last answer's
 * feedback after praise, the praise before a setup, and praise joined to it by commas. Again after the
 * praise with a praise ending ("Nice one, now") that the loop cannot read past and withoutPraiseLead takes
 * off, until nothing more comes off: the announcement after it ("let's check your understanding of
 * nouns."), and a lead-in or praise after that ("Here is your first question.", "great,"), come off too
 * (the port's own merge with #401; TerraTutor master keeps them).
 */
function withoutLead(text: string, inSetup: boolean): string {
  // A setup's last sentence ends the text: the space after it lets it be read as a sentence too.
  let rest = inSetup ? `${text}\n` : text;
  let praised = false;
  for (let before = ""; before !== rest;) {
    before = rest;
    for (;;) {
      const intro = checkIntro(rest, inSetup);
      if (intro) { rest = rest.slice(intro[0].length).trimStart(); continue; }
      const s = FIRST_SENTENCE.exec(rest);
      if (!s) break;
      const lead: RegExpExecArray | null = isPraise(s[0]) || isLeadIn(s[0]) || (praised && LAST_ANSWER.test(s[0])) ? s : PRAISE_COMMAS.exec(rest);
      if (!lead) break;
      praised ||= lead !== s || isPraise(s[0]);
      rest = rest.slice(lead[0].length).trimStart();
    }
    rest = withoutPraiseLead(rest);
  }
  return rest.trim();
}

const capitalised = (text: string) => text.replace(/^([*_\s"“]*)(\p{Ll})/u, (_, pre: string, c: string) => pre + c.toUpperCase());

// A word in the question's first sentence that points back at something said before it: "Can you tell me
// what the "whole" is in this example?", "What fraction of it is left?", "What does the picture show?"
// (TerraTutor click test 2026-11-19 part 7, issue 6: the repeat lost the chocolate-bar example).
// The empty "they" and "it" point at nothing: "What do they call the answer to an addition problem?", "What
// is it called when you add numbers?" (review of TerraTutor #260: the repeat pulled in the
// feedback above them). "What do they call it?" and "What is it called?" still point back.
const POINTS_NOWHERE = /\bthey\s+call(?=\s+(?!(?:it|them|this|that|these|those)\b)\w)|\bit\s+called(?=\s+(?:when|if)\b)/gi;
const POINTS_BEFORE = /\b(?:this|these|those|it|its|they|them|their)\b|\bthat\s+(?:example|picture|story|sentence|passage|problem|diagram|image|drawing|shape|number|fraction|word|poem|text|bar|one)\b|\bthe\s+(?:picture|example|story|passage|diagram|image|drawing|poem)\b/i;

/**
 * The setup a question that points back needs: the nearest paragraph before the question's own that holds
 * more than what leads in to it (withoutLead, so praise, a lead-in and the check's announcement come off
 * here too), at most two paragraphs up and never past a choice line. "" when there is none.
 * `lines` are the message's lines before the question's "?", `first` the question paragraph's first line.
 */
function setupBefore(lines: string[], first: number): string {
  for (let p = first, hops = 0; hops < 2; hops++) {
    let end = p - 1;
    while (end >= 0 && !lines[end].trim()) end--;
    if (end < 0 || CHOICE_LINE.test(lines[end])) return "";
    let begin = end;
    while (begin > 0 && lines[begin - 1].trim() && !CHOICE_LINE.test(lines[begin - 1])) begin--;
    const setup = withoutLead(lines.slice(begin, end + 1).join("\n").trim(), true);
    if (setup) return setup;
    p = begin;
  }
  return "";
}

/**
 * The tutor's question with its paragraph (the lines before it up to a blank line or a choice), from the
 * end of any praise or lead-in before it to the end of the message, and its choices: those after it come
 * with it, and those listed before it are put after it. When its first sentence points back at something
 * said before it ("Can you tell me what the "whole" is in this example?"), the setup it points at comes
 * first (setupBefore), without praise, a lead-in or the check's announcement.
 */
export function questionAgain(tutorMessage: string, keyedQuestion: string): string {
  const m = tutorMessage.trim();
  const at = m.indexOf("?");
  if (at < 0) return keyedQuestion.trim();
  const lines = m.slice(0, at).split("\n");
  let first = lines.length - 1;
  while (first > 0 && lines[first - 1].trim() && !CHOICE_LINE.test(lines[first - 1])) first--;
  const start = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
  // Praise, a lead-in or the check's announcement comes off (withoutLead). A question that points back at
  // what came before it ("... in this example?") keeps the setup it points at (setupBefore).
  let question = withoutLead(m.slice(start).trim(), false);
  const setup = POINTS_BEFORE.test(question.split(/(?<=[.!?:])\s/)[0].replace(POINTS_NOWHERE, "")) ? setupBefore(lines, first) : "";
  question = setup ? `${capitalised(setup)}\n\n${capitalised(question)}` : capitalised(question);
  const choicesBefore = m.slice(0, start).split("\n").filter((l) => CHOICE_LINE.test(l)).map((l) => l.trim());
  return choicesBefore.length >= 2 && !question.split("\n").some((l) => CHOICE_LINE.test(l))
    ? `${question}\n${choicesBefore.join("\n")}`
    : question;
}

/** The whole reply when code found the answer answers nothing: no reply call (TutorEngine). */
export function nonAnswerReply(tutorMessage: string, check: AnswerCheck): string {
  const again = questionAgain(tutorMessage, check.question);
  return again ? `${NON_ANSWER_AGAIN}\n\n${again}` : NON_ANSWER_RETRY;
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
  // An answer to the hint's own question: right, but the check's question is still open, and the app asks it
  // again after the reply (hintAnswerBack), so the reply neither asks nor answers it.
  const open = check.on === "hint"
    ? `That was the hint's question, not the check's. The check's question is still open${check.checkQuestion ? `: ${check.checkQuestion}` : ""}\nThe app asks it again after your reply. Do not ask it, do not give its answer, and do not say the check is done.\n`
    : "";
  return `<tutor_note>\n${question}${body}\n${open}Do not say the student has mastered anything unless the app has saved it. Do not mention this note.\n</tutor_note>`;
}

export function withAnswerCheckNote(userContent: string, check: AnswerCheck): string {
  return `${userContent}\n\n${answerCheckNote(check)}`;
}
