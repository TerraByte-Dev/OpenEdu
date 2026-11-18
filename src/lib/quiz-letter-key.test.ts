import { describe, it, expect, vi, beforeEach } from "vitest";

// gemma4:e2b writes a multiple-choice key as the letter alone ("D") while its options read "D) ...".
// In the B9 readiness run (2026-11-13) that was 1,818 of 2,127 question calls, and the validator's
// repair loop got the same letter back, so quizzes came out empty. These tests run the production
// generator with the model call stubbed: the stub applies the same `validate` callLLMStructured
// would, and fails the call when it reports issues, as exhausted repairs do.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateQuizQuestions, validateQuizBatch } from "./quiz";
import { resolveLetterKey, alignKeyToOption } from "./quiz-grading";
import { callLLMStructured } from "./llm";
import type { LLMConfig, Syllabus } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const syllabus = {
  level: 1,
  title: "Phonics",
  subtopics: [{ id: "s1", title: "Rhyming words", key_concepts: ["rhyme", "word families"] }],
} as unknown as Syllabus;

const mc = (correct_answer: string, options = ["A) cat and dog", "B) sun and moon", "C) red and blue", "D) hop and top"]) => ({
  question_text: "Which pair of words rhymes?",
  question_type: "multiple_choice",
  options,
  correct_answer,
  difficulty_level: 1,
  explanation: "Hop and top end with the same sound.",
  subtopic_id: "s1",
  blank_position: "",
  matching_pairs: [],
});

describe("resolveLetterKey", () => {
  it.each(["D", "d", "D)", "(D)", "D.", " D ", "Option D"])("maps %j to the labelled option", (key) => {
    expect(resolveLetterKey(mc(key)).correct_answer).toBe("D) hop and top");
  });

  it("maps a letter by position when the options carry no labels", () => {
    const q = mc("B", ["cat and dog", "sun and moon", "red and blue", "hop and top"]);
    expect(resolveLetterKey(q).correct_answer).toBe("sun and moon");
  });

  it("leaves a key that already names an option alone", () => {
    expect(resolveLetterKey(mc("D) hop and top")).correct_answer).toBe("D) hop and top");
    expect(resolveLetterKey(mc("hop and top")).correct_answer).toBe("hop and top");
  });

  it("leaves a bare letter alone when an option's own text is that letter", () => {
    const q = mc("A", ["A) A", "B) B", "C) C", "D) D"]);
    expect(resolveLetterKey(q).correct_answer).toBe("A");
  });

  it("reads an upper-case key as a label even when an option's text is that letter in lower case", () => {
    const q = mc("A", ["A) an", "B) a", "C) the", "D) some"]);
    expect(resolveLetterKey(q).correct_answer).toBe("A) an");
  });

  it("leaves a mixed set of labelled and unlabelled options alone", () => {
    const q = mc("B", ["B. vitamins", "minerals", "water", "fiber"]);
    expect(resolveLetterKey(q).correct_answer).toBe("B");
  });

  it("leaves a letter with no matching option, and non-multiple-choice questions, alone", () => {
    expect(resolveLetterKey(mc("D", ["A) x", "B) y", "C) z"])).correct_answer).toBe("D");
    const tf = { ...mc("A"), question_type: "true_false", options: [] };
    expect(resolveLetterKey(tf).correct_answer).toBe("A");
  });
});

describe("validateQuizBatch with a letter key", () => {
  it("accepts a bare letter that names an option", () => {
    expect(validateQuizBatch([mc("D")], new Set(["s1"]), { tier: "tiny" })).toEqual([]);
  });

  it("still rejects a key that names no option", () => {
    expect(validateQuizBatch([mc("hop and stop")], new Set(["s1"]), { tier: "tiny" })).toHaveLength(1);
  });
});

