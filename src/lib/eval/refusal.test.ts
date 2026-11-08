import { describe, it, expect } from "vitest";
import { hasRefusalPhrase } from "./refusal";

// Made-up sentences in the shapes the list is meant to catch. None comes from an eval item or row.
describe("hasRefusalPhrase", () => {
  it.each([
    "I do not have information about the length of the Quorrin canal in my current notes.",
    "I don’t have the boiling point of that compound in your notes.",
    "I don't know the answer to that.",
    "I'm not sure how tall that tower is.",
    "I cannot find that figure in the material you gave me.",
    "Unfortunately there is no information about this in the context.",
    "Your notes don't mention the founding date.",
    "The reference passages do not contain that value.",
    "That detail is not mentioned in your notes.",
    "That is outside the scope of this course right now.",
    "Great question! That's beyond the current scope, and a great question for a later level.",
  ])("catches %j", (s) => {
    expect(hasRefusalPhrase(s)).toBe(true);
  });

  it.each([
    "The canal is 42 km long.",
    "I am answering from general knowledge: it melts at 90 °C.",
    "Do you know which unit the survey used? It was recorded in metres.",
    "The tower does not have a spire; it is 120 m tall.",
  ])("leaves %j alone", (s) => {
    expect(hasRefusalPhrase(s)).toBe(false);
  });

  it("matches a hedge before an answer, which over-refusal excludes by also requiring the row to be unanswered", () => {
    expect(hasRefusalPhrase("Your notes don't cover this, but from general knowledge it is about 42 km long.")).toBe(true);
  });
});
