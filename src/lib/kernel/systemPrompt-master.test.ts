import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../curriculum";
import { readingLevelLayer, gradePromptLayer, GRADES } from "../grade";
import { CHILD_SAFETY_RULES } from "../child-safety";
import { turnSystemPrompt, OUTPUT_RULES, WORKED_ANSWER_RULES } from "./outputRules";
import { SHOW_ANSWER_MESSAGE } from "./suggestions";
import { PROMPT_CASES, type MasterPromptArgs } from "./systemPromptCases";
import master from "./__fixtures__/system-prompt-master.json";

// #243's hard requirement: with no grade set, the tutor's system prompt is byte-identical to master
// (86aadaa), so every benchmark result stays comparable. The fixture was written by master's
// buildSystemPrompt from PROMPT_CASES before the reading-level slot existed. ChatTab passes
// readingLevelLayer(grade) as the last argument, so that is the call made here.
//
// If this fails because OUTPUT_RULES or another slot changed on purpose, regenerate the fixture from
// that change, never from a change that adds the reading level.

// The case's master arguments, padded to all seven so the reading level lands in its own slot, as
// ChatTab passes it (a short case would otherwise put it in the mode-suffix slot).
function withGrade(args: MasterPromptArgs, readingLevel: string | undefined): string {
  const [instructions, syllabus, level, topic, suffix, knowledge, persona] = args;
  return buildSystemPrompt(instructions, syllabus, level, topic, suffix, knowledge, persona, readingLevel);
}

describe("system prompt with no grade set", () => {
  it("has a fixture for every case", () => {
    expect(master.map((m) => m.name)).toEqual(PROMPT_CASES.map((c) => c.name));
  });

  for (const [i, c] of PROMPT_CASES.entries()) {
    it(`is byte-identical to master: ${c.name}`, () => {
      expect(withGrade(c.args, readingLevelLayer(null))).toBe(master[i].prompt);
      expect(withGrade(c.args, gradePromptLayer(null))).toBe(master[i].prompt);
      expect(buildSystemPrompt(...c.args)).toBe(master[i].prompt);
    });
  }
});

describe("system prompt with a grade set", () => {
  const [, full] = PROMPT_CASES;

  it("adds the reading level once, just before the output rules", () => {
    const line = readingLevelLayer(1)!;
    const prompt = withGrade(full.args, line);
    expect(prompt.split("## Reading level").length).toBe(2);
    expect(prompt.endsWith(`${line}\n\n---\n\n${OUTPUT_RULES}`)).toBe(true);
  });

  it("is master's prompt plus that one section, nothing else changed", () => {
    for (const [i, c] of PROMPT_CASES.entries()) {
      for (const g of GRADES) {
        const line = readingLevelLayer(g)!;
        const removed = withGrade(c.args, line).replace(`\n\n---\n\n${line}`, "");
        expect(removed).toBe(master[i].prompt);
      }
    }
  });

  it("still lets the worked-answer turn swap the trailing output rules", () => {
    const prompt = withGrade(full.args, readingLevelLayer(4));
    // The tried-problem conversation outputRules.test.ts uses: the chip is offered under the last reply.
    const convo = [
      { role: "user", content: "A recipe needs 3 cups of flour for every 2 cups of milk. How many cups of flour go with 8 cups of milk?" },
      { role: "assistant", content: "What do you get when you scale both amounts by the same number?" },
      { role: "user", content: "Is it 10?" },
      { role: "assistant", content: "Not quite. Which number turns the 2 cups of milk into 8?" },
      { role: "user", content: SHOW_ANSWER_MESSAGE },
    ];
    const swapped = turnSystemPrompt(prompt, convo);
    expect(swapped.endsWith(WORKED_ANSWER_RULES)).toBe(true);
    expect(swapped).toContain(readingLevelLayer(4)!);
  });
});

// What ChatTab passes since the child-safety rules: the reading level, then CHILD_SAFETY_RULES.
describe("system prompt with a grade set: child-safety rules", () => {
  const [, full] = PROMPT_CASES;
  const SEP = "\n\n---\n\n";

  it("adds the safety section once, after the reading level and just before the output rules", () => {
    const prompt = withGrade(full.args, gradePromptLayer(1));
    expect(prompt.split("## Safety").length).toBe(2);
    expect(prompt.endsWith(`${readingLevelLayer(1)}${SEP}${CHILD_SAFETY_RULES}${SEP}${OUTPUT_RULES}`)).toBe(true);
  });

  it("is master's prompt plus those two sections for every grade, nothing else changed", () => {
    for (const [i, c] of PROMPT_CASES.entries()) {
      for (const g of GRADES) {
        expect(gradePromptLayer(g)).toBe(`${readingLevelLayer(g)}${SEP}${CHILD_SAFETY_RULES}`);
        const added = `${SEP}${readingLevelLayer(g)}${SEP}${CHILD_SAFETY_RULES}`;
        expect(withGrade(c.args, gradePromptLayer(g)).replace(added, "")).toBe(master[i].prompt);
      }
    }
  });

  it("adds the safety section once with a grade set, disclosure or not", () => {
    for (const g of GRADES) expect(gradePromptLayer(g, "my dad hit me")).toBe(gradePromptLayer(g));
  });

  it("keeps the safety section on the worked-answer turn", () => {
    const prompt = withGrade(full.args, gradePromptLayer(4));
    const convo = [
      { role: "user", content: "A recipe needs 3 cups of flour for every 2 cups of milk. How many cups of flour go with 8 cups of milk?" },
      { role: "assistant", content: "What do you get when you scale both amounts by the same number?" },
      { role: "user", content: "Is it 10?" },
      { role: "assistant", content: "Not quite. Which number turns the 2 cups of milk into 8?" },
      { role: "user", content: SHOW_ANSWER_MESSAGE },
    ];
    const swapped = turnSystemPrompt(prompt, convo);
    expect(swapped.endsWith(WORKED_ANSWER_RULES)).toBe(true);
    expect(swapped).toContain(CHILD_SAFETY_RULES);
  });
});

// The review of #282: grade defaults to "Not set", so a fresh install's child would get no safety
// section at all. With no grade, a turn whose message trips isSafetyDisclosure gets CHILD_SAFETY_RULES
// in the reading-level slot; every other no-grade turn stays byte-identical to master.
describe("system prompt with no grade set: a safety-disclosure turn", () => {
  const SEP = "\n\n---\n\n";

  it("adds only the safety section, just before the output rules, on a disclosure", () => {
    const [, full] = PROMPT_CASES;
    const prompt = withGrade(full.args, gradePromptLayer(null, "I want to kill myself"));
    expect(prompt.split("## Safety").length).toBe(2);
    expect(prompt).not.toContain("## Reading level");
    expect(prompt.endsWith(`${CHILD_SAFETY_RULES}${SEP}${OUTPUT_RULES}`)).toBe(true);
  });

  it("is master's prompt plus that one section for every case", () => {
    for (const [i, c] of PROMPT_CASES.entries()) {
      for (const m of ["my dad hit me", "I want to kill myself", "kms"]) {
        const prompt = withGrade(c.args, gradePromptLayer(null, m));
        expect(prompt.replace(`${SEP}${CHILD_SAFETY_RULES}`, "")).toBe(master[i].prompt);
      }
    }
  });

  it("is byte-identical to master on an ordinary message", () => {
    for (const [i, c] of PROMPT_CASES.entries()) {
      for (const m of ["What is 3/4 + 1/8?", "the story really touched me", ""]) {
        expect(withGrade(c.args, gradePromptLayer(null, m))).toBe(master[i].prompt);
      }
    }
  });
});
