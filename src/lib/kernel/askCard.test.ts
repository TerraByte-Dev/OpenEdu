import { describe, it, expect } from "vitest";
import { repairAskCard, repeatsQuestion, answeredCard, pickedAnswer } from "./askCard";

const card = (question: string, labels: string[], values?: string[]) => ({
  question,
  choices: labels.map((label, i) => ({ label, value: values?.[i] ?? label })),
});

describe("repairAskCard", () => {
  // Click test 2026-11-14, gemma4:e4b, fractions L1, "Check if I've got this.": neither button answered
  // the question, and the child could not type "1".
  it("uses the choices a question names when no button offers any of them", () => {
    const asked = card("Think about the fraction 1/5. Which number, 1 or 5, is the unit fraction part?", ["What is the denominator?", "What is the numerator?"], ["denominator", "numerator"]);
    expect(repairAskCard(asked)).toEqual(card("Think about the fraction 1/5. Which number, 1 or 5, is the unit fraction part?", ["1", "5"]));
  });

  it("reads a named list of more than two, and fractions and words", () => {
    expect(repairAskCard(card("Which is biggest: 1/2, 1/3, or 1/4?", ["Tell me more", "I don't know"])).choices.map((c) => c.label)).toEqual(["1/2", "1/3", "1/4"]);
    expect(repairAskCard(card("Is 3 bigger or smaller than 5?", ["Yes", "No"])).choices.map((c) => c.label)).toEqual(["bigger", "smaller"]);
  });

  it("turns buttons that are all 'What is X?' questions into the answers they name", () => {
    const asked = card("What do we call the top number in 3/4?", ["What is the denominator?", "What is the numerator?"], ["d", "n"]);
    expect(repairAskCard(asked)).toEqual(card("What do we call the top number in 3/4?", ["The denominator", "The numerator"], ["d", "n"]));
  });

  describe("leaves a card that already answers its question exactly as it was", () => {
    const unchanged: Array<[string, ReturnType<typeof card>]> = [
      ["the assess topic picker", card("Which topic should we check first?", ["Unit fractions", "Numerator and denominator", "Equal parts"])],
      ["a named list whose items are on the buttons", card("Which is bigger, 1/2 or 1/3?", ["1/2", "1/3"])],
      ["named items inside longer labels", card("Would you like to practice Unit fractions, Numerator and denominator, or Equal parts first?", ["Unit fractions", "Numerator and denominator", "Equal parts"])],
      ["a yes/no question", card("Are all the slices the same size?", ["Yes", "No"])],
      ["an offer to go on", card("Do you want to keep going or stop for now?", ["Keep going", "Stop for now"])],
      ["a choice between two clauses", card("Do you want to stop, or do we keep going?", ["Stop", "Keep going"])],
      ["'or not'", card("Is the answer 3 or not?", ["Yes", "No"])],
      ["question buttons on a topic picker", card("Which would you like to learn next?", ["What is a numerator?", "How do I compare fractions?"])],
      ["question buttons that are not all 'What is'", card("What do we call the top number?", ["What is the numerator?", "Why is it on top?"])],
      ["a card with no question mark", card("Pick one to start with.", ["Halves", "Quarters"])],
      ["numbers in the buttons", card("Which number, 1 or 5, is on top in 1/5?", ["1 (the top)", "5 (the bottom)"])],
    ];
    it.each(unchanged)("%s", (_name, asked) => {
      expect(repairAskCard(asked)).toBe(asked);
    });
  });

  it("passes anything that is not a card through untouched", () => {
    expect(repairAskCard(null)).toBe(null);
    const odd = { question: 3, choices: "x" };
    expect(repairAskCard(odd)).toBe(odd);
  });
});

describe("repeatsQuestion", () => {
  it("is true when the reply ends on the card's question", () => {
    expect(repeatsQuestion("Let's check. Which topic should we check first?", "Which topic should we check first?")).toBe(true);
    expect(repeatsQuestion("Let's check.\n\n**Which topic should we check first?** 🙂", "Which topic should we check first?")).toBe(true);
    expect(repeatsQuestion("Ready?\nThink about 1/5. Which number is on top?", "Think about 1/5. Which number is on top?")).toBe(true);
  });

  it("is true when the question stands just above a trailing choice list (reply choices)", () => {
    expect(repeatsQuestion("Nice work!\n\nWhich one would you like to try first?\n\n1. Halves\n2. Quarters", "Which one would you like to try first?")).toBe(true);
  });

  it("is false when the reply only contains the question part-way, or not at all", () => {
    expect(repeatsQuestion("Which topic first? Let me explain halves.", "Which topic first?")).toBe(false);
    expect(repeatsQuestion("Let's check what you know.", "Which topic should we check first?")).toBe(false);
    expect(repeatsQuestion("", "Which topic?")).toBe(false);
    // The end of a longer sentence is not the question.
    expect(repeatsQuestion("Tell me which one is on top?", "Which one is on top?")).toBe(false);
  });
});

describe("pickedAnswer and answeredCard", () => {
  const choices = [{ label: "One fifth", value: "1/5" }, { label: "Five", value: "5" }];

  it("names a pick by its button text, and a typed answer as typed", () => {
    expect(pickedAnswer(choices, "1/5")).toEqual({ text: "One fifth", typed: false });
    expect(pickedAnswer(choices, " 1, because it's on top ")).toEqual({ text: "1, because it's on top", typed: true });
  });

  it("records the question and the answer, after the text before it", () => {
    expect(answeredCard("", "Which is on top?", { text: "One fifth", typed: false })).toBe("Which is on top?\n\n*You picked: One fifth*\n\n");
    expect(answeredCard("Let's check.", "Which is on top?", { text: "1", typed: true })).toBe("\n\nWhich is on top?\n\n*You answered: 1*\n\n");
  });

  it("leaves the question out when the text before it already ends on it", () => {
    expect(answeredCard("Let's check. Which is on top?", "Which is on top?", { text: "1", typed: false })).toBe("\n\n*You picked: 1*\n\n");
  });

  it("keeps a typed answer from breaking the emphasis", () => {
    expect(answeredCard("", "Q?", { text: "2*3\nis 6", typed: true })).toBe("Q?\n\n*You answered: 2\\*3 is 6*\n\n");
  });
});
