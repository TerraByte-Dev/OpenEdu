import { describe, it, expect } from "vitest";
import { RAG_BLIND_10 } from "./rag-blind-10";
import { classifyTurn } from "../kernel/turnKind";

// Filled in from the classifier at the blind set's merge into this branch, before any model run. A turn
// the classifier does not call a fact lookup gets no lookup note, so levers 9e/9f/9g cannot act on it.
const BLIND_10_KIND_PINS: Record<string, number> = { "fact-lookup": 98, other: 14 };

describe("rag-blind-10.json on the turn-note stack", () => {
  it("is classified as the pins say", () => {
    const kinds: Record<string, number> = {};
    for (const q of RAG_BLIND_10) { const k = classifyTurn([{ role: "user", content: q.ask }]); kinds[k] = (kinds[k] ?? 0) + 1; }
    expect(kinds).toEqual(BLIND_10_KIND_PINS);
  });
});
