import { describe, it, expect, vi } from "vitest";

// The dictionary note's harm guard on the existing suites (docs/BENCHMARKS.md lever 18): the detector
// (kernel/defineWord.ts askedWord) must not fire on any student message the existing evals send, so
// every existing suite's requests are unchanged by the lever. Checked here, before any run, on the
// messages exactly as the runners build them, and on every string literal in src/lib/eval as a
// superset (which also covers the questions written inside the headless tests).

vi.mock("@tauri-apps/plugin-sql", () => import("./headless/shims/plugin-sql"));
vi.mock("@tauri-apps/plugin-http", () => import("./headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./headless/shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./headless/shims/api-core"));

import { askedWord } from "../kernel/defineWord";
import { RAG_QUESTIONS } from "./rag-fixture";
import { RAG_HELDOUT } from "./rag-heldout";
import { RAG_DEV_V2 } from "./rag-dev-v2";
import { K12_ITEMS } from "./k12-items";
import { formatK12Prompt } from "./k12-fixture";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "./k12-flow";
import { K12_FR_ITEMS } from "./k12-flow-fr-items";
import { formatK12FlowFrT1, formatK12FlowFrT2 } from "./k12-flow-fr";
import { GOLDENS } from "./goldens";
import { LIBRARY_QUERIES } from "./library-fixture";

/** Every student message the existing model evals send through the kernel, by suite. */
const SENT: Record<string, string[]> = {
  "rag main": RAG_QUESTIONS.map((q) => q.ask),
  "rag held-out v1": RAG_HELDOUT.map((q) => q.ask),
  "rag dev-v2": RAG_DEV_V2.map((q) => q.ask),
  "k12-mc": K12_ITEMS.map(formatK12Prompt),
  "k12-flow": K12_ITEMS.flatMap((i) => [formatK12FlowT1(i), formatK12FlowT2(i), K12_FLOW_T3]),
  "k12-flow-fr": K12_FR_ITEMS.flatMap((i) => [formatK12FlowFrT1(i), formatK12FlowFrT2(i), K12_FLOW_T3]),
  goldens: GOLDENS.flatMap((g) => g.turns.map((t) => t.user)),
};

// String literals in every eval source and test, except this suite's own files.
const SOURCES = import.meta.glob(["./**/*.ts", "!./define-*"], { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.)*)`/g;
const literals = Object.values(SOURCES).flatMap((src) =>
  [...src.matchAll(LITERAL)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\n/g, "\n").replace(/\\(.)/g, "$1")));

// The messages checked, per suite, pinned so a change to any suite shows here (1,368 in all).
const COUNTS: Record<string, number> = {
  "rag main": 20, "rag held-out v1": 84, "rag dev-v2": 47, "k12-mc": 240, "k12-flow": 720, "k12-flow-fr": 243, goldens: 14,
};

// Frozen negative list (lever 18 review, P10): questions about what a person, poet or character meant,
// which name them with a capital letter. The detector must not fire on any of them. The guard is
// partial (defineWord.ts): a name asked about with a sentence that contains it, or typed in lower
// case, still fires; those are listed in the lever row as a known limit.
const NAME_QUESTIONS = [
  "What does Frost mean in the last stanza?",
  "What does Frost mean?",
  "what does Lincoln mean in the Gettysburg Address",
  "What does Lincoln mean by a new birth of freedom",
  "What does Hamlet mean?",
  "What does Hamlet mean in act 3?",
  "What does Atticus mean in chapter 3?",
  "what does Gatsby mean when he says you can repeat the past",
  "What does Tom mean in this scene?",
  "What does King mean in his speech?",
  "What does Juliet mean?",
  "What does Scout mean in chapter 11?",
  "What does Dickinson mean in the poem?",
  "What does Orwell mean in the last chapter",
  "What does Jefferson mean in the Declaration?",
  "what does Douglass mean in his narrative",
  "What does Macbeth mean in this soliloquy?",
  "What does Holden mean?",
  "What does Piggy mean in chapter 5?",
  "What does Hughes mean in the poem",
];

describe("dictionary note: no fires on the existing suites", () => {
  it.each(Object.entries(SENT))("%s: 0 fires", (suite, messages) => {
    expect(messages.length).toBe(COUNTS[suite]);
    expect(messages.filter((m) => askedWord(m) !== null)).toEqual([]);
  });

  it("the pinned counts cover every suite (1,368 messages)", () => {
    expect(Object.keys(COUNTS).sort()).toEqual(Object.keys(SENT).sort());
    expect(Object.values(COUNTS).reduce((a, b) => a + b, 0)).toBe(1368);
  });

  it("the frozen list of name questions: 0 fires", () => {
    expect(NAME_QUESTIONS.filter((m) => askedWord(m) !== null)).toEqual([]);
  });

  it("every string literal in src/lib/eval: only two known, true meaning questions fire, and neither reaches the tutor as sent", () => {
    const fired = [...new Set(literals.filter((s) => askedWord(s) !== null))].sort();
    expect(fired).toEqual([
      // k12-items.ts ela-k5-12's stem alone. Sent, it is followed by its options and "Which one is
      // right?" (k12-mc, k12-flow), and the detector reads only the last sentence, so it does not fire.
      "Read the sentence. The path was so narrow that the hikers had to walk one behind another. What does the word narrow mean in this sentence?",
      // library-fixture.ts: a retrieval-ranking query, scored without a model.
      "what does simile mean",
    ]);
    expect(K12_ITEMS.some((i) => fired.includes(i.stem))).toBe(true);
    expect(LIBRARY_QUERIES.some((q) => q.ask === "what does simile mean")).toBe(true);
  });
});
