// The k12-flow runner for the webview: the attempt-first flow (k12-flow.ts) through the real kernel,
// configured as ChatTab runs a turn (retrieval "always", tools as detected, the "explain" skill plus
// the subject's domain skill, and ChatTab's system prompt for a course on the item's subject: see
// k12-flow-prompt.ts). Detectors and statistics: k12-flow-grade.ts.
//
// Runs in the Tauri webview (needs Ollama up and a chat model; Library on, no library URL override):
//     await window.__runK12FlowEval({ pilot: true })   // the 12 pilot items
//     const r = await window.__runK12FlowEval()        // the 240 k12-mc items (DEV for this flow)
//     copy(JSON.stringify(r))                          // window.__k12FlowRows holds the rows if this fails
//
// From a terminal, `EVAL_SUITE=k12-flow npm run eval` calls runK12FlowItems below, the same function
// this hook calls (headless/run.ts; options in headless/README.md).
//
// k12-flow-fr, the same flow on typed problems with no options (k12-flow-fr.ts), runs through the same
// turn function: window.__runK12FlowFrEval({ only }) here, `EVAL_SUITE=k12-flow-fr npm run eval` from
// a terminal (runK12FlowFrItems).
//
// The sealed v2 k12 items are the test set. Only the frozen run script reads that file; this runner
// never opens it. That script can call `runK12Flow` (k12-flow.ts) with its own items and turn.
//
// Do not save a source file during a run: Vite HMR reloads the webview and kills it.

import { tutorEngine } from "../kernel";
import { registerBuiltinTools, type ToolContext } from "../tools";
import { loadBuiltinSkills } from "../skills";
import { getChatConfig, getMaxContextTokens } from "../store";
import { callLLMTurn, detectModelProfile } from "../llm";
import { K12_ITEMS, K12_PILOT, type K12Item } from "./k12-items";
import { assertLibraryGuards, watched } from "./k12-runner";
import { k12FlowTurnSetup } from "./k12-flow-prompt";
import { K12FlowAbort, runK12Flow, type K12FlowRow, type K12FlowSubject, type K12FlowTurnFn } from "./k12-flow";
import { runK12FlowFr, type K12FlowFrRow } from "./k12-flow-fr";
import { K12_FR_ITEMS, type K12FrItem } from "./k12-flow-fr-items";
import type { K12FlowFrSummary } from "./k12-flow-fr-grade";
import { k12FlowErrorLimit, median, type K12FlowSummary, type Rate } from "./k12-flow-grade";
import type { LLMConfig } from "../../types";

// Never created, like k12-runner's course: notebook grounding finds nothing, the library is the corpus.
const K12_FLOW_COURSE_ID = "__eval_k12_flow__";

let inFlight = false;

