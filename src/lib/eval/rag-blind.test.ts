import { describe, it, expect } from "vitest";
import { RAG_BLIND_9F_RAW, RAG_BLIND_9F_ITEMS, RAG_BLIND_9F_VAULT, RAG_BLIND_9F } from "./rag-blind";
import { RAG_PROBE_ITEMS } from "./rag-probe";
import { RAG_DEV_V2, containsAlternative } from "./rag-dev-v2";
import { RAG_HELDOUT } from "./rag-heldout";
import { sha256Hex } from "./sealed";
import { classifyTurn } from "../kernel/turnKind";

// Lever 9f's blind set (rag-blind.ts): the committed file is the agent's file, byte for byte. These
// tests check its format only; nothing here grades an answer.

describe("rag-blind-9f.json", () => {
  it("is the agent's file, byte for byte", async () => {
    expect(await sha256Hex(new TextEncoder().encode(RAG_BLIND_9F_RAW))).toBe("2debb4273dd2b61a420661441a17191aa024a96e099f23f30389436ae8e07c48");
    expect(RAG_BLIND_9F_RAW).not.toContain("\r");
  });

  it("has 16 notes, 48 positives and 48 near-misses, 3 of each per note, unique ids that collide with no other set", () => {
    expect(RAG_BLIND_9F_VAULT).toHaveLength(16);
    expect(new Set(RAG_BLIND_9F_VAULT.map((n) => n.title)).size).toBe(16);
    expect(RAG_BLIND_9F_ITEMS.filter((x) => x.kind === "positive")).toHaveLength(48);
    expect(RAG_BLIND_9F_ITEMS.filter((x) => x.kind === "near-miss")).toHaveLength(48);
    for (const n of RAG_BLIND_9F_VAULT) {
      const mine = RAG_BLIND_9F_ITEMS.filter((x) => x.noteTitle === n.title);
      expect([mine.filter((x) => x.kind === "positive").length, mine.filter((x) => x.kind === "near-miss").length], n.title).toEqual([3, 3]);
    }
    const ids = RAG_BLIND_9F_ITEMS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const others = new Set([...RAG_DEV_V2, ...RAG_HELDOUT, ...RAG_PROBE_ITEMS].map((x) => x.id));
    for (const id of ids) expect(others.has(id), id).toBe(false);
  });

  it("finds every positive's answer in its note, every near-miss's poison in its note, and no near-miss answer equal to its poison", () => {
    const text = new Map(RAG_BLIND_9F_VAULT.map((n) => [n.title, n.text]));
    for (const x of RAG_BLIND_9F_ITEMS) {
      const note = text.get(x.noteTitle)!;
      expect(note, x.id).toBeTruthy();
      if (x.kind === "positive") {
        expect(x.poison, x.id).toBeUndefined();
        expect(x.expect!.split("|").some((a) => note.includes(a.trim())), x.id).toBe(true);
      } else {
        expect(note, x.id).toContain(x.poison);
        expect(x.expect, x.id).toBeTruthy();
        expect(x.expect!.split("|").map((a) => a.trim()), x.id).not.toContain(x.poison);
        // The substring grader would fail a correct real answer that contains the poison.
        expect(containsAlternative(x.expect!, x.poison!), x.id).toBeNull();
      }
    }
  });

  it("is classified as the pins say (the run's turnKind void check uses these counts x3)", () => {
    const kinds: Record<string, number> = {};
    for (const q of RAG_BLIND_9F) { const k = classifyTurn([{ role: "user", content: q.ask }]); kinds[k] = (kinds[k] ?? 0) + 1; }
    expect(kinds).toEqual(BLIND_KIND_PINS);
  });
});

// Filled in from the classifier at the set's first commit, before any model run.
const BLIND_KIND_PINS: Record<string, number> = { "fact-lookup": 85, other: 11 };
