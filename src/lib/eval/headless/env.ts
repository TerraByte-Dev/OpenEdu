// `npm run eval` options, read from environment variables. Pure: no I/O, no Tauri.
// The full list, with examples, is in ./README.md.

import type { LLMProvider } from "../../../types";
import type { RetrievalMode } from "../../kernel/ground";
import { STORE_KEYS, apiKeyStoreKey } from "../../store-keys";
import type { RagPrompt } from "../rag-runner";

export type EvalSuite = "rag" | "k12-flow" | "k12-flow-fr" | "b7-cpu" | "define";

export interface EvalOptions {
  suite: EvalSuite;
  provider: LLMProvider;
  model: string;
  ollamaUrl: string;
  /** Unset: the app's default embedding model for the embedding provider (Ollama). */
  embedModel?: string;
  /** Cloud providers only. Read from EVAL_API_KEY, never written to the results file. */
  apiKey?: string;
  /** "blind-19": define only, lever 19's held-out set (src/lib/eval/blind-19/items.json). */
  set: "main" | "dev" | "test" | "dev-v2" | "sealed" | "blind-19";
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
  /** k12-flow and k12-flow-fr only: the first N items. */
  limit?: number;
  /** k12-flow and k12-flow-fr only: N items stratified by subject, fixed seed (select.ts). */
  sample?: number;
  /** Unset: .dev/eval-runs/<stamp>-<suite>-<set>-<model>.json under the working directory. */
  out?: string;
  /** Record Ollama's own timing and token counts for every chat request (wire.ts). Requests unchanged. */
  wire: boolean;
  /** Ollama only: add options.num_gpu to every chat and embed request (0 = CPU only). Changes the
   *  requests on purpose, for latency runs; such a run is not a parity run. */
  numGpu?: number;
  /** b7-cpu only: the CPU server's log file, read for the thread count its runner started with. */
  serverLog?: string;
  /** define only: "off" sends no dictionary note (kernel defineWord.ts), the paired baseline at the same
   *  commit. Unset: "on", what the app does. */
  dictionary?: "on" | "off";
  /** define only: "off" keeps the dictionary senses in stored order (lever 18 as shipped), lever 19's
   *  arm S at the same commit. Unset: "on", the ranker (arm R), what the app does. */
  senseRank?: "on" | "off";
}

