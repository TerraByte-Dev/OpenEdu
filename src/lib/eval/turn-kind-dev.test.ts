import { describe, it, expect } from "vitest";
import { classifyMessage, type TurnKind } from "../kernel/turnKind";
import { RAG_DEV_V2 } from "./rag-dev-v2";
import { RAG_HELDOUT } from "./rag-heldout";

// What the turn classifier (kernel/turnKind.ts) makes of the RAG dev questions, pinned so a run's
// trigger rate is a check on the run, not a variable. DEV only: the classifier's second revision was
// written after reading these questions' texts (never a model's answers to them), so on these sets the
// trigger is in-sample. The rules it gained are general (a preposition before "what", a lead-in clause,
// pointer words judged by how much else the message says); no item text is in product code.

const tally = (qs: ReadonlyArray<{ ask: string }>) => {
  const out: Partial<Record<TurnKind, number>> = {};
  for (const q of qs) out[classifyMessage(q.ask)] = (out[classifyMessage(q.ask)] ?? 0) + 1;
  return out;
};

describe("turn kinds on the RAG dev sets", () => {
  it("dev vault v2: every name-free positive and every near-miss is a fact lookup", () => {
    expect(tally(RAG_DEV_V2.filter((q) => q.kind === "positive"))).toEqual({ "fact-lookup": 22 });
    expect(tally(RAG_DEV_V2.filter((q) => q.kind !== "positive"))).toEqual({ "fact-lookup": 25 });
  });

  it("v1 dev: English lookups get the note; other languages and the unsure ones do not", () => {
    const dev = RAG_HELDOUT.filter((q) => q.split === "dev") as Array<{ ask: string; kind: string; group?: string }>;
    const by = (kind: string, group: string) => tally(dev.filter((q) => q.kind === kind && q.group === group));
    expect(by("positive", "crosslingual")).toEqual({ other: 12 }); // English first, by design
    expect(by("positive", "paraphrase")).toEqual({ "fact-lookup": 4, other: 4 });
    expect(by("negative", "near-miss")).toEqual({ "fact-lookup": 16, other: 2 });
    expect(by("negative", "far")).toEqual({ "fact-lookup": 3, "typed-problem": 1 });
  });
});
