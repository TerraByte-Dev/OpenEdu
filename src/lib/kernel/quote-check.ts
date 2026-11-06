// Quote check — the model points at the sentence that answers; code decides whether it exists.
//
// Why: on qwen3.5:0.8b the grounding stage leaks on NEAR-MISS questions — a note about Verrin
// solution is retrieved for "Does Verrin solution conduct electricity?" although it never says, and
// the model answers from it with a citation. No retrieval-only rule separates those (the 2026-11-06
// gate study: own-note AUC 0.391), because similarity measures topic, not whether the answer is there.
// Only something that reads the content can tell, so this asks the model to read — and then does not
// trust it: the model must COPY the answering sentence, and code keeps a passage only if that copy is
// literally in it. A model that invents a quote, or quotes the question back, loses the grounding.
//
// Cost: one extra structured call per grounded turn. Off unless the turn asks for it (TutorTurn.quoteCheck).
// Fails CLOSED: if the call errors, the turn goes ungrounded. Ungrounded is a worse answer; a wrongly
// grounded one is a citation the student cannot tell from a real one.

import { callLLMStructured } from "../llm";
import { words } from "../library-rank";
import { capText, estTokens } from "./budget";
import { contentWords, formatGroundingBlock, MAX_HIT_TOKENS, type Grounding, type GroundingHit } from "./ground";
import type { LLMConfig, ModelTier } from "../../types";

export const QUOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { quote: { type: "string" } },
  required: ["quote"],
};

/** Below this many content words a "quote" is a name or a fragment ("Verrin solution"), not an answer. */
export const MIN_QUOTE_WORDS = 3;

const norm = (s: string): string => ` ${words(s).join(" ")} `;

/**
 * The hits that literally contain `quote`, compared word by word (case, punctuation and spacing
 * ignored). Empty when the quote is too short or adds nothing the question did not already say —
 * copying the note's restatement of the topic is not evidence that the note holds the answer.
 */
export function quotedHits(quote: string, question: string, hits: GroundingHit[]): GroundingHit[] {
  const qWords = contentWords(quote);
  if (qWords.length < MIN_QUOTE_WORDS) return [];
  const asked = new Set(contentWords(question));
  if (qWords.every((w) => asked.has(w))) return [];
  const q = norm(quote);
  return hits.filter((h) => norm(capText(h.text.trim(), MAX_HIT_TOKENS)).includes(q));
}

export function quotePrompt(question: string, hits: GroundingHit[]): Array<{ role: string; content: string }> {
  const passages = hits
    .map((h, i) => `[${i + 1}] ${h.title}\n${capText(h.text.trim(), MAX_HIT_TOKENS)}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "You check whether passages answer a question. Copy, word for word, the one sentence from the " +
        "passages that directly answers the question. If no sentence directly answers it, return an " +
        "empty string. Never answer from your own knowledge and never write a sentence that is not in " +
        "the passages.",
    },
    { role: "user", content: `${passages}\n\nQuestion: ${question}` },
  ];
}

export async function quoteCheck(
  question: string,
  grounding: Grounding,
  opts: { config: LLMConfig; tier?: ModelTier; maxTokens: number; signal?: AbortSignal },
): Promise<Grounding> {
  if (grounding.hits.length === 0) return grounding;
  let quote = "";
  let error: string | undefined;
  try {
    const out = await callLLMStructured<{ quote: string }>(quotePrompt(question, grounding.hits), opts.config, {
      schema: QUOTE_SCHEMA,
      toolName: "Quote",
      maxRepairAttempts: 1,
      temperature: 0,
      signal: opts.signal,
      tier: opts.tier,
    });
    quote = out.quote ?? "";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const hits = error ? [] : quotedHits(quote, question, grounding.hits);
  const block = formatGroundingBlock(hits, opts.maxTokens);
  return {
    block,
    hits,
    trace: {
      ...grounding.trace,
      skipped: hits.length ? grounding.trace.skipped : "no-quote",
      hitTitles: hits.map((h) => h.title),
      blockTokens: estTokens(block),
      quote,
      error: error ?? grounding.trace.error,
    },
  };
}
