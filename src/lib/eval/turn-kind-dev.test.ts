import { describe, it, expect } from "vitest";
import { classifyMessage, type TurnKind } from "../kernel/turnKind";
import { RAG_DEV_V2 } from "./rag-dev-v2";
import { RAG_HELDOUT } from "./rag-heldout";
import { RAG_PROBE_ITEMS } from "./rag-probe";

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

// Lever 9e's probe (rag-probe.ts). Pinned from the prototype's judge pass, before any model run; the
// classifier is unchanged since #215.
describe("turn kinds on the lever-9e probe", () => {
  const kindOf = (id: string) => classifyMessage(RAG_PROBE_ITEMS.find((x) => x.id === id)!.ask);
  const others = (kind: string) => RAG_PROBE_ITEMS.filter((x) => x.kind === kind && classifyMessage(x.ask) !== "fact-lookup").map((x) => x.id);

  it("positives: 33 fact lookups; bp-dra-1, bp-kha-1, bp-kha-2, bp-cin-1, bp-ver-1 are other", () => {
    expect(tally(RAG_PROBE_ITEMS.filter((x) => x.kind === "positive"))).toEqual({ "fact-lookup": 33, other: 5 });
    expect(others("positive")).toEqual(["bp-dra-1", "bp-kha-1", "bp-kha-2", "bp-cin-1", "bp-ver-1"]);
  });

  it("near-misses: 39 fact lookups; bn-qbk-1 is other", () => {
    expect(tally(RAG_PROBE_ITEMS.filter((x) => x.kind === "near-miss"))).toEqual({ "fact-lookup": 39, other: 1 });
    expect(others("near-miss")).toEqual(["bn-qbk-1"]);
    expect(kindOf("bn-qbk-1")).toBe("other");
  });
});
