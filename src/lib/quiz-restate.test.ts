import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Restatements on the app's path (review of #335): gradeAnswersBatch with the bundled dictionary and word
// list. With no grader (config null) an answer code leaves alone is passed as `fallback`, so `by` says
// whether code took it. Each case below is the question said back, or a title that names someone else:
// code must leave it to the model.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch } from "./quiz";
import { resetDictionaryCache } from "./dictionary";
import { resetWordListCache } from "./wordlist";
import { installAppOrigin } from "./eval/headless/origin";

const original = globalThis.fetch;

async function byOf(cases: Array<[string, string, string]>): Promise<string[]> {
  const out = await gradeAnswersBatch(cases.map(([question, expected, student], index) => ({ index, question, expected, student, type: "short_answer" })), null);
  return cases.map((_, i) => out.get(i)!.by);
}

// Each case is [question, key, answer]; none may be settled by code.
async function expectUnsettled(cases: Array<[string, string, string]>): Promise<void> {
  const by = await byOf(cases);
  expect(cases.filter((_, i) => by[i] === "exact")).toEqual([]);
}

describe("gradeAnswersBatch: restatements code must leave to the model", () => {
  beforeEach(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });

  it("never takes a depth in words where writing the sign is the skill, or the question's own depth", async () => {
    const DIVER = "A diver is 11 m below the surface. Write her position as an integer.";
    await expectUnsettled([
      ["Use a signed number to represent 300 m below sea level.", "-300 m", "300 m below sea level"],
      ["Write an integer to represent 20 feet below sea level.", "-20 feet", "20 feet below sea level"],
      [DIVER, "-11 m", "11 m below the surface"],
      [DIVER, "-11 m", "11 m deep"],
      [DIVER, "-11 m", "11 m down"],
      ["Express 250 m above sea level as a number.", "250 m", "250 m above sea level"],
      // No word asks for the sign, but the question already says the amount and the direction.
      ["A diver is 11 m below the surface. Where is she?", "-11 m", "11 m below the surface"],
      ["A diver is 11 m below the surface. Where is she?", "-11 m", "1100 cm below the surface"],
    ]);
  }, 30_000);

  it("never takes a decade, century or fortnight that says the question back, either way", async () => {
    await expectUnsettled([
      ["What is a decade?", "10 years", "a decade"],
      ["What is a decade?", "10 years", "1 decade"],
      ["How long is a decade?", "10 years", "a decade"],
      ["How long is a decade?", "10 years", "1 decade"],
      ["How long is a century?", "100 years", "a century"],
      ["How long is a fortnight?", "2 weeks", "a fortnight"],
      ["How long is a fortnight?", "14 days", "a fortnight"],
      ["What is a period of ten years called?", "A decade", "ten years"],
      ["What is a period of ten years called?", "A decade", "10 years"],
      ["What is a period of 100 years called?", "A century", "100 years"],
      ["What word means a period of two weeks?", "A fortnight", "two weeks"],
      ["What word means a period of two weeks?", "A fortnight", "14 days"],
    ]);
  }, 30_000);

  it("never takes a title that names a man for a woman or a woman for a man", async () => {
    const FDR = "Which president led the United States through most of World War II?";
    const NOBEL = "Which scientist was the first woman to win a Nobel Prize?";
    await expectUnsettled([
      [FDR, "Franklin D. Roosevelt", "mrs roosevelt"],
      [FDR, "Franklin D. Roosevelt", "lady roosevelt"],
      ["Which First Lady chaired the committee that wrote the Universal Declaration of Human Rights?", "Eleanor Roosevelt", "mr roosevelt"],
      ["Who was the first president of the United States?", "George Washington", "mrs washington"],
      ["Which First Lady later served as U.S. Secretary of State?", "Hillary Clinton", "mr clinton"],
      ["Who was the 42nd president of the United States?", "Bill Clinton", "mrs clinton"],
      ["Who was president during the Civil War?", "Abraham Lincoln", "mrs lincoln"],
      [NOBEL, "Marie Curie", "mr curie"],
      ["Which scientist discovered radium?", "Marie Curie", "mr curie"],
      ["Who was the first Black U.S. Secretary of State?", "Colin Powell", "mrs powell"],
      ["Who was the first Black woman to serve as U.S. Secretary of State?", "Condoleezza Rice", "mr rice"],
      ["Who was the first woman to serve as Prime Minister of the United Kingdom?", "Margaret Thatcher", "mr thatcher"],
      // The question names the person by the surname, with a possessive: the surname cannot tell them apart.
      ["Who was Abraham Lincoln's wife?", "Mary Todd Lincoln", "mr lincoln"],
      ["Who was Abraham Lincoln's wife?", "Mary Todd Lincoln", "mrs lincoln"],
      ["Who was Abraham Lincoln's wife?", "Mary Todd Lincoln", "lincoln"],
    ]);
  }, 30_000);

  it("still takes a restatement or a title the question does not say back", async () => {
    const cases: Array<[string, string, string]> = [
      ["A diver is 20 meters below the surface of a lake and swims up 9 meters. Where is she now?", "-11 m", "11 meters below the surface"],
      ["A park opened in 1974. How old was it in 2024?", "50 years", "5 decades"],
      ["A library lends a book for 14 days. How long can a reader keep it?", "14 days", "a fortnight"],
      ["Which scientist was the first woman to win a Nobel Prize?", "Marie Curie", "madame curie"],
      ["Which civil rights leader gave the 'I Have a Dream' speech in 1963?", "Martin Luther King Jr.", "dr king"],
    ];
    expect(await byOf(cases)).toEqual(cases.map(() => "exact"));
  }, 30_000);
});
