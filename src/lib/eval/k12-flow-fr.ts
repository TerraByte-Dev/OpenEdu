// The k12-flow-fr driver: k12-flow's attempt-first conversation on typed problems with no options
// (docs/BENCHMARKS.md B3/B4, "k12-flow-fr"). Pure: the model turn is passed in.
//
// Each item is one three-turn conversation, run the way a student would run it in ChatTab:
//   T1  the problem as a student types it (item.ask): no options, no "Which one is right?"
//   T2  a scripted wrong try, "I think it's 15 beads.": the source item's option at k12-flow's frozen
//       distractor letter (k12-flow-fr-items.ts)
//   T3  SHOW_ANSWER_MESSAGE, the text the "Show me the answer" chip sends
//
// The conversation itself (history as ChatTab saves it, the chip check after T2, the retry rule) is
// k12-flow's own runK12FlowConversation, so the two flows build their turns the same way. Only the
// user turns and the detectors (k12-flow-fr-grade.ts) differ.

import { K12_FLOW_T3, runK12FlowConversation, type K12FlowTurnFn, type K12FlowTurnRecord } from "./k12-flow";
import { gradeK12FlowFr, summarizeK12FlowFr, type K12FlowFrGrade, type K12FlowFrSummary } from "./k12-flow-fr-grade";
import type { K12FrItem } from "./k12-flow-fr-items";

export function formatK12FlowFrT1(item: Pick<K12FrItem, "ask">): string {
  return item.ask;
}

export function formatK12FlowFrT2(item: Pick<K12FrItem, "attempt">): string {
  return `I think it's ${item.attempt}.`;
}

export interface K12FlowFrRow {
  id: string;
  /** The k12-mc item the problem was rewritten from. */
  source: string;
  /** The key's option text, and the number T2 claims. */
  key: string;
  attempted: string;
  turns: K12FlowTurnRecord[];
  studentAttempted: boolean | null;
  chipOffered: boolean | null;
  workedAnswerTurn: boolean | null;
  t3WorkedAnswerRules: boolean | null;
  /** Null for an ERROR row. */
  grade: K12FlowFrGrade | null;
}

/** Run one item's three turns and grade them. A failed turn is an ERROR row; only K12FlowAbort throws. */
export async function runK12FlowFrItem(item: K12FrItem, turn: K12FlowTurnFn<K12FrItem>, now: () => number = Date.now): Promise<K12FlowFrRow> {
  const { texts, ...conv } = await runK12FlowConversation(item, [formatK12FlowFrT1(item), formatK12FlowFrT2(item), K12_FLOW_T3], turn, now);
  const grade = texts ? gradeK12FlowFr(item, { t1: texts[0], t2: texts[1], t3: texts[2] }) : null;
  return { id: item.id, source: item.source, key: item.key, attempted: item.attempt, ...conv, grade };
}

export interface K12FlowFrResult {
  rows: K12FlowFrRow[];
  summary: K12FlowFrSummary;
}

/** Run the flow over `items`, one at a time, and summarise. `onRow` sees each row as it completes. */
export async function runK12FlowFr(
  items: readonly K12FrItem[],
  turn: K12FlowTurnFn<K12FrItem>,
  opts: { now?: () => number; onRow?: (row: K12FlowFrRow) => void } = {},
): Promise<K12FlowFrResult> {
  const rows: K12FlowFrRow[] = [];
  for (const item of items) {
    const row = await runK12FlowFrItem(item, turn, opts.now);
    rows.push(row);
    opts.onRow?.(row);
  }
  return { rows, summary: summarizeK12FlowFr(rows) };
}
