import { describe, it, expect } from "vitest";
import { matchText } from "./text-match";

describe("matchText (settings search filter)", () => {
  it("an empty/whitespace query matches everything", () => {
    expect(matchText("anything", "")).toBe(true);
    expect(matchText("anything", "   ")).toBe(true);
  });

  it("is a case-insensitive substring match", () => {
    expect(matchText("OpenEdu Library", "library")).toBe(true);
    expect(matchText("OpenEdu Library", "LIB")).toBe(true);
    expect(matchText("OpenEdu Library", "xyz")).toBe(false);
  });

  it("requires ALL whitespace-separated terms (AND semantics)", () => {
    expect(matchText("provider ollama models", "ollama model")).toBe(true);
    expect(matchText("provider ollama models", "ollama tavily")).toBe(false);
  });
});
