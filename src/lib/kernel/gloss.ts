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
const LETTER = /\p{L}/gu;
const WORD = /[\p{L}\p{M}]+/gu;

/**
 * True when the text contains a word in a script other than Latin: two or more letters, none of them
 * Latin. That is how a non-English question announces itself without a model call.
 *
 * Two letters, not one, so a lone Greek letter in an English maths question ("what is sin θ?",
 * "the π in the formula") does not trigger a call. Latin-script languages (Spanish, French,
 * Swahili) are not detected: their names are spelled as in the notes, and they were not the misses
 * this lever targets.
 */
export function needsGloss(text: string): boolean {
  for (const [word] of text.matchAll(WORD)) {
    const letters = word.match(LETTER) ?? [];
    if (letters.length >= 2 && !letters.some((c) => LATIN.test(c))) return true;
  }
  return false;
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
 * Make the gloss call. Never throws: a failed gloss means retrieval runs on the original alone, as
 * it did before L2. No repair retries: a second or third call costs more than the gloss is worth.
 */
export async function glossQuestion(
  messages: NeutralMessage[],
  question: string,
  config: LLMConfig,
  opts: { tools?: ProviderToolDef[]; tier?: ModelTier; signal?: AbortSignal },
): Promise<GlossResult> {
  const started = performance.now();
  try {
    const out = await callLLMStructured<{ english: string }>(glossMessages(messages), config, {
      schema: GLOSS_SCHEMA,
      toolName: "Gloss",
      maxRepairAttempts: 0,
      tier: opts.tier,
      signal: opts.signal,
      tools: opts.tools,
    });
    return { text: cleanGloss(out.english, question), ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { text: null, ms: Math.round(performance.now() - started), error: e instanceof Error ? e.message : String(e) };
  }
}
