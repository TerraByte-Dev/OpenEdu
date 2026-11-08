// `npm run eval` options, read from environment variables. Pure: no I/O, no Tauri.
// The full list, with examples, is in ./README.md.

import type { LLMProvider } from "../../../types";
import type { RetrievalMode } from "../../kernel/ground";
import { STORE_KEYS, apiKeyStoreKey } from "../../store-keys";
import type { RagPrompt } from "../rag-runner";

export type EvalSuite = "rag" | "k12-flow";

export interface EvalOptions {
  suite: EvalSuite;
  provider: LLMProvider;
  model: string;
  ollamaUrl: string;
  /** Unset: the app's default embedding model for the embedding provider (Ollama). */
  embedModel?: string;
  /** Cloud providers only. Read from EVAL_API_KEY, never written to the results file. */
  apiKey?: string;
  set: "main" | "dev" | "test" | "dev-v2" | "sealed";
  /** Required when set is "sealed". */
  sealedPath?: string;
  repeats: number;
  /** Unset: the runner's own default (both mechanisms). */
  modes?: RetrievalMode[];
  only?: string;
  syllabus?: "python" | "matched";
  /** RAG only: the instructions arm (rag-runner.ts ragInstructions). Unset: the runner's default. */
  prompt?: RagPrompt;
  /** The Settings context-window cap. Unset: the app default. */
  maxContextTokens?: number;
  /** k12-flow only: the first N items. */
  limit?: number;
  /** k12-flow only: N items stratified by subject, fixed seed (select.ts). */
  sample?: number;
  /** Unset: .dev/eval-runs/<stamp>-<suite>-<set>-<model>.json under the working directory. */
  out?: string;
  /** Record Ollama's own timing and token counts for every chat request (wire.ts). Requests unchanged. */
  wire: boolean;
  /** Ollama only: add options.num_gpu to every chat and embed request (0 = CPU only). Changes the
   *  requests on purpose, for latency runs; such a run is not a parity run. */
  numGpu?: number;
}

export const DEFAULT_EVAL_MODEL = "gemma4:e2b";
const PROVIDERS: LLMProvider[] = ["ollama", "openai", "anthropic"];
const SUITES: EvalSuite[] = ["rag", "k12-flow"];
const SETS = ["main", "dev", "test", "dev-v2", "sealed"] as const;
const MODES: RetrievalMode[] = ["always", "auto", "off"];
// Kept in step with rag-runner.ts RAG_PROMPTS by parity.test.ts (importing the runner here would pull the
// kernel into a module that is meant to stay pure).
const PROMPTS: RagPrompt[] = ["standin", "product-default", "product-course"];

