import { describe, it, expect } from "vitest";
import { OUTPUT_RULES, outputRulesLayer } from "./outputRules";

// These assert the rules SAY the right things. Whether a 4B model then obeys them is a live-model
// question and belongs in the goldens — but a rule that quietly stops being present cannot be obeyed
// at all, and that is the regression this catches.
describe("OUTPUT_RULES", () => {
  it("bans the failure modes seen in the real Chemistry transcript", () => {
    const text = OUTPUT_RULES.toLowerCase();
    expect(text).toContain("stage directions");   // "(NOVA's eyes light up…)"
    expect(text).toContain("favourite");          // "one of my favorite topics"
    expect(text).toContain("emoji");              // 🧩 💡 🌍 section headers
    expect(text).toContain("one question at a time"); // the stacked compound question
    expect(text).toMatch(/\b150 words\b/);        // the reply that hit the context limit
  });

  it("stays short — this is a prompt that ships on every turn", () => {
    // ~4 chars/token. A style layer that costs more than a few hundred tokens is competing with the
    // content it is supposed to be shaping, on a window that is 4096 by default.
    expect(Math.ceil(OUTPUT_RULES.length / 4)).toBeLessThan(250);
  });

  it("constrains style without dictating pedagogy", () => {
    // The mode skills own whether to explain or ask — socratic must keep working underneath this.
    // If these rules ever start saying "give the answer", they have overreached into the HOW axis.
    const text = OUTPUT_RULES.toLowerCase();
    expect(text).not.toContain("give the answer");
    expect(text).not.toContain("do not ask");
    expect(text).not.toContain("explain fully");
  });

  it("is what the layer returns", () => {
    expect(outputRulesLayer()).toBe(OUTPUT_RULES);
  });
});
