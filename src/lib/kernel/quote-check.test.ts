import { describe, it, expect } from "vitest";
import { quotedHits, quotePrompt } from "./quote-check";
import type { GroundingHit } from "./ground";

const hit = (title: string, text: string): GroundingHit => ({ source: "note", title, text, score: 0.6, ref: title });
const verrin = hit("Lab Log — Verrin Solution", "Verrin solution is a pale liquid. It boils at 143.7 degrees Celsius under normal pressure.\nStore it cold.");
const ridge = hit("Geography — Ashcombe Ridge", "Ashcombe Ridge rises to 2,418 metres above sea level.");

describe("quotedHits", () => {
  it("keeps the passage that literally contains the quote, ignoring case, punctuation and spacing", () => {
    const q = "it boils at 143.7 degrees  celsius under normal pressure";
    expect(quotedHits(q, "What is the boiling point of Verrin solution?", [verrin, ridge])).toEqual([verrin]);
  });

  it("drops everything when the quote is not in any passage (invented or paraphrased)", () => {
    expect(quotedHits("Verrin solution conducts electricity very well.", "Does Verrin solution conduct electricity?", [verrin, ridge])).toEqual([]);
    expect(quotedHits("It boils at roughly 144 degrees Celsius.", "Verrin boiling point?", [verrin])).toEqual([]);
  });

  it("drops an empty quote, a bare name, and a quote that only repeats the question", () => {
    expect(quotedHits("", "anything", [verrin])).toEqual([]);
    expect(quotedHits("Verrin solution", "Does Verrin solution conduct electricity?", [verrin])).toEqual([]);
    expect(quotedHits("Verrin solution is a pale liquid", "Is Verrin solution a pale liquid?", [verrin])).toEqual([]);
  });

  it("matches whole words only, never inside a longer word", () => {
    const h = hit("x", "The reboiling point stays at 143.7 degrees Celsius always.");
    expect(quotedHits("boiling point stays at 143.7 degrees", "boiling point?", [h])).toEqual([]);
  });

  it("works on non-Latin text", () => {
    const h = hit("hi", "वेरिन घोल 143.7 डिग्री सेल्सियस पर उबलता है।");
    expect(quotedHits("वेरिन घोल 143.7 डिग्री सेल्सियस पर उबलता है", "वेरिन घोल का क्वथनांक क्या है?", [h])).toEqual([h]);
  });
});

describe("quotePrompt", () => {
  it("numbers the passages and puts the question last", () => {
    const [sys, user] = quotePrompt("Q?", [verrin, ridge]);
    expect(sys.role).toBe("system");
    expect(user.content.startsWith("[1] Lab Log — Verrin Solution")).toBe(true);
    expect(user.content).toContain("[2] Geography — Ashcombe Ridge");
    expect(user.content.endsWith("Question: Q?")).toBe(true);
  });
});
