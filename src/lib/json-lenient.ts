// Lenient JSON parsing for model output, moved out of llm.ts so Tauri-free modules can use it
// (llm.ts imports @tauri-apps/plugin-http).

// Small Ollama models often emit raw LaTeX (\alpha, \frac, \pi, \sum, ...) inside
// JSON string values without doubling the backslash. JSON.parse rejects those as
// "Bad escaped character", and even when grammar-constrained sampling lets them
// through, \t / \b / \n get silently decoded into control characters that corrupt
// stored content. Double any backslash that isn't followed by a valid JSON escape.
export function sanitizeJsonEscapes(s: string): string {
  return s.replace(/\\(?!["\\\/bfnrtu])/g, "\\\\");
}

// Try JSON.parse, with a stray-backslash repair retry as a fallback.
export function tryParseJsonLenient(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return JSON.parse(sanitizeJsonEscapes(raw)); }
}
