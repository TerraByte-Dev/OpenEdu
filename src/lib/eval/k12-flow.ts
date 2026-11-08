// The k12-flow benchmark driver (docs/BENCHMARKS.md B3 + B4). Pure: the model turn is passed in.
//
// Each item is one three-turn conversation, run the way a student would run it in ChatTab:
//   T1  the stem, the four lettered options, and "Which one is right?"
//   T2  a scripted wrong try, "I think it's C.": the first non-key letter after the key, cyclic
//   T3  SHOW_ANSWER_MESSAGE, the text the "Show me the answer" chip sends
//
// History between turns is built exactly as ChatTab builds it (persistedReply), and after T2 the
// chip check calls hasTriedOpenQuestion and suggestFollowUps with the arguments ChatTab passes. T3 is
// sent whether or not the chip was offered: the chip is recorded, not conditioned on. The kernel gives
// T3 the worked-answer rules only when the chip was offered (isWorkedAnswerTurn); each row records
// that gate too, and it must equal chipOffered.
//
// `runK12Flow` takes the model turn as a function, so the webview runner (k12-flow-runner.ts, which
// drives the real kernel) and a headless runner can both call it. The turn function owns the system
// prompt; this file owns the user turns, the history, the timing and the grading.

import type { K12Item, K12Key } from "./k12-items";
import type { GroundingHit } from "../kernel/ground";
import { SHOW_ANSWER_MESSAGE, hasTriedOpenQuestion, suggestFollowUps } from "../kernel/suggestions";
import { isWorkedAnswerTurn } from "../kernel/outputRules";
import { persistedReply } from "../kernel/persistedReply";
import { gradeK12Flow, summarizeK12Flow, type K12FlowGrade, type K12FlowSummary } from "./k12-flow-grade";

const LETTERS: readonly K12Key[] = ["A", "B", "C", "D"];

export const K12_FLOW_QUESTION = "Which one is right?";
/** T3 is the chip's own text, imported so the two can never drift apart. */
export const K12_FLOW_T3 = SHOW_ANSWER_MESSAGE;

/** A turn that produced no reply (it threw, stalled, aborted, or came back empty) is retried once,
 *  as in k12-mc. A reply, right or wrong, never is. An empty reply would otherwise pass G1 and G2. */
export const K12_FLOW_MAX_ATTEMPTS = 2;

export function formatK12FlowT1(item: K12Item): string {
  const [a, b, c, d] = item.options;
  return `${item.stem}\n\nA) ${a}\nB) ${b}\nC) ${c}\nD) ${d}\n\n${K12_FLOW_QUESTION}`;
}

/** The frozen distractor rule: the first letter after the key, wrapping D to A. */
export function scriptedWrongLetter(key: K12Key): K12Key {
  return LETTERS[(LETTERS.indexOf(key) + 1) % LETTERS.length];
}

export function formatK12FlowT2(item: K12Item): string {
  return `I think it's ${scriptedWrongLetter(item.key)}.`;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What a model turn hands back. `stopReason` uses the kernel's values ("complete", "length",
 *  "stalled", "aborted", "max_iterations"). `ttftMs` is the time to the first text chunk, measured
 *  by the turn function because only it sees the stream; null if no text arrived. */
export interface K12FlowTurnOutput {
  text: string;
  stopReason: string;
  hits: GroundingHit[];
  usedHits: GroundingHit[];
  ttftMs: number | null;
  /** Tool calls the turn made. Not graded (the detectors read `text` only); kept for hand labels,
   *  because a math.render call can show an expression the text only refers to. */
  toolCalls?: Array<{ name: string; args: unknown }>;
  /** The kernel's report that this turn's system prompt ended with the worked-answer rules. */
  workedAnswerRules?: boolean;
  /** The kernel's report that this turn appended the first-turn hold note to the student's message. */
  firstTurnHold?: boolean;
}

/** One model turn. `messages` is the conversation so far, ending with the new user message,
 *  without a system message; `item` lets the caller build that item's system prompt. It throws
 *  when the turn fails. */
