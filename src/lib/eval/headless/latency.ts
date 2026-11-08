// B7: what a tutoring turn costs on a CPU, end to end, through the product path
// (docs/BENCHMARKS.md B7). `EVAL_SUITE=b7-cpu npm run eval`; options and the server setup in
// ./README.md ("b7-cpu").
//
// It starts nothing. It expects a second Ollama server, CPU only, on its own port (default 11435),
// started by hand as the README shows, and it refuses to run unless:
//   - no other Ollama server on this machine (127.0.0.1:11434) has a model loaded (another run is
//     using the CPU or the memory bus);
//   - the CPU is idle (at most B7_MAX_BUSY_PCT busy over 3 s) before the first turn;
//   - after every turn, /api/ps on the CPU server lists the chat model and every loaded model has
//     size_vram 0. A model with any of its weights on a GPU voids the run (written, then thrown).
//
// Turns go through the runners' own functions:
//   - k12-flow: runK12FlowItem (k12-flow.ts) with k12FlowKernelTurn (k12-flow-runner.ts), the turn
//     runK12FlowItems runs. Same system prompt, skills, tools, retrieval "always", chip check. The
//     runner's unscored warm-up call is not sent: the cold repeat measures what it would hide.
//   - notes: runRagEval with one question, retrieval "always", the matched syllabus, the main fixture
//     vault. runRagEval seeds the vault (one embed per note) before the turn; those requests are
//     setup and are not counted in the turn (latency-stats.ts splitSetup).
//
// The scenarios, fixed before any run (all dev items, chosen by rule, not by content):
//   k12-flow  The first 1 + N math K-5 items in K12_ITEMS file order, one item per repeat, three
//             turns each: T1 the problem (a new problem), T2 a scripted wrong try, T3 "Show me the
//             answer" (the show-answer turn). Repeat 0 is cold; its T1 is the cold-start first turn.
//             One item per repeat, all with the same system prompt, so a warm T1 sees what a learner's
//             next problem sees: the course prompt cached, the problem new.
//   notes-en  h-pp01 (English, its gold note in the vault).
//   notes-hi  h-xl-hi01 (Hindi in Devanagari: the L2 gloss runs, then the reply).
//             Cold: each once, after unloading every model. Warm: alternated en, hi, en, hi … N
//             times each, so each warm notes turn follows a different question under the same system
//             prompt, as a learner's next question would. Repeating one question back to back would
//             let Ollama reuse the whole previous prompt and time a prefill that never happens.

import { K12_ITEMS, type K12Item } from "../k12-items";
import { RAG_FIXTURE } from "../rag-fixture";
import { RAG_HELDOUT, type HeldoutQuestion } from "../rag-heldout";
import { runRagEval } from "../rag-runner";
import { k12FlowKernelTurn, k12FlowSetup } from "../k12-flow-runner";
import { K12FlowAbort, runK12FlowItem, type K12FlowTurnFn } from "../k12-flow";
import { installTap, type TapCall } from "./latency-tap";
import { splitSetup, summarizeB7, turnCost, B7_BUDGET_MS, B7_TURN_KINDS, type B7Summary, type B7TurnKind, type B7TurnRow } from "./latency-stats";
import { cpuBusyPct, machineInfo, serverThreads, type MachineInfo } from "./machine";
import type { EvalOptions } from "./env";

export const B7_K12 = { subject: "math", band: "K-5" } as const;
export const B7_NOTES = { "notes-en": "h-pp01", "notes-hi-gloss": "h-xl-hi01" } as const;
/** The machine's usual Ollama server, which must have nothing loaded during a B7 run. */
export const B7_OTHER_OLLAMA_URL = "http://127.0.0.1:11434";
export const B7_MAX_BUSY_PCT = 25;
const UNLOAD_WAIT_MS = 20_000;

/** A refusal or a void: the run stops, and what it measured so far is still written. */
export class B7Abort extends K12FlowAbort {}

