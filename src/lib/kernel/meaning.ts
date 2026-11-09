// Lever 9g (issue #204): a meaning check under the notes-miss switch. The switch (askedThing.ts, lever
// 9e) decides from words whether the shown passages mention the thing asked about, and on real notes it
// is wrong in a way that hides the student's right notes: "What is the formula for kinetic energy?"
// over notes that write "KE = ½mv²", a typo, an abbreviation, a description instead of a name. This
// compares meaning instead: the question and every sentence of the shown passages (their full chunk text,
// which on a long note is more than the block shows) go to the embedder in
// one call, and the switch may fire only when no sentence comes within NOTES_MEANING_MIN of the
// question. One embed call, made only on a turn the switch would fire on; no chat call.
//
// Known limits, to settle before this ships: the threshold is calibrated on nomic-embed-text only (an
// OpenAI embedding model has a different cosine scale); embed() takes no abort signal and its retries
// can hold a fired turn for about 6 s on a flaky Ollama; a fired turn embeds up to about 60 sentences.
//
// NOTES_MEANING_MIN was chosen offline on dev data before any model run (PR body): sentence cosine,
// nomic-embed-text, no task prefix, the question as typed. Over 164 dev positives and 167 near-misses,
// the word switch alone (with the multi-sentence guard) hid 19 right notes and caught 129 near-misses;
// with the check at 0.68 it hid 0 and caught 80.

import { embed } from "../llm";
import { getEmbeddingConfig } from "../store";
import { sentenceSpans } from "./ground";

export const NOTES_MEANING_MIN = 0.68;

/** The sentences the check compares the question with: line or sentence units, trimmed, over 3 chars. */
export function meaningSentences(passages: string[]): string[] {
  return passages.flatMap((p) => sentenceSpans(p).map(([a, b]) => p.slice(a, b).trim())).filter((s) => s.length > 3);
}

function cosine(a: number[], b: number[]): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** The highest cosine between the question and any sentence of the passages; null when the embedder
 *  failed or there is no sentence (the caller then does not fire: an unknown is not a miss). */
export async function nearestSentence(question: string, passages: string[], signal?: AbortSignal): Promise<number | null> {
  const sentences = meaningSentences(passages);
  if (!sentences.length || signal?.aborted) return null;
  try {
    const [q, ...vs] = await embed([question, ...sentences], await getEmbeddingConfig());
    if (!q || vs.length !== sentences.length) return null;
    return Math.max(...vs.map((v) => cosine(q, v)));
  } catch {
    return null;
  }
}
