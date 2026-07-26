// Token budget for one tutoring turn (docs/ARCHITECTURE.md).
//
// Before this module the kernel handed the provider an unbounded message array and let the server
// decide what to drop. Ollama drops from the FRONT — which is exactly where the system prompt and
// the <tools> manifest live. So a long conversation silently lost its persona, its syllabus, and its
// knowledge that tools exist, and the floor model looked like it had "stopped using RAG" when in
// fact the instruction telling it to ground had been evicted. `stopHooks.ts` has promised this file
// since Phase 1; this is it.
//
// The rule: the window is an explicit number the APP chooses, and the kernel enforces it before
// every model call. Nothing is left to the server.
//
// Pure and Tauri-free — unit-tested next to mastery.ts / srs.ts.

// ── Estimation ───────────────────────────────────────────────────────────────

// ~4 chars/token. Deliberately the same cheap estimator notebook.ts:27 uses for chunk sizing, so
// chunk budgets and context budgets speak one unit. It runs on every message of every turn, so it
// stays O(1) — a real tokenizer would be more accurate and is not worth the bundle or the latency.
// It over-estimates on code/markup and under-estimates on CJK; `RESERVE_FRACTION` absorbs the error.
const CHARS_PER_TOKEN = 4;

export function estTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── The budget ───────────────────────────────────────────────────────────────

// What the app asks Ollama for when the model's own maximum is larger. 8192 is the smallest window
// that comfortably holds a ~1,200-token system prompt, a retrieved-context block, and a real
// conversation. Raising it costs RAM on the KV cache — which is why this is a user-visible setting
// and why `keep_alive` is deliberately NOT shipped alongside it (see #86): both multiply resident
// memory, and on a 4GB machine the combination is what produces `signal: killed`.
export const DEFAULT_CONTEXT_TOKENS = 8192;

// Never go below this — under ~2k there is no room for a system prompt plus one exchange, and every
// provider default is at least this.
export const MIN_CONTEXT_TOKENS = 2048;

// Fractions of the window. They sum to 1.0.
//   system    — the assembled system prompt + the <tools> manifest
//   grounding — retrieved passages injected before the model runs (Phase 1 uses this; today it is
//               unclaimed and `fitMessages` lends it to history rather than wasting it)
//   history   — prior turns
//   reserve   — headroom for the model's own output, plus estimator error
const SYSTEM_FRACTION = 0.25;
const GROUNDING_FRACTION = 0.20;
const HISTORY_FRACTION = 0.40;
const RESERVE_FRACTION = 0.15;

export interface Budget {
  total: number;
  system: number;
  grounding: number;
  history: number;
  reserve: number;
}

export function budgetFor(contextTokens: number): Budget {
  const total = Math.max(MIN_CONTEXT_TOKENS, Math.floor(contextTokens) || DEFAULT_CONTEXT_TOKENS);
  return {
    total,
    system: Math.floor(total * SYSTEM_FRACTION),
    grounding: Math.floor(total * GROUNDING_FRACTION),
    history: Math.floor(total * HISTORY_FRACTION),
    reserve: Math.floor(total * RESERVE_FRACTION),
  };
}

// ── Truncation ───────────────────────────────────────────────────────────────

// Cap a single blob of text, leaving a VISIBLE marker. The marker matters: a silently truncated tool
// result teaches the model that it received the whole thing, and it will then answer confidently from
// a fragment. Told it was cut, it can search again or say it does not know.
export function capText(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  // Prefer cutting on a whitespace boundary so we don't hand the model half a token/word.
  const hard = text.slice(0, maxChars);
  const lastBreak = hard.lastIndexOf("\n") >= maxChars * 0.6 ? hard.lastIndexOf("\n") : hard.lastIndexOf(" ");
  const body = lastBreak > maxChars * 0.5 ? hard.slice(0, lastBreak) : hard;
  return `${body}\n…[truncated: showing ${body.length} of ${text.length} characters]`;
}

