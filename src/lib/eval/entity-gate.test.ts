import { describe, it, expect } from "vitest";

// Lever 3, the named-entity mismatch gate (kernel/entityGate.ts), against the dev items and the bundled
// library's real vocabulary. Lives under src/lib/eval/ because it needs names, and test files here are
// outside the sealed name lint's corpus; the gate itself carries no name, item or id.
//
// The first block is clause 1 of the lever's pre-registered kill rule (PR #192): on every positive of
// every dev set the gate must keep the gold note. The gold note is the item's `note` where it has one;
// otherwise every vault note whose text contains one of the item's `expect` alternatives (main
// fixture). That definition, as written in the PR, misses the second note of a multi-hop item (the
// fixture says each "needs two different notes", but `expect` holds only one note's value), so the
// second block checks those notes by title. It pins what it found: the gate drops m2's second note.
// See the PR for why that kills the lever.

import manifestJson from "../../../public/library/index.json";
import { normalizeManifest, dfFor } from "../library-rank";
import { entityGate, sameWord } from "../kernel/entityGate";
import { gateCandidates, MIN_NOTE_SCORE, type GroundingHit } from "../kernel/ground";
import { RAG_FIXTURE, RAG_QUESTIONS, type FixtureNote, type RagQuestion } from "./rag-fixture";
import { RAG_HELDOUT } from "./rag-heldout";
import { RAG_DEV_V2, RAG_DEV_V2_VAULT } from "./rag-dev-v2";

const vocab = dfFor(normalizeManifest(manifestJson)).vocab;

const SECOND_HOP: Record<string, string> = { m1: "Geography — Ashcombe Ridge", m2: "Recipe — Brannock Bread" };

function goldNotes(q: RagQuestion & { note?: string }, vault: FixtureNote[]): FixtureNote[] {
  if (q.note) return vault.filter((n) => n.title === q.note);
  const alts = (q.expect ?? "").toLowerCase().split("|").filter(Boolean);
  return vault.filter((n) => alts.some((a) => n.text.toLowerCase().includes(a)));
}

/** "<id> -> <title>" for every listed note of a question that the gate drops. */
function drops(q: RagQuestion, notes: FixtureNote[]): string[] {
  const gate = entityGate(q.ask, vocab);
  return notes.filter((n) => gate && !gate.keeps(n)).map((n) => `${q.id} -> ${n.title}`);
}

const SETS: Array<{ name: string; vault: FixtureNote[]; items: Array<RagQuestion & { note?: string }> }> = [
  { name: "main", vault: RAG_FIXTURE, items: RAG_QUESTIONS },
  { name: "dev", vault: RAG_FIXTURE, items: RAG_HELDOUT.filter((q) => q.split === "dev") },
  { name: "test (spent, dev)", vault: RAG_FIXTURE, items: RAG_HELDOUT.filter((q) => q.split === "test") },
  { name: "dev-v2", vault: RAG_DEV_V2_VAULT, items: RAG_DEV_V2 },
];

const note = (title: string, text: string): GroundingHit => ({ source: "note", title, text, score: 0.7, ref: title });
const v2 = (name: string) => RAG_DEV_V2_VAULT.find((n) => n.title.includes(name))!;

describe("clause 1: the gate never drops a dev positive's gold note", () => {
  for (const set of SETS) {
    it(set.name, () => {
      const positives = set.items.filter((q) => q.kind !== "negative");
      expect(positives.length).toBeGreaterThan(0);
      const dropped: string[] = [];
      for (const q of positives) {
        const gold = goldNotes(q, set.vault);
        expect(gold.length, q.id).toBeGreaterThan(0);
        dropped.push(...drops(q, gold));
      }
      expect(dropped).toEqual([]);
    });
  }
});

