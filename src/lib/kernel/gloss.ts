// Lever L2: gloss a non-English question into English before retrieval (docs/BENCHMARKS.md, section 3).
//
// Why: the notes and the library are mostly English, and the embedder (nomic-embed-text) is too. A
// question written in Hindi, Arabic or Amharic often spells the note's name in its own script, and the
// cosine to the English note then falls below MIN_NOTE_SCORE. That was the dominant cross-lingual
// miss on dev. Searching with an English gloss as well as the original puts the note back in reach
// without lowering the floor.
//
// What it costs: nothing on an English question (needsGloss is pure code, and an English turn's
// requests are byte for byte what they were before; english-path.test.ts pins them). One short
// structured call on a non-English one.
//
// The call is a CONTINUATION of the turn's own prefix: the same system prompt, the same tools, the
// same history and the student's message, plus one instruction at the end, at the same num_ctx. Two
// reasons, both about CPU boxes:
//   - Ollama keys the loaded runner on options like num_ctx. A different window reloads the model,
//     which measured 19 s on a CPU-only laptop.
//   - Ollama reuses the KV cache across an unchanged prefix. A gloss call with its own short prompt
//     would evict the cached system prompt, and the reply would pay ~10 s to prefill it again.
//
// The gloss only feeds retrieval. It is never shown to the student, never written into the student's
// message and never sent to the model as part of the reply turn.

import { callLLMStructured, type NeutralMessage, type ProviderToolDef } from "../llm";
import type { LLMConfig, ModelTier } from "../../types";

/** Longest gloss kept. A question is short; anything longer is the model answering, not glossing. */
const MAX_GLOSS_CHARS = 300;

const LATIN = /\p{Script=Latin}/u;
/** A letter or combining mark that belongs to a script. Common (ℏ, 𝑥, ª) and Inherited (a combining
 *  accent) are not any language's letters, so they count for neither side. */
const SCRIPT_CHAR = /(?![\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}]/gu;
const WORD = /[\p{L}\p{M}]+/gu;

/** Words shorter than this (in SCRIPT_CHARs) are ignored: maths symbols (θ, αβ, λμ, βγ) and
 *  two-letter function words. Marks count, so a Devanagari word keeps its vowel signs. */
const MIN_WORD_CHARS = 3;

/** Gloss when at least this share of the counted characters is in a non-Latin script. */
const MIN_NON_LATIN_SHARE = 0.5;

/** How long the gloss may take before the turn goes ahead on the original question alone. Sized for
 *  a GPU (p50 300 ms on e2b, 687 ms on qwen3.5:4b) with room for a CPU box (p50 1.31 s with
 *  num_gpu 0 on a Ryzen 7 5800H). A slower CPU loses the gloss, never the turn. */
export const GLOSS_TIMEOUT_MS = 3_000;

/** Output cap for the gloss call. A gloss is ~20 tokens of JSON; MAX_GLOSS_CHARS of English is under
 *  100. Without a cap the call inherits the reply's num_predict, and a rambling model keeps
 *  generating after a timeout has let the turn go on. */
export const GLOSS_NUM_PREDICT = 128;

/**
 * True when the question is mostly written in a script other than Latin: of the characters in words of
 * three or more, at least half are non-Latin. That is how a non-English question announces itself
 * without a model call.
 *
 * Why a share and not "any non-Latin word": English maths writes Greek and maths letters next to each
 * other ("the eigenvalues λμ", "ℏω", "(αβ)γ = α(βγ)", "𝑥𝑦 = 3"), and each of those used to cost an
 * English turn a model call and change its retrieval. Short words are ignored, Common-script letters
 * (ℏ, 𝑥) are not counted, and the rest is a vote by share. Latin-script languages (Spanish, French,
 * Swahili) are not detected: their names are spelled as in the notes, and they were not the misses
 * this lever targets. A question that is mostly English with one non-Latin word is not glossed either.
 */
export function needsGloss(text: string): boolean {
  let latin = 0, other = 0;
  for (const [word] of text.matchAll(WORD)) {
    const chars = word.match(SCRIPT_CHAR) ?? [];
    if (chars.length < MIN_WORD_CHARS) continue;
    for (const c of chars) if (LATIN.test(c)) latin++; else other++;
  }
  return other > 0 && other >= MIN_NON_LATIN_SHARE * (latin + other);
}

/** L2 runs only on Ollama. On a cloud provider the gloss is an extra paid call carrying the whole
 *  history, and the prefix-cache reason for its shape does not apply; that cost is unmeasured. */
export function shouldGloss(text: string, provider: string): boolean {
  return provider === "ollama" && needsGloss(text);
}

/** The instruction appended after the student's message for the gloss call. */
export const GLOSS_INSTRUCTION =
  "Before you reply: rewrite my last message in English, as a short search query for my notes. " +
  "Write every name in Latin letters. Do not answer it. " +
  'Return JSON: {"english": "<my last message in English>"}';

export const GLOSS_SCHEMA = {
  type: "object",
  properties: { english: { type: "string", minLength: 1, maxLength: MAX_GLOSS_CHARS } },
  required: ["english"],
  additionalProperties: false,
} as const;

/** The gloss call's messages: the turn's own messages, then the instruction. Nothing is rewritten. */
export function glossMessages(messages: NeutralMessage[]): Array<{ role: string; content: string }> {
  return [...messages.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: GLOSS_INSTRUCTION }];
}

/** The usable gloss, or null: trimmed, one line, non-empty, and not just the question echoed back. */
export function cleanGloss(raw: string, question: string): string | null {
  const g = raw.replace(/\s+/g, " ").trim();
  if (!g || g.length > MAX_GLOSS_CHARS) return null;
  if (g === question.replace(/\s+/g, " ").trim()) return null;
  return g;
}

export interface GlossResult {
  /** The English gloss, or null when the call failed or returned nothing usable. */
  text: string | null;
  ms: number;
  error?: string;
}

/**
 * Make the gloss call. Never throws: a failed or timed-out gloss means retrieval runs on the original
 * alone, as it did before L2. No repair retries: a second or third call costs more than the gloss is
 * worth.
 */
export async function glossQuestion(
  messages: NeutralMessage[],
  question: string,
  config: LLMConfig,
  opts: { tools?: ProviderToolDef[]; tier?: ModelTier; signal?: AbortSignal; timeoutMs?: number },
): Promise<GlossResult> {
  const started = performance.now();
  // Its own deadline, joined with the turn's abort. Without it the gloss inherits the tier's per-call
  // timeout (150 s on small), and since it runs before anything streams, a stalled gloss would hold
  // the turn that long with nothing on screen.
  const timeoutMs = opts.timeoutMs ?? GLOSS_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  try {
    const out = await callLLMStructured<{ english: string }>(glossMessages(messages), config, {
      schema: GLOSS_SCHEMA,
      toolName: "Gloss",
      maxRepairAttempts: 0,
      tier: opts.tier,
      signal,
      tools: opts.tools,
      numPredict: GLOSS_NUM_PREDICT,
    });
    return { text: cleanGloss(out.english, question), ms: Math.round(performance.now() - started) };
  } catch (e) {
    const error = deadline.aborted && !opts.signal?.aborted
      ? `gloss timed out after ${timeoutMs} ms`
      : e instanceof Error ? e.message : String(e);
    return { text: null, ms: Math.round(performance.now() - started), error };
  }
}