export type K12FlowTurnFn<I extends K12FlowSubject = K12Item> = (messages: ChatMessage[], item: I) => Promise<K12FlowTurnOutput>;

/** What a turn function may read from an item: its id, and its subject (the course topic). The
 *  multiple-choice items and the free-response items (k12-flow-fr.ts) both have these. */
export type K12FlowSubject = Pick<K12Item, "id" | "subject">;

export interface K12FlowTurnRecord {
  user: string;
  text: string;
  stopReason: string | null;
  ttftMs: number | null;
  totalMs: number;
  /** 1, or 2 when the first attempt produced no reply. */
  attempts: number;
  hitTitles: string[];
  toolCalls: Array<{ name: string; args: unknown }>;
  /** Set when the turn still produced no reply on its last attempt. */
  error: string | null;
  /** The kernel's report that this turn got the first-turn hold note (attemptFirst.ts). Null if the
   *  turn produced no reply or the turn function does not report it. */
  firstTurnHold: boolean | null;
}

export interface K12FlowRow {
  id: string;
  key: K12Key;
  /** The letter T2 claims. */
  attempted: K12Key;
  turns: K12FlowTurnRecord[];
  /** hasTriedOpenQuestion before T2, as ChatTab computes it. Null if T2 never ran. */
  studentAttempted: boolean | null;
  /** suggestFollowUps offered "Show me the answer" after T2. Null if T2 did not finish. */
  chipOffered: boolean | null;
  /** The gate function the kernel uses (isWorkedAnswerTurn), evaluated here by the driver on its own
   *  copy of T3's conversation. It is a pure function of that history, so it must equal chipOffered,
   *  but it is not read from the kernel: see t3WorkedAnswerRules for what T3 was actually sent. Null
   *  if T2 did not finish. */
  workedAnswerTurn: boolean | null;
  /** From the kernel's own T3 result: the system prompt T3 sent ended with WORKED_ANSWER_RULES
   *  (before the tools manifest). Null if T3 did not finish or the turn function does not report it. */
  t3WorkedAnswerRules: boolean | null;
  /** Null for an ERROR row: some turn produced no reply twice, and later turns were not run. */
  grade: K12FlowGrade | null;
}

/** Thrown by a turn function to end the whole run (a guard tripped). Every other throw is a failed
 *  turn: retried once, then an ERROR row. */
export class K12FlowAbort extends Error {}

const failedStop = (s: string) => s === "stalled" || s === "aborted";

async function runTurn<I extends K12FlowSubject>(turn: K12FlowTurnFn<I>, messages: ChatMessage[], item: I, now: () => number): Promise<{ rec: K12FlowTurnRecord; out: K12FlowTurnOutput | null }> {
  const user = messages[messages.length - 1].content;
  const rec: K12FlowTurnRecord = { user, text: "", stopReason: null, ttftMs: null, totalMs: 0, attempts: 0, hitTitles: [], toolCalls: [], error: null, firstTurnHold: null };
  for (let attempt = 1; attempt <= K12_FLOW_MAX_ATTEMPTS; attempt++) {
    rec.attempts = attempt;
    const started = now();
    try {
      const out = await turn(messages, item);
      rec.totalMs = now() - started;
      rec.text = out.text;
      rec.stopReason = out.stopReason;
      rec.ttftMs = out.ttftMs;
      rec.hitTitles = out.hits.map((h) => h.title);
      rec.toolCalls = out.toolCalls ?? [];
      rec.firstTurnHold = out.firstTurnHold ?? null;
      if (failedStop(out.stopReason)) rec.error = `turn ${out.stopReason}`;
      else if (!out.text.trim()) rec.error = "empty reply";
      else {
        rec.error = null;
        return { rec, out };
      }
    } catch (e) {
      if (e instanceof K12FlowAbort) throw e;
      rec.totalMs = now() - started;
      rec.stopReason = null;
      rec.firstTurnHold = null;
      rec.error = e instanceof Error ? e.message : String(e);
    }
  }
  return { rec, out: null };
}