describe("generateQuizQuestions on a model that answers with the letter", () => {
  beforeEach(() => {
    let n = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      n += 1;
      const parsed = { ...mc("D"), question_text: `Which pair of words rhymes? (${n})` };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
      return parsed;
    });
  });

  const keyIsOption = (qs: Array<{ options: string[] | null; correct_answer: string }>) => {
    for (const q of qs) {
      expect(q.options).toContain(q.correct_answer);
      expect(q.correct_answer.replace(/^[A-D]\)\s*/, "")).toBe("hop and top");
    }
  };

  it("local, one question per call: returns a full quiz whose key is the option's text", async () => {
    const qs = await generateQuizQuestions(syllabus, 3, config);
    expect(qs).toHaveLength(3);
    keyIsOption(qs);
  });

  it("cloud, batched: returns a full quiz whose key is the option's text", async () => {
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      const parsed = { questions: [1, 2, 3].map((n) => ({ ...mc("D"), question_text: `Which pair of words rhymes? (${n})` })) };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
      return parsed;
    });
    const cloud = { provider: "anthropic", model: "claude-haiku-5-5", modelTier: "medium" } as unknown as LLMConfig;
    const qs = await generateQuizQuestions(syllabus, 3, cloud);
    expect(qs).toHaveLength(3);
    keyIsOption(qs);
  });

  it("review pool: a stored question with a letter key comes back with the option's text", async () => {
    const stored = [1, 2, 3, 4, 5].map((n) => ({
      ...mc("D"), id: `q${n}`, question_text: `Stored rhyme question ${n}`,
    })) as unknown as Parameters<typeof generateQuizQuestions>[3];
    const qs = await generateQuizQuestions(syllabus, 5, config, stored);
    const review = qs.filter((q) => q.question_text.startsWith("Stored"));
    expect(review.length).toBeGreaterThan(0);
    keyIsOption(review);
  });
});

// TerraTutor #200 (audit 5 #7): a key that differs from its option only in letter case ("mitochondria" for "Mitochondria")
// passed the case-blind validator, but the shuffle looked for it case-sensitively and kept it as it was,
// and the quiz compares the picked option string with the key: every option was marked wrong.
describe("a multiple-choice key in other letter case than its option", () => {
  const cell = (correct_answer: string, options = ["Nucleus", "Mitochondria", "Ribosome", "Cell wall"]) => ({
    ...mc(correct_answer, options),
    question_text: "Which part of the cell makes energy?",
    explanation: "The mitochondria release energy from food.",
  });

  it("is set to the option as written, labelled or not", () => {
    expect(alignKeyToOption(cell("mitochondria")).correct_answer).toBe("Mitochondria");
    expect(alignKeyToOption(cell("MITOCHONDRIA ")).correct_answer).toBe("Mitochondria");
    expect(alignKeyToOption(cell("mitochondria", ["a) Nucleus", "b) Mitochondria", "c) Ribosome", "d) Cell wall"])).correct_answer).toBe("b) Mitochondria");
    expect(alignKeyToOption(cell("B) mitochondria", ["A) Nucleus", "B) Mitochondria", "C) Ribosome", "D) Cell wall"])).correct_answer).toBe("B) Mitochondria");
  });

  it("takes the exact option first, and leaves a key two options match only by case alone", () => {
    const letters = (key: string) => alignKeyToOption({ ...mc(key, ["a", "A", "b", "c"]), question_text: "Which is a capital letter?" }).correct_answer;
    expect(letters("A")).toBe("A");
    expect(letters("a")).toBe("a");
    const twins = alignKeyToOption(cell("mitochondria", ["Mitochondria", "MITOCHONDRIA", "Ribosome", "Cell wall"]));
    expect(twins.correct_answer).toBe("mitochondria");
    expect(validateQuizBatch([twins], new Set(["s1"]), { tier: "tiny" }).join(" ")).toContain("must exactly match one of the options");
  });

  it("generateQuizQuestions: the key is the shuffled option the child sees, so the right one can be picked", async () => {
    let n = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      n += 1;
      const stems = ["Which part of the cell makes energy?", "Name the cell's power plant.", "Where does a cell release energy from sugar?", "Which organelle has its own DNA and makes ATP?"];
      const parsed = { ...cell("mitochondria", n % 2 ? undefined : ["a) Nucleus", "b) Mitochondria", "c) Ribosome", "d) Cell wall"]), question_text: stems[(n - 1) % 4] };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
      return parsed;
    });
    const qs = await generateQuizQuestions(syllabus, 4, config);
    expect(qs).toHaveLength(4);
    for (const q of qs) {
      expect(q.options).toContain(q.correct_answer);
      expect(q.correct_answer).toMatch(/^[A-D]\) Mitochondria$/);
    }
  });

  it("review pool: a stored question whose key differs only in case comes back answerable", async () => {
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      const parsed = { ...mc("D) hop and top"), question_text: `Fresh rhyme ${Math.random()}` };
      return parsed;
    });
    const stored = [1, 2, 3, 4, 5].map((n) => ({
      ...cell("mitochondria", ["A) Nucleus", "B) Mitochondria", "C) Ribosome", "D) Cell wall"]), id: `q${n}`, question_text: `Stored cell question ${n}`,
    })) as unknown as Parameters<typeof generateQuizQuestions>[3];
    const qs = await generateQuizQuestions(syllabus, 5, config, stored);
    const review = qs.filter((q) => q.question_text.startsWith("Stored"));
    expect(review.length).toBeGreaterThan(0);
    for (const q of review) expect(q.correct_answer).toBe("B) Mitochondria");
  });
});

