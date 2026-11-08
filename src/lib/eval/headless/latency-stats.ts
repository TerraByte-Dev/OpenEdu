// B7 (CPU latency) accounting: what one turn cost, and the percentiles over a run. Pure: no I/O.
// The driver is latency.ts; the request log it reads is latency-tap.ts.

import type { TapCall } from "./latency-tap";

/** The five turn kinds B7 reports, in report order. */
export const B7_TURN_KINDS = ["k12-t1-new-problem", "k12-t2-wrong-try", "k12-t3-show-answer", "notes-en", "notes-hi-gloss"] as const;
export type B7TurnKind = (typeof B7_TURN_KINDS)[number];

/** The budget the run answers: is a warm turn's wall time under this at p50. */
export const B7_BUDGET_MS = 15_000;
/** A request whose load_duration is at least this loaded the model (the rule the L2 results used). */
export const RELOAD_MS = 1_000;

/**
 * Nearest-rank percentile, no interpolation: the smallest value with at least p% of the values at or
 * below it. At n = 5, p50 is the 3rd value and p90 is the 5th, the maximum. Null for no values.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * A notes turn runs through runRagEval, which seeds the vault (one embed per note) before the turn.
 * The turn starts at the first chat request or the first embed of the question itself; everything
 * before that is setup and is not part of the turn's cost.
 */
export function splitSetup(calls: readonly TapCall[], ask: string): { setup: TapCall[]; turn: TapCall[] } {
  const at = calls.findIndex((c) => c.path === "/api/chat" || c.inputs.includes(ask));
  return at < 0 ? { setup: [...calls], turn: [] } : { setup: calls.slice(0, at), turn: calls.slice(at) };
}

/** Where a turn's wall time went. The five parts sum to the wall time; `other` is what is left
 *  (kernel code, tool calls, HTTP, the gloss probe), and is negative only if requests overlapped. */
export interface B7Steps {
  load: number;
  prefill: number;
  generate: number;
  embed: number;
  other: number;
}
export const B7_STEP_NAMES = ["load", "prefill", "generate", "embed", "other"] as const;

export interface B7TurnCost {
  /** Chat requests that were the reply (or a tool-loop step of it). */
  chatCalls: number;
  /** Chat requests with a `format`: callLLMStructured, e.g. the L2 gloss. */
  structuredCalls: number;
  embedCalls: number;
  /** Sum over chat requests of Ollama's prompt_eval_count: tokens evaluated, so cached ones are not counted. */
  promptTokens: number;
  promptEvalMs: number;
  /** promptTokens per second of prompt_eval_duration; null when nothing was timed. */
  promptTokPerSec: number | null;
  outputTokens: number;
  evalMs: number;
  outputTokPerSec: number | null;
  /** Sum of load_duration over every chat and embed request. */
  loadMs: number;
  /** Some request's load_duration was at least RELOAD_MS: a model was loaded during the turn. */
  reload: boolean;
  /** Wall time of the structured (gloss) call; null when there was none. */
  structuredMs: number | null;
  /** Some request ended without Ollama's final timing fields (aborted, failed, or not JSON). */
  incomplete: boolean;
  steps: B7Steps;
}

const n0 = (v: number | null) => v ?? 0;
const rate = (count: number, ms: number) => (ms > 0 ? Math.round((count / ms) * 10_000) / 10 : null);

export function turnCost(calls: readonly TapCall[], wallMs: number): B7TurnCost {
  const chat = calls.filter((c) => c.path === "/api/chat");
  const structured = chat.filter((c) => c.kind === "structured");
  const embeds = calls.filter((c) => c.path === "/api/embed");
  const sum = (xs: readonly TapCall[], f: (c: TapCall) => number | null) => xs.reduce((a, c) => a + n0(f(c)), 0);

  const promptTokens = sum(chat, (c) => c.promptEvalCount);
  const promptEvalMs = sum(chat, (c) => c.promptEvalMs);
  const outputTokens = sum(chat, (c) => c.evalCount);
  const evalMs = sum(chat, (c) => c.evalMs);
  const loadMs = sum(calls, (c) => c.loadMs);
  const embed = sum(embeds, (c) => (c.ms === null ? null : c.ms - n0(c.loadMs)));
  return {
    chatCalls: chat.length - structured.length,
    structuredCalls: structured.length,
    embedCalls: embeds.length,
    promptTokens,
    promptEvalMs,
    promptTokPerSec: rate(promptTokens, promptEvalMs),
    outputTokens,
    evalMs,
    outputTokPerSec: rate(outputTokens, evalMs),
    loadMs,
    reload: calls.some((c) => n0(c.loadMs) >= RELOAD_MS),
    structuredMs: structured.length ? sum(structured, (c) => c.ms) : null,
    incomplete: calls.some((c) => c.ms === null || (c.path === "/api/chat" ? c.evalMs === null : c.loadMs === null)),
    steps: { load: loadMs, prefill: promptEvalMs, generate: evalMs, embed, other: wallMs - loadMs - promptEvalMs - evalMs - embed },
  };
}

/** One measured turn, as the results file holds it. */
export interface B7TurnRow {
  kind: B7TurnKind;
  /** 0 is the cold repeat (every model unloaded from the CPU server first); 1..N are warm. */
  rep: number;
  /** The harness unloaded every model right before THIS turn, and /api/ps confirmed it. Only the
   *  first turn of a cold repeat; its T2 and T3 run on a model the T1 just loaded. */
  cold: boolean;
  /** The k12 item id or the notes question id. */
  item: string;
  user: string;
  reply: string;
  stopReason: string | null;
  /** Set when the turn produced no usable reply (an ERROR row). Excluded from the percentiles. */
  error: string | null;
  /** From the start of the turn to the first streamed text, as the runners measure it. */
  ttftMs: number | null;
  wallMs: number;
  /** /api/ps right before the turn: was each model resident on the CPU server. */
  residentBefore: { chat: boolean; embed: boolean };
  /** L2 gloss outcome for a glossed turn (the grounding trace), else null. */
  gloss: { text: string | null; ms: number; error?: string } | null;
  /** k12 turns: the kernel's report that the system prompt ended with the worked-answer rules (T3
   *  gets them only when the show-answer chip was offered). Null for notes turns. */
  workedAnswerRules: boolean | null;
  cost: B7TurnCost;
  /** Every chat and embed request of the turn, in order. */
  calls: TapCall[];
}