/** The ungraded part of a row: the three turns as sent and answered, and the chip check. */
export interface K12FlowConversation {
  turns: K12FlowTurnRecord[];
  studentAttempted: boolean | null;
  chipOffered: boolean | null;
  workedAnswerTurn: boolean | null;
  t3WorkedAnswerRules: boolean | null;
  /** The three reply texts, or null when some turn produced no reply twice (an ERROR row). */
  texts: [string, string, string] | null;
}

/**
 * Send `users` (T1, T2, T3) one at a time, with the history ChatTab would hold between them, and run
 * ChatTab's chip check after T2. The multiple-choice flow (runK12FlowItem) and the free-response flow
 * (k12-flow-fr.ts) both run their turns through this, so the two cannot drift apart in how a
 * conversation is built. A failed turn ends the conversation; only K12FlowAbort throws.
 */
export async function runK12FlowConversation<I extends K12FlowSubject>(
  item: I,
  users: readonly [string, string, string],
  turn: K12FlowTurnFn<I>,
  now: () => number = Date.now,
): Promise<K12FlowConversation> {
  const conv: K12FlowConversation = { turns: [], studentAttempted: null, chipOffered: null, workedAnswerTurn: null, t3WorkedAnswerRules: null, texts: null };
  const history: ChatMessage[] = [];
  const texts: string[] = [];

  for (let i = 0; i < users.length; i++) {
    const userMsg: ChatMessage = { role: "user", content: users[i] };
    // ChatTab computes this from the history before the send, plus the new message.
    const studentAttempted = hasTriedOpenQuestion([...history, userMsg]);
    if (i === 1) conv.studentAttempted = studentAttempted;
    history.push(userMsg);
    const { rec, out } = await runTurn(turn, [...history], item, now);
    conv.turns.push(rec);
    if (!out) return conv;
    texts.push(out.text);
    const saved = persistedReply(out.text, out.stopReason);
    if (saved !== null) history.push({ role: "assistant", content: saved });
    if (i === 1) {
      const chips = suggestFollowUps({
        answer: out.text,
        syllabus: null,
        hits: out.hits,
        usedHits: out.usedHits,
        // The eval course is never created, so it has no flashcards; ChatTab would count 0.
        dueFlashcards: 0,
        abandoned: false,
        truncated: out.stopReason === "length",
        studentAttempted,
      });
      conv.chipOffered = chips.some((c) => c.message === SHOW_ANSWER_MESSAGE);
      conv.workedAnswerTurn = isWorkedAnswerTurn([...history, { role: "user", content: K12_FLOW_T3 }]);
    }
    if (i === 2) conv.t3WorkedAnswerRules = out.workedAnswerRules ?? null;
  }
  conv.texts = [texts[0], texts[1], texts[2]];
  return conv;
}

/** Run one item's three turns and grade them. A failed turn is an ERROR row; only K12FlowAbort throws. */
export async function runK12FlowItem(item: K12Item, turn: K12FlowTurnFn, now: () => number = Date.now): Promise<K12FlowRow> {
  const attempted = scriptedWrongLetter(item.key);
  const { texts, ...conv } = await runK12FlowConversation(item, [formatK12FlowT1(item), formatK12FlowT2(item), K12_FLOW_T3], turn, now);
  const grade = texts ? gradeK12Flow(item, { t1: texts[0], t2: texts[1], t3: texts[2] }, attempted) : null;
  return { id: item.id, key: item.key, attempted, ...conv, grade };
}

export interface K12FlowResult {
  rows: K12FlowRow[];
  summary: K12FlowSummary;
}

/**
 * Run the flow over `items`, one item at a time, and summarise. The plain entry point: the caller
 * supplies the model turn. `onRow` sees each row as it completes, so a crash does not lose the run.
 */
export async function runK12Flow(
  items: readonly K12Item[],
  turn: K12FlowTurnFn,
  opts: { now?: () => number; onRow?: (row: K12FlowRow) => void } = {},
): Promise<K12FlowResult> {
  const rows: K12FlowRow[] = [];
  for (const item of items) {
    const row = await runK12FlowItem(item, turn, opts.now);
    rows.push(row);
    opts.onRow?.(row);
  }
  return { rows, summary: summarizeK12Flow(rows) };
}
