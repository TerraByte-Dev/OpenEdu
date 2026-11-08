// Lever L2: gloss a non-English question into English before retrieval (docs/BENCHMARKS.md, section 3).
//
// Why: the notes and the library are mostly English, and the embedder (nomic-embed-text) is too. A
// question written in Hindi, Arabic or Amharic often spells the note's name in its own script, and the
// cosine to the English note then falls below MIN_NOTE_SCORE. That was the dominant cross-lingual
// miss on dev. Searching with an English gloss as well as the original puts the note back in reach
// without lowering the floor.
//
// What it costs: nothing on a question needsGloss rejects. That check is pure code, and the turn then
// skips the gloss block entirely. english-path.test.ts pins the requests of its English questions
// byte for byte against a snapshot written before L2, and 0 of 90 English dev rows changed retrieval.
// That is what is proven; needsGloss is a heuristic, not a language detector, so some English text
// can still be glossed. One short structured call on a glossed question.
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

import { callLLMStructured, ollamaModelLoaded, type NeutralMessage, type ProviderToolDef } from "../llm";
import type { LLMConfig, ModelTier } from "../../types";

/** Longest gloss kept. A question is short; anything longer is the model answering, not glossing. */
const MAX_GLOSS_CHARS = 300;

const LATIN = /\p{Script=Latin}/u;
/** A letter or combining mark that belongs to a script. Common (ℏ, 𝑥, ª) and Inherited (a combining
 *  accent) are not any language's letters, so they count for neither side. */
const SCRIPT_CHAR = /(?![\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}]/gu;
const WORD = /[\p{L}\p{M}]+/gu;

/** Scripts where one character is a whole syllable (Hangul, Kana, Ethiopic) or a morpheme (Han). */
const SYLLABIC = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Ethiopic}]/u;
const GREEK = /\p{Script=Greek}/u;

/**
 * The shortest word counted, in SCRIPT_CHARs, by the script of the word's first one:
 *   - Greek 4. English maths writes Greek letters side by side in groups of up to three (λμ, αβγ,
 *     βγδ). Greek prose still counts: its one- to three-letter words (η, το, και) drop out, its
 *     content words (είναι, φωτοσύνθεση) do not.
 *   - Hangul, Han, Kana and Ethiopic 1. One character is a syllable, so 세포 (cell) and ምን (what) are
 *     whole words, and a short Korean or Amharic question can be nothing but two-character words.
 *   - Everything else 2, Latin included. Arabic leaves short vowels unwritten, so its commonest words
 *     are two letters (ما، هو، في، من); a two-character Devanagari word is a consonant and a vowel sign,
 *     a full syllable (है, में, का). A lone letter (x, θ, ω) is maths, not language, outside the
 *     syllabic scripts.
 */
function minWordChars(first: string): number {
  return GREEK.test(first) ? 4 : SYLLABIC.test(first) ? 1 : 2;
}

/** What one Hangul, Han, Kana or Ethiopic character counts for in the share, in letters. A syllable
 *  written in Latin letters is at least a consonant and a vowel (세 se, ም mi, の no). Counted as 1,
 *  "ATP 합성" (ATP synthesis) would be 3 Latin letters against 2 Korean ones and stay unglossed,
 *  although each Korean character is a syllable and the acronym is the only English in it. */
const SYLLABLE_WEIGHT = 2;

/** Gloss when at least this share of the counted, weighted characters is in a non-Latin script. */
const MIN_NON_LATIN_SHARE = 0.5;

/** How long the gloss may take, when the chat model is already in memory, before the turn goes ahead
 *  on the original question alone. Sized for a GPU (p50 300 ms on e2b, 687 ms on qwen3.5:4b) with
 *  room for a CPU box (p50 1.31 s with num_gpu 0 on a Ryzen 7 5800H). Every one of those was measured
 *  with the model loaded and the prefix cached. */
export const GLOSS_TIMEOUT_MS = 3_000;