// ── Fitting a conversation ───────────────────────────────────────────────────

export interface FitMessage {
  role: string;
  content: string;
}

export interface FitResult<T extends FitMessage> {
  messages: T[];
  dropped: number;
  usage: { system: number; history: number; total: number };
}

// The note that replaces an elided prefix. The model is told history was trimmed rather than being
// left to infer it from a conversation that appears to begin mid-thought.
function elisionNote(dropped: number): FitMessage {
  return {
    role: "system",
    content: `[${dropped} earlier message${dropped === 1 ? "" : "s"} in this session were trimmed to fit the context window. Ask the student to restate anything you need from earlier.]`,
  };
}

// Fit a message array into `budget`, dropping the OLDEST non-system messages first.
//
// Invariants, in priority order:
//   1. Every leading system message survives. It carries the persona, the syllabus, and the tools
//      manifest — losing it is the exact failure this module exists to prevent.
//   2. The final message survives, whatever its size. It is the student's current question.
//   3. The kept window never STARTS on a "tool" message. A tool result orphaned from the assistant
//      turn that called it is a hard 400 on OpenAI and Anthropic, so the cut advances past any
//      partial tool block.
//
// The grounding slice is lent to history when no retrieved block has claimed it, so a Phase-0 build
// (no retrieval yet) uses the window it actually has instead of reserving 20% for nothing.
export function fitMessages<T extends FitMessage>(
  messages: T[],
  budget: Budget,
  opts: { groundingUsed?: number } = {},
): FitResult<T> {
  const groundingUsed = Math.max(0, opts.groundingUsed ?? 0);
  const historyAllowance = budget.history + Math.max(0, budget.grounding - groundingUsed);

  // Leading system messages are pinned; everything after is candidate history.
  let pin = 0;
  while (pin < messages.length && messages[pin].role === "system") pin++;
  const head = messages.slice(0, pin);
  const rest = messages.slice(pin);

  const systemTokens = head.reduce((n, m) => n + estTokens(m.content), 0);
  if (rest.length === 0) {
    return { messages: [...head], dropped: 0, usage: { system: systemTokens, history: 0, total: systemTokens } };
  }

  // Walk backwards from the newest message, keeping what fits.
  let used = 0;
  let cut = rest.length; // index of the first KEPT message in `rest`
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estTokens(rest[i].content);
    // Invariant 2: the newest message is kept unconditionally, even if it alone blows the allowance.
    if (i === rest.length - 1 || used + cost <= historyAllowance) {
      used += cost;
      cut = i;
    } else {
      break;
    }
  }

  // Invariant 3: never begin on an orphaned tool result. Only a cut can orphan one — if `cut` is
  // still 0 nothing was dropped, so a leading "tool" message is whatever the caller handed us and
  // removing it would be the bug rather than the fix.
  while (cut > 0 && cut < rest.length - 1 && rest[cut].role === "tool") {
    used -= estTokens(rest[cut].content);
    cut++;
  }

  const kept = rest.slice(cut);
  const dropped = cut;
  const out = dropped > 0
    ? [...head, elisionNote(dropped) as T, ...kept]
    : [...head, ...kept];

  const noteTokens = dropped > 0 ? estTokens(elisionNote(dropped).content) : 0;
  return {
    messages: out,
    dropped,
    usage: { system: systemTokens, history: used + noteTokens, total: systemTokens + used + noteTokens },
  };
}

// A one-line readout for the dev console / diagnostics: `system 1240 · history 1900 · free 956 / 8192`.
export function formatBudgetUsage(budget: Budget, usage: FitResult<FitMessage>["usage"]): string {
  const free = Math.max(0, budget.total - usage.total - budget.reserve);
  return `system ${usage.system} · history ${usage.history} · reserve ${budget.reserve} · free ${free} / ${budget.total}`;
}