describe("clause 1, multi-hop second notes (outside the PR's written gold definition)", () => {
  it("drops m2's second note: the question names one note's entity and only describes the other", () => {
    const dropped = RAG_QUESTIONS.filter((q) => SECOND_HOP[q.id])
      .flatMap((q) => drops(q, RAG_FIXTURE.filter((n) => n.title === SECOND_HOP[q.id])));
    expect(dropped).toEqual(["m2 -> Recipe — Brannock Bread"]);
  });
});

describe("entityGate", () => {
  const ridge = v2("Corrabeth");

  it("drops a note when the question names a different thing and the note names its own", () => {
    const gate = entityGate("How tall is Ben Nevis?", vocab);
    expect(gate?.entities).toEqual(["ben", "nevis"]);
    expect(gate!.keeps(ridge)).toBe(false);
  });

  it("keeps the note when the question names it, misspells it, or names it in lower case", () => {
    for (const q of [
      "How high is the summit of Corrabeth Spur?",
      "How high is the summit of Corabeth?",
      "is corrabeth higher than Ben Nevis, the highest mountain in the world?",
    ]) {
      const gate = entityGate(q, vocab);
      expect(gate, q).not.toBeNull();
      expect(gate!.keeps(ridge), q).toBe(true);
    }
  });

  it("never drops a note with no distinctive name of its own", () => {
    const plain = { title: "Mountains", text: "the tallest peak we studied rises above the tree line, and snow lingers until june." };
    expect(entityGate("How tall is Ben Nevis?", vocab)!.keeps(plain)).toBe(true);
  });

  it("is off when case carries no signal or the question does not read as English", () => {
    for (const q of [
      "How Tall Is Ben Nevis?",
      "HOW TALL IS BEN NEVIS?",
      "Wie hoch ist der Berg mit dem Wacholder am Südhang?", // German: every noun capitalised
      "¿Qué altura tiene el Ben Nevis?",
      "बेन नेविस कितना ऊँचा है?",
      "Ben Nevis?",
    ]) expect(entityGate(q, vocab), q).toBeNull();
  });

  it("does not treat a sentence start, a library word or a stopword as a name", () => {
    expect(entityGate("Fahrenheit or not, at what temperature does that oil boil?", vocab)).toBeNull();
    expect(entityGate("I think it boils. What is the boiling point in Fahrenheit?", vocab)).toBeNull();
    expect(entityGate("what did I write about the ridge?", vocab)).toBeNull();
  });

  it("is off without a library vocabulary", () => {
    expect(entityGate("How tall is Ben Nevis?", null)).toBeNull();
  });

  it("matches plurals, possessives and typos, but not different words", () => {
    expect(sameWord("nevis", "neviss")).toBe(true);
    expect(sameWord("corrabeth", "corabeth")).toBe(true);
    expect(sameWord("ashcombe", "ashcomb")).toBe(true);
    expect(sameWord("ben", "bens")).toBe(true);
    expect(sameWord("ben", "bet")).toBe(false);
    expect(sameWord("nevis", "devon")).toBe(false);
  });
});

describe("gateCandidates", () => {
  it("drops only notes, records the dropped titles above the floor, and keeps library cards", () => {
    const card: GroundingHit = { source: "library", title: "Mountains of the World", text: "Ben Nevis is the highest mountain in Britain.", score: MIN_NOTE_SCORE + 0.05, ref: "lib:x" };
    const low = { ...note(v2("Ombrevast").title, v2("Ombrevast").text), score: MIN_NOTE_SCORE - 0.1 };
    const { kept, trace } = gateCandidates("How tall is Ben Nevis?", [note(v2("Corrabeth").title, v2("Corrabeth").text), card, low], vocab);
    expect(kept).toEqual([card]);
    expect(trace).toEqual({ entities: ["ben", "nevis"], dropped: [v2("Corrabeth").title] });
  });

  it("returns the candidates untouched, with no trace, when the gate is off", () => {
    const c = [note(v2("Corrabeth").title, v2("Corrabeth").text)];
    expect(gateCandidates("how tall is mount kilimanjaro?", c, vocab)).toEqual({ kept: c });
  });
});
