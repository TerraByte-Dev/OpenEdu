import { describe, it, expect, vi, beforeEach } from "vitest";

// TerraTutor live test part 9 (2026-11-20), issues 1 and 2. A level test asked about "The percentage of silica
// (SiO2) content" 3 times in one section: a key with a digit counted as a number, which the same-key cap
// leaves alone. And a quiz asked what the cell membrane does in relation to the cytoplasm 3 times, keyed
// in other words each time, which the near-duplicate check (same key only, for multiple choice) let
// through. The labelled pairs in __fixtures__/near-repeat-pairs.json are the measurement behind
// quiz-grading.ts isRewordedRepeat; the generator tests run the production path with the model stubbed,
// applying `validate` as callLLMStructured does.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "medium"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateQuizQuestions, generatePromotionTestQuestions, SAME_KEY_CAP } from "./quiz";
import { isNearDuplicate, dedupeByQuestionText, keyForm, sameKeyForm, type NearDuplicateQ } from "./quiz-grading";
import { callLLMStructured, log } from "./llm";
import pairs from "./__fixtures__/near-repeat-pairs.json";
import type { LLMConfig, Syllabus } from "../types";

const medium = { provider: "ollama", model: "qwen3:8b", modelTier: "medium" } as unknown as LLMConfig;
const volcanoes = { level: 2, title: "Volcanoes level 2", subtopics: [{ id: "2.1", title: "Magma and eruptions", key_concepts: ["viscosity", "silica"] }] } as unknown as Syllabus;
const cells = { level: 1, title: "The cell", subtopics: [{ id: "1.1", title: "Cell parts", key_concepts: ["cell membrane", "cytoplasm"] }] } as unknown as Syllabus;

type Raw = {
  question_text: string; question_type: string; options: string[]; correct_answer: string; difficulty_level: number;
  explanation: string; subtopic_id: string; blank_position: string; matching_pairs: Array<{ left: string; right: string }>;
};
type Pair = { note?: string; a: NearDuplicateQ & { from?: string }; b: NearDuplicateQ & { from?: string } };
const label = (p: Pair) => p.note ?? `${p.a.from} / ${p.b.from}`;

let n = 0;
// A question with nothing in common with any other: a unique stem and key.
const filler = (subtopic_id: string): Raw => {
  const k = ++n;
  const key = `A) Rock sample ${["north", "south", "east", "west", "upper", "lower", "inner", "outer"][k % 8]} ${k}`;
  return {
    question_text: `Field log entry ${k}: which labelled sample came from the cliff face?`, question_type: "multiple_choice",
    options: [key, "B) none", "C) both", "D) neither"], correct_answer: key, difficulty_level: 2,
    explanation: `The log says so. Therefore the answer is ${key}`, subtopic_id, blank_position: "", matching_pairs: [],
  };
};
// A multiple-choice question from the fixture (a live one), with an explanation the validator accepts.
const asRaw = (q: NearDuplicateQ & { options?: readonly string[] | null }, subtopic_id: string): Raw => ({
  question_text: q.question_text, question_type: "multiple_choice", options: [...(q.options ?? [])],
  correct_answer: String(q.correct_answer), difficulty_level: 2,
  explanation: `That is what the lesson says. Therefore the answer is ${q.correct_answer}`, subtopic_id, blank_position: "", matching_pairs: [],
});

// Each question call takes the next of `script` (then fillers), validated as callLLMStructured would.
function model(script: Raw[], subtopic_id: string) {
  let calls = 0;
  vi.mocked(callLLMStructured).mockReset();
  vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
    const { toolName, validate } = opts as { toolName: string; validate?: (p: unknown) => string[] };
    if (toolName === "emit_verdicts") return { verdicts: [] } as never;
    const out = script[calls++] ?? filler(subtopic_id);
    const issues = validate ? validate(out) : [];
    if (issues.length) throw new Error(`Structured output failed after 3 attempts: ${issues.join("; ")}`);
    return out as never;
  });
}

