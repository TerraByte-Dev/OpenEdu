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
// assessPicker.ts imports this file too; appNextPick is only called inside openCheckAt, never at load.
import { appNextPick } from "./assessPicker";
import { replyFromPersisted } from "./persistedReply";
import { VERDICT_FALLBACK } from "./replyClaims";
import { STOPWORDS as CONTENT_STOPWORDS } from "./contentWords";
import { foldPlural, sameAnswer } from "../quiz-grading";

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
  /** "hint" when the answer was to a hint's own question, not the check's; "earlier" when it was to the check's
   *  opening question after the tutor had moved on to another (checkAnswer). Neither ever counts toward mastery
   *  (TutorEngine refuses the mark), and the question still open is asked again (hintAnswerBack). */
  on?: "hint" | "earlier";
  /** With `on`, the question still open, as its key call copied it: the check's own after an answer to a hint's
   *  question, the tutor's newest after an answer to the check's opening question. */
  checkQuestion?: string;
  /** True when the tutor's newest question was the check's opening one asked again in other words (checkAnswer,
   *  rewordsQuestion), or another question with the same answer (keysAgree) answered right, and the verdict came
   *  from grading the opening question second: given on the newest question with nothing asked again, but not a
   *  first try, so TutorEngine refuses a mark on it. */
  reworded?: true;
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
 * ASSESS_LOOKBACK counts from the latest pick on the app's own "which next?" card (assessPicker.ts appNextPick)
 * when there is one: the pick starts the check again for the new skill (TerraTutor live test 2026-11-21 part 14, issue
 * 3: the first skill's answers had used three of four, and one "I don't know" on the second skill closed the
 * check, so its next answer got no check and could not be marked). The app shows that card only while the check
 * is still open for the answer after it (nextPickerCard), so a pick counts only when the check, counted without
 * it, was open for that answer: the first skill's window is what it was, and a model card worded like the app's
 * after the check closed opens nothing (TerraTutor's review of part 14, MUST-FIX 2).
 * CHECK_MAX_MESSAGES still counts from the request.
 * A new thread is a new conversation. The newest message itself is not read: `conversation` ends with it.
 */
export function openCheck(conversation: ReadonlyArray<Message>): string | null {
  const at = openCheckAt(conversation);
  return at < 0 ? null : conversation[at].content;
}

/**
 * The index of the message openCheck returns, or -1 when no check is open. A pick at or after `noPickFrom` does
 * not start the count again (the gate below asks what the check was without that pick).
 */
function openCheckAt(conversation: ReadonlyArray<Message>, noPickFrom: number = Infinity): number {
  const before = conversation.slice(0, -1);
  const memo = new Map<number, number>();
  let learner = 0;
  let used = 0;
  let restarted = false;
  for (let j = before.length - 1; j >= 0; j--) {
    const m = before[j];
    if (m.role !== "user") {
      // Only where the app could have shown that card: the check was open, without this pick, for the answer right
      // after it (nextPickerCard's gate). A model card that opens its reply the same way passes appNextPick, and
      // after a closed check it would open it again (TerraTutor's review of part 14, MUST-FIX 2).
      if (!restarted && j < noPickFrom && m.role === "assistant" && appNextPick(m.content) !== null && openCheckAt(conversation.slice(0, j + 2), j) >= 0) restarted = true;
      continue;
    }
    if (asksForMasteryCheck(m.content)) return j;
    if (++learner >= CHECK_MAX_MESSAGES) return -1;
    if (restarted) continue;
    const free = isHintRequest(m.content) || (j + 1 < before.length && codeRepeat(before, j + 1, memo));
    if (!free && ++used >= ASSESS_LOOKBACK) return -1;
  }
  return -1;
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
 * `opening` is the check's own first question when the tutor has since moved on from it unanswered
 * (openingQuestion), else null: an answer not right for the message keyed may be its (checkAnswer).
 * `back` is the question of the tutor's message before the message keyed, still open after a not-right answer, as code
 * would ask it again (laterQuestion), else null: hintAnswerBack asks it on `on: "earlier"` when the open question the key
 * call copied is a statement.
 * `conversation` ends with the newest message.
 */
export function checkedMessage(conversation: ReadonlyArray<Message>): { message: string; hint: string | null; opening: string | null; back: string | null } {
  const last = conversation.length - 2;
  const hinted = last >= 2 && conversation[last - 1].role === "user" && isHintRequest(conversation[last - 1].content) && tutorAt(conversation, last - 2);
  const memo = new Map<number, number>();
  const at = checkedAt(conversation, last, memo);
  return {
    message: keyedText(conversation, at),
    hint: hinted ? afterAnsweredCard(conversation[last].content) : null,
    opening: openingQuestion(conversation, at, memo),
    back: laterQuestion(conversation, at),
  };
}

// The first sentence of the not-right verdict lines ("That's not right yet.", "That's partly right."), as a reply opens.
const NOT_RIGHT_OPENS = [VERDICT_FALLBACK.incorrect, VERDICT_FALLBACK.partly].map((v) => v.split(/(?<=[.!?])\s/)[0]);

/**
 * The question of the tutor's message just before the message at `checked` (the one two back), as questionAgain gives
 * it from that question's paragraph, or null. Only when the learner's answer to it was not right: the message at
 * `checked` opens with a not-right verdict line (NOT_RIGHT_OPENS), and that question is still open. Its question is its
 * last sentence with a "?", and only one code would key (not asksOpinion). Not the check's first message: its question
 * is the one an `on: "earlier"` answer has just answered. TerraTutor live test 2026-11-21 part 14, thread D: after the opening
 * question was answered right late, the open question was the help's "What is another big part that a plant cell has
 * that an animal cell does not? ...", answered wrong. One answered right is not asked again, nor one further back
 * (TerraTutor's review of part 14, MUST-FIX 3: "That's okay. What is the cell wall made of?", answered "cellulose", was asked again).
 */
function laterQuestion(conversation: ReadonlyArray<Message>, checked: number): string | null {
  const first = openCheckAt(conversation) + 1;
  const k = checked - 2;
  if (first <= 0 || k <= first || !tutorAt(conversation, k) || conversation[k + 1]?.role !== "user") return null;
  const opens = keyedText(conversation, checked).replace(/[‘’]/g, "'").trimStart();
  if (!NOT_RIGHT_OPENS.some((v) => opens.startsWith(v))) return null;
  const text = keyedText(conversation, k);
  const asks = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.includes("?"));
  const q = asks[asks.length - 1];
  if (!q || asksOpinion(q, text)) return null;
  const from = text.lastIndexOf("\n\n", text.lastIndexOf(q));
  return questionAgain(from < 0 ? text : text.slice(from), q) || null;
}

/**
 * The tutor's first message in the open check (its reply to the request that opened it), as the check keys it,
 * when the tutor has moved on from it and the learner left it unanswered; else null. TerraTutor live test 2026-11-20 part
 * 10, step 2: "Can you tell me what the cell membrane does?", "I don't know", an easier question about a
 * house's wall answered right, then a new question about the cytoplasm; the learner answered the membrane
 * question right and was graded against the cytoplasm one: "That's not right yet." Left unanswered: the
 * learner's message after it is not an answer ("I don't know", "help", a hint request), or code repeated it
 * after that message (an answer that answered nothing, codeRepeat). One the learner answered, right or wrong,
 * is not reopened: after "56" for "What is 7 x 8?", "56" for the next question is still graded on that one
 * only. Nor is one answered after the tutor moved on (`on: "earlier"`): code's repeat of another question
 * after HINT_ANSWER_BACK, later than it, marks that turn (a hint's answer on a later question stops it too,
 * the safe side); else every later wrong answer graded it again, "right" each time, until the check closed
 * (review of TerraTutor #268). `checked` is the index of the message the newest answer is keyed against (checkedAt).
 */
function openingQuestion(conversation: ReadonlyArray<Message>, checked: number, memo: Map<number, number>): string | null {
  const at = openCheckAt(conversation);
  const q = at + 1;
  if (at < 0 || q >= checked || !tutorAt(conversation, q) || conversation[q + 1]?.role !== "user") return null;
  const left = !readsAsAnswer(conversation[q + 1].content) || codeRepeat(conversation, q + 2, memo);
  if (!left) return null;
  for (let k = q + 2; k < conversation.length - 1; k++) {
    // Code's question asked again after HINT_ANSWER_BACK that is not a repeat of the message keyed before it (a later
    // question of the check's, hintAnswerBack's `earlier`) stops it too.
    if (conversation[k].role === "assistant" && afterAnsweredCard(conversation[k].content).includes(HINT_ANSWER_BACK)
      && (!codeRepeat(conversation, k, memo) || checkedAt(conversation, k - 2, memo) !== q)) return null;
  }
  return keyedText(conversation, q);
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
 * What code adds after the reply when the learner answered the hint's own question (`on: "hint"`) or the
 * check's opening question after the tutor moved on (`on: "earlier"`), or null on any other turn: the
 * question still open again (`tutorMessage`'s, the message the answer was keyed against), so the next try is
 * checked against it (checkedMessage). Neither answer passes the check (TutorEngine's mastery gate).
 * Only a question with an answer key is asked again. On `on: "earlier"`, when the key call copied a statement as the
 * open question ("Chloroplasts are what help plant cells make their own food.") from a message that asks something
 * else, the question questionAgain finds there is not the keyed one, and asking it again asked a yes/no with no key
 * ("Does that sound like something you remember?", TerraTutor live test 2026-11-21 part 14, issue 5). A statement there is an
 * open question with no "?" that the question found does not hold (questionInMessage): an instruction keyed in its
 * own paragraph ("Name the planet closest to the Sun. Can you do it?") is asked again as before (TerraTutor's review of part 14,
 * MUST-FIX 1). The question asked then is `earlier` (checkedMessage's `back`), or none. An `on: "hint"` answer with no
 * open question (the hint's question was the only one, hintOnly) gets none (MUST-FIX 2).
 */
export function hintAnswerBack(tutorMessage: string, check: AnswerCheck | null, earlier: string | null = null): string | null {
  if (!check?.on || (check.on === "hint" && !check.checkQuestion)) return null;
  const open = check.checkQuestion ?? "";
  const again = questionAgain(tutorMessage, open);
  const statement = check.on === "earlier" && !open.includes("?") && tutorMessage.includes("?") && !questionInMessage(open, again);
  const asked = statement ? earlier : again;
  return asked ? `${HINT_ANSWER_BACK}\n\n${asked}` : null;
}

// A line after a question that asks nothing new and gives no feedback: "Take your time!", "You can do it.".
// "Keep going!", "Let me know!" and "I believe in you!" only as the whole line, with nothing but marks or an
// emoji after them: "Keep going, count the slices." goes on with help (OpenEdu's take-back of TerraTutor #264,
// item 2; ported from TerraTutor #266).
const AFTER_QUESTION = /^[\W_]*(?:(?:take your time|you can do it|you(?:'|’)ve got this|give it a (?:try|go|shot)|try it|have a go|think about it|good luck|no rush)\b[^?]*|(?:keep going|let me know|i believe in you)[^\p{L}\p{N}?]*)$/iu;
// A sentence's end in streamed text: an end mark or a colon with any closing marks after it, then spaces; or
// a line break. The spaces are the group.
const SENTENCE_BREAK = /(?:[.!?:][*_"”')\]]*|(?=\n))(\s+)/;
// A sentence that only announces going back to a question: "Now, let's go back to my last question.", "Back to
// the question.", "Let's return to the first question!". Code's HINT_ANSWER_BACK says it after the reply, so it
// is held like a lead-in: dropped when nothing but the held question follows it (TerraTutor live test 2026-11-20
// part 11, thread D: "Now, let's go back to my last question. Now back to the question:"), let out before
// feedback. One that says anything more ("... to the question about the nucleus.", "... of why cells divide.") is
// not one.
// After a held question it is read as before (let out with it), so endsOnQuestion reads a hint as it did.
const GOES_BACK = /^[\W_]*(?:(?:now|okay|ok|so|alright|all right|anyway|great|good)\b[\s,!.]*)*(?:(?:let(?:'|’)?s|let us|we(?:'|’)ll|we will|i(?:'|’)ll|i will|time to)\s+(?:(?:go|get|come|head|turn)\s+back|return)\s+to|(?:going|getting|coming)\s+back\s+to|back\s+to)\s+(?:my|our|the|your)\s+(?:(?:last|earlier|first|previous|original|other|main|current|open|real|check(?:'|’)s)\s+)?question[.!]*[*_"”')\]]*$/i;
// A sentence that only announces moving on to another question: "Now, let's try another one.", "Let's try a different
// one.", "Here is another question.", "Let's do one more!", "Next question." Held like GOES_BACK: code asks the open
// question after the reply, so the model's own next question is dropped, and the line that leads in to it with it
// (TerraTutor live test 2026-11-20 part 12, threads B and C: "Now, let's try another one. Now back to the question:"). One that
// says what comes next ("Let's try another one with pizza.", "Let's try a different picture.") is not one.
const MOVES_ON = /^[\W_]*(?:(?:now|okay|ok|so|alright|all right|great|good|and)\b[\s,!.]*)*(?:(?:let(?:'|’)?s|let us|we(?:'|’)ll|we will|i(?:'|’)ll|i will)\s+(?:(?:try|do|have|move on to|go on to|go to|look at)\s+)?|(?:here(?:'|’)?s|here is|time for|on to|moving on to|try|do)\s+)?(?:(?:just\s+)?one\s+more|another|a\s+(?:new|different|harder|easier|second)|the\s+next|next)(?:\s+(?:one|question|problem|example|try|go))?[.!]*[*_"”')\]]*$/i;

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
 * `again` is what code adds after the reply (hintAnswerBack). A question of the model's that code asks there is never
 * let out, nor the lead-in held before it, nor what follows it that code's copy holds too: live test 2026-11-20 part
 * 13, thread D, "What is the smallest number that appears in both lists? That number is the Least Common Multiple, or
 * LCM." was let out by its second sentence, and code then asked the same question again. Feedback after it is let out
 * without it, and so is a tool round (flush). The model's copy is code's question when each holds most of the other's
 * meaning words (sameQuestion): word for word, with words added ("... in both of the lists?") or a paraphrase
 * ("What's the smallest number in both lists?"); dropping a near copy costs nothing, as code asks its own after it.
 */
export class TrailingQuestionHold {
  private buf = "";
  // Everything after the last sentence let out: the spaces before the held sentences, and those sentences, each
  // marked `repeat` when it is the model's copy of code's question or goes with it (dropped when the rest is let out),
  // `leadIn` when it was held as a lead-in, `afterAsk` when it was held because a question came before it.
  private kept: Array<{ text: string; repeat: boolean; asks: boolean; leadIn: boolean; afterAsk: boolean }> = [];
  // A question is held: what follows it with no feedback in it is held with it.
  private asked = false;
  // The question held last is one code asks again after the reply.
  private repeatHeld = false;
  // Code's text after HINT_ANSWER_BACK, and its questions.
  private readonly again: string;
  private readonly againAsks: string[];

  constructor(again: string | null = null) {
    const back = again ? again.lastIndexOf(HINT_ANSWER_BACK) : -1;
    this.again = again ? (back < 0 ? again : again.slice(back + HINT_ANSWER_BACK.length)).trim() : "";
    this.againAsks = this.again.split(/(?<=[.!?])\s+|\n+/).filter((q) => q.includes("?"));
  }

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
    return this.kept.map((p) => p.text).join("") + this.buf;
  }

  /** Lets out everything held: something follows it (a tool round), or nothing will be added after it. With
   *  `repeats` false the model's copy of code's question stays out: code still asks it after the reply. */
  flush(repeats = true): string {
    let out = "";
    // The sentence not yet read (the text's last, waiting for more) is read first, as at the end: a question that ends
    // the text before a tool call is still here (review of TerraTutor #279, MUST-FIX 3).
    if (!repeats) {
      const last = this.buf.replace(/\s+$/, "");
      const spaces = this.buf.slice(last.length);
      this.buf = last ? "" : spaces;
      if (last) out = this.sentence(last, spaces);
    }
    out += (repeats ? this.kept : this.kept.filter((p) => !p.repeat)).map((p) => p.text).join("") + this.buf;
    this.buf = "";
    this.kept = [];
    this.asked = false;
    this.repeatHeld = false;
    return out;
  }

  /** The end of the reply: the last sentence is read, and a question still held there is dropped. */
  end(): string {
    const last = this.buf.replace(/\s+$/, "");
    this.buf = "";
    const out = last ? this.sentence(last, "") : "";
    this.kept = [];
    this.asked = false;
    this.repeatHeld = false;
    return out;
  }

  private sentence(text: string, spaces: string): string {
    const s = text.trim();
    const asks = s.includes("?");
    const repeat = asks && this.againAsks.some((q) => sameQuestion(s, q));
    // After the model's copy of code's question, a sentence code's copy holds too ("That number is the Least Common
    // Multiple, or LCM." beside code's "... (LCM).") goes with it.
    const withRepeat = !asks && this.repeatHeld && /[\p{L}\p{N}]/u.test(s) && questionInMessage(s, this.again);
    const leadIn = /:[*_"”')\]]*$/.test(s) || (!this.asked && (GOES_BACK.test(s) || MOVES_ON.test(s)));
    const afterAsk = !leadIn && !asks && !withRepeat && this.asked && (!/[\p{L}\p{N}]/u.test(s) || CHOICE_LINE.test(s) || AFTER_QUESTION.test(s));
    const held = !s || asks || withRepeat || leadIn || afterAsk;
    if (held) {
      if (asks) { this.asked = true; this.repeatHeld = repeat; }
      // The lead-in held before the model's copy of code's question goes with it ("Here it is again:"). Only a lead-in:
      // what was held because an earlier question came before it (its choice lines, "Take your time!") stays with that
      // question (inbox 2026-11-21-0017 item 3: "Which is bigger?" lost its "A) 4" and "B) 6").
      if (repeat) {
        for (let i = this.kept.length - 1; i >= 0 && !this.kept[i].asks && !this.kept[i].afterAsk; i--) {
          if (this.kept[i].leadIn && /[\p{L}\p{N}]/u.test(this.kept[i].text)) this.kept[i].repeat = true;
        }
      }
      this.kept.push({ text: text + spaces, repeat: repeat || (!asks && this.repeatHeld), asks, leadIn, afterAsk });
      return "";
    }
    const out = this.kept.filter((p) => !p.repeat).map((p) => p.text).join("") + text;
    this.kept = [{ text: spaces, repeat: false, asks: false, leadIn: false, afterAsk: false }];
    this.asked = false;
    this.repeatHeld = false;
    return out;
  }
}

// The words a question is framed with, which say nothing of what it asks: question words, "is", "the", "that", and
// the "s" of "what's". Closed and small.
const QUESTION_FRAME = new Set("what which who whom whose where when why how is are was were s the a an that this these those it of in on to do does did can could you".split(" "));

/** A question's meaning words, as TrailingQuestionHold compares it with code's: lower case, with lead words before it
 *  ("So, what is ...", "Now, ...") and QUESTION_FRAME left out. All its words when every one is a frame word. */
function meaningWords(question: string): string[] {
  const all = words(question.replace(/^[\W_]+/, "").replace(LEAD_FILLER, ""));
  const meant = all.filter((w) => !QUESTION_FRAME.has(w));
  return meant.length ? meant : all;
}

/** Two questions are one when each holds at least four in five of the other's meaning words (meaningWords): "What is
 *  the smallest number that appears in both of the lists?" and "What's the smallest number in both lists?" are code's
 *  "What is the smallest number that appears in both lists?"; "Is 8 in both lists?" is not (review of TerraTutor #279,
 *  MUST-FIX 4). */
function sameQuestion(a: string, b: string): boolean {
  const x = meaningWords(a), y = meaningWords(b);
  return x.length > 0 && y.length > 0 && questionInMessage(x.join(" "), y.join(" ")) && questionInMessage(y.join(" "), x.join(" "));
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
  if (echoesOfferLead(out.answer, out.question)) issues.push('"answer" must answer the question inside the offer, not repeat the offer\'s words.');
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

// A key call's "answer" that is no answer: a request for input, a refusal or a note about the message. TerraTutor
// live test 2026-11-20 part 11, issue 6: the key for a message that asked nothing was "Please provide a topic", and the
// learner's answer was graded "correct" against it. Read as no key ("none"), so no verdict is given. Narrow: it
// must open the answer, so "No", "None", "0" and "Not enough water" stay keys; "please" needs a request for input
// after it ("Please give me the ball." is a key), "I cannot" a refusal to answer ("I can't see it because it is
// too small" is a key), and "any answer" nothing after it but "is fine" ("Any answer that is a mammal" is a key).
const META_KEY = new RegExp(String.raw`^[\W_]*(?:${[
  String.raw`(?:please|kindly)\s+(?:provide|give|specify|share|tell|clarify|enter|supply|ask|state)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the|more|your|some|specific|clear)\s+)*(?:topic|question|context|message|details?|information|subject|input|prompt)s?\b`,
  String.raw`(?:i|we)\s+(?:cannot|can(?:'|’)?t|can not|(?:am|are|(?:'|’)m|(?:'|’)re)\s+unable\s+to|do not|don(?:'|’)?t)\s+(?:determine|answer|tell)\s+(?:the|this|which|what|from|without)\b`,
  String.raw`as an ai\b`,
  String.raw`(?:there is|there(?:'|’)s|there are)\s+no\s+(?:\w+\s+)?(?:question|answer)s?\b`,
  String.raw`no\s+(?:\w+\s+)?question\b`,
  String.raw`(?:the|this|tutor(?:'|’)s)\s+message\s+(?:does not|doesn(?:'|’)?t|did not|didn(?:'|’)?t)\s+(?:ask|contain|have|include)\b`,
  String.raw`(?:n\/a|not applicable)[\W_]*$`,
  String.raw`(?:answers?|responses?)\s+(?:will|may|can|could|might)\s+vary\b`,
  String.raw`(?:it\s+)?(?:depends|varies)\s+on\s+(?:the\s+)?(?:student|learner|person|you)\b`,
  String.raw`any\s+(?:answer|opinion|choice|response)\s*(?:(?:is|will be)\s+(?:fine|ok|okay|correct|acceptable|right|good)\b|works\b|will do\b|[\W_]*$)`,
  String.raw`the\s+student(?:'|’)s?(?:\s+own)?\s+(?:answer|opinion|choice|response)\b`,
  String.raw`(?:(?:this|it)\s+is\s+)?(?:an?\s+)?(?:opinion|open[- ]ended|subjective|personal)\s+(?:question|answer|response)\b`,
  // TerraTutor live test 2026-11-20 part 13, issue 3: an offer keyed "Choice 1 or 2" and "Choice depends on student preference",
  // and "What do you already know about life during the Elizabethan Era?" keyed "Student's prior knowledge". Only a
  // choice of two numbered or lettered options as the whole key: "Choice B" and "Option 2" stay keys.
  String.raw`(?:choice|option)s?\s+(?:\d+|[a-d]|one|two)\s+or\s+(?:(?:choice|option)\s+)?(?:\d+|[a-d]|one|two|both)[\W_]*$`,
  String.raw`(?:the\s+)?(?:choice|option|answer)s?\s+(?:depends|depend|varies|vary|is\s+up\s+to)\b`,
  String.raw`(?:the\s+)?(?:student|learner)(?:'|’)?s?(?:\s+own)?\s+(?:preference|choice|opinion|(?:prior|previous|existing|background|own)\s+knowledge)\b`,
].join("|")})`, "i");

/** True when the key call's answer is no answer key at all (META_KEY). */
export function isMetaKey(answer: string): boolean {
  return META_KEY.test(answer.trim());
}

// A question that asks what the learner thinks, likes or feels, with no one right answer: "Can you tell me which
// idea you think is the most important one?" (TerraTutor live test part 11, thread E: keyed "Cells are the basic
// unit of life" and graded on it), "What is your favorite planet?", "Would you rather be a bird or a fish?". Narrow:
// "What do you think 7 x 8 is?" and "What do you think is the first part?" ask for a fact, and are keyed.
// What sounds better or more fun to the learner, and which one they want or would like to do, is their preference
// (TerraTutor live test 2026-11-20 part 13, issue 3: "Which one sounds better to you right now?" after two choices was keyed
// "Choice 1 or 2" and graded).
const OPINION = /\b(?:your\s+(?:own\s+)?(?:favou?rite|opinion)|do\s+you\s+(?:like|prefer|agree|enjoy)|would\s+you\s+(?:rather|prefer)|sounds?\s+(?:better|best|good|great|fun|interesting|more\s+fun|like\s+more\s+fun)\s+(?:to|for)\s+you|which\s+(?:one\s+|of\s+these\s+|of\s+them\s+)?(?:do|would)\s+you\s+(?:want|like)\s+to\b|how\s+do(?:es)?\s+(?:you|it\s+make\s+you)\s+feel|you\s+(?:think|feel|believe)\s+(?:is|was|are|were)\s+(?:the\s+)?(?:most|best|least|more|less)\s+(?:important|interesting|fun|useful|exciting|surprising|cool|beautiful)|(?:most|more)\s+(?:interesting|fun|exciting|surprising)\s+to\s+you|which\s+(?:one|idea|part|of\s+these|of\s+them)\s+(?:do\s+you|you)\s+(?:like|prefer|enjoy)|you\s+(?:like|enjoy)\s+(?:the\s+)?(?:most|best))\b/i;

// Which skill or part to check or study next (WHICH_NEXT): the model's copy of the app's "Which one should we check
// next?" card, with the skill titles as its choices, was keyed with one title, and typing it was graded "correct" (TerraTutor live
// test 2026-11-21 part 14, issue 1). Closed and small: one, a skill, topic, part, area or lesson, or one of these, then a
// study verb, then "next". Not "do", "try" or "first", and not in a sentence that poses a problem (POSES_PROBLEM): "In 3 +
// 4 × 2, which one should we do first?" asks for a fact, and is keyed (TerraTutor's review of part 14, MUST-FIX 5). "Which planet
// should we visit next?" is keyed too.
const WHICH_NEXT = /\bwhich\s+(?:one|skill|topic|part|area|lesson|of\s+these|of\s+them)\s+(?:should|shall|will|can)\s+(?:we|i)\s+(?:check|learn|study|review|practi[cs]e|look\s+at|work\s+on|cover)\s+next\b/i;

// A question that offers the learner a choice of what to do next: "Do you want to try another example, or would you
// like to check another part of translating diagrams to fraction notation?" (TerraTutor live test 2026-11-20 part 12, step 3:
// keyed "2/6", a statement before it, so a pick would have been graded wrong). It opens with the offer ("do you want",
// "would you like", "shall we", "want to", "are you ready"), and after its "or" comes another offer, another thing to
// do or another one, never a thing to name: "Is a whale a fish or a mammal?", "Is 3/4 bigger or smaller than 1/2?" and
// "Do you want to add or subtract?" are asked for a fact and keyed.
const OFFER = String.raw`(?:do\s+you\s+(?:want|wanna)|would\s+you\s+(?:like|want)|shall\s+we|want\s+to|are\s+you\s+ready)`;
const OFFER_HEAD = String.raw`^[\W_]*(?:(?:now|okay|ok|so|alright|all right|great|good|then|and)\b[\s,!.]*)*${OFFER}\b[^?]*?`;
const OFFER_OTHER = String.raw`(?:${OFFER}|(?:do|would|shall|should|can|could)\s+(?:you|we|i)\b|(?:to\s+)?(?:try|check|do|go|move|keep|practi[cs]e|look|review|stop|start|learn|work|play)\b|(?:an?\s+)?(?:new|different|another)\b)`;
const CHOICE_OFFER = new RegExp(String.raw`${OFFER_HEAD}\bor\s+${OFFER_OTHER}`, "i");
// The same, split at the choice's "or": the first choice ends with group 1, the other starts where the match ends.
const CHOICE_SPLIT = new RegExp(String.raw`(${OFFER_HEAD})\bor\s+(?=${OFFER_OTHER})`, "i");
// An offer asks nothing of its own (TerraTutor #273's review, MUST-FIX 3). A sentence with an embedded question
// ("Do you want to tell me what the nucleus does, or would you like a hint?", "whether a tomato is a fruit"), a ":"
// ("Would you like to try this one: what gas do plants take in, ...?") or a verb that asks for an answer ("... or
// check the picture again to find the numerator?") asks for a fact, and is keyed as before. So does one that poses a
// problem in numbers: an operation between two numbers, or "3 of the 4" ("Do you want to try 6 × 7, or would you like
// an easier one?", review of this port, NIT 1). A number alone poses none ("Do you want to do 3 more, or would you like
// to stop?", "... try question 2, or go back to question 1?"; TerraTutor take-back 2026-11-20-1623, item 1, ported
// from TerraTutor 87577a00). Nor does a range with a spaced dash ("Do you want to try 2 - 3 more questions, or would
// you like to stop?", "... for 10 - 15 minutes, or ...": TerraTutor live test 2026-11-21 part 14, issue 7, inbox
// 2026-11-21-0017 item 1; ported from TerraTutor #281).
const ASKS_INSIDE_WORDS = String.raw`\b(?:what|which|who|whom|whose|where|when|why|how|whether|if|(?:tell|name|find|guess|answer)(?:s|ed|ing)?)\b`;

// What may follow the second number of an operation an offer poses: nothing but ",", "?", "." or " or", after at most
// one word of when ("solve 12 ÷ 3 next, or ..."). "try 6 × 7, or ..." poses 6 × 7; "2 - 3 more questions", "10 - 15
// minutes" and "a 3 × 3 grid" pose nothing (the reviewer's rule, inbox 2026-11-21-0017 item 1).
const POSED_END = String.raw`(?=(?:\s+(?:next|now|first|instead))?\s*(?:[,?]|\.(?!\d)|or\b))`;
// An operation between two numbers: any operator but a "-" with spaces round it, anywhere, as before; that one, a range
// as often as a subtraction, only when the second number ends the problem (POSED_END).
const NUMBER_OP = String.raw`\d\s*[×x*÷/+−=<>]\s*\d|\d(?:-\s*|\s+-)\d|\d\s+-\s+\d+(?:\.\d+)?${POSED_END}`;
const ASKS_INSIDE = new RegExp(String.raw`:|${NUMBER_OP}|\b\d+\s+of\s+(?:the\s+)?\d+\b|${ASKS_INSIDE_WORDS}`, "i");

// A problem posed in numbers: an operation between two numbers, or "3 of the 4" (ASKS_INSIDE's number half).
const POSES_PROBLEM = new RegExp(String.raw`${NUMBER_OP}|\b\d+\s+of\s+(?:the\s+)?\d+\b`, "i");

// A yes/no question about whether the learner remembers, knows how, is ready, or follows: "Do you remember how we find
// a common denominator?" (TerraTutor live test 2026-11-20 part 13, thread C: keyed "4", and the right method told "not quite right
// yet"), "Do you know how to add fractions?", "Are you ready for the next one?", "Does that make sense?". It asks
// nothing with one right answer. Closed and structural: it opens the sentence (lead words aside), and "remember",
// "recall" or "know" is followed by "how" and who does it ("how we", "how to"). "Do you know what 3 × 4 is?", "Do you
// remember what we call the top number?" and "Do you know how many legs a spider has?" ask for a fact, and are keyed;
// so does a bare "Do you know?" after a setup ("Let's see if you know which planet is closest to the sun. Do you
// know?"), and a recall question that poses a problem in numbers ("Do you remember how we find 3 × 4?", POSES_PROBLEM).
const ASK_START = String.raw`^[\W_]*(?:(?:${LEAD_WORDS})\b[\s,!.]*)*`;
const RECALL = new RegExp(String.raw`${ASK_START}(?:do|did|can)\s+you\s+(?:still\s+)?(?:remember|recall|know)\s+how\s+(?:to|we|you|i|they)\b`, "i");
// Whether the learner is ready or follows, only when nothing is asked inside it (ASKS_INSIDE): "Are you ready to tell
// me which planet is closest to the Sun?" and "Are you ready for 3 × 4?" ask for a fact, and are keyed.
const READY = new RegExp(String.raw`${ASK_START}(?:are\s+you\s+ready\b|(?:does|did)\s+(?:that|this|it)\s+(?:all\s+)?make\s+sense\b)`, "i");

/** True when the tutor's `message` says nothing after `question` but lines that ask nothing new (AFTER_QUESTION) or
 *  have no letters or digits. A question the message does not hold word for word is placed by its words
 *  (sameQuestion); one that cannot be placed is not last. */
function endsMessage(question: string, message: string): boolean {
  let end = message.lastIndexOf(question);
  if (end >= 0) end += question.length;
  else {
    const parts = [...message.matchAll(/[^\n.!?]*[.!?]+|[^\n.!?]+/g)].reverse();
    const hit = parts.find((m) => m[0].includes("?") && sameQuestion(m[0], question));
    if (!hit) return false;
    end = hit.index! + hit[0].length;
  }
  return message.slice(end).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).every((s) => !/[\p{L}\p{N}]/u.test(s) || AFTER_QUESTION.test(s));
}

/** True when every question asked in `question` asks for the learner's opinion (OPINION), offers a choice of what to
 *  do next (CHOICE_OFFER), or asks whether they remember, know how, are ready or follow (RECALL, READY), with no fact
 *  to key. RECALL and READY count only when nothing follows them in the tutor's `message` (endsMessage): "Are you
 *  ready for a tricky one? Name the planet closest to the Sun." and "Do you remember how we find the area of a
 *  rectangle? Show me with a rectangle that is 3 cm by 4 cm." ask what comes after (review of TerraTutor #279, MUST-FIX 2). */
export function asksOpinion(question: string, message: string = question): boolean {
  const asks = question.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.includes("?"));
  const last = (s: string) => endsMessage(s, message);
  return asks.length > 0 && asks.every((s) => OPINION.test(s) || (WHICH_NEXT.test(s) && !POSES_PROBLEM.test(s)) || (RECALL.test(s) && !POSES_PROBLEM.test(s) && last(s)) || isReady(s, message) || (CHOICE_OFFER.test(s) && !ASKS_INSIDE.test(s)));
}

const isReady = (s: string, message: string) => READY.test(s) && !ASKS_INSIDE.test(s) && endsMessage(s, message);

/** True when every question asked in `question` only asks whether the learner is ready or follows (READY: "Does
 *  that make sense?", "Are you ready?"), as asksOpinion reads it, and nothing follows it in `message`. A plain yes to
 *  it uses no try at a check (TutorEngine usedNoTry); asksOpinion's other kinds are not this. */
export function asksReady(question: string, message: string = question): boolean {
  const asks = question.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.includes("?"));
  return asks.length > 0 && asks.every((s) => isReady(s, message));
}

/** The one plain operation a choice offer poses ("Do you want to try 6 × 7, or would you like an easier one?"),
 *  worked by code (keyFromArithmetic), or null: the offer is not one, or poses no single operation. A "-" counts only
 *  with spaces round it and a "/" not at all: "3-4 more" is a range, "1/2" a fraction. And only when the second number
 *  ends the problem (POSED_END): "Do you want to try 2 - 3 more questions, or would you like to stop?" was keyed -1, and
 *  "4 more please" was told it was wrong (TerraTutor live test 2026-11-21 part 14, issue 7). */
function offeredArithmetic(question: string): string | null {
  const offer = question.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).find((s) => s.includes("?") && CHOICE_OFFER.test(s));
  const posed = offer ? [...offer.matchAll(new RegExp(String.raw`(\d+(?:\.\d+)?)(\s*[+−×xX*·÷]\s*|\s+-\s+)(\d+(?:\.\d+)?)${POSED_END}`, "g"))] : [];
  return posed.length === 1 ? keyFromArithmetic(`What is ${posed[0][1]} ${posed[0][2].trim()} ${posed[0][3]}?`) : null;
}

/** True when the key only echoes a choice offer in `question`, the choice itself: every word of it is in the offer, it
 *  has an "or", and it names both sides of the offer's "or" (a word only the first choice has, and one only the other
 *  has): "6 × 7 or an easier one" for "Do you want to try 6 × 7, or would you like an easier one?". A key from the
 *  offer that names one side is a key: "mammal" for "... whether a whale is a fish or a mammal, or would you like a
 *  hint?", "3/4" for "... which is bigger, 3/4 or 2/3, or would you like a hint?" (review of TerraTutor #279, MUST-FIX 1). */
function echoesOffer(key: string, question: string): boolean {
  const offer = question.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).find((s) => s.includes("?") && CHOICE_OFFER.test(s));
  const split = offer ? CHOICE_SPLIT.exec(offer) : null;
  if (!offer || !split) return false;
  const k = words(key);
  const first = new Set(words(split[1]));
  const other = new Set(words(offer.slice(split[0].length)));
  const said = new Set(words(offer));
  return k.some((w) => w === "or") && k.every((w) => said.has(w))
    && k.some((w) => first.has(w) && !other.has(w)) && k.some((w) => other.has(w) && !first.has(w));
}

// What an offer asks the learner to do when it only asks them to give the answer: closed and small.
const REPORTING_VERB = /^(?:tell|say|show|explain|share|answer|guess)$/;

// An offer that opens the sentence: "Do you want to ...", "Would you like to ...".
const OFFER_START = new RegExp(String.raw`^[\W_]*(?:(?:now|okay|ok|so|alright|all right|great|good|then|and)\b[\s,!.]*)*${OFFER}\b`, "i");

/** True when the key is only the first words of what the offer in `question` asks the learner to do, up to the question
 *  inside it: "Tell me" or "Tell me whether" for "Do you want to tell me whether a whale is a fish or a mammal, or would
 *  you like a hint?" (TerraTutor live test 2026-11-21 part 14, issue 8: keyed "Tell me", and "a mammal" was "partly" right). Such a
 *  key repeats the offer and answers nothing: the key call is asked once more for the question inside it (validateKey),
 *  and a key that still repeats it fails the call (no key, verdict "unsure"). Only when what the offer asks the learner
 *  to do is to report the answer (REPORTING_VERB: "tell me", "say", "show me", ...): "Add" for "Do you want to add or
 *  subtract to find how many apples there are in all?" is a key (TerraTutor's review of part 14, MUST-FIX 4). "mammal" is a key; so
 *  is "Yes" for "... tell me if ...". */
function echoesOfferLead(key: string, question: string): boolean {
  const offer = question.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).find((s) => s.includes("?") && OFFER_START.test(s));
  const asked = offer ? offer.slice(OFFER_START.exec(offer)![0].length).replace(/^\s*to\b/i, "") : "";
  const inside = /\b(?:what|which|who|whom|whose|where|when|why|how|whether|if)\b/i.exec(asked);
  if (!inside) return false;
  const lead = words(asked.slice(0, inside.index + inside[0].length));
  if (!REPORTING_VERB.test(lead[0] ?? "")) return false;
  const k = words(key);
  return k.length > 0 && k.length <= lead.length && k.every((w, i) => w === lead[i]);
}

/**
 * The key for the tutor's question; "none" when the message asks nothing with one right answer (also when its
 * questions only ask the learner's opinion, asksOpinion, or the key call's answer is no key, isMetaKey); null
 * when the call failed. A message whose one question asks for one plain operation is keyed by code,
 * with no call. (Two questions in one message go to the model, which keys both.) So is a choice offer that poses one
 * ("Do you want to try 6 × 7, or would you like an easier one?" is keyed 42, `offer` set: TerraTutor live test 2026-11-20 part 13,
 * issue 4, where the key call returned the offer itself, "6 × 7 or an easier one"); a model key that only echoes an
 * offer (echoesOffer) is no key.
 */
export async function answerKey(
  tutorMessage: string,
  config: LLMConfig,
  opts: CallOpts,
): Promise<{ question: string; key: string; offer?: true } | "none" | null> {
  const asked = onlyQuestion(tutorMessage);
  const byCode = asked ? keyFromArithmetic(asked) : null;
  if (byCode !== null) return { question: asked, key: byCode };
  const offered = asked ? offeredArithmetic(asked) : null;
  if (offered !== null) return { question: asked, key: offered, offer: true };
  if (asked && asksOpinion(asked, tutorMessage)) return "none";
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
  if (!answer || isMetaKey(answer)) return "none";
  if (validateKey(out, tutorMessage).length) return null;
  const question = out.question.trim();
  if (asksOpinion(question, tutorMessage) || echoesOffer(answer, question)) return "none";
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
 * `opening` is the check's own first question when the tutor has moved on from it unanswered (checkedMessage):
 * an answer graded "incorrect" or "partly" for `tutorMessage`'s question, with no hint question in play, is graded
 * against it too; a better verdict there is its verdict, tagged `on: "earlier"`, or given on the newest question
 * and marked `reworded` when that question is the opening one reworded (rewordsQuestion, keys that agree), or has
 * the same answer and the answer was right (keysAgree).
 */
export async function checkAnswer(
  tutorMessage: string,
  studentMessage: string,
  config: LLMConfig,
  opts: CallOpts,
  hintReply: string | null = null,
  opening: string | null = null,
): Promise<AnswerCheck | null> {
  const found = await answerKey(tutorMessage, config, opts);
  // A message that asks nothing with one right answer (or, with no question mark at all, whose key call failed) leaves
  // only a hint's own question to answer, when a hint asked one: graded there (hintOnly). TerraTutor live test 2026-11-21 part 14,
  // issue 6: the check gave up before the hint, and a wrong "3" to the hint's "What is the largest number that can
  // divide both 2 and 12?" was praised.
  if (found === "none" || (found === null && !tutorMessage.includes("?"))) return hintReply?.includes("?") ? hintOnly(hintReply, studentMessage, config, opts) : null;
  if (found === null) return { question: "", key: "", verdict: "unsure", by: "failed" };
  const { offer, ...keyed } = found;
  // An offer that poses a problem ("Do you want to try 6 × 7, or would you like an easier one?") is answered with a
  // number, or picked: a pick ("an easier one", "yes", "6 x 7 please") states no number but the offer's own, and gets
  // no verdict. So does one whose number sits inside other words ("something with 5s please", review of TerraTutor #279): an
  // answer leads with its number (lead words aside) or ends on it ("42", "it's 42", "6 × 7 = 42").
  const posed = offer ? numbersIn(keyed.question).map((n) => n.value) : [];
  const bare = (t: string) => !/[\p{L}\p{N}]/u.test(t);
  const answers = (n: { from: number; to: number }) =>
    bare(studentMessage.slice(0, n.from).trim().replace(LEAD_FILLER, "")) || bare(studentMessage.slice(n.to));
  if (offer && !numbersIn(studentMessage).some((n) => !n.loneOne && !posed.includes(n.value) && answers(n))) return null;
  // An answer that poses a problem of its own, not the offer's, with no "=" after it, and states no number outside it,
  // asks for that problem: "let me try 3 x 4", "3 x 4 please" (inbox 2026-11-21-0017 item 1). No verdict. "6 × 7 = 42"
  // and "7 × 6 = 42" answer, and so does "42 because 6 x 5 + 12 makes it": 42 is outside (TerraTutor's review of part 14, MUST-FIX 6).
  const asksOwn = offer ? [...studentMessage.matchAll(/(\d+(?:\.\d+)?)\s*(?:[+−×xX*·÷]|\s-\s)\s*(\d+(?:\.\d+)?)/g)].filter((m) =>
    !studentMessage.slice(m.index! + m[0].length).includes("=") && !(posed.includes(Number(m[1])) && posed.includes(Number(m[2])))) : [];
  if (asksOwn.length && numbersIn(studentMessage).every((n) => asksOwn.some((m) => n.from >= m.index! && n.to <= m.index! + m[0].length))) return null;
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
    const hinted = keyOnly(await answerKey(hintReply, config, opts));
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
  const onTheNewest = await graded(keyed, ctx, raw, studentMessage, config, opts);
  if ((onTheNewest.verdict !== "incorrect" && onTheNewest.verdict !== "partly") || !opening) return onTheNewest;
  // The tutor moved on from the check's opening question before it was answered, and the answer is not right
  // for the newest one: it may be the opening question's (TerraTutor live test 2026-11-20 part 10, step 2).
  // Graded there second, so at most two grader calls, as after a hint. A better verdict there (correct over
  // partly, either over incorrect) is its verdict, tagged `on: "earlier"`: it never counts toward mastery (it
  // was not the first try), and code asks the newest question again after the reply (hintAnswerBack).
  // Otherwise the newest's verdict stands. "partly" on the newest is tried too (TerraTutor live test part 11,
  // threads A and C: a whole three-part answer to "what are the three main ideas of the cell theory?" was
  // "partly" right for the move-on question and told to give "the other two").
  const earlier = keyOnly(await answerKey(opening, config, opts));
  if (!earlier || earlier === "none" || sameKey(earlier.key, keyed.key) || asksSameQuestion(earlier, keyed)) return onTheNewest;
  const earlierCtx = { question: earlier.question, options: optionsIn(opening) };
  const earlierRaw = compareToKey(earlier.key, studentMessage, earlierCtx);
  const onTheEarlier: AnswerCheck = earlierRaw === "match"
    ? { ...earlier, verdict: "correct", by: "code" }
    : await graded(earlier, earlierCtx, earlierRaw, studentMessage, config, opts);
  if (VERDICT_RANK[onTheEarlier.verdict] <= VERDICT_RANK[onTheNewest.verdict]) return onTheNewest;
  // The newest question is the opening one asked again in other words (rewordsQuestion): one question, so one
  // verdict, the better one, on the newest, and nothing asked again. Tagged `on: "earlier"`, the reply said
  // "That's partly right." and code then asked the same question again (this repo's port of TerraTutor #268,
  // take-back 2026-11-20-0752). Only when the two keys give one answer (keysAgree): "36" and "24", or "Yes" and
  // "No", are two questions however alike their words; and so are two that name different things, "insects" and
  // "snakes and birds" for "What does a frog eat?" / "What eats a frog?" (take-back 2026-11-20-1103, item 3), or
  // "Frogs eat insects like flies and crickets." and "Snakes, birds and herons eat frogs." (its review, MUST-FIX 1).
  // Two statement keys in other words are two answers here too: when unsure, the two are graded apart, and the
  // newest question is asked again (ported from TerraTutor #273).
  // The same verdict, with nothing asked again, when the newest question is another question with the same answer
  // and the answer was right (TerraTutor live test 2026-11-20 part 12, issue 1: "The denominator would be 4." was
  // right for "what number would be the denominator?", keyed "4", and code then asked "how many pieces do we have
  // in total?", keyed "4 pieces", again): the keys must give one answer, the learner's message must state the key's
  // numbers, and every word one key has and the other does not must be a word the newest question counts ("pieces"
  // in "how many pieces ...?", countsKeyWords), or, for a word only the newest key has, in the learner's message.
  // "tens" in "4 tens" for "What is the value of the 4 in 345?" is in neither, so "4" for "What digit is in the tens
  // place of 345?" does not answer it (review MUST-FIX 2); "square" in "4 square cm" for an area question is not
  // counted by it, so "4 cm", right for a perimeter, does not answer it either way round (review of this port,
  // MUST-FIX 1).
  // Marked `reworded`: the verdict came from grading the opening question second, so it is not a first try, and
  // TutorEngine refuses the model's own mark on it (MASTERY_REFUSED_REWORDED), as it does after `on: "earlier"`.
  // Given with the newest question's key, so the model's note pairs the newest question with its own key.
  const agree = keysAgree(earlier.key, keyed.key);
  const reworded = agree && rewordsQuestion(earlier.question, keyed.question);
  const answersBoth = agree && onTheEarlier.verdict === "correct" && statesKeyNumbers(studentMessage, keyed.key)
    && countsKeyWords(earlier.key, keyed.key, keyed.question, studentMessage);
  if (reworded || answersBoth) return { ...onTheEarlier, question: keyed.question, key: keyed.key, reworded: true };
  return { ...onTheEarlier, on: "earlier", checkQuestion: keyed.question };
}

/**
 * The verdict on an answer to a hint's own question when the message the hint was asked on has no key (checkAnswer):
 * the hint's question is the only one open. Code's match with its key is "correct"; else, when the hint ends on its
 * question (endsOnQuestion), the grader's verdict. Right or partly right is tagged `on: "hint"`, as any answer to a
 * hint's question is (no mark, and no question of the check's to ask again: hintAnswerBack); wrong is the hint
 * question's "incorrect", untagged, and the reply goes on from it. A hint with no key, or feedback after its question
 * and no match by code, gets no verdict.
 */
async function hintOnly(hintReply: string, studentMessage: string, config: LLMConfig, opts: CallOpts): Promise<AnswerCheck | null> {
  const hinted = await answerKey(hintReply, config, opts);
  if (hinted === null) return { question: "", key: "", verdict: "unsure", by: "failed" };
  if (hinted === "none") return null;
  const hintKey = { question: hinted.question, key: hinted.key };
  const ctx = { question: hintKey.question, options: optionsIn(hintReply) };
  const raw = compareToKey(hintKey.key, studentMessage, ctx);
  const check: AnswerCheck | null = raw === "match" ? { ...hintKey, verdict: "correct", by: "code" }
    : endsOnQuestion(hintReply) ? await graded(hintKey, ctx, raw, studentMessage, config, opts) : null;
  if (!check || check.verdict === "incorrect" || check.verdict === "unsure") return check;
  return { ...check, on: "hint", checkQuestion: "" };
}

// A key without answerKey's `offer` flag, which only the check's own question reads.
const keyOnly = (k: Awaited<ReturnType<typeof answerKey>>) => (k && k !== "none" ? { question: k.question, key: k.key } : k);

// The order checkAnswer prefers verdicts in when an answer is graded on two questions. "unsure" (a failed call)
// is never preferred.
const VERDICT_RANK: Record<Verdict, number> = { unsure: -1, incorrect: 0, partly: 1, correct: 2 };

// Words that frame a question in the chat rather than say what it asks: "Can you tell me what the cell membrane
// does?" and "So, what do you think the membrane does?" ask one thing.
const ASK_FRAMING = new Set(["think", "know", "remember", "explain", "describe",
  "main", "really", "again", "own", "words", "try", "use"]);
// Nouns that ask what something does: askedWords reads each as "do", so "What is the job of the heart?" and
// "What does the heart do?" ask one thing, as do "So, what job does the membrane do for the cell?" and "Can you
// tell me what the cell membrane does?" (ported from TerraTutor #272). "What is the job of the nucleus?" is not
// "What is the nucleus?".
const DO_NOUNS = new Set(["job", "role", "function"]);
// A negation the stopwords leave out: "Which one is NOT ..." asks another question.
const NEGATION = /\b(?:not|never|no|none|except)\b|n['’]t\b/gi;
// Words that make the order of the others part of the question: "Is the sun bigger than the earth?" and "Is the
// earth bigger than the sun?" share every word. "from" counts only with a "to" after it.
const ORDER_WORD = /\b(?:than|before|after|or|between)\b|\bfrom\b.*\bto\b/i;

// Stopwords that say what is asked, so askedWords keeps them (OpenEdu #410's take-back, inbox 2026-11-20-1003;
// ported from TerraTutor #272): "What is a mammal?" / "What does a mammal have?" and "What is in a cell
// membrane?" / "... on a cell membrane?" are two questions. Each verb is kept as one form ("has" / "have" is one
// word: "how many legs a spider has" / "how many legs does a spider have").
const ASKED_VERBS = new Map([["have", "have"], ["has", "have"], ["had", "have"], ["get", "get"], ["gets", "get"],
  ["got", "get"], ["give", "give"], ["gives", "give"], ["gave", "give"], ["make", "make"], ["makes", "make"],
  ["made", "make"], ["show", "show"], ["shows", "show"], ["showed", "show"], ["list", "list"], ["lists", "list"]]);
// An asked verb after one of these, with only dropped words between ("What makes", "Who do you think made"), is
// said of the thing asked for, not of the thing named: "What makes a volcano?" asks what causes one, "What does a
// volcano make?" what it gives out. askedWords keeps such a verb as its own word ("make<"), so the two stay apart
// while "What made the Grand Canyon?" / "What makes the Grand Canyon?" are one (review of this repo's #410
// take-back port, MUST-FIX 1).
const SUBJECT_QUESTION_WORDS = new Set(["what", "who", "which"]);
const ASKED_PREPOSITIONS = new Set(["in", "on"]);
// "how" asks for a way, not a thing: "How do bees make honey?" is not "Do bees make honey?", nor "How are rocks
// made?" "What are rocks made of?".
const ASKED_QUESTION_WORDS = new Set(["how"]);
// A stopword preposition is asked when it ends the question: "What are leaves for?" is not "What are leaves?",
// nor "What is the story about?" "What is the story?". It ends the question when only dropped words follow it
// (framingOnly): "What are leaves for, do you think?" asks what "What are leaves for?" asks (TerraTutor take-back
// 2026-11-20-1103, item 2). Anywhere else it is dropped ("what job does the membrane do for the cell?"). "from" is
// no stopword, so it is always kept.
const ASKED_LAST_PREPOSITIONS = new Set(["for", "of", "about", "with", "to"]);
// "do" is asked ("What does the nucleus do?" is not "What is the nucleus?") where it is the verb: last in the
// question or before one of DO_ASKED_BEFORE ("what job does the membrane do for the cell?"). Before anything
// else it only forms the question ("What do you think ...", "how many legs does a spider have") and is dropped.
// A "do" read the wrong way only keeps two questions apart.
const DO_FORMS = new Set(["do", "does", "did"]);
const DO_ASKED_BEFORE = new Set(["for", "to", "in", "on", "with", "at", "into", "inside", "during", "when", "while",
  "after", "before", "next", "first", "then", "there", "here", "now", "so", "if"]);

// What a question asks, word by word in order: every word token (numbers and single letters kept, so "12 times 3"
// and "12 times 2", "3/4" and "1/2", "the letter A" and "the letter B" differ), folded to its singular, less the
// stopwords and ASK_FRAMING, but with ASKED_VERBS (marked "<" in the subject slot of SUBJECT_QUESTION_WORDS),
// ASKED_PREPOSITIONS, ASKED_QUESTION_WORDS, a last preposition (ASKED_LAST_PREPOSITIONS, framing after it aside) and
// an asked "do" kept, and DO_NOUNS read as "do". A single capital
// letter is kept even where it is a stopword ("Is the letter I a vowel?"); a lowercase "a" or "i" is the article
// or the pronoun.
function askedWords(q: string): string[] {
  const out: string[] = [];
  const tokens = q.replace(/[*_`#>]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  // Where the words that only frame the question start, at its end (", do you think?"), or tokens.length.
  let tail = tokens.length;
  while (tail > 0 && framingOnly(tokens[tail - 1])) tail--;
  let subjectSlot = false;
  for (const [i, t] of tokens.entries()) {
    const w = t.toLowerCase();
    const verb = ASKED_VERBS.get(w);
    const kept = out.length;
    if (t.length === 1 && /\p{Lu}/u.test(t)) out.push(w);
    else if (verb) out.push(subjectSlot ? `${verb}<` : verb);
    else if (ASKED_PREPOSITIONS.has(w) || ASKED_QUESTION_WORDS.has(w)) out.push(w);
    else if (ASKED_LAST_PREPOSITIONS.has(w) && i + 1 >= tail) out.push(w);
    else if (DO_FORMS.has(w)) { if (i === tokens.length - 1 || DO_ASKED_BEFORE.has(tokens[i + 1].toLowerCase())) out.push("do"); }
    else if (DO_NOUNS.has(foldPlural(w))) out.push("do");
    else if (!CONTENT_STOPWORDS.has(w) && !ASK_FRAMING.has(foldPlural(w))) out.push(foldPlural(w));
    if (SUBJECT_QUESTION_WORDS.has(w)) subjectSlot = true;
    else if (out.length > kept) subjectSlot = false;
  }
  return out;
}

/** True when askedWords drops the token wherever it stands: a stopword or ASK_FRAMING word that is not asked
 *  (ASKED_VERBS, ASKED_PREPOSITIONS, ASKED_QUESTION_WORDS, ASKED_LAST_PREPOSITIONS) and not a single capital. */
function framingOnly(t: string): boolean {
  const w = t.toLowerCase();
  if ((t.length === 1 && /\p{Lu}/u.test(t)) || ASKED_VERBS.has(w) || ASKED_PREPOSITIONS.has(w) || ASKED_QUESTION_WORDS.has(w) || ASKED_LAST_PREPOSITIONS.has(w)) return false;
  return CONTENT_STOPWORDS.has(w) || ASK_FRAMING.has(foldPlural(w));
}

/**
 * True when two keyed questions ask the same thing in other words: the same asked words (askedWords: numbers and
 * single letters included), at least one of them, the same numbers in the same order, the same negations, and,
 * when either has an order word ("than", "or", "before", "after", "between", "from ... to"), the same words in
 * the same order. Strict on purpose: a question that adds a word ("... keep out of the cell?" after "What does
 * the cell membrane do?"), another verb or preposition ("What does a mammal have?" after "What is a mammal?",
 * "on" after "in", "What are leaves for?" after "What are leaves?"), a "how" ("How do bees make honey?" after
 * "Do bees make honey?"), another number ("12 times 2" after "12 times 3") or another order ("the earth bigger than
 * the sun") is another question, and two questions are then graded apart as before (`on: "earlier"`).
 * checkAnswer also needs the two keys to give one answer (keysAgree) before it merges.
 */
export function rewordsQuestion(a: string, b: string): boolean {
  const negations = (q: string) => (q.toLowerCase().match(NEGATION) ?? []).sort().join(" ");
  const numbers = (ws: string[]) => ws.filter((w) => /^\p{N}+$/u.test(w)).join(" ");
  const inOrder = (ws: string[]) => [...new Set(ws)].join(" ");
  const wa = askedWords(a);
  const wb = askedWords(b);
  const sa = new Set(wa);
  const sb = new Set(wb);
  if (!sa.size || sa.size !== sb.size || ![...sa].every((w) => sb.has(w))) return false;
  if (numbers(wa) !== numbers(wb) || negations(a) !== negations(b)) return false;
  return !(ORDER_WORD.test(a) || ORDER_WORD.test(b)) || inOrder(wa) === inOrder(wb);
}

// A key's yes or no, as a leading word ("Yes", "No, it is smaller", "True"), or null.
function yesNo(key: string): "yes" | "no" | null {
  const m = /^[\W_]*(yes|true|no|false)\b/i.exec(key);
  return m ? (/^(?:yes|true)$/i.test(m[1]) ? "yes" : "no") : null;
}

const normKey = (s: string) => s.toLowerCase().replace(/[*_`"“”'’.,!?;:()]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:the|a|an) /, "");

/** True when two keys are the same once case, punctuation, spacing and a leading article are set aside ("1/2", "1/2."),
 *  but not a feet, inch or factorial mark after a number (numberMarks: "5'" / "5\"", "5!" / "5"). */
function sameKey(a: string, b: string): boolean {
  return !!normKey(a) && normKey(a) === normKey(b) && numberMarks(a) === numberMarks(b);
}

/**
 * True when two keys give one answer: the same once case, punctuation and an article are set aside and plurals folded
 * as quiz-grading.ts sameAnswer folds them ("3 blocks" / "3 block"), or the same numbers in the same order (a
 * fraction's two numbers too: "3/8", "$\frac{3}{8}$") with the same symbols beside them in the same order (keySymbols:
 * not "4 cm" / "4 cm²", "3 × 4" / "3 + 4", "50%" / "50", "$4" / "4 cents", "4 > 3" / "4 < 3"), the same negations,
 * no yes/no on one side that the other contradicts, and every other word of one key in the other ("4" / "4 pieces",
 * "3" / "3 blocks", "4 cm" / "4 square cm"; not "4 pieces" / "4 blocks", "3/4" / "4/3", "4 cm" / "4 m", "4" / "not
 * 4"). A word only one key has can still change what its number means ("4 cm" / "4 square cm"): checkAnswer merges
 * two questions on such keys only when the newest question counts that word (countsKeyWords). TerraTutor live test
 * 2026-11-20 part 12, issue 1: the move-on question's key "4 pieces" was not the first question's "4", and the move-on
 * question the learner had just answered was asked again. Keys are read as plainKey reads them ("$4$" / "4 pieces",
 * "x = 4" / "4", "50%" / "50 percent", "4 > 3" / "4 is greater than 3"; not "x > 3" / "x is greater than or equal to
 * 3", "x = 4" / "y = 4"), and a feet, inch or factorial mark after a number is part of the answer (numberMarks: not
 * "5'" / "5\"", "5!" / "5"; TerraTutor take-back 2026-11-20-1623, items 2-4, ported from TerraTutor #276). Exact on
 * purpose: keys in other words are two answers here.
 */
export function keysAgree(a: string, b: string): boolean {
  if (numberMarks(a) !== numberMarks(b)) return false;
  const [ua, ub] = [unknownIn(a), unknownIn(b)];
  if (ua && ub && ua !== ub) return false;
  if (sameKey(a, b) || (!!normKey(a) && sameAnswer(normKey(a), normKey(b)))) return true;
  const na = numbersIn(plainKey(a)).map((n) => n.value);
  const nb = numbersIn(plainKey(b)).map((n) => n.value);
  if (!na.length || na.length !== nb.length || na.some((v, i) => Math.abs(v - nb[i]) > 1e-9)) return false;
  const negations = (k: string) => (k.toLowerCase().match(NEGATION) ?? []).sort().join(" ");
  if (negations(a) !== negations(b) || yesNo(a) !== yesNo(b) || keySymbols(a) !== keySymbols(b)) return false;
  const [ra, rb] = [keyWords(a), keyWords(b)];
  const [fewer, more] = ra.size <= rb.size ? [ra, rb] : [rb, ra];
  return [...fewer].every((w) => more.has(w));
}

/** A key read as plain text: LaTeX math as written out ("$\frac{3}{8}$" is "3/8", "$4$" "4", "\times" and "\cdot"
 *  "×", "\div" "÷"; money stays money: "$4 and $5", "$4.50"), an "x", "*" or "·" between two numbers is "×" ("3 x 4"
 *  is "3 × 4", a "**" between two numbers is "^": "2 ** 3" is "2^3"), formatting left out ("**4**" is "4", "x = 4"
 *  and "n = 4" are "4", the en dash and the minus sign are "-", "′" and "″" are "'" and '"'), and a closed set of
 *  words read as their symbols: "50 percent" is "50%", "90 degrees" "90°", "4.50 dollars" "$4.50", "is greater than"
 *  ">", "is less than" "<" (not "is greater than or equal to": those words stay words, another answer than ">" and
 *  "≥"). No other word is a symbol. */
function plainKey(k: string): string {
  return k.replace(/\$([^$]*\\[^$]*)\$/g, "$1")
    .replace(/\$(?=\S)([^$]*?\S)\$(?!\d)/g, "$1")
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\(?:times|cdot)\b/g, "×").replace(/\\div\b/g, "÷")
    .replace(/(?<=\d\s*)\*\*(?=\s*\d)/g, "^").replace(/(?<=\d\s*)[x*·](?=\s*\d)/gi, "×")
    .replace(/[*_]/g, " ").replace(/[–−]/g, "-").replace(/′/g, "'").replace(/″/g, '"')
    .replace(/^\s*[a-z]\s*=\s*(?=\S)/i, "")
    .replace(/(\d)\s*per\s?cent\b/gi, "$1%").replace(/(\d)\s*degrees?\b/gi, "$1°")
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*dollars?\b/gi, "$$$1")
    .replace(/\s*\bis greater than\b(?!\s+or\s+equal)\s*/gi, " > ")
    .replace(/\s*\bis less than\b(?!\s+or\s+equal)\s*/gi, " < ");
}

/** The letter a key assigns to ("x" in "x = 4", "$x = 4$", "**x** = 4"), or "". Keys for two unknowns ("x = 4" /
 *  "y = 4", "$x = 4$" / "$y = 4$") are two answers. Read with math dollars and formatting gone, since plainKey drops
 *  both and then the "x = " too. */
function unknownIn(k: string): string {
  return /^\s*([a-z])\s*=/i.exec(k.replace(/[$*_]/g, ""))?.[1].toLowerCase() ?? "";
}

/** A key's feet, inch and factorial marks straight after a number ("5'", "5″", "5!", "5'6\""), in order. Each is
 *  another answer ("5'" / "5\"", "5!" / "5"), and normKey and keySymbols drop them, so keysAgree checks them first.
 *  A quote around a word or number ("'four'", "\"4\"") is not a mark. */
function numberMarks(k: string): string {
  const unquoted = k.replace(/(^|[\s(\[:=])(['"“‘])([^'"“”‘’]*)(?:\2|[”’])(?=$|[\s.,;:!?)\]])/g, "$1$3");
  return [...unquoted.matchAll(/\d(['′"″!])(?!\p{L})/gu)].map((m) => (m[1] === "′" ? "'" : m[1] === "″" ? '"' : m[1])).join("");
}

/** A key's text, as plainKey reads it, with its numbers (numbersIn) taken out. */
function keyBesideNumbers(k: string): string {
  let text = plainKey(k);
  for (const n of numbersIn(text).reverse()) text = `${text.slice(0, n.from)} ${text.slice(n.to)}`;
  return text;
}

/** A key's words beside its numbers, single letters kept ("4 m"), stopwords and "frac" (LaTeX) left out, folded to the singular (foldPlural). */
function keyWords(k: string): Set<string> {
  return new Set((keyBesideNumbers(k).toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => !CONTENT_STOPWORDS.has(w) && w !== "frac").map(foldPlural));
}

/** A key's symbols beside its numbers, in order: every character that is not a letter, a space or punctuation
 *  ("×", "+", "²", "%", "$", "<", "/", "°"; a "-" between two letters is a hyphen and left out). Each changes what
 *  the numbers mean, so keys whose symbols differ are two answers (keysAgree). */
function keySymbols(k: string): string {
  return (keyBesideNumbers(k).replace(/(?<=\p{L})-(?=\p{L})/gu, " ").match(/[^\p{L}\s.,;:!?'"“”‘’()[\]{}\\]/gu) ?? []).join("");
}

/** The words a "how many" or "how much" in `question` counts: up to three words after it, to its first stopword,
 *  folded to the singular ("pieces" in "how many pieces do we have?", "total" and "blocks" in "how many total blocks
 *  do you have?"). A count names what it counts, so "4" and "4 pieces" answer it alike. */
function countedWords(question: string): Set<string> {
  const out = new Set<string>();
  for (const m of question.toLowerCase().matchAll(/\bhow\s+(?:many|much)\s+((?:\p{L}+\s*){1,3})/gu)) {
    for (const w of m[1].split(/\s+/).filter(Boolean)) {
      if (CONTENT_STOPWORDS.has(w)) break;
      out.add(foldPlural(w));
    }
  }
  return out;
}

/** True when every word one key has and the other does not (keyWords) is a word the newest question counts
 *  (countedWords), or, for a word only the newest key has, is in the learner's message, plurals folded. Any other
 *  such word can change what the number means ("tens" in "4 tens", "square" in "4 square cm"), and the keys are then
 *  two answers: "4 cm", right for a square's perimeter, does not answer "What is the area ...?" keyed "4 square cm",
 *  and "4 square cm" does not answer a perimeter question keyed "4 cm". */
function countsKeyWords(first: string, newest: string, newestQuestion: string, student: string): boolean {
  const [had, has] = [keyWords(first), keyWords(newest)];
  const counted = countedWords(newestQuestion);
  const said = new Set((student.toLowerCase().match(/\p{L}+/gu) ?? []).map(foldPlural));
  return [...had].every((w) => has.has(w) || counted.has(w)) && [...has].every((w) => had.has(w) || counted.has(w) || said.has(w));
}

/** True when the student's message states every number in `key` (or the key has none). */
function statesKeyNumbers(student: string, key: string): boolean {
  const theirs = numbersIn(student).map((n) => n.value);
  return numbersIn(key).every((n) => theirs.some((v) => Math.abs(v - n.value) <= 1e-9));
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
// "That is exactly right." too: the tutor's move-on code asks again after an `on: "earlier"` verdict opens
// with it (TerraTutor live test 2026-11-20 part 10), and kept, it said "right" under "That's partly right.".
const PRAISE_WORD = /^\W*(?:correct|right|yes|yep|yeah|great|good|nice|awesome|perfect|excellent|exactly|well done|that(?:'|’)?s (?:exactly |absolutely |totally )?(?:right|correct)|that is (?:exactly |absolutely |totally )?(?:right|correct)|you got it)/i;
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
  // With no open question (the message before the hint asked nothing to check, hintOnly), nothing is asked again.
  const open = check.on === "hint" && !check.checkQuestion
    ? "That was the hint's question. Do not say the check is done.\n"
    : check.on === "hint"
    ? `That was the hint's question, not the check's. The check's question is still open${check.checkQuestion ? `: ${check.checkQuestion}` : ""}\nThe app asks it again after your reply. Do not ask it, do not give its answer, and do not say the check is done.\n`
    : check.on === "earlier"
      ? `That answers the check's first question, not the last one you asked. Your last question is still open${check.checkQuestion ? `: ${check.checkQuestion}` : ""}\nThe app asks it again after your reply. Do not ask it, do not give its answer, and do not say the check is done.\n`
      : "";
  return `<tutor_note>\n${question}${body}\n${open}Do not say the student has mastered anything unless the app has saved it. Do not mention this note.\n</tutor_note>`;
}

export function withAnswerCheckNote(userContent: string, check: AnswerCheck): string {
  return `${userContent}\n\n${answerCheckNote(check)}`;
}
