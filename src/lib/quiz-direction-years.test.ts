import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// A sign written as a word and a year said in pairs, on the app's path: gradeAnswersBatch with the
// bundled dictionary and word list. With no grader (config null) an answer code leaves alone is passed as
// `fallback`, so `by` says whether code took it.
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
import { GRADE_DEV_DIRECTION_YEARS } from "./eval/grade-dev";

const original = globalThis.fetch;

async function verdicts(cases: Array<[string, string, string]>): Promise<Array<{ by: string; isCorrect: boolean }>> {
  const out = await gradeAnswersBatch(cases.map(([question, expected, student], index) => ({ index, question, expected, student, type: "short_answer" })), null);
  return cases.map((_, i) => out.get(i)!);
}

describe("gradeAnswersBatch: a sign written as a word and a year said in pairs", () => {
  beforeEach(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });

  it("accepts held-out v8's two model misses in new questions", async () => {
    const cases: Array<[string, string, string]> = [
      ["A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?", "-$15", "$15 overdrawn"],
      ["A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?", "−$15", "overdrawn by $15"],
      ["A lemonade stand spent $30 on supplies and took in $18 in sales. What was its profit?", "-$12", "a loss of $12"],
      ["In which year was the Magna Carta sealed?", "1215", "twelve fifteen"],
      ["When was the Battle of Trafalgar fought?", "1805", "eighteen oh five"],
    ];
    expect(await verdicts(cases)).toEqual(cases.map(() => ({ by: "exact", isCorrect: true, feedback: "Correct." })));
  }, 30_000);

  it("never settles a wrong answer of the dev set, and marks none of it wrong", async () => {
    const items = GRADE_DEV_DIRECTION_YEARS.flatMap((q) => q.answers.map((a) => ({ q, a })));
    const got = await verdicts(items.map(({ q, a }) => [q.question, q.key, a.text]));
    const bad = items.filter((_, i) => got[i].by === "exact" && (!got[i].isCorrect || !items[i].a.right)).map(({ q, a }) => `${q.id} ${a.text}`);
    expect(bad).toEqual([]);
    expect(got.filter((v, i) => v.by === "exact" && items[i].a.right)).toHaveLength(42);
  }, 30_000);

  it("leaves to the model the other direction, a dropped sign, another year, and a pair on a count or a choice", async () => {
    const cases: Array<[string, string, string]> = [
      ["A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?", "-$15", "$15 in credit"],
      ["A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?", "-$15", "$15"],
      ["A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?", "-$15", "fifteen"],
      ["At dawn the temperature was 4 °C. By midnight it had dropped 19 degrees. What was the temperature at midnight?", "-15 °C", "15 above zero"],
      ["A team has 48 points and the leading team has 63. Taking the leader's score as 0, what is the team's score?", "-15", "fifteen"],
      ["A stand spent $30 and took in $18. What was its loss?", "$12", "a profit of $12"],
      ["An account is overdrawn by $15. What is its balance?", "-$15", "$15 overdrawn"],
      ["In which year was the Magna Carta sealed?", "1215", "twelve fifty"],
      ["In what year did astronauts first walk on the Moon?", "1969", "nineteen ninety-six"],
      ["A school library has 800 fiction books and 415 other books. How many books does it have?", "1215", "twelve fifteen"],
      ["Was the Magna Carta sealed in 1215 or 1512?", "1215", "twelve fifteen"],
    ];
    const got = await verdicts(cases);
    expect(cases.filter((_, i) => got[i].by === "exact")).toEqual([]);
  }, 30_000);
});