export interface K12FlowReport {
  model: string;
  provider: string;
  contextTokens: number;
  supportsTools: boolean;
  /** True for anything short of all 240 dev items. A partial run is not a result. */
  partial: boolean;
  /** Lever 16's switches this run used (K12FlowArm). */
  arm: K12FlowArm;
  rows: K12FlowRow[];
  summary: K12FlowSummary;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtRate = (r: Rate) => `${r.k}/${r.n}${r.n ? ` (${pct(r.k / r.n)}, 95% Wilson ${pct(r.wilson[0])}-${pct(r.wilson[1])})` : ""}`;

export interface K12FlowSetup {
  config: LLMConfig;
  profile: Awaited<ReturnType<typeof detectModelProfile>>;
  contextTokens: number;
}

/** Tools, skills and the chat configuration, resolved exactly as ChatTab resolves them. */
export async function k12FlowSetup(): Promise<K12FlowSetup> {
  registerBuiltinTools();
  await loadBuiltinSkills();
  const baseConfig = await getChatConfig();
  const profile = await detectModelProfile(baseConfig);
  const contextTokens = baseConfig.provider === "ollama"
    ? Math.min(profile.contextTokens, await getMaxContextTokens())
    : profile.contextTokens;
  return { config: { ...baseConfig, modelTier: profile.tier, contextTokens }, profile, contextTokens };
}

/**
 * One k12-flow turn through the real kernel: the library guards, the item's system prompt and skills
 * (k12-flow-prompt.ts), retrieval "always", under the turn watchdog. runK12FlowItems and runK12FlowFrItems
 * run every T1, T2 and T3 through this; the B7 latency harness (headless/latency.ts) times the same
 * function.
 */
/** Lever 16's paired-arm switches for a k12-flow run (EVAL_COURSE_RULES, EVAL_TEMPERATURE). The default
 *  is the frozen protocol's prompt (no rules block) at the app's temperature. */
export interface K12FlowArm { courseRules: "none" | "code" | "legacy"; temperature: "tutor" | "model-default" }
export const K12_FLOW_DEFAULT_ARM: K12FlowArm = { courseRules: "none", temperature: "tutor" };

export function k12FlowKernelTurn({ config, profile, contextTokens }: K12FlowSetup, arm: K12FlowArm = K12_FLOW_DEFAULT_ARM): K12FlowTurnFn<K12FlowSubject> {
  return async (messages, item) => {
    // A guard tripping mid-run ends the run (void): the shipping configuration went away.
    await assertLibraryGuards().catch((e) => {
      throw new K12FlowAbort(`VOID RUN — ${e instanceof Error ? e.message : String(e)}`);
    });
    const { system, activeSkill, domainSkill } = k12FlowTurnSetup(item, profile.tier, profile.supportsTools, arm.courseRules);
    const started = Date.now();
    let ttftMs: number | null = null;
    const result = await watched((signal) => tutorEngine.run(
      {
        messages: [{ role: "system", content: system }, ...messages],
        config,
        retrieval: "always",
        ...(arm.temperature === "model-default" ? { temperature: arm.temperature } : {}),
        onText: () => { if (ttftMs === null) ttftMs = Date.now() - started; },
      },
      {
        courseId: K12_FLOW_COURSE_ID,
        level: 1,
        syllabus: null,
        modelTier: profile.tier,
        contextTokens,
        permissionMode: "default",
        config,
        abort: signal,
        activeSkill,
        domainSkill,
        confirmTool: async () => true,
        supportsTools: profile.supportsTools,
      } satisfies ToolContext,
    ));
    return {
      text: result.text,
      stopReason: result.stopReason,
      hits: result.grounding.hits,
      usedHits: result.usedHits,
      ttftMs,
      toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
      workedAnswerRules: result.workedAnswerRules,
      firstTurnHold: result.firstTurnHold,
    };
  };
}

/** The webview hook, window.__runK12FlowEval. */
export async function runK12FlowEval(opts?: { pilot?: boolean; only?: string }): Promise<K12FlowReport> {
  const pool = opts?.pilot ? K12_PILOT : K12_ITEMS;
  const items = opts?.only ? pool.filter((x) => x.id === opts.only) : pool;
  return runK12FlowItems(items, {
    onRows: (rows) => { if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__k12FlowRows = rows; },
  });
}

/**
 * Resolve the configuration as ChatTab does, check the library guards, warm the model up, and hand
 * `body` the turn function both k12-flow suites use: the real kernel, configured as ChatTab runs a
 * turn for a course on the item's subject. One run at a time, across both suites.
 */
async function withK12FlowTurn<R>(tag: string, count: number, arm: K12FlowArm, body: (turn: K12FlowTurnFn<K12FlowSubject>, setup: K12FlowSetup) => Promise<R>): Promise<R> {
  if (inFlight) throw new Error("A k12-flow eval is already running. Overlapping runs share one row log and one GPU.");
  inFlight = true;
  try {
    const setup = await k12FlowSetup();
    const { config, profile, contextTokens } = setup;

    await assertLibraryGuards();
    console.log(`[${tag}] ${config.provider}/${config.model} ctx=${contextTokens} tools=${profile.supportsTools} · rules=${arm.courseRules} temperature=${arm.temperature} · ${count} item(s) × 3 turns`);


    // Warm-up, unscored: a cold model load can outlast the first-byte timeout.
    await watched(async (signal) => {
      for await (const ev of callLLMTurn([{ role: "user", content: "Reply with the single word: ready" }], config, { tier: profile.tier, signal })) void ev;
    }).catch(() => {});

    const turn = k12FlowKernelTurn(setup, arm);

    return await body(turn, setup);
  } finally {
    inFlight = false;
  }
}

/** The summary lines both suites print. */
function logSummary(tag: string, summary: K12FlowSummary | K12FlowFrSummary, turns: Array<Array<{ error: string | null; ttftMs: number | null; totalMs: number }>>, partial: boolean): void {
  console.log(`\n[${tag}] ── summary ─────────────────────────────`);
  console.log(`[${tag}] headline G1∧G2∧G3: ${fmtRate(summary.headline)} · errors ${summary.errors}${summary.void ? " · VOID (errors over 2%)" : ""}`);
  // k12-flow-fr: G3 has a lenient and a strict reading, and a lever counts only if it holds under both.
  if ("headlineStrict" in summary) console.log(`[${tag}] headline G1∧G2∧G3strict: ${fmtRate(summary.headlineStrict)}`);
  for (const k of ["g1", "g1b", "g2", "g3", "g3Strict", "g4", "g5", "chipOffered"] as const) {
    if (k in summary) console.log(`[${tag}]   ${k.padEnd(11)} ${fmtRate((summary as K12FlowFrSummary)[k])}`);
  }
  if ("g3Disagree" in summary) console.log(`[${tag}]   G3 readings disagree on ${summary.g3Disagree} row(s): route them to hand labels`);
  for (let t = 0; t < 3; t++) {
    const recs = turns.map((r) => r[t]).filter((x) => x && !x.error);
    console.log(`[${tag}]   T${t + 1} median ttft ${median(recs.flatMap((x) => (x.ttftMs === null ? [] : [x.ttftMs])))} ms · median total ${median(recs.map((x) => x.totalMs))} ms`);
  }
  if (partial) console.log(`[${tag}] PARTIAL RUN — not a result`);
}

/**
 * Run `items` through the flow, configured as ChatTab runs a turn. The webview hook and the headless
 * runner both call this. `onRows` gets the row log before the first item and it fills as rows
 * complete, so a void run (K12FlowAbort) still leaves its rows with the caller.
 */
export async function runK12FlowItems(items: readonly K12Item[], opts: { onRows?: (rows: K12FlowRow[]) => void; arm?: K12FlowArm } = {}): Promise<K12FlowReport> {
  const arm = opts.arm ?? K12_FLOW_DEFAULT_ARM;
  return withK12FlowTurn("k12-flow", items.length, arm, async (turn, { config, contextTokens, profile }) => {
    const partial = items.length !== K12_ITEMS.length;
    const rows: K12FlowRow[] = [];
    opts.onRows?.(rows);

    // The run is void at this many ERROR rows whatever happens next; stop instead of spending hours.
    const errorLimit = k12FlowErrorLimit(items.length);
    const { summary } = await runK12Flow(items, turn, {
      onRow: (row) => {
        rows.push(row);
        const g = row.grade;
        const ms = row.turns.map((t) => `${t.ttftMs ?? "-"}/${t.totalMs}`).join(" ");
        console.log(`[k12-flow] ${row.id.padEnd(14)} ${g ? `${g.pass ? "PASS" : "fail"} G1 ${+g.g1} G1b ${+g.g1b} G2 ${+g.g2} G3 ${+g.g3} G4 ${+g.g4} G5 ${+g.g5} T3=${g.t3Answer?.letter ?? "-"}` : "ERROR"} chip ${row.chipOffered ?? "-"} · ttft/total ms ${ms}`);
        const errors = rows.filter((r) => r.grade === null).length;
        if (errors >= errorLimit) {
          throw new K12FlowAbort(`VOID RUN — ${errors} ERROR rows of ${items.length} items (limit ${errorLimit}) at ${row.id}. Discard it whole.`);
        }
      },
    });

    logSummary("k12-flow", summary, rows.map((r) => r.turns), partial);
    return { model: config.model, provider: config.provider, contextTokens, supportsTools: profile.supportsTools, partial, arm, rows, summary };
  });
}

export interface K12FlowFrReport {
  model: string;
  provider: string;
  contextTokens: number;
  supportsTools: boolean;
  /** True for anything short of every free-response item. A partial run is not a result. */
  partial: boolean;
  /** Lever 16's switches this run used (K12FlowArm). */
  arm: K12FlowArm;
  rows: K12FlowFrRow[];
  summary: K12FlowFrSummary;
}

/** The free-response flow (k12-flow-fr.ts) through the same turn function, setup and void rules. */
export async function runK12FlowFrItems(items: readonly K12FrItem[], opts: { onRows?: (rows: K12FlowFrRow[]) => void; arm?: K12FlowArm } = {}): Promise<K12FlowFrReport> {
  const arm = opts.arm ?? K12_FLOW_DEFAULT_ARM;
  return withK12FlowTurn("k12-flow-fr", items.length, arm, async (turn, { config, contextTokens, profile }) => {
    const partial = items.length !== K12_FR_ITEMS.length;
    const rows: K12FlowFrRow[] = [];
    opts.onRows?.(rows);

    const errorLimit = k12FlowErrorLimit(items.length);
    const { summary } = await runK12FlowFr(items, turn, {
      onRow: (row) => {
        rows.push(row);
        const g = row.grade;
        const ms = row.turns.map((t) => `${t.ttftMs ?? "-"}/${t.totalMs}`).join(" ");
        console.log(`[k12-flow-fr] ${row.id.padEnd(17)} ${g ? `${g.pass ? "PASS" : "fail"}/${g.passStrict ? "PASS" : "fail"} G1 ${+g.g1} G1b ${+g.g1b} G2 ${+g.g2} G3 ${+g.g3}/${+g.g3Strict}${g.g3Disagree ? " DISAGREE" : ""} G4 ${+g.g4} G5 ${+g.g5} T3=${g.t3Answer?.text ?? "-"}` : "ERROR"} chip ${row.chipOffered ?? "-"} · ttft/total ms ${ms}`);
        const errors = rows.filter((r) => r.grade === null).length;
        if (errors >= errorLimit) {
          throw new K12FlowAbort(`VOID RUN — ${errors} ERROR rows of ${items.length} items (limit ${errorLimit}) at ${row.id}. Discard it whole.`);
        }
      },
    });

    logSummary("k12-flow-fr", summary, rows.map((r) => r.turns), partial);
    return { model: config.model, provider: config.provider, contextTokens, supportsTools: profile.supportsTools, partial, arm, rows, summary };
  });
}

/** The webview hook for the free-response flow, window.__runK12FlowFrEval. */
export async function runK12FlowFrEval(opts?: { only?: string }): Promise<K12FlowFrReport> {
  const items = opts?.only ? K12_FR_ITEMS.filter((x) => x.id === opts.only) : K12_FR_ITEMS;
  return runK12FlowFrItems(items, {
    onRows: (rows) => { if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__k12FlowFrRows = rows; },
  });
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runK12FlowEval = runK12FlowEval;
  (window as unknown as Record<string, unknown>).__runK12FlowFrEval = runK12FlowFrEval;
}
