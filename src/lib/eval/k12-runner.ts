// The K-12 eval runner — puts the multiple-choice item set through the configured model, three ways:
//   raw          — the model alone: the question, no system prompt, no tools, no grounding
//   prompt-only  — the real kernel with the tutor system prompt, retrieval off, no tools
//   shipping     — the real kernel as ChatTab runs it (retrieval: "always", tools as detected). HEADLINE.
//
// The user turn is byte-identical in all three, and grading is the deterministic letter extractor in
// k12-fixture.ts, whose header carries the pre-registered bar this run is judged against.
//
// Runs in the Tauri webview (needs Ollama up and a chat model; Library on, no library URL override):
//     await window.__runK12Eval({ pilot: true })   // the 12 pilot items — the only pre-freeze run
//     const r = await window.__runK12Eval()        // the pre-registered run: 240 items × 3 arms
//     copy(JSON.stringify(r))                      // window.__k12Rows holds the rows if this fails
//
// Do not save a source file during a run: Vite HMR reloads the webview and kills it.

import { tutorEngine, skillBundleLayer } from "../kernel";
import { registerBuiltinTools, type ToolContext } from "../tools";
import { loadBuiltinSkills, resolveSkill } from "../skills";
import { buildSystemPrompt } from "../curriculum";
import { getChatConfig, getLibraryEnabled, getLibraryUrl, getMaxContextTokens } from "../store";
import { callLLMTurn, detectModelProfile } from "../llm";
import { getManifest, isLibraryAvailable, isLibraryTestingDisabled } from "../library";
import { K12_ITEMS, K12_PILOT, type K12Item, type K12Key } from "./k12-items";
import { K12_BAR, contrastK12, formatK12Prompt, judgeK12, scoreK12, tally, wilson95, type K12Contrast, type K12Outcome, type K12Tally, type K12Verdict } from "./k12-fixture";
import type { LLMConfig } from "../../types";

// Never created: no ensureCourse, no seeding, no teardown. The notebook half of grounding searches
// an unknown course and returns nothing, so the bundled library is the only corpus in play.
const K12_COURSE_ID = "__eval_k12__";

// A kernel turn that has produced nothing in this long is recorded as an ERROR row and aborted. The
// stall timer only covers the chat stream; the shipping arm's notebook embed has no timeout at all.
const K12_TURN_WATCHDOG_MS = 600_000;
const K12_MAX_ATTEMPTS = 2;

// Only ONE run at a time — two interleaved runs would share window.__k12Rows and the GPU, and the
// per-turn times would mean nothing. See rag-runner.ts for how the same mistake once cost a result.
let inFlight = false;

// RAG_INSTRUCTIONS, copied verbatim: it is not exported, and importing rag-runner drags in the db.
const K12_INSTRUCTIONS: Record<string, string> = {
  identity: "You are a helpful tutor.",
  pedagogy: "Answer the student's question directly and concisely.",
  rules: "Be accurate. If you do not know something, say so.",
};

export type K12Arm = "raw" | "prompt-only" | "shipping";

// The order each item goes through its arms. Item-major, so thermal and time drift across a long
// run cannot line up with an arm.
const ARMS: K12Arm[] = ["raw", "prompt-only", "shipping"];

export interface K12Row {
  id: string;
  arm: K12Arm;
  text: string;
  letter: K12Key | null;
  outcome: K12Outcome;
  /** The raw arm reports the provider's finishReason; the kernel arms report the turn's stopReason;
   *  null when the turn threw. "stalled" and "aborted" make the row an ERROR; nothing else is
   *  graded on. */
  stopReason: string | null;
  hitTitles: string[];
  groundError: string | null;
  toolCalls: string[];
  ms: number;
  /** 1, or 2 when the first attempt produced no reply and was retried. */
  attempts: number;
}

type Split = Record<string, { correct: number; total: number }>;

export interface K12ArmSummary extends K12Tally {
  wilson: [number, number];
  bySubject: Split;
  byBand: Split;
}

