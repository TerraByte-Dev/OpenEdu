import { describe, it, expect } from "vitest";
import { asksForFlashcard, validateCard, flashcardMessages, FLASHCARD_INSTRUCTION } from "./flashcardRequest";

// The pure halves of the flashcard stage. The stage itself runs through tutorEngine.run in
// writeStages.test.ts. Requests are written for this test, in the shapes of the readiness items.

describe("asksForFlashcard", () => {
  it("sees a request for one card", () => {
    for (const text of [
      "Make me a flashcard: 6 x 7 = 42.",
      "Can you save a flashcard that says the divisor is the number of groups?",
      "Make a flashcard for the slope formula.",
      "Please make a flashcard: what is the y-intercept of y = 3x - 2? Answer: -2.",
      "Save a flashcard: a hexagon has 6 sides.",
      "Make a flashcard that says elif means else-if.",
      "Can you make a flashcard about what a while loop does?",
      "Turn that into a flash card please",
      "Make a flashcard: what do you call a baby cat? A kitten.",
      "add a flash-card for condensation",
    ]) {
      expect(asksForFlashcard(text), text).toBe(true);
    }
  });

  it("leaves questions about flashcards, due-card requests and plurals to the model", () => {
    for (const text of [
      "Which of my flashcards are due today?",
      "Quiz me on my flashcards that are due.",
      "Should I make a flashcard for this?",
      "How do I add a flashcard?",
      "Did you save the flashcard?",
      "Make flashcards for all of these.",
      "What is a flashcard?",
      "Make me a quiz about fractions.",
      "I made a mistake. Flashcard time later.",
    ]) {
      expect(asksForFlashcard(text), text).toBe(false);
    }
  });
});

describe("validateCard", () => {
  it("accepts a plain question and answer", () => {
    expect(validateCard({ front: "What is 6 x 7?", back: "42" })).toEqual([]);
  });

  it("rejects an empty side, an echo, and LaTeX", () => {
    expect(validateCard({ front: "What is 6 x 7?", back: "  " })).not.toEqual([]);
    expect(validateCard({ front: "Hexagon", back: "hexagon" })).not.toEqual([]);
    expect(validateCard({ front: "Area of a circle?", back: "$\\pi r^2$" })).not.toEqual([]);
  });
});

describe("flashcardMessages", () => {
  it("sends the instruction, the tutor's last message and the request, and nothing else", () => {
    expect(flashcardMessages("Make me a flashcard: 6 x 7 = 42.", "")).toEqual([
      { role: "system", content: FLASHCARD_INSTRUCTION },
      { role: "user", content: "Tutor's last message:\n(none)\n\nStudent's request:\nMake me a flashcard: 6 x 7 = 42." },
    ]);
    const long = "x".repeat(5_000);
    expect(flashcardMessages("Turn that into a flashcard", long)[1].content.length).toBeLessThan(1_600);
  });
});
