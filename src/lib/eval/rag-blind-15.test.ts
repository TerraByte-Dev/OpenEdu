import { describe, it, expect } from "vitest";
import { RAG_BLIND_15_RAW, RAG_BLIND_15_ITEMS, RAG_BLIND_15_VAULT } from "./rag-blind-15";
import { containsAlternative } from "./rag-dev-v2";
import { sha256Hex } from "./sealed";

// The blind set for lever 15 (rag-blind-15.ts). These tests check its format only; nothing here
// grades an answer.

describe("rag-blind-15.json", () => {
  it("is the agent's file, byte for byte", async () => {
    expect(await sha256Hex(new TextEncoder().encode(RAG_BLIND_15_RAW))).toBe("234d983687a463f51ebdd29b0d5f8b1aeb9a20d0b7e861bcaf0c6ed8703292c0");
    expect(RAG_BLIND_15_RAW).not.toContain("\r");
  });

  it("has 16 notes, 64 positives and 48 near-misses, 4 and 3 per note, with unique ids", () => {
    expect(RAG_BLIND_15_VAULT).toHaveLength(16);
    expect(new Set(RAG_BLIND_15_VAULT.map((n) => n.title)).size).toBe(16);
    for (const n of RAG_BLIND_15_VAULT) {
      const mine = RAG_BLIND_15_ITEMS.filter((x) => x.noteTitle === n.title);
      expect([mine.filter((x) => x.kind === "positive").length, mine.filter((x) => x.kind === "near-miss").length], n.title).toEqual([4, 3]);
    }
    expect(RAG_BLIND_15_ITEMS).toHaveLength(112);
    expect(new Set(RAG_BLIND_15_ITEMS.map((x) => x.id)).size).toBe(112);
  });

  it("finds every positive's answer and every poison in its note, and no near-miss answer in its note or equal to its poison", () => {
    const text = new Map(RAG_BLIND_15_VAULT.map((n) => [n.title, n.text]));
    for (const x of RAG_BLIND_15_ITEMS) {
      const note = text.get(x.noteTitle)!;
      expect(note, x.id).toBeTruthy();
      const alts = x.expect.split("|").map((a) => a.trim());
      for (const a of alts) expect(a.length, `${x.id} ${a}`).toBeGreaterThanOrEqual(3);
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

  it("is long enough to test lever 10: every note is longer than one shown passage (1,000 characters)", () => {
    for (const n of RAG_BLIND_15_VAULT) expect(n.text.length, n.title).toBeGreaterThan(1000);
  });
});
