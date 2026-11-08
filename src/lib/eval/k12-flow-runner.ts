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
import { K12FlowAbort, runK12Flow, type K12FlowRow, type K12FlowTurnFn } from "./k12-flow";
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
 * (k12-flow-prompt.ts), retrieval "always", under the turn watchdog. runK12FlowItems runs every T1, T2
 * and T3 through this; the B7 latency harness (headless/latency.ts) times the same function.
 */
export function k12FlowKernelTurn({ config, profile, contextTokens }: K12FlowSetup): K12FlowTurnFn {
  return async (messages, item) => {
    // A guard tripping mid-run ends the run (void): the shipping configuration went away.
    await assertLibraryGuards().catch((e) => {
      throw new K12FlowAbort(`VOID RUN — ${e instanceof Error ? e.message : String(e)}`);
    });
    const { system, activeSkill, domainSkill } = k12FlowTurnSetup(item, profile.tier, profile.supportsTools);
    const started = Date.now();
    let ttftMs: number | null = null;
    const result = await watched((signal) => tutorEngine.run(
      {
        messages: [{ role: "system", content: system }, ...messages],
        config,
        retrieval: "always",
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
 * Run `items` through the flow, configured as ChatTab runs a turn. The webview hook and the headless
 * runner both call this. `onRows` gets the row log before the first item and it fills as rows
 * complete, so a void run (K12FlowAbort) still leaves its rows with the caller.
 */
export async function runK12FlowItems(items: readonly K12Item[], opts: { onRows?: (rows: K12FlowRow[]) => void } = {}): Promise<K12FlowReport> {
  if (inFlight) throw new Error("A k12-flow eval is already running. Overlapping runs share one row log and one GPU.");
  inFlight = true;
  try {
    const partial = items.length !== K12_ITEMS.length;

    const setup = await k12FlowSetup();
    const { config, profile, contextTokens } = setup;

    await assertLibraryGuards();
    console.log(`[k12-flow] ${config.provider}/${config.model} ctx=${contextTokens} tools=${profile.supportsTools} · ${items.length} item(s) × 3 turns`);


    // Warm-up, unscored: a cold model load can outlast the first-byte timeout.
    await watched(async (signal) => {
      for await (const ev of callLLMTurn([{ role: "user", content: "Reply with the single word: ready" }], config, { tier: profile.tier, signal })) void ev;
    }).catch(() => {});

    const turn = k12FlowKernelTurn(setup);

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

    console.log("\n[k12-flow] ── summary ─────────────────────────────");
    console.log(`[k12-flow] headline G1∧G2∧G3: ${fmtRate(summary.headline)} · errors ${summary.errors}${summary.void ? " · VOID (errors over 2%)" : ""}`);
    for (const k of ["g1", "g1b", "g2", "g3", "g4", "g5", "chipOffered"] as const) {
      console.log(`[k12-flow]   ${k.padEnd(11)} ${fmtRate(summary[k])}`);
    }
    for (let t = 0; t < 3; t++) {
      const recs = rows.map((r) => r.turns[t]).filter((x) => x && !x.error);
      console.log(`[k12-flow]   T${t + 1} median ttft ${median(recs.flatMap((x) => (x.ttftMs === null ? [] : [x.ttftMs])))} ms · median total ${median(recs.map((x) => x.totalMs))} ms`);
    }
    if (partial) console.log("[k12-flow] PARTIAL RUN — not a result");

    return { model: config.model, provider: config.provider, contextTokens, supportsTools: profile.supportsTools, partial, rows, summary };
  } finally {
    inFlight = false;
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runK12FlowEval = runK12FlowEval;
}
