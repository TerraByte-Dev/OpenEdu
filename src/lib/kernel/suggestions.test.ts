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

  it("stays silent when the student abandoned the turn, or there is nothing to follow up on", () => {
    expect(suggestFollowUps(input({ abandoned: true }))).toEqual([]);
    expect(suggestFollowUps(input({ answer: "Yes." }))).toEqual([]);
  });

  // The bug this pins: "abandoned" and "truncated" were one flag, so every length-capped reply
  // suppressed its own chips — the turns most in need of an obvious next action offered none.
  it("still suggests after a truncated reply, led by Continue", () => {
    const out = suggestFollowUps(input({ truncated: true }));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toBe("Continue");
  });

  it("keeps Continue even when the fragment ends on a question", () => {
    const out = suggestFollowUps(input({ truncated: true, answer: `${ANSWER} So what is the ratio?` }));
    expect(out.map((s) => s.label)).toContain("Continue");
    expect(out.map((s) => s.label)).toContain("Give me a hint");
  });

  it("keeps labels short enough to sit in one row", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "A Really Very Extremely Long Note Title That Would Wrap" })],
    }));
    for (const s of out) expect(s.label.length).toBeLessThanOrEqual(30);
  });

  // The mode bar was deleted; these chips are what replaced it. If context always wins all three
  // slots, socratic and quiz become unreachable and the bar was removed rather than replaced.
  it("always leaves room for at least one mode chip", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "d1", title: "Moles" }), hit({ ref: "d2", title: "Ratios" })],
      syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]),
      dueFlashcards: 4,
    }));
    expect(out).toHaveLength(3);
    expect(out.some((s) => s.mode === "socratic" || s.mode === "quiz" || s.label === "Worked example")).toBe(true);
  });

  it("carries the teaching mode on the chips that need one", () => {
    const asked = suggestFollowUps(input({ answer: `${ANSWER} What do you think?` }));
    expect(asked.find((s) => s.label === "Give me a hint")?.mode).toBe("hint");

    const plain = suggestFollowUps(input());
    expect(plain.find((s) => s.label === "Make me figure it out")?.mode).toBe("socratic");
    expect(plain.find((s) => s.label === "Quiz me on this")?.mode).toBe("quiz");
    // "explain" is the neutral default, so a chip that wants it carries no mode at all.
    expect(plain.find((s) => s.label === "Worked example")?.mode).toBeUndefined();
  });

  // The messages were padded once ("I don't know how to start. Can you walk me through it?") and the
  // padding turned out to be semantically active: it announced confusion and instructed a restart, so
  // the tutor circled back over ground already covered. Terse is the feature, not a style preference.
  it("keeps messages short and imperative", () => {
    const everyMessage = [
      ...suggestFollowUps(input()),
      ...suggestFollowUps(input({ truncated: true })),
      ...suggestFollowUps(input({ answer: `${ANSWER} What do you think?` })),
      ...suggestFollowUps(input({ dueFlashcards: 2 })),
      ...suggestFollowUps(input({ hits: [hit({ ref: "d9", title: "Moles" })] })),
      ...suggestFollowUps(input({ syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]) })),
    ];
    expect(everyMessage.length).toBeGreaterThan(5);
    for (const s of everyMessage) {
      expect(s.message.split(/\s+/).length, s.message).toBeLessThanOrEqual(8);
      // No self-reported confusion — that is what invited reassurance instead of progress.
      expect(s.message, s.message).not.toMatch(/i'?m not sure|i don'?t know|i'?m confused|not really/i);
      // No politeness scaffolding wrapping the actual request.
      expect(s.message, s.message).not.toMatch(/^(can you|could you|please|would you)/i);
    }
  });

  it("labels are a truthful preview of what gets sent", () => {
    // Tapping "Give me a hint" should send "Give me a hint" — not a paragraph never shown.
    for (const s of suggestFollowUps(input({ answer: `${ANSWER} What do you think?` }))) {
      expect(s.message.toLowerCase(), s.label).toContain(s.label.toLowerCase().replace(/[^a-z ]/g, ""));
    }
  });

  it("never emits duplicate messages", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "Moles" })],
      syllabus: syllabus([{ title: "Moles", mastered: false }]),
    }));
    expect(new Set(out.map((s) => s.message)).size).toBe(out.length);
  });
});
