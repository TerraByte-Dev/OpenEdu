import { describe, it, expect } from "vitest";
import { RAG_BLIND_16_RAW, RAG_BLIND_16_ITEMS, RAG_BLIND_16_VAULT } from "./rag-blind-16";
import { containsAlternative } from "./rag-dev-v2";
import { sha256Hex } from "./sealed";

// The blind set for lever 16 (rag-blind-16.ts). These tests check its format only; nothing here
// grades an answer.

describe("rag-blind-16.json", () => {
  it("is the agent's file, byte for byte", async () => {
    expect(await sha256Hex(new TextEncoder().encode(RAG_BLIND_16_RAW))).toBe("81cf5ecbf67a045d7427c1972e3e27747b97162658805061b797e9b6d8267f00");
    expect(RAG_BLIND_16_RAW).not.toContain("\r");
  });

  it("has 16 notes, 64 positives and 48 near-misses, 4 and 3 per note, with unique ids", () => {
    expect(RAG_BLIND_16_VAULT).toHaveLength(16);
    expect(new Set(RAG_BLIND_16_VAULT.map((n) => n.title)).size).toBe(16);
    for (const n of RAG_BLIND_16_VAULT) {
      const mine = RAG_BLIND_16_ITEMS.filter((x) => x.noteTitle === n.title);
      expect([mine.filter((x) => x.kind === "positive").length, mine.filter((x) => x.kind === "near-miss").length], n.title).toEqual([4, 3]);
    }
    expect(RAG_BLIND_16_ITEMS).toHaveLength(112);
    expect(new Set(RAG_BLIND_16_ITEMS.map((x) => x.id)).size).toBe(112);
  });

  it("finds every positive's answer and every poison in its note, and no near-miss answer in its note or equal to its poison", () => {
    const text = new Map(RAG_BLIND_16_VAULT.map((n) => [n.title, n.text]));
    for (const x of RAG_BLIND_16_ITEMS) {
      const note = text.get(x.noteTitle)!;
      expect(note, x.id).toBeTruthy();
      const alts = x.expect.split("|").map((a) => a.trim());
      // Unlike blind-15's check (3 characters), a positive may have a 2-character alternative: b16-ratio-p4's
      // answer is the exercise "7C", as the note writes it. A near-miss's expect alternatives are the real-world
      // answer list, which is reported and never gates (#233), so they have no minimum ("π", "B1", "90").
      if (x.kind === "positive") for (const a of alts) expect(a.length, `${x.id} ${a}`).toBeGreaterThanOrEqual(2);
      if (x.kind === "positive") {
        expect(x.poison, x.id).toBeUndefined();
        expect(alts.some((a) => note.includes(a)), x.id).toBe(true);
      } else {
        expect(x.poison!.length, x.id).toBeGreaterThanOrEqual(3);
        expect(note, x.id).toContain(x.poison);
        for (const a of alts) expect(note.includes(a), `${x.id} ${a}`).toBe(false);
        // The substring grader would fail a correct real answer that contains the poison.
        expect(containsAlternative(x.expect, x.poison!), x.id).toBeNull();
      }
    }
  });

  it("is long enough to test the window (lever 14): every note is longer than one shown passage (1,000 characters)", () => {
    for (const n of RAG_BLIND_16_VAULT) expect(n.text.length, n.title).toBeGreaterThan(1000);
  });
});
