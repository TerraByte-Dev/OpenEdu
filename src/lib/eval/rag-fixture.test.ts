import { describe, it, expect } from "vitest";
import { RAG_FIXTURE, RAG_QUESTIONS, scoreRagAnswer, summarizeRag, type RagQuestion } from "./rag-fixture";

const q = (id: string): RagQuestion => {
  const found = RAG_QUESTIONS.find((x) => x.id === id);
  if (!found) throw new Error(`no question ${id}`);
  return found;
};

describe("the fixture itself", () => {
  it("has the shape the falsification condition assumes", () => {
    const kinds = RAG_QUESTIONS.reduce<Record<string, number>>((acc, x) => {
      acc[x.kind] = (acc[x.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds.positive).toBe(12);
    expect(kinds.negative).toBe(4);
    expect(kinds.multihop).toBe(2);
    expect(kinds.spanish).toBe(2);
  });

  it("gives every answerable question an expectation and every negative a poison value", () => {
    for (const x of RAG_QUESTIONS) {
      if (x.kind === "negative") expect(x.poison, x.id).toBeTruthy();
      else expect(x.expect, x.id).toBeTruthy();
    }
  });

  // If a nonce leaked into pretraining the test is worthless, so the values must at least be
  // findable in the vault we seed. This catches the classic fixture rot: editing a note and
  // forgetting the question that depends on it.
  it("every expected value actually appears somewhere in the vault", () => {
    const corpus = RAG_FIXTURE.map((n) => `${n.title} ${n.text}`).join(" ").toLowerCase();
    for (const x of RAG_QUESTIONS) {
      if (!x.expect) continue;
      const alts = x.expect.split("|").map((a) => a.trim().toLowerCase());
      expect(alts.some((a) => corpus.includes(a)), `${x.id} expects ${x.expect}`).toBe(true);
    }
  });

  it("negatives are genuinely unanswerable from the vault", () => {
    const corpus = RAG_FIXTURE.map((n) => n.text).join(" ").toLowerCase();
    expect(corpus).not.toContain("ethanol");
    expect(corpus).not.toContain("hamlet");
    expect(corpus).not.toContain("everest");
  });
});

describe("scoreRagAnswer — positives", () => {
  it("passes when the nonce value is present", () => {
    expect(scoreRagAnswer(q("p1"), "Your survey put the sediment index at 3.71.", ["Field Notes"]).pass).toBe(true);
  });

  it("fails when the model answers plausibly but without the fact", () => {
    const v = scoreRagAnswer(q("p1"), "Sediment indices vary by basin and depend on rainfall.", []);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("3.71");
  });

  it("accepts any listed alternative form", () => {
    expect(scoreRagAnswer(q("p3"), "It spins at 4180 rpm.", []).pass).toBe(true);
    expect(scoreRagAnswer(q("p3"), "About 4,180 rpm at full load.", []).pass).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(scoreRagAnswer(q("p7"), "It turns ORANGE.", []).pass).toBe(true);
  });
});

describe("scoreRagAnswer — negatives (the actual test)", () => {
  it("passes a plain answer with no citation", () => {
    const v = scoreRagAnswer(q("n1"), "Ethanol boils at about 78 degrees Celsius.", []);
    expect(v.pass).toBe(true);
  });

  // The failure mode the whole condition exists to catch: always retrieve, always claim the notes
  // backed you up. That scores 100% on positives and is worthless.
  it("FAILS when a citation chip appears for something the vault cannot answer", () => {
    const v = scoreRagAnswer(q("n1"), "Ethanol boils at about 78 degrees Celsius.", ["Lab Log — Verrin Solution"]);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("fabricated citation");
  });

  it("FAILS when an unrelated value bleeds in from the vault", () => {
    const v = scoreRagAnswer(q("n1"), "Ethanol boils at 214 degrees.", []);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("214");
  });
});

describe("summarizeRag", () => {
  it("reports per-kind rates rather than a single boolean", () => {
    const rows = [
      { q: q("p1"), verdict: { pass: true, reason: "" } },
      { q: q("p2"), verdict: { pass: false, reason: "" } },
      { q: q("n1"), verdict: { pass: true, reason: "" } },
    ];
    const s = summarizeRag(rows);
    expect(s.positive).toEqual({ pass: 1, total: 2 });
    expect(s.negative).toEqual({ pass: 1, total: 1 });
  });
});