/** The deadline when Ollama does not have the chat model in memory at this num_ctx (/api/ps), or
 *  cannot say. The gloss is then the turn's first call and pays the load and a cold prefill: 2.9–5.3 s
 *  of load measured on GPU, and 6.5 s of load plus 4.1 s of prefill on CPU, about 12 s with the gloss
 *  itself. Most of that wait is not added to the turn: the reply would pay the same load if the gloss
 *  did not, and it reuses the system prompt and tools the gloss leaves cached. 20 s is the CPU figure
 *  with room for a slower box. */
export const GLOSS_COLD_TIMEOUT_MS = 20_000;

/** Output cap for the gloss call. A gloss is ~20 tokens of JSON; MAX_GLOSS_CHARS of English is under
 *  100. Without a cap the call inherits the reply's num_predict, and a rambling model keeps
 *  generating after a timeout has let the turn go on. */
export const GLOSS_NUM_PREDICT = 128;

/**
 * True when the question is mostly written in a script other than Latin: of the characters in words
 * long enough to count (minWordChars), with each Hangul, Han, Kana or Ethiopic character weighing
 * SYLLABLE_WEIGHT, at least half are non-Latin. That is how a non-English question announces itself
 * without a model call.
 *
 * Why a share and not "any non-Latin word": English maths writes Greek and maths letters next to each
 * other ("the eigenvalues λμ", "ℏω", "Is αβγ = γβα?", "𝑥𝑦 = 3"), and each of those used to cost an
 * English turn a model call and change its retrieval. Short Greek groups are ignored, Common-script
 * letters (ℏ, 𝑥) are not counted, and the rest is a vote by share. Latin-script languages (Spanish,
 * French, Swahili) are not detected: their names are spelled as in the notes, and they were not the
 * misses this lever targets. A question that is mostly English with one non-Latin word is not glossed
 * either.
 */
export function needsGloss(text: string): boolean {
  let latin = 0, other = 0;
  for (const [word] of text.matchAll(WORD)) {
    const chars = word.match(SCRIPT_CHAR) ?? [];
    const first = chars[0];
    if (!first || chars.length < minWordChars(first)) continue;
    for (const c of chars) {
      if (LATIN.test(c)) latin++;
      else other += SYLLABIC.test(c) ? SYLLABLE_WEIGHT : 1;
    }
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
  opts: { tools?: ProviderToolDef[]; tier?: ModelTier; signal?: AbortSignal; deadlines?: { warm: number; cold: number } },
): Promise<GlossResult> {
  const started = performance.now();
  const { warm, cold } = opts.deadlines ?? { warm: GLOSS_TIMEOUT_MS, cold: GLOSS_COLD_TIMEOUT_MS };
  // Its own deadline, joined with the turn's abort. Without it the gloss inherits the tier's per-call
  // timeout (150 s on small), and since it runs before anything streams, a stalled gloss would hold
  // the turn that long with nothing on screen. Built from a plain AbortController, setTimeout and a
  // listener, not AbortSignal.any or AbortSignal.timeout, which older macOS and Linux webviews lack,
  // and set up inside the try, so nothing here can throw past it.
  const controller = new AbortController();
  const onTurnAbort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutMs = warm;
  let timedOut = false;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timeoutMs = ms;
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(0, ms - (performance.now() - started)));
  };
  try {
    if (opts.signal?.aborted) controller.abort();
    else opts.signal?.addEventListener("abort", onTurnAbort, { once: true });
    // The warm deadline also bounds the /api/ps probe. A model that is not in memory, or a probe that
    // cannot tell, gets the cold deadline instead, counted from the same start.
    arm(warm);
    if ((await ollamaModelLoaded(config, controller.signal)) !== true) arm(cold);
    const out = await callLLMStructured<{ english: string }>(glossMessages(messages), config, {
      schema: GLOSS_SCHEMA,
      toolName: "Gloss",
      maxRepairAttempts: 0,
      tier: opts.tier,
      signal: controller.signal,
      tools: opts.tools,
      numPredict: GLOSS_NUM_PREDICT,
    });
    return { text: cleanGloss(out.english, question), ms: Math.round(performance.now() - started) };
  } catch (e) {
    const error = timedOut && !opts.signal?.aborted
      ? `gloss timed out after ${timeoutMs} ms`
      : e instanceof Error ? e.message : String(e);
    return { text: null, ms: Math.round(performance.now() - started), error };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onTurnAbort);
  }
}