export const DEFAULT_EVAL_MODEL = "gemma4:e2b";
const PROVIDERS: LLMProvider[] = ["ollama", "openai", "anthropic"];
const SUITES: EvalSuite[] = ["rag", "k12-flow", "k12-flow-fr", "b7-cpu", "define"];
/** b7-cpu talks to a second, CPU-only Ollama server on its own port (README.md, "b7-cpu"). */
export const B7_DEFAULT_OLLAMA_URL = "http://127.0.0.1:11435";
export const B7_DEFAULT_REPEATS = 5;
const SETS = ["main", "dev", "test", "dev-v2", "sealed", "blind-19"] as const;
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
  // k12-flow-fr is the same flow on typed problems without options: every k12-flow rule applies.
  const flow = suite === "k12-flow" || suite === "k12-flow-fr";
  const b7 = suite === "b7-cpu";
  const define = suite === "define";

  const provider = (get("EVAL_PROVIDER") ?? "ollama") as LLMProvider;
  if (!PROVIDERS.includes(provider)) errs.push(`EVAL_PROVIDER=${provider}: use ${PROVIDERS.join(", ")}`);
  const apiKey = get("EVAL_API_KEY");
  if (provider !== "ollama" && !apiKey) errs.push(`EVAL_PROVIDER=${provider} needs EVAL_API_KEY`);

  const set = (get("EVAL_SET") ?? (flow || b7 || define ? "dev" : "main")) as EvalOptions["set"];
  if (!SETS.includes(set)) errs.push(`EVAL_SET=${set}: use ${SETS.join(", ")}`);
  if (set === "blind-19" && !define) errs.push("EVAL_SET=blind-19 is the define suite's held-out set (lever 19)");
  // The k12 test items are in the sealed v2 file. Running them needs the frozen path through
  // loadSealed and all its refusals, which k12-flow does not have yet. The 240 k12-mc items are DEV.
  if (flow && set !== "dev") errs.push(`EVAL_SET=${set}: ${suite} runs only the dev items (${suite === "k12-flow" ? "the 240 k12-mc items" : "the free-response items derived from them"}) for now`);
  // k12-flow's configuration is frozen by its protocol (one sample, retrieval "always", no syllabus).
  if (flow) {
    for (const k of ["EVAL_REPEATS", "EVAL_MODES", "EVAL_SYLLABUS", "EVAL_SEALED", "EVAL_PROMPT"]) if (get(k)) errs.push(`${k} does not apply to ${suite}`);
  }
  // b7-cpu's scenarios, retrieval mode and requests are fixed by its pre-registration (latency.ts). It
  // measures the requests the app sends, so nothing that changes them is accepted.
  if (b7) {
    if (provider !== "ollama") errs.push("EVAL_SUITE=b7-cpu runs on Ollama only");
    if (set !== "dev") errs.push(`EVAL_SET=${set}: b7-cpu runs its own fixed dev scenarios`);
    for (const k of ["EVAL_MODES", "EVAL_ONLY", "EVAL_SYLLABUS", "EVAL_SEALED", "EVAL_NUM_GPU", "EVAL_WIRE", "EVAL_PROMPT"]) if (get(k)) errs.push(`${k} does not apply to b7-cpu`);
  } else if (get("EVAL_B7_SERVER_LOG")) {
    errs.push("EVAL_B7_SERVER_LOG applies to b7-cpu only");
  }
  // define: its own items (define-items.ts), dev or test split; one user turn, retrieval "always", no
  // syllabus, ChatTab's prompt (define-runner.ts). Repeats and EVAL_ONLY are allowed.
  if (define) {
    if (set !== "dev" && set !== "test" && set !== "blind-19") errs.push(`EVAL_SET=${set}: define runs its own dev or test split, or blind-19`);
    for (const k of ["EVAL_MODES", "EVAL_SYLLABUS", "EVAL_SEALED", "EVAL_PROMPT"]) if (get(k)) errs.push(`${k} does not apply to define`);
    // The test split runs once, whole, at 3 repeats (lever 18): a one-item smoke run would write test
    // replies before the frozen run.
    // blind-19 is a test set too (lever 19): run once, whole, at 3 repeats.
    if (set === "test" || set === "blind-19") {
      const name = set === "test" ? "test split" : "blind-19 set";
      if (get("EVAL_ONLY")) errs.push(`EVAL_ONLY is not allowed on the define ${name}: the run covers every item`);
      if (get("EVAL_REPEATS") !== "3") errs.push(`The define ${name} runs EVAL_REPEATS=3 (pre-registered)`);
    }
  }
  const dictionary = get("EVAL_DICTIONARY") as EvalOptions["dictionary"];
  if (dictionary !== undefined) {
    if (dictionary !== "on" && dictionary !== "off") errs.push(`EVAL_DICTIONARY=${dictionary}: use on or off`);
    // Every other suite's messages never fire the detector (define-false-fires.test.ts), so the switch
    // could only make a run look like an arm it is not.
    if (!define) errs.push("EVAL_DICTIONARY applies to define only");
  }
  const senseRank = get("EVAL_SENSE_RANK") as EvalOptions["senseRank"];
  if (senseRank !== undefined) {
    if (senseRank !== "on" && senseRank !== "off") errs.push(`EVAL_SENSE_RANK=${senseRank}: use on or off`);
    if (!define) errs.push("EVAL_SENSE_RANK applies to define only");
  }
  const sealedPath = get("EVAL_SEALED");
  if (!flow && set === "sealed" && !sealedPath) errs.push("EVAL_SET=sealed needs EVAL_SEALED=<path to the sealed file>");
  // A partial sealed run still reads, and so burns, the whole set (protocol rule 8).
  if (set === "sealed" && get("EVAL_ONLY")) errs.push("EVAL_ONLY is not allowed with EVAL_SET=sealed: the run covers every item");
  if (set === "sealed" && get("EVAL_MODES")) errs.push("EVAL_MODES is not allowed with EVAL_SET=sealed: the run uses the runner's default modes");
  // Choosing the prompt arm per sealed run would let the sealed set pick it. The sealed run uses the default.
  if (set === "sealed" && get("EVAL_PROMPT")) errs.push("EVAL_PROMPT is not allowed with EVAL_SET=sealed: the run uses the runner's default prompt");

  const repeatsRaw = get("EVAL_REPEATS") ?? (b7 ? String(B7_DEFAULT_REPEATS) : "1");
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
    if (!flow) errs.push(`${k} applies to k12-flow only, and to k12-flow-fr (rag takes EVAL_ONLY)`);
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
    ollamaUrl: get("EVAL_OLLAMA_URL") ?? (b7 ? B7_DEFAULT_OLLAMA_URL : "http://127.0.0.1:11434"),
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
    serverLog: b7 ? get("EVAL_B7_SERVER_LOG") : undefined,
    dictionary: define ? (dictionary ?? "on") : undefined,
    senseRank: define ? (senseRank ?? "on") : undefined,
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
  // define: the arm is in the name, since the arms run at one commit: B = EVAL_DICTIONARY=off, S =
  // EVAL_SENSE_RANK=off (lever 19's baseline), and the note with the ranker: D on B8's splits, R on blind-19.
  const arm = o.suite === "define" ? `-${o.dictionary === "off" ? "B" : o.senseRank === "off" ? "S" : o.set === "blind-19" ? "R" : "D"}` : "";
  return `.dev/eval-runs/${stamp}-${o.suite}-${o.set}${arm}-${model}.json`;
}
