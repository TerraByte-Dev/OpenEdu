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
import { K12_BAR, formatK12Prompt, mcnemarExact, scoreK12, tally, wilson95, type K12Outcome, type K12Tally } from "./k12-fixture";
import type { LLMConfig } from "../../types";

// Never created: no ensureCourse, no seeding, no teardown. The notebook half of grounding searches
// an unknown course and returns nothing, so the bundled library is the only corpus in play.
const K12_COURSE_ID = "__eval_k12__";

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
  /** Recorded, never graded on. The raw arm reports the provider's finishReason; the kernel arms
   *  report the turn's stopReason; null when the turn threw. */
  stopReason: string | null;
  hitTitles: string[];
  groundError: string | null;
  toolCalls: string[];
  ms: number;
}

type Split = Record<string, { correct: number; total: number }>;

export interface K12ArmSummary extends K12Tally {
  wilson: [number, number];
  bySubject: Split;
  byBand: Split;
}

/** Paired contrast, first arm vs second: b = items only the first got right, c = only the second. */
export interface K12Contrast {
  b: number;
  c: number;
  p: number;
}

export interface K12Verdict {
  /** Non-null when rule 2 voids the run; the clauses below are then not a result. */
  void: string | null;
  V: boolean;
  A: boolean;
  H: "lift" | "reduces" | "no-difference";
  C: boolean;
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

function contrast(first: K12Row[], second: K12Row[]): K12Contrast | null {
  if (!first.length || !second.length) return null;
  const secondRight = new Set(second.filter((r) => r.outcome === "correct").map((r) => r.id));
  let b = 0;
  let c = 0;
  for (const r of first) {
    const right = r.outcome === "correct";
    if (right && !secondRight.has(r.id)) b++;
    if (!right && secondRight.has(r.id)) c++;
  }
  return { b, c, p: mcnemarExact(b, c) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtSplit = (s: Split) => Object.entries(s).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(" · ");
const fmtContrast = (c: K12Contrast | null) => (c ? `b=${c.b} c=${c.c} p=${c.p.toFixed(4)}` : "not run");

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

    // Guards. groundFromLibrary swallows every one of these conditions and returns no card, so
    // without them the shipping arm silently becomes the prompt-only arm and still prints a number.
    if (isLibraryTestingDisabled()) {
      throw new Error("The library is suppressed for testing (another eval is mid-run or crashed). Reload the app and retry.");
    }
    if (!(await getLibraryEnabled())) {
      throw new Error("The Library is switched off in Settings. Turn it on — the shipping arm cannot ground without it.");
    }
    if (await getLibraryUrl()) {
      throw new Error("A library URL override is set in Settings. Clear it — this benchmark measures the bundled corpus.");
    }
    await getManifest();
    if (!isLibraryAvailable()) {
      throw new Error("The bundled library manifest did not load. The shipping arm would run ungrounded; nothing was sent to the model.");
    }

    console.log(`[k12-eval] ${config.provider}/${config.model} ctx=${contextTokens} tools=${profile.supportsTools} · ${items.length} item(s) × ${arms.length} arm(s)`);

    const skill = resolveSkill("explain") ?? null;
    // Syllabus is null, not evalToolSyllabus(): that one injects a Python Basics level block.
    const system = buildSystemPrompt(K12_INSTRUCTIONS, null, 1, "General Study", skillBundleLayer(skill) ?? "");

    const rows: K12Row[] = [];
    // Exposed before the first turn and filled as rows complete, so a late crash does not lose the run.
    (window as unknown as Record<string, unknown>).__k12Rows = rows;

    for (const item of items) {
      const prompt = formatK12Prompt(item);
      for (const arm of arms) {
        const row: K12Row = { id: item.id, arm, text: "", letter: null, outcome: "error", stopReason: null, hitTitles: [], groundError: null, toolCalls: [], ms: 0 };
        const started = Date.now();
        try {
          if (arm === "raw") {
            // callLLMTurn, the transport the kernel itself uses — same num_ctx, num_predict and
            // think:false — so the only thing this arm removes is the harness.
            const signal = new AbortController().signal;
            for await (const ev of callLLMTurn([{ role: "user", content: prompt }], config, { tier: profile.tier, signal })) {
              if (ev.type === "text") row.text += ev.delta;
              else if (ev.type === "done") row.stopReason = ev.finishReason;
            }
          } else {
            const shipping = arm === "shipping";
            const ctx: ToolContext = {
              courseId: K12_COURSE_ID,
              level: 1,
              syllabus: null,
              modelTier: profile.tier,
              contextTokens,
              permissionMode: "default",
              config,
              abort: new AbortController().signal,
              activeSkill: skill,
              confirmTool: async () => true,
              // false returns no tools before the registry is consulted, which together with
              // retrieval "off" makes the library unreachable in the prompt-only arm.
              supportsTools: shipping ? profile.supportsTools : false,
            };
            const result = await tutorEngine.run(
              {
                messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
                config,
                retrieval: shipping ? "always" : "off",
                onText: () => {},
              },
              ctx,
            );
            row.text = result.text;
            row.stopReason = result.stopReason;
            row.hitTitles = result.grounding.trace.hitTitles;
            row.groundError = result.grounding.trace.error ?? null;
            row.toolCalls = result.toolCalls.map((c) => c.name);
          }
        } catch (e) {
          row.text = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          row.stopReason = null;
        }
        row.ms = Date.now() - started;
        const scored = scoreK12(item, row.text);
        row.outcome = scored.outcome;
        row.letter = scored.letter;
        rows.push(row);
        console.log(`[k12-eval] ${arm.padEnd(11)} ${item.id.padEnd(14)} ${row.outcome}${row.letter ? ` ${row.letter}` : ""} · ${row.ms}ms`);
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
      shippingVsRaw: contrast(of("shipping"), of("raw")),
      shippingVsPromptOnly: contrast(of("shipping"), of("prompt-only")),
    };

    console.log("\n[k12-eval] ── summary ─────────────────────────────");
    for (const arm of arms) {
      const s = byArm[arm]!;
      console.log(`[k12-eval] ${arm.padEnd(11)} ${s.correct}/${s.total} (${s.total ? pct(s.correct / s.total) : "n/a"}) · 95% Wilson ${pct(s.wilson[0])}-${pct(s.wilson[1])} · no-parse ${s.noParse} · error ${s.error}`);
      console.log(`[k12-eval]   by subject: ${fmtSplit(s.bySubject)}`);
      console.log(`[k12-eval]   by band:    ${fmtSplit(s.byBand)}`);
    }
    console.log(`[k12-eval] grounded (shipping rows handed a card): ${grounded}/${of("shipping").length}`);
    console.log(`[k12-eval] McNemar shipping vs raw: ${fmtContrast(contrasts.shippingVsRaw)}`);
    console.log(`[k12-eval] McNemar shipping vs prompt-only (descriptive): ${fmtContrast(contrasts.shippingVsPromptOnly)}`);

    // The pre-committed bar (k12-fixture.ts header). Only a complete run is judged against it.
    let verdict: K12Verdict | null = null;
    if (partial) {
      console.log("[k12-eval] PARTIAL RUN — not a result");
    } else {
      const raw = byArm.raw!;
      const ship = byArm.shipping!;
      const h = contrasts.shippingVsRaw!;
      const errored = arms.filter((a) => byArm[a]!.error / byArm[a]!.total > K12_BAR.maxErrorRate);
      verdict = {
        void: errored.length
          ? `ERROR rows over the limit in ${errored.join(", ")}`
          : grounded === 0 ? "the shipping arm grounded zero items" : null,
        V: arms.every((a) => byArm[a]!.noParse / byArm[a]!.total <= K12_BAR.maxNoParseRate),
        A: ship.wilson[0] >= K12_BAR.shippingWilsonLowerBound,
        H: h.p < K12_BAR.alpha ? (h.b > h.c ? "lift" : "reduces") : "no-difference",
        C: raw.correct / raw.total >= K12_BAR.ceiling,
      };
      if (verdict.void) console.log(`[k12-eval] VOID RUN — ${verdict.void}. Discard it whole and log these counts.`);
      console.log(`[k12-eval] V (format validity, no-parse <= ${pct(K12_BAR.maxNoParseRate)} per arm): ${verdict.V ? "VALID" : "FORMAT-INVALID — not quotable as an accuracy figure"}`);
      console.log(`[k12-eval] A (shipping Wilson lower bound >= ${pct(K12_BAR.shippingWilsonLowerBound)}): ${pct(ship.wilson[0])} — ${verdict.A ? "MET" : "NOT MET"}`);
      console.log(`[k12-eval] H (shipping vs raw, alpha ${K12_BAR.alpha}): ${verdict.H === "lift" ? "harness lift" : verdict.H === "reduces" ? "the harness reduces accuracy on this format" : `no measurable difference at n=${ship.total}`}`);
      console.log(`[k12-eval] C (raw arm >= ${pct(K12_BAR.ceiling)}): ${verdict.C ? "NEAR CEILING — the set cannot discriminate a harness effect" : "below ceiling"}`);
    }

    return { model: config.model, provider: config.provider, contextTokens, supportsTools: profile.supportsTools, partial, rows, byArm, grounded, contrasts, verdict };
  } finally {
    inFlight = false;
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runK12Eval = runK12Eval;
}