/** Parse the EVAL_* variables. Throws one error naming every bad value. */
export function parseEvalEnv(env: Record<string, string | undefined>): EvalOptions {
  const errs: string[] = [];
  const get = (k: string) => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };

  const suite = (get("EVAL_SUITE") ?? "rag") as EvalSuite;
  if (!SUITES.includes(suite)) errs.push(`EVAL_SUITE=${suite}: use ${SUITES.join(", ")}`);
  const flow = suite === "k12-flow";

  const provider = (get("EVAL_PROVIDER") ?? "ollama") as LLMProvider;
  if (!PROVIDERS.includes(provider)) errs.push(`EVAL_PROVIDER=${provider}: use ${PROVIDERS.join(", ")}`);
  const apiKey = get("EVAL_API_KEY");
  if (provider !== "ollama" && !apiKey) errs.push(`EVAL_PROVIDER=${provider} needs EVAL_API_KEY`);

  const set = (get("EVAL_SET") ?? (flow ? "dev" : "main")) as EvalOptions["set"];
  if (!SETS.includes(set)) errs.push(`EVAL_SET=${set}: use ${SETS.join(", ")}`);
  // The k12 test items are in the sealed v2 file. Running them needs the frozen path through
  // loadSealed and all its refusals, which k12-flow does not have yet. The 240 k12-mc items are DEV.
  if (flow && set !== "dev") errs.push(`EVAL_SET=${set}: k12-flow runs only the dev items (the 240 k12-mc items) for now`);
  // k12-flow's configuration is frozen by its protocol (one sample, retrieval "always", no syllabus).
  if (flow) {
    for (const k of ["EVAL_REPEATS", "EVAL_MODES", "EVAL_SYLLABUS", "EVAL_SEALED", "EVAL_PROMPT"]) if (get(k)) errs.push(`${k} does not apply to k12-flow`);
  }
  const sealedPath = get("EVAL_SEALED");
  if (!flow && set === "sealed" && !sealedPath) errs.push("EVAL_SET=sealed needs EVAL_SEALED=<path to the sealed file>");
  // A partial sealed run still reads, and so burns, the whole set (protocol rule 8).
  if (set === "sealed" && get("EVAL_ONLY")) errs.push("EVAL_ONLY is not allowed with EVAL_SET=sealed: the run covers every item");
  if (set === "sealed" && get("EVAL_MODES")) errs.push("EVAL_MODES is not allowed with EVAL_SET=sealed: the run uses the runner's default modes");
  // Choosing the prompt arm per sealed run would let the sealed set pick it. The sealed run uses the default.
  if (set === "sealed" && get("EVAL_PROMPT")) errs.push("EVAL_PROMPT is not allowed with EVAL_SET=sealed: the run uses the runner's default prompt");

  const repeatsRaw = get("EVAL_REPEATS") ?? "1";
  const repeats = Number(repeatsRaw);
  if (!Number.isInteger(repeats) || repeats < 1) errs.push(`EVAL_REPEATS=${repeatsRaw}: a whole number, 1 or more`);

  let modes: RetrievalMode[] | undefined;
  const modesRaw = get("EVAL_MODES");
  if (modesRaw) {
    modes = modesRaw.split(",").map((m) => m.trim()) as RetrievalMode[];
    const bad = modes.filter((m) => !MODES.includes(m));
    if (bad.length || modes.length === 0) errs.push(`EVAL_MODES=${modesRaw}: comma list of ${MODES.join(", ")}`);
  }

  const prompt = get("EVAL_PROMPT") as RagPrompt | undefined;
  if (prompt !== undefined && !PROMPTS.includes(prompt)) errs.push(`EVAL_PROMPT=${prompt}: use ${PROMPTS.join(", ")}`);

  const syllabus = get("EVAL_SYLLABUS") as EvalOptions["syllabus"];
  if (syllabus !== undefined && syllabus !== "python" && syllabus !== "matched") errs.push(`EVAL_SYLLABUS=${syllabus}: use python or matched`);

  let maxContextTokens: number | undefined;
  const ctxRaw = get("EVAL_CTX");
  if (ctxRaw) {
    maxContextTokens = Number(ctxRaw);
    if (!Number.isInteger(maxContextTokens) || maxContextTokens <= 0) errs.push(`EVAL_CTX=${ctxRaw}: a whole number of tokens`);
  }

  const count = (k: string): number | undefined => {
    const raw = get(k);
    if (raw === undefined) return undefined;
    if (!flow) errs.push(`${k} applies to k12-flow only (rag takes EVAL_ONLY)`);
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1) errs.push(`${k}=${raw}: a whole number, 1 or more`);
    return v;
  };
  const limit = count("EVAL_LIMIT");
  const sample = count("EVAL_SAMPLE");

  const wireRaw = get("EVAL_WIRE");
  if (wireRaw !== undefined && wireRaw !== "1" && wireRaw !== "0") errs.push(`EVAL_WIRE=${wireRaw}: use 1 or 0`);
  let numGpu: number | undefined;
  const gpuRaw = get("EVAL_NUM_GPU");
  if (gpuRaw !== undefined) {
    numGpu = Number(gpuRaw);
    if (!Number.isInteger(numGpu) || numGpu < 0) errs.push(`EVAL_NUM_GPU=${gpuRaw}: a whole number, 0 or more`);
    if (provider !== "ollama") errs.push("EVAL_NUM_GPU applies to Ollama only");
    if (set === "sealed") errs.push("EVAL_NUM_GPU is not allowed with EVAL_SET=sealed: it changes the requests");
  }

  if (errs.length) throw new Error(`Bad eval options:\n  ${errs.join("\n  ")}`);
  return {
    suite,
    provider,
    model: get("EVAL_MODEL") ?? DEFAULT_EVAL_MODEL,
    ollamaUrl: get("EVAL_OLLAMA_URL") ?? "http://127.0.0.1:11434",
    embedModel: get("EVAL_EMBED_MODEL"),
    apiKey,
    set,
    sealedPath,
    repeats,
    modes,
    only: get("EVAL_ONLY"),
    syllabus,
    prompt,
    maxContextTokens,
    limit,
    sample,
    out: get("EVAL_OUT"),
    wire: wireRaw === "1",
    numGpu,
  };
}

/**
 * The settings store a learner would have after picking this provider and model in Settings, and
 * nothing else. Every key left out reads as unset, so store.ts falls back to the same defaults the
 * app uses.
 */
export function storeValuesFor(o: EvalOptions): Record<string, unknown> {
  const v: Record<string, unknown> = {
    [STORE_KEYS.provider]: o.provider,
    [STORE_KEYS.chatModel]: o.model,
    [STORE_KEYS.genModel]: o.model,
    [STORE_KEYS.ollamaUrl]: o.ollamaUrl,
  };
  if (o.embedModel) v[STORE_KEYS.embeddingModel] = o.embedModel;
  if (o.maxContextTokens) v[STORE_KEYS.maxContextTokens] = o.maxContextTokens;
  if (o.apiKey) v[apiKeyStoreKey(o.provider)] = o.apiKey;
  return v;
}

export interface GitState {
  commit: string | null;
  /** Uncommitted or untracked changes under src/. */
  srcDirty: boolean | null;
  /** `git diff master -- src` is not empty. */
  srcDiffersFromMaster: boolean | null;
  /** Tags pointing at HEAD. */
  tags: string[] | null;
}

/**
 * Protocol rule 4 for a sealed run: the reason it must not start, or null. Checked before the set is
 * read, because reading it burns it (rule 8).
 */
export function sealedGitRefusal(g: GitState): string | null {
  const why =
    g.commit === null || g.srcDirty === null || g.srcDiffersFromMaster === null || g.tags === null ? "git state could not be read (is git on PATH, and is there a master branch?)"
    : g.srcDirty ? "src/ has uncommitted changes"
    : g.srcDiffersFromMaster ? "src/ differs from master"
    : !g.tags.some((t) => t.startsWith("eval-test-")) ? "HEAD has no eval-test-<date> tag"
    : null;
  return why && `Refusing the sealed run: ${why}. heldout-v2-protocol.md rule 4: run at an eval-test-<date> tag with git diff against master = 0 in src/.`;
}

/** Default results path, relative to the main checkout (see run.ts). */
export function defaultOutPath(o: EvalOptions, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const model = o.model.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `.dev/eval-runs/${stamp}-${o.suite}-${o.set}-${model}.json`;
}
