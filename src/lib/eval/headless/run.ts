// The headless eval entry: `npm run eval` (vitest.eval.config.ts → run.eval.ts → here).
//
// It does what the app does before a dev-console eval, then calls the SAME runner function the
// webview hook calls (window.__runRagEval = runRagEval; window.__runK12FlowEval → runK12FlowItems).
// The only things swapped are underneath the
// kernel, by alias in vitest.eval.config.ts: SQLite (node:sqlite, in memory, real migrations), HTTP
// (Node fetch), the settings store (in memory, seeded below) and the app origin (public/ on disk).

import { STORE_FILE } from "../../store-keys";
import { getOllamaModels } from "../../llm";
import { getEmbeddingConfig, getLibraryEnabled } from "../../store";
import { registerBuiltinTools } from "../../tools";
import { loadBuiltinSkills } from "../../skills";
import { refreshManifest, isLibraryAvailable, getManifest } from "../../library";
import { refreshDatasetManifest } from "../../library-datasets";
import { runRagEval, type RagCustomSet, type RagReport } from "../rag-runner";
import { runK12FlowItems, runK12FlowFrItems, type K12FlowReport, type K12FlowFrReport } from "../k12-flow-runner";
import { K12FlowAbort, type K12FlowRow } from "../k12-flow";
import { summarizeK12Flow } from "../k12-flow-grade";
import { K12_ITEMS } from "../k12-items";
import type { K12FlowFrRow } from "../k12-flow-fr";
import { summarizeK12FlowFr } from "../k12-flow-fr-grade";
import { K12_FR_ITEMS } from "../k12-flow-fr-items";
import { HELDOUT_V2_SHA256, loadSealed } from "../sealed";
import { K12_FLOW_SAMPLE_SEED, selectK12FlowItems } from "./select";
import { seedStore } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { installWire } from "./wire";
import { parseEvalEnv, storeValuesFor, defaultOutPath, sealedGitRefusal, type EvalOptions } from "./env";
import { cwd, path, writeText, gitState, mainCheckout } from "./node-io";
import { ollamaRunInfo } from "./ollama-info";
import { runB7, type B7Result } from "./latency";

export interface HeadlessResult {
  report: RagReport | K12FlowReport | K12FlowFrReport | B7Result;
  outFile: string;
}

const pulled = (models: string[], want: string) => models.some((m) => m === want || m === `${want}:latest`);

// Fail before seeding anything if Ollama is down or a model is missing. The runner would also fail,
// but later and less clearly (an embed error at the first note).
async function preflight(o: EvalOptions, embedModel: string): Promise<void> {
  const tags = await getOllamaModels(o.ollamaUrl);
  const start = o.suite === "b7-cpu" ? 'Start the CPU-only server as src/lib/eval/headless/README.md shows ("b7-cpu")' : 'Start it with "ollama serve"';
  if (tags.error) throw new Error(`Ollama is not reachable at ${o.ollamaUrl}: ${tags.error}. ${start}.`);
  const missing = [...(o.provider === "ollama" ? [o.model] : []), embedModel].filter((m) => !pulled(tags.models, m));
  if (missing.length) throw new Error(`Not pulled in Ollama: ${missing.join(", ")}. Run: ${missing.map((m) => `ollama pull ${m}`).join(" && ")}`);
}

