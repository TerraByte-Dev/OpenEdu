import { describe, it, expect } from "vitest";
import { suggestFollowUps, endsWithQuestion, type SuggestionInput } from "./suggestions";
import type { GroundingHit } from "./ground";
import type { Syllabus } from "../../types";

const ANSWER = "Stoichiometry is the bookkeeping of a reaction. The balanced equation gives you the ratio of moles, and every calculation follows from it.";

const hit = (over: Partial<GroundingHit> = {}): GroundingHit => ({
  source: "note",
  title: "Chemistry — Moles",
  text: "A mole is 6.02e23 particles.",
  score: 0.8,
  ref: "doc-1",
  ...over,
});

const syllabus = (subtopics: Array<{ title: string; mastered: boolean }>): Syllabus => ({
  id: "s1",
  course_id: "c1",
  level: 1,
  title: "Level 1",
  description: "",
  learning_objectives: [],
  subtopics: subtopics.map((s, i) => ({ id: `1.${i + 1}`, title: s.title, key_concepts: [], practice_type: "", mastered: s.mastered })),
  assessment_criteria: [],
  estimated_hours: 1,
  generated_at: "",
});

const input = (over: Partial<SuggestionInput> = {}): SuggestionInput => ({
  answer: ANSWER,
  syllabus: null,
  hits: [],
  usedHits: [],
  ...over,
});

describe("endsWithQuestion", () => {
  it("detects a trailing question through markdown and closing punctuation", () => {
    expect(endsWithQuestion("What do you think?")).toBe(true);
    expect(endsWithQuestion("**Is it balanced?**")).toBe(true);
    expect(endsWithQuestion("Try it. (Which one?)")).toBe(true);
    expect(endsWithQuestion("That's the ratio.")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
  });
});

describe("suggestFollowUps", () => {
  it("never offers more than three", () => {
    const out = suggestFollowUps(input({
      hits: [hit(), hit({ ref: "doc-2", title: "Other" })],
      syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]),
      dueFlashcards: 5,
    }));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("offers ways to answer, not new questions, when the tutor asked one", () => {
    const out = suggestFollowUps(input({ answer: `${ANSWER} What do you think the balanced equation is?` }));
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.label)).toEqual(["Give me a hint", "Walk me through it"]);
  });

  // The highest-value chip: they wrote the note, so they half-remember it, and "what did I say about
  // X" is something people actually ask.
  it("surfaces a retrieved note the answer did not use", () => {
    const unused = hit({ ref: "doc-9", title: "Chemistry — Limiting Reagents" });
    const out = suggestFollowUps(input({ hits: [unused], usedHits: [] }));
    expect(out[0].message).toContain("Chemistry — Limiting Reagents");
  });

  it("does not offer a note the answer already drew on", () => {
    const used = hit();
    const out = suggestFollowUps(input({ hits: [used], usedHits: [used] }));
    expect(out.some((s) => s.message.includes(used.title))).toBe(false);
  });

  it("offers more of a reference it actually cited", () => {
    const ref = hit({ source: "library", ref: "lib:pt", title: "Periodic Table" });
    const out = suggestFollowUps(input({ hits: [ref], usedHits: [ref] }));
    expect(out.some((s) => s.message.includes("Periodic Table"))).toBe(true);
  });

  it("offers the next unmastered subtopic and skips mastered ones", () => {
    const out = suggestFollowUps(input({
      syllabus: syllabus([
        { title: "Balancing equations", mastered: true },
        { title: "Limiting reagents", mastered: false },
      ]),
    }));
    expect(out.some((s) => s.message.includes("Limiting reagents"))).toBe(true);
    expect(out.some((s) => s.message.includes("Balancing equations"))).toBe(false);
  });

  it("mentions due flashcards only when some are due", () => {
    expect(suggestFollowUps(input({ dueFlashcards: 3 })).some((s) => s.label === "Review due cards")).toBe(true);
    expect(suggestFollowUps(input({ dueFlashcards: 0 })).some((s) => s.label === "Review due cards")).toBe(false);
  });

  it("always has something useful to fall back on", () => {
    const out = suggestFollowUps(input());
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((s) => s.label === "Worked example")).toBe(true);
  });

  it("stays silent on an interrupted or trivial reply", () => {
    expect(suggestFollowUps(input({ incomplete: true }))).toEqual([]);
    expect(suggestFollowUps(input({ answer: "Yes." }))).toEqual([]);
  });

  it("keeps labels short enough to sit in one row", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "A Really Very Extremely Long Note Title That Would Wrap" })],
    }));
    for (const s of out) expect(s.label.length).toBeLessThanOrEqual(30);
  });

  it("never emits duplicate messages", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "Moles" })],
      syllabus: syllabus([{ title: "Moles", mastered: false }]),
    }));
    expect(new Set(out.map((s) => s.message)).size).toBe(out.length);
  });
});