export interface K12Report {
  model: string;
  provider: string;
  contextTokens: number;
  supportsTools: boolean;
  /** True for anything short of all 240 items × all 3 arms. A partial run is not a result. */
  partial: boolean;
  rows: K12Row[];
  byArm: Partial<Record<K12Arm, K12ArmSummary>>;
  /** Shipping rows that were actually handed a library card. */
  grounded: number;
  contrasts: { shippingVsRaw: K12Contrast | null; shippingVsPromptOnly: K12Contrast | null };
  verdict: K12Verdict | null;
}

function splitBy(rows: K12Row[], items: Map<string, K12Item>, key: "subject" | "band"): Split {
  const out: Split = {};
  for (const r of rows) {
    const bucket = (out[items.get(r.id)![key]] ??= { correct: 0, total: 0 });
    bucket.total++;
    if (r.outcome === "correct") bucket.correct++;
  }
  return out;
}

// groundFromLibrary swallows every one of these conditions and returns no card, so without them the
// shipping arm silently becomes the prompt-only arm and still prints a number. The kernel re-reads
// all four on every turn, so they are checked before the run and again before every shipping turn.
async function assertLibraryGuards(): Promise<void> {
  if (isLibraryTestingDisabled()) {
    throw new Error("The library is suppressed for testing (another eval is mid-run or crashed). Reload the app and retry.");
  }
  if (!(await getLibraryEnabled())) {
    throw new Error("The Library is switched off in Settings. Turn it on — the shipping arm cannot ground without it.");
  }
  if (await getLibraryUrl()) {
    throw new Error("A library URL override is set in Settings. Clear it and restart the app — this benchmark measures the bundled corpus.");
  }
  await getManifest();
  if (!isLibraryAvailable()) {
    throw new Error("The bundled library manifest did not load. The shipping arm would run ungrounded; nothing was sent to the model.");
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtSplit = (s: Split) => Object.entries(s).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(" · ");
const fmtContrast = (c: K12Contrast | null) => (c ? `b=${c.b} c=${c.c} p=${c.p.toFixed(4)}` : "not run");

// One watchdog for every arm, so "outran the watchdog" means the same thing in all three. On
// timeout it aborts the turn (stop the orphan using the GPU) and rejects into the row's catch.
async function watched<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const turn = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      turn.abort();
      reject(new Error(`turn watchdog: no result in ${K12_TURN_WATCHDOG_MS / 60_000} min`));
    }, K12_TURN_WATCHDOG_MS);
  });
  return Promise.race([run(turn.signal), watchdog]).finally(() => clearTimeout(timer));
}

// The count at which an arm's ERROR rows void the run (rule 2): 5 at n=240.
const ERROR_LIMIT = Math.floor(K12_BAR.maxErrorRate * K12_BAR.items) + 1;