export async function runHeadlessEval(env: Record<string, string | undefined>): Promise<HeadlessResult> {
  const o = parseEvalEnv(env);
  // Pick the k12-flow items before anything is seeded: a bad EVAL_ONLY id fails fast.
  const flowItems = o.suite === "k12-flow" ? selectK12FlowItems(K12_ITEMS, o) : null;
  const frItems = o.suite === "k12-flow-fr" ? selectK12FlowItems(K12_FR_ITEMS, o) : null;
  const git = await gitState();
  // Rule 4 before the set is touched: reading it burns it.
  const refusal = o.set === "sealed" ? sealedGitRefusal(git) : null;
  if (refusal) throw new Error(refusal);

  // Settings first: the store is read by everything below.
  seedStore(STORE_FILE, storeValuesFor(o));
  installAppOrigin();
  // Off unless EVAL_WIRE or EVAL_NUM_GPU is set; then every Ollama chat/embed request goes through it.
  const wire = installWire({ log: o.wire, numGpu: o.numGpu });

  // What the store resolves for embeddings is what the runner will use; ask it rather than guess.
  const embedModel = (await getEmbeddingConfig()).model;
  await preflight(o, embedModel);
  // The Ollama version and the digest of every model the run uses, so two arms can be checked for
  // "same Ollama, same weights" from their files alone.
  const ollama = await ollamaRunInfo(o.ollamaUrl, [...(o.provider === "ollama" ? [o.model] : []), embedModel]);

  // Sealed set: hash check, schema check and name lint all happen inside loadSealed, before any
  // model call (protocol rules 1 and 2).
  let custom: RagCustomSet | undefined;
  let sealedSha256: string | null = null;
  if (o.set === "sealed") {
    const loaded = await loadSealed(o.sealedPath!, HELDOUT_V2_SHA256);
    custom = { name: "sealed-v2", vault: loaded.set.rag.notes, questions: loaded.set.rag.items };
    sealedSha256 = loaded.sha256;
    console.log(`[eval] sealed set verified: sha256 ${loaded.sha256} · name lint clean (${loaded.lintedTokens} token(s))`);
  }

  // The app's boot (main.tsx): tools, skills, and the bundled library manifests. The webview runner
  // relies on these having run at app start; here they run before it.
  registerBuiltinTools();
  await loadBuiltinSkills();
  await refreshManifest();
  await refreshDatasetManifest();
  // refreshManifest swallows errors, so a missing public/ would quietly drop the library from grounding
  // and the tool list. Refuse instead, and record what loaded.
  const libraryEnabled = await getLibraryEnabled();
  if (libraryEnabled && !isLibraryAvailable()) {
    throw new Error(`The library is enabled but its manifest did not load from ${(await path()).resolve(cwd(), "public", "library")}. Run npm run eval from the repo root.`);
  }
  const library = { enabled: libraryEnabled, cards: libraryEnabled ? (await getManifest()).length : 0 };

  const started = new Date();
  const p = await path();
  // EVAL_OUT is relative to where you ran it; the default lands in the main checkout's .dev/, which a
  // linked worktree's removal would otherwise delete with it.
  const outFile = o.out ? p.resolve(cwd(), o.out) : p.resolve(await mainCheckout(), defaultOutPath(o, started));
  const options = { ...o, apiKey: undefined }; // dropped by JSON.stringify: a key never reaches the file
  const write = async (body: object) => { await wire.settle(); return writeText(outFile, JSON.stringify({
    suite: o.suite,
    options,
    commit: git.commit,
    srcDirty: git.srcDirty,
    srcDiffersFromMaster: git.srcDiffersFromMaster,
    tags: git.tags,
    library,
    ollama,
    sealedSha256,
    started: started.toISOString(),
    finished: new Date().toISOString(),
    ...body,
    ...(o.wire ? { wire: wire.calls } : {}),
  }, null, 2)).then(() => console.log(`[eval] results: ${outFile}`)); };

  if (o.suite === "b7-cpu") {
    const report = await runB7(o, embedModel, (body) => write({ split: "dev", ...body }));
    return { report, outFile };
  }

  if (flowItems) {
    const report = await runFlow(flowItems, o, write);
    return { report, outFile };
  }
  if (frItems) {
    const report = await runFlowFr(frItems, o, write);
    return { report, outFile };
  }

  const report = await runRagEval({
    repeats: o.repeats,
    modes: o.modes,
    only: o.only,
    syllabus: o.syllabus,
    prompt: o.prompt,
    passageWindow: o.passageWindow,
    ...(custom ? { custom } : { set: o.set as "main" | "dev" | "test" | "dev-v2" | "blind-10" }),
  });
  await write(report);
  return { report, outFile };
}

// k12-flow through the webview runner's own function. Each row is written out with its item's
// subject and band. A void run (K12FlowAbort) still writes its rows and summary before it throws:
// every run is reported (BENCHMARKS.md, anti-cheating rule 7).
async function runFlow(items: typeof K12_ITEMS, o: EvalOptions, write: (body: object) => Promise<void>): Promise<K12FlowReport> {
  const byId = new Map(K12_ITEMS.map((x) => [x.id, x]));
  const selection = { pool: K12_ITEMS.length, items: items.length, only: o.only ?? null, limit: o.limit ?? null, sample: o.sample ?? null, seed: o.sample ? K12_FLOW_SAMPLE_SEED : null };
  const withItem = (rows: K12FlowRow[]) => rows.map(({ id, ...r }) => ({ id, subject: byId.get(id)!.subject, band: byId.get(id)!.band, ...r }));
  let log: K12FlowRow[] = [];
  try {
    const report = await runK12FlowItems(items, { onRows: (rows) => { log = rows; } });
    await write({ split: "dev", selection, ...report, rows: withItem(report.rows), abort: null });
    return report;
  } catch (e) {
    if (e instanceof K12FlowAbort) {
      await write({ split: "dev", selection, partial: true, abort: e.message, rows: withItem(log), summary: summarizeK12Flow(log) });
    }
    throw e;
  }
}

// k12-flow-fr the same way: the runner's own function, every row with its item's subject and band, a
// void run written before it throws.
async function runFlowFr(items: typeof K12_FR_ITEMS, o: EvalOptions, write: (body: object) => Promise<void>): Promise<K12FlowFrReport> {
  const byId = new Map(K12_FR_ITEMS.map((x) => [x.id, x]));
  const selection = { pool: K12_FR_ITEMS.length, items: items.length, only: o.only ?? null, limit: o.limit ?? null, sample: o.sample ?? null, seed: o.sample ? K12_FLOW_SAMPLE_SEED : null };
  const withItem = (rows: K12FlowFrRow[]) => rows.map(({ id, ...r }) => ({ id, subject: byId.get(id)!.subject, band: byId.get(id)!.band, ...r }));
  let log: K12FlowFrRow[] = [];
  try {
    const report = await runK12FlowFrItems(items, { onRows: (rows) => { log = rows; } });
    await write({ split: "dev", selection, ...report, rows: withItem(report.rows), abort: null });
    return report;
  } catch (e) {
    if (e instanceof K12FlowAbort) {
      await write({ split: "dev", selection, partial: true, abort: e.message, rows: withItem(log), summary: summarizeK12FlowFr(log) });
    }
    throw e;
  }
}