// TerraTutor #200 review: a key whose own text starts like a label ("C. S. Lewis", "A. Lincoln") was read as
// label + text, so it matched no option and the validator rejected a question master accepted.
describe("a multiple-choice key whose text starts with an initial", () => {
  const authors = ["A) J. K. Rowling", "B) Roald Dahl", "C) C. S. Lewis", "D) E. B. White"];
  const narnia = (correct_answer: string, options = authors) => ({
    ...mc(correct_answer, options),
    question_text: "Who wrote The Lion, the Witch and the Wardrobe?",
    explanation: "C. S. Lewis wrote the Narnia books.",
  });

  it("is set to the option whose text it is", () => {
    expect(alignKeyToOption(narnia("C. S. Lewis")).correct_answer).toBe("C) C. S. Lewis");
    expect(alignKeyToOption(narnia("c. s. lewis")).correct_answer).toBe("C) C. S. Lewis");
    expect(alignKeyToOption(narnia("C) C. S. Lewis")).correct_answer).toBe("C) C. S. Lewis");
    const lincoln = alignKeyToOption(narnia("A. Lincoln", ["A) G. Washington", "B) A. Lincoln", "C) T. Jefferson", "D) U. S. Grant"]));
    expect(lincoln.correct_answer).toBe("B) A. Lincoln");
    expect(alignKeyToOption(narnia("C. S. Lewis", ["J. K. Rowling", "Roald Dahl", "C. S. Lewis", "E. B. White"])).correct_answer).toBe("C. S. Lewis");
  });

  it("validateQuizBatch accepts it", () => {
    expect(validateQuizBatch([narnia("C. S. Lewis")], new Set(["s1"]), { tier: "tiny" })).toEqual([]);
    expect(validateQuizBatch([narnia("A. Lincoln", ["A) G. Washington", "B) A. Lincoln", "C) T. Jefferson", "D) U. S. Grant"])], new Set(["s1"]), { tier: "tiny" })).toEqual([]);
  });

  it("generateQuizQuestions: the key is the shuffled option the child sees", async () => {
    let n = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      if (opts.toolName === "emit_verdicts") return { verdicts: [] };
      n += 1;
      const stems = ["Who wrote The Lion, the Witch and the Wardrobe?", "Who wrote The Magician's Nephew?", "Which author created Narnia?"];
      const parsed = { ...narnia("C. S. Lewis"), question_text: stems[(n - 1) % 3] };
      const issues = opts.validate ? opts.validate(parsed as never) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts. Issues: ${issues.join("; ")}`);
      return parsed;
    });
    const qs = await generateQuizQuestions(syllabus, 3, config);
    expect(qs).toHaveLength(3);
    for (const q of qs) {
      expect(q.options).toContain(q.correct_answer);
      expect(q.correct_answer).toMatch(/^[A-D]\) C\. S\. Lewis$/);
    }
  });
});
