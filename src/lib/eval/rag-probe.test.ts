import { describe, it, expect } from "vitest";
import { RAG_PROBE_RAW, RAG_PROBE_ITEMS, RAG_PROBE_V1, RAG_PROBE_V2 } from "./rag-probe";
import { RAG_DEV_V2_NAMES, RAG_DEV_V2_VAULT } from "./rag-dev-v2";
import { RAG_FIXTURE, scoreRagAnswer } from "./rag-fixture";
import { RAG_DEV_V2 } from "./rag-dev-v2";
import { RAG_HELDOUT } from "./rag-heldout";
import { findNameHits, sha256Hex } from "./sealed";

// Lever 9e's probe (rag-probe.ts): the committed file is the prototype's probe-set.json, byte for
// byte, and the two named sets split it by vault.

// The distinctive (invented) names of the v1 vault's notes, RAG_FIXTURE.
const V1_NAMES = ["marlow", "verrin", "kessel", "tolvane", "brannock", "perrin", "dalquist", "ashcombe", "wexler", "tessik"];
const V2_NAMES = Object.values(RAG_DEV_V2_NAMES).map((n) => n.toLowerCase());

describe("rag-probe-l12.json", () => {
  it("is the prototype's probe set, byte for byte", async () => {
    expect(await sha256Hex(new TextEncoder().encode(RAG_PROBE_RAW))).toBe("d1416ffdd2bb4ffffaaa59c186fbee082b3ea2957acfbd17a0ca1af9148e6bb2");
    expect(RAG_PROBE_RAW).not.toContain("\r");
  });

  it("has 38 positives and 40 near-misses, unique ids that collide with no other set", () => {
    expect(RAG_PROBE_ITEMS.filter((x) => x.kind === "positive")).toHaveLength(38);
    expect(RAG_PROBE_ITEMS.filter((x) => x.kind === "near-miss")).toHaveLength(40);
    const ids = RAG_PROBE_ITEMS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const others = new Set([...RAG_DEV_V2, ...RAG_HELDOUT].map((x) => x.id));
    for (const id of ids) expect(others.has(id), id).toBe(false);
  });

  it("names no note's distinctive name, v2 or v1, in any question, plural or possessive", () => {
    const asks = RAG_PROBE_ITEMS.map((x) => ({ path: x.id, text: x.ask }));
    expect(findNameHits([...V2_NAMES, ...V1_NAMES], asks)).toEqual([]);
  });

  it("gives every near-miss a poison that is in its note, and 23 of them a real-world answer", () => {
    const text = new Map([...RAG_DEV_V2_VAULT, ...RAG_FIXTURE].map((n) => [n.title, n.text]));
    const nearMisses = RAG_PROBE_ITEMS.filter((x) => x.kind === "near-miss");
    for (const x of nearMisses) {
      expect(x.poison, x.id).toBeTruthy();
      expect(text.get(x.noteTitle), x.id).toContain(x.poison);
    }
    expect(nearMisses.filter((x) => x.expect)).toHaveLength(23);
    for (const x of RAG_PROBE_ITEMS.filter((x) => x.kind === "positive")) {
      expect(x.expect, x.id).toBeTruthy();
      expect(x.poison, x.id).toBeUndefined();
    }
  });
});

describe("probe-v2 and probe-v1", () => {
  it("split the items by vault: 28/31 on the v2 vault, 10/9 on RAG_FIXTURE, every item once", () => {
    const count = (qs: typeof RAG_PROBE_V2) => [qs.filter((q) => q.kind === "positive").length, qs.filter((q) => q.kind === "negative").length];
    expect(count(RAG_PROBE_V2)).toEqual([28, 31]);
    expect(count(RAG_PROBE_V1)).toEqual([10, 9]);
    const v2 = new Set(RAG_DEV_V2_VAULT.map((n) => n.title));
    const v1 = new Set(RAG_FIXTURE.map((n) => n.title));
    for (const q of RAG_PROBE_V2) expect(v2.has(q.note), q.id).toBe(true);
    for (const q of RAG_PROBE_V1) expect(v1.has(q.note), q.id).toBe(true);
    expect([...RAG_PROBE_V2, ...RAG_PROBE_V1].map((q) => q.id).sort()).toEqual(RAG_PROBE_ITEMS.map((x) => x.id).sort());
  });

  it("map each item to the held-out question shape, keeping expect and poison", () => {
    for (const q of [...RAG_PROBE_V2, ...RAG_PROBE_V1]) {
      const x = RAG_PROBE_ITEMS.find((i) => i.id === q.id)!;
      expect(q, q.id).toEqual(x.kind === "positive"
        ? { id: x.id, ask: x.ask, note: x.noteTitle, split: "dev", kind: "positive", group: "paraphrase", expect: x.expect }
        : { id: x.id, ask: x.ask, note: x.noteTitle, split: "dev", kind: "negative", group: "near-miss", poison: x.poison, ...(x.expect ? { expect: x.expect } : {}) });
    }
  });

  it("are scored like every other set: a positive needs its value, a near-miss fails on its poison", () => {
    const pos = RAG_PROBE_V2.find((q) => q.kind === "positive")!;
    expect(scoreRagAnswer(pos, `It is ${pos.expect!.split("|")[0]}.`, []).pass).toBe(true);
    const nm = RAG_PROBE_V2.find((q) => q.kind === "negative")!;
    expect(scoreRagAnswer(nm, `It is ${nm.poison}.`, []).pass).toBe(false);
    expect(scoreRagAnswer(nm, "I do not know.", []).pass).toBe(true);
  });
});