export interface Spread {
  n: number;
  p50: number | null;
  p90: number | null;
  max: number | null;
}

export function spread(values: readonly number[]): Spread {
  return { n: values.length, p50: percentile(values, 50), p90: percentile(values, 90), max: values.length ? Math.max(...values) : null };
}

export interface B7KindSummary {
  kind: B7TurnKind;
  /** Warm repeats (rep >= 1) without an error. Every percentile below is over these. */
  warm: number;
  errors: number;
  wallMs: Spread;
  ttftMs: Spread;
  /** p50 of each step over the warm turns. */
  stepsP50: Record<(typeof B7_STEP_NAMES)[number], number | null>;
  /** The step with the largest p50. */
  slowestStep: (typeof B7_STEP_NAMES)[number] | null;
  promptTokensP50: number | null;
  promptTokPerSecP50: number | null;
  outputTokensP50: number | null;
  outputTokPerSecP50: number | null;
  /** Mean chat + structured calls per warm turn. */
  modelCallsMean: number | null;
  structuredMsP50: number | null;
  /** Warm turns in which a model was loaded (load_duration >= RELOAD_MS). B7's bar is 0. */
  warmReloads: number;
  /** Glossed-kind only: warm turns whose gloss came back with an error (e.g. its deadline). */
  glossErrors: number;
  /** p50 wall <= B7_BUDGET_MS; null when there were no warm turns. */
  underBudget: boolean | null;
  /** The cold turn(s) of this kind, as measured. */
  cold: Array<{ item: string; wallMs: number; ttftMs: number | null; loadMs: number; error: string | null }>;
}

export interface B7Summary {
  budgetMs: number;
  kinds: B7KindSummary[];
  /** Every kind with warm turns is under budget at p50. Null when no kind had warm turns. */
  allUnderBudget: boolean | null;
  /** The kind with the largest warm p50 wall time, and its slowest step. */
  slowestKind: { kind: B7TurnKind; wallP50: number; slowestStep: string | null } | null;
  /** The cold-start first turn: the cold k12 T1 (nothing resident, then a new problem). */
  coldStart: { wallMs: number; ttftMs: number | null; loadMs: number; error: string | null } | null;
}

export function summarizeB7(rows: readonly B7TurnRow[], budgetMs = B7_BUDGET_MS): B7Summary {
  const kinds = B7_TURN_KINDS.map((kind): B7KindSummary => {
    const mine = rows.filter((r) => r.kind === kind);
    const warmAll = mine.filter((r) => r.rep >= 1);
    const warm = warmAll.filter((r) => r.error === null);
    const p50 = (f: (r: B7TurnRow) => number | null) => percentile(warm.flatMap((r) => { const v = f(r); return v === null ? [] : [v]; }), 50);
    const stepsP50 = Object.fromEntries(B7_STEP_NAMES.map((s) => [s, p50((r) => r.cost.steps[s])])) as B7KindSummary["stepsP50"];
    const ranked = B7_STEP_NAMES.filter((s) => stepsP50[s] !== null).sort((a, b) => stepsP50[b]! - stepsP50[a]!);
    const wallMs = spread(warm.map((r) => r.wallMs));
    return {
      kind,
      warm: warm.length,
      errors: warmAll.length - warm.length,
      wallMs,
      ttftMs: spread(warm.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]))),
      stepsP50,
      slowestStep: ranked[0] ?? null,
      promptTokensP50: p50((r) => r.cost.promptTokens),
      promptTokPerSecP50: p50((r) => r.cost.promptTokPerSec),
      outputTokensP50: p50((r) => r.cost.outputTokens),
      outputTokPerSecP50: p50((r) => r.cost.outputTokPerSec),
      modelCallsMean: warm.length ? warm.reduce((a, r) => a + r.cost.chatCalls + r.cost.structuredCalls, 0) / warm.length : null,
      structuredMsP50: p50((r) => r.cost.structuredMs),
      warmReloads: warm.filter((r) => r.cost.reload).length,
      glossErrors: warm.filter((r) => r.gloss?.error !== undefined).length,
      underBudget: wallMs.p50 === null ? null : wallMs.p50 <= budgetMs,
      cold: mine.filter((r) => r.cold).map((r) => ({ item: r.item, wallMs: r.wallMs, ttftMs: r.ttftMs, loadMs: r.cost.loadMs, error: r.error })),
    };
  });
  const measured = kinds.filter((k) => k.wallMs.p50 !== null);
  const slowest = [...measured].sort((a, b) => b.wallMs.p50! - a.wallMs.p50!)[0];
  const cs = rows.find((r) => r.kind === "k12-t1-new-problem" && r.cold);
  return {
    budgetMs,
    kinds,
    allUnderBudget: measured.length ? measured.every((k) => k.underBudget) : null,
    slowestKind: slowest ? { kind: slowest.kind, wallP50: slowest.wallMs.p50!, slowestStep: slowest.slowestStep } : null,
    coldStart: cs ? { wallMs: cs.wallMs, ttftMs: cs.ttftMs, loadMs: cs.cost.loadMs, error: cs.error } : null,
  };
}
