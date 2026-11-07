// The headless eval entry: `npm run eval` (vitest.eval.config.ts → run.eval.ts → here).
//
// It does what the app does before a dev-console eval, then calls the SAME runner function the
// webview hook calls (window.__runRagEval = runRagEval). The only things swapped are underneath the
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
import { HELDOUT_V2_SHA256, loadSealed } from "../sealed";
import { seedStore } from "./shims/plugin-store";
import { installAppOrigin } from "./origin";
import { parseEvalEnv, storeValuesFor, defaultOutPath, sealedGitRefusal, type EvalOptions } from "./env";
import { cwd, path, writeText, gitState, mainCheckout } from "./node-io";

export interface HeadlessResult {
  report: RagReport;
  outFile: string;
}

const pulled = (models: string[], want: string) => models.some((m) => m === want || m === `${want}:latest`);

// Fail before seeding anything if Ollama is down or a model is missing. The runner would also fail,
// but later and less clearly (an embed error at the first note).
async function preflight(o: EvalOptions, embedModel: string): Promise<void> {
  const tags = await getOllamaModels(o.ollamaUrl);
  if (tags.error) throw new Error(`Ollama is not reachable at ${o.ollamaUrl}: ${tags.error}. Start it with "ollama serve".`);
  const missing = [...(o.provider === "ollama" ? [o.model] : []), embedModel].filter((m) => !pulled(tags.models, m));
  if (missing.length) throw new Error(`Not pulled in Ollama: ${missing.join(", ")}. Run: ${missing.map((m) => `ollama pull ${m}`).join(" && ")}`);
}

export async function runHeadlessEval(env: Record<string, string | undefined>): Promise<HeadlessResult> {
  const o = parseEvalEnv(env);
  const git = await gitState();
  // Rule 4 before the set is touched: reading it burns it.
  const refusal = o.set === "sealed" ? sealedGitRefusal(git) : null;
  if (refusal) throw new Error(refusal);

  // Settings first: the store is read by everything below.
  seedStore(STORE_FILE, storeValuesFor(o));
  installAppOrigin();

  // What the store resolves for embeddings is what the runner will use; ask it rather than guess.
  await preflight(o, (await getEmbeddingConfig()).model);

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
  const report = await runRagEval({
    repeats: o.repeats,
    modes: o.modes,
    only: o.only,
    syllabus: o.syllabus,
    ...(custom ? { custom } : { set: o.set as "main" | "dev" | "test" }),
  });
  const finished = new Date();

  const p = await path();
  // EVAL_OUT is relative to where you ran it; the default lands in the main checkout's .dev/, which a
  // linked worktree's removal would otherwise delete with it.
  const outFile = o.out ? p.resolve(cwd(), o.out) : p.resolve(await mainCheckout(), defaultOutPath(o, started));
  const options = { ...o, apiKey: undefined }; // dropped by JSON.stringify: a key never reaches the file
  await writeText(outFile, JSON.stringify({
    suite: o.suite,
    options,
    commit: git.commit,
    srcDirty: git.srcDirty,
    srcDiffersFromMaster: git.srcDiffersFromMaster,
    tags: git.tags,
    library,
    sealedSha256,
    started: started.toISOString(),
    finished: finished.toISOString(),
    ...report,
  }, null, 2));
  console.log(`[eval] results: ${outFile}`);
  return { report, outFile };
}