export async function runK12Eval(opts?: { pilot?: boolean; arms?: K12Arm[]; only?: string }): Promise<K12Report> {
  if (inFlight) {
    throw new Error("A K-12 eval is already running. Wait for it to finish — overlapping runs share one row log and one GPU.");
  }
  inFlight = true;

  try {
    const pool = opts?.pilot ? K12_PILOT : K12_ITEMS;
    const items = opts?.only ? pool.filter((x) => x.id === opts.only) : pool;
    const arms = ARMS.filter((a) => !opts?.arms || opts.arms.includes(a));
    const partial = !!opts?.pilot || items.length !== K12_BAR.items || arms.length !== ARMS.length;

    registerBuiltinTools();
    await loadBuiltinSkills();

    // Resolve the window exactly as ChatTab does, so the eval measures the configuration the app runs.
    const baseConfig = await getChatConfig();
    const profile = await detectModelProfile(baseConfig);
    const contextTokens = baseConfig.provider === "ollama"
      ? Math.min(profile.contextTokens, await getMaxContextTokens())
      : profile.contextTokens;
    const config: LLMConfig = { ...baseConfig, modelTier: profile.tier, contextTokens };

    await assertLibraryGuards();

    console.log(`[k12-eval] ${config.provider}/${config.model} ctx=${contextTokens} tools=${profile.supportsTools} · ${items.length} item(s) × ${arms.length} arm(s)`);

    const skill = resolveSkill("explain") ?? null;
    // Syllabus is null, not evalToolSyllabus(): that one injects a Python Basics level block.
    const system = buildSystemPrompt(K12_INSTRUCTIONS, null, 1, "General Study", skillBundleLayer(skill) ?? "");

    const rows: K12Row[] = [];
    // Exposed before the first turn and filled as rows complete, so a late crash does not lose the run.
    (window as unknown as Record<string, unknown>).__k12Rows = rows;
    // A void run is "logged with its counts" (rule 2) — this is that log.
    const logCounts = () => {
      for (const arm of arms) {
        const t = tally(rows.filter((r) => r.arm === arm));
        console.log(`[k12-eval] at void: ${arm.padEnd(11)} ${t.correct}/${t.total} · no-parse ${t.noParse} · error ${t.error}`);
      }
    };

    // Warm-up, unscored and carrying no item: a cold model load took longer than the first-byte
    // timeout in the pilot and cost the first row. If this fails Ollama is not usable; say so now.
    await watched(async (signal) => {
      for await (const ev of callLLMTurn([{ role: "user", content: "Reply with the single word: ready" }], config, { tier: profile.tier, signal })) void ev;
    }).catch(() => { /* a slow cold load is exactly what this absorbs; the first real turn decides */ });

    for (const item of items) {
      const prompt = formatK12Prompt(item);
      for (const arm of arms) {
        // Outside the per-row try on purpose: a guard tripping mid-run throws and voids the run (rule 2).
        if (arm === "shipping") await assertLibraryGuards().catch((e) => { logCounts(); throw e; });
        const row: K12Row = { id: item.id, arm, text: "", letter: null, outcome: "error", stopReason: null, hitTitles: [], groundError: null, toolCalls: [], ms: 0, attempts: 0 };
        const started = Date.now();
        let failed = false;
        // One retry, for a turn that produced NO reply (rule 1). A reply, right or wrong, is never retried.
        for (let attempt = 1; attempt <= K12_MAX_ATTEMPTS; attempt++) {
          row.attempts = attempt;
          row.text = "";
          row.stopReason = null;
          failed = false;
          try {
            if (arm === "raw") {
              // callLLMTurn, the transport the kernel itself uses — same num_ctx, num_predict and
              // think:false — so the only thing this arm removes is the harness.
              await watched(async (signal) => {
                for await (const ev of callLLMTurn([{ role: "user", content: prompt }], config, { tier: profile.tier, signal })) {
                  if (ev.type === "text") row.text += ev.delta;
                  else if (ev.type === "done") row.stopReason = ev.finishReason;
                }
              });
            } else {
              const shipping = arm === "shipping";
              const result = await watched((signal) => tutorEngine.run(
                {
                  messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
                  config,
                  retrieval: shipping ? "always" : "off",
                  onText: () => {},
                },
                {
                  courseId: K12_COURSE_ID,
                  level: 1,
                  syllabus: null,
                  modelTier: profile.tier,
                  contextTokens,
                  permissionMode: "default",
                  config,
                  abort: signal,
                  activeSkill: skill,
                  confirmTool: async () => true,
                  // false returns no tools before the registry is consulted, which together with
                  // retrieval "off" makes the library unreachable in the prompt-only arm.
                  supportsTools: shipping ? profile.supportsTools : false,
                } satisfies ToolContext,
              ));
              row.text = result.text;
              row.stopReason = result.stopReason;
              row.hitTitles = result.grounding.trace.hitTitles;
              row.groundError = result.grounding.trace.error ?? null;
              row.toolCalls = result.toolCalls.map((c) => c.name);
            }
          } catch (e) {
            row.text = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
            row.stopReason = null;
            failed = true;
          }
          // Nothing but the watchdog aborts either arm's signal, so both of these mean the stream
          // hung, not that the model answered. "length" stays graded on its text.
          if (row.stopReason === "stalled" || row.stopReason === "aborted") {
            row.text = `ERROR: turn ${row.stopReason}`;
            failed = true;
          }
          if (!failed) break;
        }
        row.ms = Date.now() - started;
        const scored = scoreK12(item, row.text, failed);
        row.outcome = scored.outcome;
        row.letter = scored.letter;
        rows.push(row);
        console.log(`[k12-eval] ${arm.padEnd(11)} ${item.id.padEnd(14)} ${row.outcome}${row.letter ? ` ${row.letter}` : ""} · ${row.ms}ms${row.attempts > 1 ? " · retried" : ""}`);
        // The run is void at this count whatever happens next (rule 2); stop instead of spending
        // up to a watchdog per remaining row on a dependency that has gone away.
        if (row.outcome === "error" && rows.filter((r) => r.arm === arm && r.outcome === "error").length >= ERROR_LIMIT) {
          logCounts();
          throw new Error(`VOID RUN — the ${arm} arm reached ${ERROR_LIMIT} ERROR rows at ${item.id}. Discard it whole.`);
        }
      }
    }

    const byId = new Map(items.map((x) => [x.id, x]));
    const of = (arm: K12Arm) => rows.filter((r) => r.arm === arm);
    const byArm: K12Report["byArm"] = {};
    for (const arm of arms) {
      const armRows = of(arm);
      const t = tally(armRows);
      byArm[arm] = { ...t, wilson: wilson95(t.correct, t.total), bySubject: splitBy(armRows, byId, "subject"), byBand: splitBy(armRows, byId, "band") };
    }
    const grounded = of("shipping").filter((r) => r.hitTitles.length > 0).length;
    const contrasts = {
      shippingVsRaw: contrastK12(of("shipping"), of("raw")),
      shippingVsPromptOnly: contrastK12(of("shipping"), of("prompt-only")),
    };

    console.log("\n[k12-eval] ── summary ─────────────────────────────");
    for (const arm of arms) {
      const s = byArm[arm]!;
      console.log(`[k12-eval] ${arm.padEnd(11)} ${s.correct}/${s.total} (${s.total ? pct(s.correct / s.total) : "n/a"}) · 95% Wilson ${pct(s.wilson[0])}-${pct(s.wilson[1])} · no-parse ${s.noParse} · error ${s.error}`);
      console.log(`[k12-eval]   by subject: ${fmtSplit(s.bySubject)}`);
      console.log(`[k12-eval]   by band:    ${fmtSplit(s.byBand)}`);
    }
    console.log(`[k12-eval] grounded (shipping rows handed a card): ${grounded}/${of("shipping").length}`);
    console.log(`[k12-eval] retried turns (no reply on the first attempt): ${arms.map((a) => `${a} ${of(a).filter((r) => r.attempts > 1).length}`).join(" · ")}`);
    console.log(`[k12-eval] McNemar shipping vs raw: ${fmtContrast(contrasts.shippingVsRaw)}`);
    console.log(`[k12-eval] McNemar shipping vs prompt-only (descriptive): ${fmtContrast(contrasts.shippingVsPromptOnly)}`);

    // The pre-committed bar (k12-fixture.ts header). Only a complete run is judged against it.
    let verdict: K12Verdict | null = null;
    if (partial) {
      console.log("[k12-eval] PARTIAL RUN — not a result");
    } else {
      const ship = byArm.shipping!;
      verdict = judgeK12(byArm as Record<K12Arm, K12ArmSummary>, grounded, contrasts.shippingVsRaw!);
      if (verdict.void) console.log(`[k12-eval] VOID RUN — ${verdict.void}. Discard it whole and log these counts.`);
      else {
        console.log(`[k12-eval] V (format validity, no-parse <= ${pct(K12_BAR.maxNoParseRate)} per arm): ${verdict.V ? "VALID" : "FORMAT-INVALID — not quotable as an accuracy figure"}`);
        console.log(`[k12-eval] A (shipping Wilson lower bound >= ${pct(K12_BAR.shippingWilsonLowerBound)}): ${pct(ship.wilson[0])} — ${verdict.A ? "MET" : "NOT MET"}`);
        console.log(`[k12-eval] H (shipping vs raw, alpha ${K12_BAR.alpha}): ${verdict.H === "lift" ? "harness lift" : verdict.H === "reduces" ? "the harness reduces accuracy on this format" : `no measurable difference at n=${ship.total}`}`);
        console.log(`[k12-eval] C (raw arm >= ${pct(K12_BAR.ceiling)}): ${verdict.C ? "NEAR CEILING — the set cannot discriminate a harness effect" : "below ceiling"}`);
      }
    }

    return { model: config.model, provider: config.provider, contextTokens, supportsTools: profile.supportsTools, partial, rows, byArm, grounded, contrasts, verdict };
  } finally {
    inFlight = false;
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runK12Eval = runK12Eval;
}
