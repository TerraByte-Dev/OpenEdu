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

// A tried problem: the tutor asked, the student tried, the tutor asked again. ChatTab offers the
// show-answer chip under that last reply.
const tutor = (content: string) => ({ role: "assistant", content });
const student = (content: string) => ({ role: "user", content });
const PROBLEM = "A recipe needs 3 cups of flour for every 2 cups of milk. How many cups of flour go with 8 cups of milk?";
const TRIED = [
  student(PROBLEM),
  tutor("What do you get when you scale both amounts by the same number?"),
  student("Is it 10?"),
  tutor("Not quite. Which number turns the 2 cups of milk into 8?"),
];
const send = (history: Array<{ role: string; content: string }>, text: string) => [...history, student(text)];

describe("isWorkedAnswerTurn", () => {
  it("is true for the show-answer chip's exact text, sent when the chip was offered", () => {
    expect(isWorkedAnswerTurn(send(TRIED, SHOW_ANSWER_MESSAGE))).toBe(true);
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
      expect(isWorkedAnswerTurn(send(TRIED, text)), JSON.stringify(text)).toBe(false);
    }
  });

  // The chip text alone is not the event: it must be the chip, offered under the reply before it.
  it("is false for the chip text typed or pasted with no chip offered", () => {
    expect(isWorkedAnswerTurn([student(SHOW_ANSWER_MESSAGE)]), "first message").toBe(false);
    expect(isWorkedAnswerTurn(send(TRIED.slice(0, 2), SHOW_ANSWER_MESSAGE)), "before any try").toBe(false);
    expect(isWorkedAnswerTurn(send([...TRIED.slice(0, 3), tutor("Not quite. Scale both by 4: 3 × 4 = 12 cups of flour.")], SHOW_ANSWER_MESSAGE)), "after a reply that asked nothing").toBe(false);
    expect(isWorkedAnswerTurn(send([...TRIED.slice(0, 3), tutor("Which turns 2 into 8?")], SHOW_ANSWER_MESSAGE)), "after a reply too short for chips").toBe(false);
    expect(isWorkedAnswerTurn(send([...TRIED.slice(0, 3), tutor(`${TRIED[3].content}\n\n_[stopped]_`)], SHOW_ANSWER_MESSAGE)), "after a stopped reply").toBe(false);
    expect(isWorkedAnswerTurn(send(TRIED.slice(0, 3), SHOW_ANSWER_MESSAGE)), "with no tutor reply before it").toBe(false);
    expect(isWorkedAnswerTurn(send([...TRIED, student(SHOW_ANSWER_MESSAGE), tutor("Scale both amounts by 4, so 3 × 4 = 12. Final answer: 12 cups. Want to try another one?")], SHOW_ANSWER_MESSAGE)), "again after the answer was shown").toBe(false);
  });

  it("is true after a hint, and after a question cut at the length limit, as the chip is", () => {
    expect(isWorkedAnswerTurn(send([...TRIED, student("Give me a hint."), tutor("Think about multiplying. What times 2 gives 8 cups of milk?")], SHOW_ANSWER_MESSAGE))).toBe(true);
    expect(isWorkedAnswerTurn(send([...TRIED.slice(0, 3), tutor(`${TRIED[3].content}\n\n_[cut off at the length limit — ask the tutor to continue]_`)], SHOW_ANSWER_MESSAGE))).toBe(true);
  });
});

describe("turnSystemPrompt", () => {
  const system = `## Tutor Identity\nA tutor.\n\n---\n\n${OUTPUT_RULES}`;

  it("swaps the trailing output rules on the worked-answer turn", () => {
    expect(turnSystemPrompt(system, send(TRIED, SHOW_ANSWER_MESSAGE))).toBe(`## Tutor Identity\nA tutor.\n\n---\n\n${WORKED_ANSWER_RULES}`);
  });

  it("returns the same string on any other turn", () => {
    expect(turnSystemPrompt(system, send(TRIED, "Give me a hint."))).toBe(system);
    expect(turnSystemPrompt(system, [student(SHOW_ANSWER_MESSAGE)])).toBe(system);
  });

  it("leaves a prompt without trailing output rules alone", () => {
    const other = "You are a helpful assistant.";
    expect(turnSystemPrompt(other, send(TRIED, SHOW_ANSWER_MESSAGE))).toBe(other);
    const notLast = `${system}\n\nMore text.`;
    expect(turnSystemPrompt(notLast, send(TRIED, SHOW_ANSWER_MESSAGE))).toBe(notLast);
  });
});
