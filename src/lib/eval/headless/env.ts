// `npm run eval` options, read from environment variables. Pure: no I/O, no Tauri.
// The full list, with examples, is in ./README.md.

import type { LLMProvider } from "../../../types";
import type { RetrievalMode } from "../../kernel/ground";
import { STORE_KEYS, apiKeyStoreKey } from "../../store-keys";

export interface EvalOptions {
  suite: "rag";
  provider: LLMProvider;
  model: string;
  ollamaUrl: string;
  /** Unset: the app's default embedding model for the embedding provider (Ollama). */
  embedModel?: string;
  /** Cloud providers only. Read from EVAL_API_KEY, never written to the results file. */
  apiKey?: string;
  set: "main" | "dev" | "test" | "sealed";
  /** Required when set is "sealed". */
  sealedPath?: string;
  repeats: number;
  /** Unset: the runner's own default (both mechanisms). */
  modes?: RetrievalMode[];
  only?: string;
  syllabus?: "python" | "matched";
  /** The Settings context-window cap. Unset: the app default. */
  maxContextTokens?: number;
  /** Unset: .dev/eval-runs/<stamp>-<suite>-<set>-<model>.json under the working directory. */
  out?: string;
}

export const DEFAULT_EVAL_MODEL = "gemma4:e2b";
const PROVIDERS: LLMProvider[] = ["ollama", "openai", "anthropic"];
const SETS = ["main", "dev", "test", "sealed"] as const;
const MODES: RetrievalMode[] = ["always", "auto", "off"];

/** Parse the EVAL_* variables. Throws one error naming every bad value. */
export function parseEvalEnv(env: Record<string, string | undefined>): EvalOptions {
  const errs: string[] = [];
  const get = (k: string) => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };

  const suite = get("EVAL_SUITE") ?? "rag";
  if (suite !== "rag") errs.push(`EVAL_SUITE=${suite}: only "rag" runs headless so far`);

  const provider = (get("EVAL_PROVIDER") ?? "ollama") as LLMProvider;
  if (!PROVIDERS.includes(provider)) errs.push(`EVAL_PROVIDER=${provider}: use ${PROVIDERS.join(", ")}`);
  const apiKey = get("EVAL_API_KEY");
  if (provider !== "ollama" && !apiKey) errs.push(`EVAL_PROVIDER=${provider} needs EVAL_API_KEY`);

  const set = (get("EVAL_SET") ?? "main") as EvalOptions["set"];
  if (!SETS.includes(set)) errs.push(`EVAL_SET=${set}: use ${SETS.join(", ")}`);
  const sealedPath = get("EVAL_SEALED");
  if (set === "sealed" && !sealedPath) errs.push("EVAL_SET=sealed needs EVAL_SEALED=<path to the sealed file>");
  // A partial sealed run still reads, and so burns, the whole set (protocol rule 8).
  if (set === "sealed" && get("EVAL_ONLY")) errs.push("EVAL_ONLY is not allowed with EVAL_SET=sealed: the run covers every item");
  if (set === "sealed" && get("EVAL_MODES")) errs.push("EVAL_MODES is not allowed with EVAL_SET=sealed: the run uses the runner's default modes");

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

  const syllabus = get("EVAL_SYLLABUS") as EvalOptions["syllabus"];
  if (syllabus !== undefined && syllabus !== "python" && syllabus !== "matched") errs.push(`EVAL_SYLLABUS=${syllabus}: use python or matched`);

  let maxContextTokens: number | undefined;
  const ctxRaw = get("EVAL_CTX");
  if (ctxRaw) {
    maxContextTokens = Number(ctxRaw);
    if (!Number.isInteger(maxContextTokens) || maxContextTokens <= 0) errs.push(`EVAL_CTX=${ctxRaw}: a whole number of tokens`);
  }

  if (errs.length) throw new Error(`Bad eval options:\n  ${errs.join("\n  ")}`);
  return {
    suite: "rag",
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
    maxContextTokens,
    out: get("EVAL_OUT"),
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