/** The first `n` k12 items of the B7 subject and band, in file order. */
export function b7K12Items(n: number): K12Item[] {
  const pool = K12_ITEMS.filter((x) => x.subject === B7_K12.subject && x.band === B7_K12.band);
  if (n > pool.length) throw new Error(`b7-cpu needs ${n} ${B7_K12.subject} ${B7_K12.band} items (1 cold + EVAL_REPEATS warm); there are ${pool.length}. Lower EVAL_REPEATS.`);
  return pool.slice(0, n);
}

export function b7NotesQuestion(kind: keyof typeof B7_NOTES): HeldoutQuestion {
  const q = RAG_HELDOUT.find((x) => x.id === B7_NOTES[kind]);
  if (!q || q.split !== "dev") throw new Error(`b7-cpu: ${B7_NOTES[kind]} is not a dev item`);
  return q;
}

// ── Ollama: /api/ps and unloading ────────────────────────────────────────────

export interface PsModel { name: string; model?: string; size?: number; size_vram?: number; context_length?: number; expires_at?: string }

const named = (m: PsModel, want: string) => [m.name, m.model].some((n) => n === want || n === `${want}:latest`);
const base = (url: string) => url.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ps(f: typeof fetch, url: string): Promise<PsModel[] | null> {
  try {
    const res = await f(`${base(url)}/api/ps`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { models?: unknown };
    return Array.isArray(json.models) ? (json.models as PsModel[]) : null;
  } catch {
    return null;
  }
}

/** The share of each loaded model in GPU memory, for the refusal message. */
const onGpu = (models: PsModel[]) => models.filter((m) => (m.size_vram ?? 0) > 0)
  .map((m) => `${m.name} (${m.size ? Math.round(((m.size_vram ?? 0) / m.size) * 100) : "?"}% GPU)`);

/** Ask the server to drop every loaded model, then wait for /api/ps to show none. Throws B7Abort if
 *  something stays loaded. A chat model is unloaded through /api/generate; a model that refuses
 *  generate (an embedder) through /api/embed. Both with keep_alive 0, as `ollama stop` does. */
async function unloadAll(f: typeof fetch, url: string): Promise<void> {
  const post = (path: string, body: object) => f(`${base(url)}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { await r.text(); return r.ok; }, () => false);
  for (const m of (await ps(f, url)) ?? []) {
    if (!(await post("/api/generate", { model: m.name, keep_alive: 0 }))) await post("/api/embed", { model: m.name, input: [], keep_alive: 0 });
  }
  const until = Date.now() + UNLOAD_WAIT_MS;
  for (;;) {
    const left = await ps(f, url);
    if (left && left.length === 0) return;
    if (Date.now() > until) {
      const names = left?.map((m) => m.name) ?? ["(the /api/ps probe failed)"];
      throw new B7Abort(`Could not unload ${names.join(", ")} from the CPU server for a cold repeat. Run: $env:OLLAMA_HOST="${base(url).replace(/^https?:\/\//, "")}"; ollama stop <model>`);
    }
    await sleep(250);
  }
}

/** After a turn: nothing on the CPU server holds GPU memory, and (when the turn got a chat reply)
 *  the chat model is listed, so the check covered it. */
async function assertCpuOnly(f: typeof fetch, url: string, chatModel: string, where: string, calls: readonly TapCall[]): Promise<void> {
  const models = await ps(f, url);
  if (!models) throw new B7Abort(`VOID RUN — /api/ps on ${url} did not answer after ${where}, so the run cannot show it ran on CPU.`);
  const gpu = onGpu(models);
  if (gpu.length) throw new B7Abort(`VOID RUN — the CPU server has weights on a GPU after ${where}: ${gpu.join(", ")}. Start it with the GPU hidden (README.md, "b7-cpu").`);
  const answered = calls.some((c) => c.path === "/api/chat" && c.status === 200);
  if (answered && !models.some((m) => named(m, chatModel))) throw new B7Abort(`VOID RUN — ${chatModel} is not in /api/ps after ${where}, so the run cannot show it ran on CPU (is OLLAMA_KEEP_ALIVE 0 on the server?).`);
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface B7Plan {
  warmRepeats: number;
  coldRepeats: 1;
  k12: { subject: string; band: string; items: string[] };
  notes: { en: string; hi: string; vault: "RAG_FIXTURE"; syllabus: "matched"; retrieval: "always" };
  budgetMs: number;
  turnKinds: readonly B7TurnKind[];
}

export interface B7Result {
  plan: B7Plan;
  machine: MachineInfo | null;
  server: { url: string; threads: number | null; busyPctBefore: number | null; psBefore: PsModel[] | null };
  rows: Array<Omit<B7TurnRow, "calls"> & { calls: Array<Omit<TapCall, "ask" | "inputs"> & { ask: string; inputs: number }> }>;
  summary: B7Summary;
  /** Why the run stopped early, or null. A refused run has no rows; a void run keeps the rows it had. */
  abort: string | null;
}

/** For the results file: questions and embedded texts are long and already in the rows. */
const slim = (r: B7TurnRow): B7Result["rows"][number] => ({ ...r, calls: r.calls.map((c) => ({ ...c, ask: c.ask.slice(-120), inputs: c.inputs.length })) });

const K12_KINDS: B7TurnKind[] = ["k12-t1-new-problem", "k12-t2-wrong-try", "k12-t3-show-answer"];

/**
 * Run B7 against the CPU server at o.ollamaUrl. The caller (run.ts) has seeded the store, booted
 * tools, skills and the library, and checked both models are pulled. `write` gets the result, also
 * when the run aborts; then this throws.
 */
export async function runB7(o: EvalOptions, embedModel: string, write: (body: B7Result) => Promise<void>): Promise<B7Result> {
  const items = b7K12Items(1 + o.repeats);
  const en = b7NotesQuestion("notes-en");
  const hi = b7NotesQuestion("notes-hi-gloss");
  const plan: B7Plan = {
    warmRepeats: o.repeats,
    coldRepeats: 1,
    k12: { ...B7_K12, items: items.map((x) => x.id) },
    notes: { en: en.id, hi: hi.id, vault: "RAG_FIXTURE", syllabus: "matched", retrieval: "always" },
    budgetMs: B7_BUDGET_MS,
    turnKinds: B7_TURN_KINDS,
  };
  const rows: B7TurnRow[] = [];
  const result: B7Result = { plan, machine: null, server: { url: o.ollamaUrl, threads: null, busyPctBefore: null, psBefore: null }, rows: [], summary: summarizeB7([]), abort: null };
  const finish = async (abort: string | null) => {
    result.rows = rows.map(slim);
    result.summary = summarizeB7(rows);
    result.abort = abort;
    await write(result);
  };

  const tap = installTap();
  const f = tap.rawFetch;
  try {
    // Refusals, before any model call.
    if (base(o.ollamaUrl) !== B7_OTHER_OLLAMA_URL) {
      const other = await ps(f, B7_OTHER_OLLAMA_URL);
      if (other?.length) throw new B7Abort(`Refusing: the Ollama server at ${B7_OTHER_OLLAMA_URL} has ${other.map((m) => m.name).join(", ")} loaded. Another model run shares this CPU and memory. Wait for it to finish, then: ollama stop <model>.`);
    }
    result.server.psBefore = await ps(f, o.ollamaUrl);
    if (!result.server.psBefore) throw new B7Abort(`Refusing: /api/ps on ${o.ollamaUrl} did not answer.`);
    const gpu = onGpu(result.server.psBefore);
    if (gpu.length) throw new B7Abort(`Refusing: the server at ${o.ollamaUrl} has weights on a GPU: ${gpu.join(", ")}. B7 needs a CPU-only server (README.md, "b7-cpu").`);
    result.machine = await machineInfo();
    result.server.threads = o.serverLog ? await serverThreads(o.serverLog) : null;
    result.server.busyPctBefore = await cpuBusyPct();
    if (result.server.busyPctBefore > B7_MAX_BUSY_PCT) {
      throw new B7Abort(`Refusing: the CPU was ${result.server.busyPctBefore}% busy over 3 s before the run (limit ${B7_MAX_BUSY_PCT}%). Close what is using it and retry.`);
    }
    console.log(`[b7] ${o.model} on ${o.ollamaUrl} · ${result.machine.cpuModel} · ${result.machine.physicalCores ?? "?"} cores / ${result.machine.logicalCpus} threads · ${result.machine.ramGb} GB · server threads ${result.server.threads ?? "unknown"} · idle check ${result.server.busyPctBefore}% busy`);

    const resident = async () => {
      const models = (await ps(f, o.ollamaUrl)) ?? [];
      return { chat: models.some((m) => named(m, o.model)), embed: models.some((m) => named(m, embedModel)) };
    };
    const log = (r: B7TurnRow) => console.log(`[b7] ${r.kind.padEnd(19)} #${r.rep}${r.cold ? " cold" : "     "} ${r.item.padEnd(11)} wall ${r.wallMs} ms · ttft ${r.ttftMs ?? "-"} ms · prompt ${r.cost.promptTokens} tok @ ${r.cost.promptTokPerSec ?? "-"} tok/s · out ${r.cost.outputTokens} tok @ ${r.cost.outputTokPerSec ?? "-"} tok/s · load ${r.cost.loadMs} ms${r.error ? ` · ERROR ${r.error}` : ""}`);

    // ── k12-flow: one item per repeat, three turns ──
    const setup = await k12FlowSetup();
    const kernelTurn = k12FlowKernelTurn(setup);
    for (let rep = 0; rep < items.length; rep++) {
      const cold = rep === 0;
      if (cold) await unloadAll(f, o.ollamaUrl);
      let t = 0;
      // runK12FlowItem retries a turn that produced no reply. The first attempt is the measurement; a
      // retry is labelled apart and not counted.
      let attempt = 0;
      let lastUser = "";
      const timed: K12FlowTurnFn = async (messages, item) => {
        const user = messages[messages.length - 1].content;
        attempt = user === lastUser ? attempt + 1 : 0;
        if (attempt === 0) t = messages.filter((m) => m.role === "user").length - 1;
        lastUser = user;
        const kind = K12_KINDS[t];
        const residentBefore = await resident();
        tap.label = `${kind}#${rep}${attempt ? `@retry${attempt}` : ""}`;
        const started = performance.now();
        let row: B7TurnRow | null = null;
        try {
          const out = await kernelTurn(messages, item);
          const wallMs = Math.round(performance.now() - started);
          const failed = out.stopReason === "stalled" || out.stopReason === "aborted" ? `turn ${out.stopReason}` : !out.text.trim() ? "empty reply" : null;
          row = { kind, rep, cold: cold && t === 0, item: item.id, user, reply: out.text, stopReason: out.stopReason, error: failed, ttftMs: out.ttftMs, wallMs, residentBefore, gloss: null, workedAnswerRules: out.workedAnswerRules ?? null, cost: turnCost([], wallMs), calls: [] };
          return out;
        } catch (e) {
          if (e instanceof K12FlowAbort) throw e;
          const wallMs = Math.round(performance.now() - started);
          row = { kind, rep, cold: cold && t === 0, item: item.id, user, reply: "", stopReason: null, error: e instanceof Error ? e.message : String(e), ttftMs: null, wallMs, residentBefore, gloss: null, workedAnswerRules: null, cost: turnCost([], wallMs), calls: [] };
          throw e;
        } finally {
          tap.label = null;
          await tap.settle();
          const calls = tap.calls.filter((c) => c.label === `${kind}#${rep}`);
          if (row && attempt === 0) {
            row.calls = calls;
            row.cost = turnCost(calls, row.wallMs);
            rows.push(row);
            log(row);
          }
          await assertCpuOnly(f, o.ollamaUrl, o.model, `${kind} #${rep}`, calls);
        }
      };
      await runK12FlowItem(items[rep], timed);
    }

    // ── notes: cold en, cold hi, then warm en/hi alternated ──
    const notesTurn = async (kind: "notes-en" | "notes-hi-gloss", q: HeldoutQuestion, rep: number) => {
      const cold = rep === 0;
      if (cold) await unloadAll(f, o.ollamaUrl);
      const residentBefore = await resident();
      const label = `${kind}#${rep}`;
      tap.label = label;
      const from = tap.calls.length;
      const report = await runRagEval({ custom: { name: `b7-${kind}`, vault: RAG_FIXTURE, questions: [q] }, modes: ["always"], syllabus: "matched" })
        .finally(async () => { tap.label = null; await tap.settle(); });
      const r = report.rows[0];
      const { turn } = splitSetup(tap.calls.slice(from).filter((c) => c.label === label), q.ask);
      const error = r.answer.startsWith("ERROR:") ? r.answer : !r.answer.trim() ? "empty reply" : null;
      const row: B7TurnRow = { kind, rep, cold, item: q.id, user: q.ask, reply: error ? "" : r.answer, stopReason: null, error, ttftMs: r.ttft_ms, wallMs: r.total_ms, residentBefore, gloss: r.retrieval.gloss ?? null, workedAnswerRules: null, cost: turnCost(turn, r.total_ms), calls: turn };
      rows.push(row);
      log(row);
      await assertCpuOnly(f, o.ollamaUrl, o.model, `${kind} #${rep}`, turn);
    };
    await notesTurn("notes-en", en, 0);
    await notesTurn("notes-hi-gloss", hi, 0);
    for (let rep = 1; rep <= o.repeats; rep++) {
      await notesTurn("notes-en", en, rep);
      await notesTurn("notes-hi-gloss", hi, rep);
    }

    await finish(null);
    printSummary(result.summary);
    return result;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await finish(why).catch(() => {});
    throw e;
  } finally {
    tap.label = null;
    tap.uninstall();
  }
}

function printSummary(s: B7Summary): void {
  console.log("\n[b7] ── summary (warm repeats; nearest-rank percentiles) ─────────────");
  for (const k of s.kinds) {
    const st = Object.entries(k.stepsP50).map(([n, v]) => `${n} ${v ?? "-"}`).join(" · ");
    console.log(`[b7] ${k.kind.padEnd(19)} n=${k.warm} wall p50 ${k.wallMs.p50 ?? "-"} p90 ${k.wallMs.p90 ?? "-"} ms · ttft p50 ${k.ttftMs.p50 ?? "-"} p90 ${k.ttftMs.p90 ?? "-"} ms · ${k.underBudget === null ? "no data" : k.underBudget ? "UNDER" : "OVER"} ${s.budgetMs / 1000} s · slowest ${k.slowestStep ?? "-"} (${st})${k.errors ? ` · ${k.errors} error(s)` : ""}${k.warmReloads ? ` · ${k.warmReloads} warm reload(s)` : ""}${k.glossErrors ? ` · ${k.glossErrors} gloss error(s)` : ""}`);
  }
  if (s.coldStart) console.log(`[b7] cold-start first turn: wall ${s.coldStart.wallMs} ms · ttft ${s.coldStart.ttftMs ?? "-"} ms · load ${s.coldStart.loadMs} ms${s.coldStart.error ? ` · ERROR ${s.coldStart.error}` : ""}`);
  console.log(`[b7] every turn kind under ${s.budgetMs / 1000} s at p50: ${s.allUnderBudget === null ? "no data" : s.allUnderBudget ? "YES" : "NO"}${s.slowestKind ? ` · slowest kind ${s.slowestKind.kind} (p50 ${s.slowestKind.wallP50} ms, slowest step ${s.slowestKind.slowestStep})` : ""}`);
}