const fromFixture = (from: string) => {
  for (const p of [...pairs.repeats, ...pairs.different] as Pair[]) for (const q of [p.a, p.b]) if (q.from === from) return q;
  throw new Error(`not in the fixture: ${from}`);
};

beforeEach(() => { n = 0; vi.mocked(log.info).mockClear(); });

describe("labelled near-repeat pairs (TerraTutor live tests 6-9)", () => {
  it("never merges a pair a careful reader calls two questions", () => {
    const merged = (pairs.different as Pair[]).filter((p) => isNearDuplicate(p.a, p.b) || isNearDuplicate(p.b, p.a)).map(label);
    expect(merged).toEqual([]);
    for (const p of pairs.different as Pair[]) expect(dedupeByQuestionText([p.a, p.b]), label(p)).toHaveLength(2);
  });

  it("catches at least 28 of the 34 repeats in the saved quizzes and level tests", () => {
    const caught = (pairs.repeats as Pair[]).filter((p) => isNearDuplicate(p.a, p.b) && isNearDuplicate(p.b, p.a));
    // Measured 2026-11-20: 28 of 34 (master: 2). The 6 missed restate the stem with other content
    // words ("the role of the cell membrane" after a sentence on the Cell Theory, "a lower silica content").
    expect(caught.length).toBeGreaterThanOrEqual(28);
  });

  it("catches the live ones: quiz 2 #3, #6 and #8, and level test #13 and #35", () => {
    const q2 = (i: number) => fromFixture(`cells L1 quiz 2, live test part 9, #${i}`);
    const lt = (i: number) => fromFixture(`volcanoes L2 level test, live test part 9, #${i}`);
    expect(isNearDuplicate(q2(3), q2(6))).toBe(true);
    expect(isNearDuplicate(q2(3), q2(8))).toBe(true);
    expect(isNearDuplicate(q2(6), q2(8))).toBe(true);
    expect(isNearDuplicate(lt(13), lt(35))).toBe(true);
    // The same stem about a high-silica magma is the other question.
    expect(isNearDuplicate(lt(13), lt(17))).toBe(false);
    expect(isNearDuplicate(lt(17), lt(35))).toBe(false);
  });

  it("local path: a quiz asks the membrane-and-cytoplasm question once", async () => {
    const q2 = (i: number) => asRaw(fromFixture(`cells L1 quiz 2, live test part 9, #${i}`), "1.1");
    model([q2(3), q2(6), filler("1.1"), q2(8), filler("1.1")], "1.1");
    const qs = await generateQuizQuestions(cells, 5, { ...medium }, [], undefined, null, null);
    expect(qs).toHaveLength(5);
    expect(qs.filter((q) => /cytoplasm/.test(q.question_text)).map((q) => q.question_text)).toEqual([q2(3).question_text]);
  });

  it("local path: a mirror question that adds the qualifier, or a negation, stays", async () => {
    const pair = (note: string) => (pairs.different as Pair[]).find((p) => p.note === `${note} (multiple choice)`)!;
    const script = ["covalent / ionic bond", "inner / outer core", "describes / doesn't describe (basaltic lava)"]
      .flatMap((note) => [asRaw(pair(note).a, "1.1"), asRaw(pair(note).b, "1.1")]);
    model(script, "1.1");
    const qs = await generateQuizQuestions(cells, 6, { ...medium }, [], undefined, null, null);
    expect(qs.map((q) => q.question_text)).toEqual(script.map((q) => q.question_text));
  });

  it("level test path: #35 is dropped as #13 asked again, #17 (high silica) stays", async () => {
    const lt = (i: number) => asRaw(fromFixture(`volcanoes L2 level test, live test part 9, #${i}`), "2.1");
    model([lt(13), lt(35), lt(17)], "2.1");
    const { current } = await generatePromotionTestQuestions(volcanoes, [], { ...medium });
    expect(current).toHaveLength(35);
    const texts = current.map((q) => q.question_text);
    expect(texts).toContain(lt(13).question_text);
    expect(texts).toContain(lt(17).question_text);
    expect(texts).not.toContain(lt(35).question_text);
  }, 30_000);
});

