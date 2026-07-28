import { describe, it, expect } from "vitest";
import { deriveThreadTitle } from "./thread-title";

describe("deriveThreadTitle", () => {
  it("strips politeness scaffolding to leave the subject", () => {
    expect(deriveThreadTitle("Can you help me understand stoichiometry better?")).toBe("Stoichiometry");
    expect(deriveThreadTitle("What is a limiting reagent?")).toBe("A limiting reagent");
    expect(deriveThreadTitle("Please explain molar mass")).toBe("Molar mass");
    expect(deriveThreadTitle("I need help with balancing equations")).toBe("Balancing equations");
  });

  it("strips more than one lead-in", () => {
    expect(deriveThreadTitle("Can you explain what is entropy?")).toBe("Entropy");
  });

  it("leaves a message that is already a bare topic alone", () => {
    expect(deriveThreadTitle("Redox reactions")).toBe("Redox reactions");
  });

  it("preserves capitalisation inside the text", () => {
    expect(deriveThreadTitle("what is ATP?")).toBe("ATP");
    expect(deriveThreadTitle("explain the pH scale")).toBe("The pH scale");
  });

  it("truncates long messages on a word boundary", () => {
    const out = deriveThreadTitle(
      "I don't understand how electron configuration relates to periodic trends across a row",
    );
    expect(out.length).toBeLessThanOrEqual(46);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no dangling space before the ellipsis
  });

  // A one-word fragment reads as a broken feature; an honest placeholder does not.
  it("falls back rather than emitting a meaningless stub", () => {
    expect(deriveThreadTitle("")).toBe("New chat");
    expect(deriveThreadTitle("   ")).toBe("New chat");
    expect(deriveThreadTitle("please?")).toBe("New chat");
    expect(deriveThreadTitle("What is")).toBe("New chat");
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveThreadTitle("what is\n\n  osmosis  ?")).toBe("Osmosis");
  });

  it("never returns an empty string", () => {
    for (const s of ["?", "!!!", "how do", "explain", "...", "can you help"]) {
      expect(deriveThreadTitle(s).length).toBeGreaterThan(0);
    }
  });
});
