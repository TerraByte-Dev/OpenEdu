import { describe, it, expect } from "vitest";
import { OUTPUT_RULES, outputRulesLayer, WORKED_ANSWER_RULES, isWorkedAnswerTurn, turnSystemPrompt } from "./outputRules";
import { SHOW_ANSWER_MESSAGE } from "./suggestions";

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

describe("WORKED_ANSWER_RULES (lever L1)", () => {
  it("asks for the full solution, one final answer on its own line, and no question back", () => {
    const text = WORKED_ANSWER_RULES.toLowerCase();
    expect(text).toContain("full worked answer");
    expect(text).toContain("from start to finish");
    expect(WORKED_ANSWER_RULES).toContain('"Final answer: "');
    expect(text).toContain("lettered options");
    expect(text).toContain("do not ask the student anything");
    expect(text).toContain("choose, check or finish");
  });

  it("overrides a mode that holds the answer back, for this turn", () => {
    expect(WORKED_ANSWER_RULES.toLowerCase()).toContain("replaces any earlier instruction to hold the answer back");
  });

  it("keeps the normal style rules word for word", () => {
    const style = OUTPUT_RULES.split("\n").filter((l) => /stage directions|favourite/.test(l));
    expect(style).toHaveLength(2);
    for (const line of style) expect(WORKED_ANSWER_RULES).toContain(line);
  });

  it("drops the normal rules that fight a full answer", () => {
    expect(WORKED_ANSWER_RULES).not.toMatch(/150 words/);
    expect(WORKED_ANSWER_RULES.toLowerCase()).not.toContain("one question at a time");
  });

  it("stays short", () => {
    expect(Math.ceil(WORKED_ANSWER_RULES.length / 4)).toBeLessThan(250);
  });
});

describe("isWorkedAnswerTurn", () => {
  it("is true for the show-answer chip's exact text", () => {
    expect(isWorkedAnswerTurn(SHOW_ANSWER_MESSAGE)).toBe(true);
  });

  it("is false for anything else, near-misses included", () => {
    for (const text of [
      "",
      "Show me the answer",
      "Give me a hint.",
      "Walk me through it.",
      SHOW_ANSWER_MESSAGE.slice(0, -1),
      SHOW_ANSWER_MESSAGE.toLowerCase(),
      SHOW_ANSWER_MESSAGE.toUpperCase(),
      ` ${SHOW_ANSWER_MESSAGE}`,
      `${SHOW_ANSWER_MESSAGE} `,
      `${SHOW_ANSWER_MESSAGE}\n`,
      `"${SHOW_ANSWER_MESSAGE}"`,
      `${SHOW_ANSWER_MESSAGE} Please.`,
      `Please. ${SHOW_ANSWER_MESSAGE}`,
      `${SHOW_ANSWER_MESSAGE}${SHOW_ANSWER_MESSAGE}`,
    ]) {
      expect(isWorkedAnswerTurn(text), JSON.stringify(text)).toBe(false);
    }
  });
});

describe("turnSystemPrompt", () => {
  const system = `## Tutor Identity\nA tutor.\n\n---\n\n${OUTPUT_RULES}`;

  it("swaps the trailing output rules on the worked-answer turn", () => {
    expect(turnSystemPrompt(system, SHOW_ANSWER_MESSAGE)).toBe(`## Tutor Identity\nA tutor.\n\n---\n\n${WORKED_ANSWER_RULES}`);
  });

  it("returns the same string on any other turn", () => {
    expect(turnSystemPrompt(system, "Give me a hint.")).toBe(system);
  });

  it("leaves a prompt without trailing output rules alone", () => {
    const other = "You are a helpful assistant.";
    expect(turnSystemPrompt(other, SHOW_ANSWER_MESSAGE)).toBe(other);
    const notLast = `${system}\n\nMore text.`;
    expect(turnSystemPrompt(notLast, SHOW_ANSWER_MESSAGE)).toBe(notLast);
  });
});
