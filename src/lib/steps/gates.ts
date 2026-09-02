// The compile-time validators — where the generator's authority is taken away.
//
// Every item, however produced, must survive all of these before it can be served. They are cheap,
// deterministic, and they run without a model. Rejections are counted BY GATE, because "we produced
// 400 items and kept 300" is not a diagnosis and "V0 rejected 80 dangling figure references" is.

import { normalizeAnswer } from "../quiz-grading";
import { check } from "./checkers";
import type { Item } from "./types";

export type GateName = "V0" | "V1" | "V2" | "V3";

export interface GateResult {
  kept: Item[];
  rejected: Array<{ item: Item; gate: GateName; why: string }>;
}

/**
 * V0 — ANSWERABILITY. Zero model calls.
 *
 * "Using the data in Table 7.3, compute Kc" passes every other gate and is unanswerable once the
 * table did not survive extraction. Any dangling reference to a numbered figure, table, equation or
 * page is rejected outright. V0 rejections are reported SEPARATELY from yield, because they measure
 * the extractor rather than the corpus.
 */
const DANGLING = /\b(?:fig(?:ure)?|table|eq(?:uation)?|problem|exercise|example|scheme|plate)\s*\.?\s*\d+(?:\.\d+)?/i;
// Each alternative carries its own terminator. A trailing \b after "p\." can NEVER match:
// both the period and the space after it are non-word characters, so there is no boundary.
const REFERS_OUT = /\bsee\s+(?:pp?\.|page\b|above\b|below\b|previous\b|next\b|the\s+following\b)/i;

export function v0Answerable(item: Item): string | null {
  if (DANGLING.test(item.stem)) return "stem references a numbered figure/table that may not exist";
  if (REFERS_OUT.test(item.stem)) return "stem defers to text outside itself";
  return null;
}

/**
 * V1 — GROUNDEDNESS. The gate that matters most.
 *
 * The expected answer must appear in the span the item claims to come from. This makes a fabricated
 * answer key STRUCTURALLY IMPOSSIBLE rather than merely detectable — which is what lets a pipeline
 * use a model it does not trust. For harvested items it is trivially satisfied (the key IS the
 * data); it earns its keep the moment anything is model-authored.
 */
export function v1Grounded(item: Item): string | null {
  const span = normalizeAnswer(item.span);
  const want =
    item.expected.kind === "exact_set" ? item.expected.any[0]
    : item.expected.kind === "numeric" ? String(item.expected.value)
    : item.expected.kind === "order" ? item.expected.items.join(" ")
    : item.expected.require.join(" ");
  const needle = normalizeAnswer(want);
  if (!needle) return "empty expected value";
  if (item.expected.kind === "numeric") {
    // A numeric key may be formatted differently in prose ("1,024" vs 1024) — compare digits.
    const digits = (s: string) => s.replace(/[^0-9.-]/g, "");
    return digits(span).includes(digits(needle)) ? null : "expected value absent from its own span";
  }
  return span.includes(needle) ? null : "expected value absent from its own span";
}

/**
 * V2 — SELF-EVALUATION. Run the item's own checker against its own expected value.
 * A key its own grader marks wrong is broken by construction, and this costs microseconds.
 */
export function v2SelfConsistent(item: Item): string | null {
  const answer =
    item.expected.kind === "exact_set" ? item.expected.any[0]
    : item.expected.kind === "numeric" ? String(item.expected.value)
    : item.expected.kind === "order" ? item.expected.items.join(", ")
    : item.expected.require.join(" ");
  const v = check(item.expected, answer);
  return v === "correct" ? null : `checker returns "${v}" on its own key`;
}

/**
 * V3 — LEAK. The stem must not contain the answer.
 * Catches "What is the second law of thermodynamics called?" -> "the second law of thermodynamics".
 */
export function v3NoLeak(item: Item): string | null {
  if (item.expected.kind !== "exact_set") return null;
  const ans = normalizeAnswer(item.expected.any[0]);
  if (ans.length < 3) return null; // a 2-char symbol appearing incidentally is not a leak
  const stem = normalizeAnswer(item.stem);
  // Only a whole-token appearance counts — "or" inside "order" is not a leak.
  return new RegExp(`(^| )${ans.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(stem)
    ? "stem contains the answer"
    : null;
}

export function runGates(items: Item[]): GateResult {
  const kept: Item[] = [];
  const rejected: GateResult["rejected"] = [];
  const checks: Array<[GateName, (i: Item) => string | null]> = [
    ["V0", v0Answerable],
    ["V1", v1Grounded],
    ["V2", v2SelfConsistent],
    ["V3", v3NoLeak],
  ];
  for (const item of items) {
    let failed = false;
    for (const [gate, fn] of checks) {
      const why = fn(item);
      if (why) { rejected.push({ item, gate, why }); failed = true; break; }
    }
    if (!failed) kept.push(item);
  }
  return { kept, rejected };
}
