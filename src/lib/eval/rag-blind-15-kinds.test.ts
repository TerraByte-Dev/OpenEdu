import { describe, it, expect } from "vitest";
import { RAG_BLIND_15 } from "./rag-blind-15";
import { classifyTurn } from "../kernel/turnKind";

// Filled in from the classifier at the blind set's merge into this branch, before any model run. A turn
// the classifier does not call a fact lookup gets no lookup note, so the lookup note (lever 15) cannot act on it.
const BLIND_15_KIND_PINS: Record<string, number> = { "fact-lookup": 74, other: 37, "typed-problem": 1 };

describe("rag-blind-15.json on the turn-note stack", () => {
  it("is classified as the pins say", () => {
    const kinds: Record<string, number> = {};
    for (const q of RAG_BLIND_15) { const k = classifyTurn([{ role: "user", content: q.ask }]); kinds[k] = (kinds[k] ?? 0) + 1; }
    expect(kinds).toEqual(BLIND_15_KIND_PINS);
  });
});
