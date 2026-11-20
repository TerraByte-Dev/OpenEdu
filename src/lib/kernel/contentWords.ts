// A question's content words: what grounding searches on. Pure and Tauri-free, and a leaf: ground.ts
// gates retrieval on it, and notebook-words.ts matches notes to a question with it when there is no
// embedder, without importing ground.ts (which imports notebook.ts).

import { words, wordLength } from "../library-rank";

// Mirrors library.ts's stopword list; kept local so this module stays independent of it. The trailing
// group is acknowledgement vocabulary — the words that make up a turn carrying no question at all
// ("ok got it", "sure thanks", "cool"). They are what lets ground.ts's MIN_CONTENT_WORDS sit at 1 without
// retrieving on every "yeah makes sense".
export const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "was", "were", "what", "whats",
  "show", "me", "my", "tell", "about", "give", "list", "and", "or", "how", "do", "does", "did",
  "i", "you", "can", "could", "with", "this", "that", "it", "its", "be", "been", "have", "has",
  "if", "then", "so", "but", "not", "no", "yes", "please", "thanks", "thank", "ok", "okay",
  "got", "get", "sure", "great", "cool", "nice", "right", "yeah", "yep", "sense", "makes", "wow",
]);

export function contentWords(s: string): string[] {
  // words() is the shared Unicode splitter (library-rank.ts). On ASCII it is exactly the old
  // `.toLowerCase().split(/[^a-z0-9]+/)`; on Hindi, Amharic or Arabic it is the difference between a
  // question and "short-query", which skipped grounding for every non-Latin student.
  return words(s).filter((t) => wordLength(t) >= 2 && !STOPWORDS.has(t));
}
