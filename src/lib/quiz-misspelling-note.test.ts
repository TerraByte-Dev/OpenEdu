import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

// The misspelling note on the app's path: gradeAnswersBatch reads the bundled dictionary (public/ on
// disk, as the webview serves it), decides which answers get a note (answer-match.ts misspellingNote),
// and the note goes into the batch prompt. Only the model call is stubbed.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch } from "./quiz";
import { callLLMStructured } from "./llm";
import { buildBatchGradePrompt } from "./quiz-grading";
import { resetDictionaryCache } from "./dictionary";
import { installAppOrigin } from "./eval/headless/origin";
import { GRADE_DEV_MISSPELLINGS, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_SYNONYMS, round2AsQuestions } from "./eval/grade-dev";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const original = globalThis.fetch;

async function promptFor(items: Array<{ index: number; question: string; expected: string; student: string; type: string }>): Promise<string> {
  vi.mocked(callLLMStructured).mockResolvedValue({});
  await gradeAnswersBatch(items, config);
  return vi.mocked(callLLMStructured).mock.calls[0][0][0].content as string;
}

const item = (index: number, question: string, expected: string, student: string) => ({ index, question, expected, student, type: "short_answer" });

describe("gradeAnswersBatch: a note when an answer may be the key misspelt", () => {
  beforeAll(() => { resetDictionaryCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); });
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  it("notes a two-edit misspelling no other real word is as close to, and tells the model what a note is", async () => {
    const p = await promptFor([item(0, "What is the frame of bones that holds up the body called?", "The skeleton", "skelitin")]);
    expect(p).toContain('Student answer: skelitin\nNote: "skelitin" may be a misspelling of "skeleton".');
    expect(p).toContain("A Note under an answer applies to that answer only");
  }, 30_000);

  it("gives no note when another real word is as close, the answer is another real word, or it is the other word misspelt", async () => {
    const p = await promptFor([
      item(0, "Which hormone made by the pancreas raises blood sugar?", "Glucagon", "glucogan"), // glycogen, two edits too
      item(1, "What do we call a scientist who studies living things?", "Biologist", "geologist"), // a real word
      item(2, "What do we call the study of what happened in the past?", "History", "mistery"), // one edit from mystery
      item(3, "What is the path a planet follows around the Sun called?", "An orbit", "orbet"), // sorbet
    ]);
    expect(p).not.toContain("Note");
  }, 30_000);

  // Review of #327: each answer below is a real word the dictionary lists as a synonym of the key's word,
  // and each got a note. They are other forms or related words, not other spellings, or the question
  // offers the answer as the other choice.
  it("gives no note to a real word that is another form or a related word, or that the question offers", async () => {
    const cases: Array<[string, string, string]> = [
      ["What is the plural of bacterium?", "bacteria", "bacterium"],
      ["What is the singular of bacteria?", "bacterium", "bacteria"],
      ["What is the plural of alga?", "algae", "alga"],
      ["What is the superlative of early?", "earliest", "earlier"],
      ["What is the comparative of early?", "earlier", "earliest"],
      ["What is the adverb form of quick?", "quickly", "quick"],
      ["What is the adverb form of heavy?", "heavily", "heavier"],
      ["What is the adverb form of clear?", "clearly", "clear"],
      ["What is the adverb form of awful?", "awfully", "awful"],
      ["What do we call the space inside a flat shape?", "Area", "arena"],
      ["What is the curved top of a doorway called?", "Arch", "arc"],
      ["What is the opposite of dead?", "alive", "live"],
      ["What word means with nobody else?", "alone", "lone"],
      ["What verb means to come up or come into being?", "arise", "rise"],
      ["What word means real, existing in fact?", "actual", "factual"],
      ["Which is about distance you can measure: farther or further?", "farther", "further"],
      ["Which word is the plural: bacterium or bacteria?", "bacteria", "bacterium"],
      ["Which word is plural: alga or algae?", "algae", "alga"],
    ];
    for (let start = 0; start < cases.length; start += 6) {
      vi.mocked(callLLMStructured).mockReset();
      const p = await promptFor(cases.slice(start, start + 6).map(([q, key, a], k) => item(k, q, key, a)));
      expect(p).not.toContain("Note");
    }
  }, 60_000);

  // Review of #327, cycle 2: each answer is another word's -ing or -ed form misspelt, as close to it as to
  // the key's word, and each got a note: the word list held headwords only. "attatching" for Attacking
  // passed on e2b 3/3 with the note and 0/3 without it.
  it("gives no note when another word's regular form is as close: attaching, inhaling, immigrating", async () => {
    const p = await promptFor([
      item(0, "What are white blood cells doing to germs?", "Attacking", "attatching"), // attaching, one edit
      item(1, "What do people do when they move out of a country to live elsewhere?", "Emigrating", "imigrating"), // immigrating
      item(2, "What are your lungs doing when you breathe out?", "Exhaling", "enhaling"), // inhaling
      item(3, "What did your lungs do when you breathed out?", "Exhaled", "enhaled"), // inhaled
      item(4, "What do people do when they move into a country to live there?", "Immigrating", "emmigrating"), // emigrating
    ]);
    expect(p).not.toContain("Note");
  }, 30_000);

  it("leaves a batch with no note byte-identical to the prompt without notes", async () => {
    const items = [item(0, "Which gas do plants give off?", "Oxygen", "carbon dioxide"), item(1, "What is 7 times 8?", "56", "54")];
    const p = await promptFor(items);
    expect(p).toBe(buildBatchGradePrompt(items, (await import("./formatting")).MATH_FORMATTING_RULES));
  }, 30_000);

  it("notes another spelling the dictionary lists for the key's word", async () => {
    const p = await promptFor([item(0, "Which light metal is used to make soda cans?", "Aluminum", "aluminium")]);
    expect(p).toContain('Note: "aluminium" may be a misspelling of "aluminum".');
  }, 30_000);

  it("on the dev sets, with the bundled dictionary: no wrong answer gets a note, and the signs set's two-edit misspellings do", async () => {
    const sets = { synonyms: GRADE_DEV_SYNONYMS, signs: GRADE_DEV_SIGNS_LETTERS, round2: round2AsQuestions(), misspell: GRADE_DEV_MISSPELLINGS };
    const noted: string[] = [];
    for (const [name, set] of Object.entries(sets)) {
      const answers = set.flatMap((q) => q.answers.map((a) => ({ q, a })));
      for (let start = 0; start < answers.length; start += 10) {
        const batch = answers.slice(start, start + 10);
        vi.mocked(callLLMStructured).mockReset();
        vi.mocked(callLLMStructured).mockResolvedValue({});
        await gradeAnswersBatch(batch.map(({ q, a }, k) => item(k, q.question, q.key, a.text)), config);
        const prompt = vi.mocked(callLLMStructured).mock.calls[0]?.[0][0].content as string | undefined;
        for (const { q, a } of batch) if (prompt?.includes(`Question: ${q.question}\nExpected answer: ${q.key}\nStudent answer: ${a.text}\nNote:`)) noted.push(`${name} ${q.id} ${a.right ? "right" : "WRONG"} ${a.text}`);
      }
    }
    expect(noted.filter((n) => n.includes("WRONG"))).toEqual([]);
    expect(noted.filter((n) => n.startsWith("signs"))).toEqual(
      ["carnivour", "herbivour", "thurmometor", "hipothisis", "skelitin", "geolagest"].map((w) => expect.stringContaining(w)));
    expect(noted.filter((n) => n.startsWith("synonyms") || n.startsWith("round2"))).toEqual([]);
    // 17 of the set's 20 right misspellings: "mitossis", "glaicer" and "biolagest" are as close to spellings
    // the dictionary resolves as forms ("mitosiss", "glacer", "bipolarest"), so they get no note.
    expect(noted.filter((n) => n.startsWith("misspell")).length).toBe(17);
  }, 120_000);

  it("gives no note when the dictionary cannot be read", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    resetDictionaryCache();
    try {
      const p = await promptFor([item(0, "What is the frame of bones that holds up the body called?", "The skeleton", "skelitin")]);
      expect(p).not.toContain("Note");
    } finally {
      globalThis.fetch = original;
      resetDictionaryCache();
      installAppOrigin();
    }
  }, 30_000);
});