describe("a key with a digit is routine only when it is a number at heart (TerraTutor live test part 9 issue 1)", () => {
  const sa = (correct_answer: string) => ({ question_text: "", question_type: "short_answer", options: [] as string[], correct_answer });
  const mcq = (correct_answer: string) => ({ question_text: "", question_type: "multiple_choice", options: [correct_answer, "B) x", "C) y", "D) z"], correct_answer });

  it("counts a key that names a formula toward the same-key cap", () => {
    expect(sameKeyForm(mcq("B) The percentage of silica (SiO2) content."))).toBe("percentage of silica sio2 content");
    expect(sameKeyForm(mcq("C) The percentage of silica (SiO2) content"))).toBe("percentage of silica sio2 content");
    expect(sameKeyForm(sa("H2O"))).toBe("h2o");
    expect(sameKeyForm(sa("Vitamin B12"))).toBe("vitamin b12");
  });

  it("leaves a number, fraction, measure or expression uncounted", () => {
    for (const k of ["12", "3/4", "5 cm", "x = 4", "-3", "$5", "2:30 PM", "45 square meters", "12.5 kg", "10 x 3 = 30"]) {
      expect(sameKeyForm(sa(k)), k).toBeNull();
    }
  });

  it("drops end punctuation from a numeric key, and keeps its signs", () => {
    expect(keyForm("12!")).toBe(keyForm("12"));
    expect(keyForm("5 cm.")).toBe(keyForm("5 cm"));
    expect(keyForm("-3")).not.toBe(keyForm("3"));
    expect(keyForm("$5")).not.toBe(keyForm("5"));
    expect(keyForm("50%")).not.toBe(keyForm("50"));
  });

  it("keeps a leading minus and a decimal point in a longer key", () => {
    expect(keyForm("-5 degrees at the summit")).not.toBe(keyForm("5 degrees at the summit"));
    expect(keyForm("pH of 7.4 in blood")).toBe("ph of 7.4 in blood");
    expect(keyForm("pH of 7.4 in blood.")).toBe("ph of 7.4 in blood");
  });

  it(`level test path: a section asks at most ${SAME_KEY_CAP} questions keyed on the silica content`, async () => {
    const silica = (question_text: string, letter: string): Raw => {
      const key = `${letter}) The percentage of silica (SiO2) content${letter === "B" ? "." : ""}`;
      return {
        question_text, question_type: "multiple_choice",
        options: letter === "A" ? [key, "B) Temperature", "C) Crystal size", "D) Gas pressure"] : ["A) Temperature", key, "C) Crystal size", "D) Gas pressure"],
        correct_answer: key, difficulty_level: 2, explanation: `Silica links into chains. Therefore the answer is ${key}`,
        subtopic_id: "2.1", blank_position: "", matching_pairs: [],
      };
    };
    model([
      silica("Which chemical component mostly controls how thick a magma is?", "B"),
      filler("2.1"),
      silica("What decides whether lava runs like syrup or like water?", "A"),
      silica("Geologists measure what to predict a magma's resistance to flow?", "B"),
      silica("Which property of molten rock makes a volcano's lava sticky?", "A"),
    ], "2.1");
    const { current } = await generatePromotionTestQuestions(volcanoes, [], { ...medium });
    expect(current).toHaveLength(35);
    expect(current.filter((q) => /silica/.test(q.correct_answer))).toHaveLength(SAME_KEY_CAP);
    expect(vi.mocked(log.info).mock.calls.some((c) => /2 question\(s\) set aside past the 2-per-key cap/.test(String(c[1])))).toBe(true);
  }, 30_000);
});
