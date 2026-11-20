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
import {
  isNearDuplicate, dedupeByQuestionText, keyForm, sameKeyForm, sameAnswer, foldPlural, sameCapKey, sameKeyHead, sameStatedAnswer,
  type NearDuplicateQ, type EarlierQuestion,
} from "./quiz-grading";
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

  it("catches at least 30 of the 47 repeats in the saved quizzes and level tests", () => {
    expect(pairs.repeats).toHaveLength(47);
    const caught = (pairs.repeats as Pair[]).filter((p) => isNearDuplicate(p.a, p.b) && isNearDuplicate(p.b, p.a));
    // Measured 2026-11-20: 29 of 40 (28 of 40 before live test part 10's round); live test part 11 added
    // 7 repeats, 30 of 47 (29 of 47 before isNearDuplicate read keys that differ only by a leading "to"). The 17 missed restate
    // the stem with other content words ("the role of the cell membrane" after a sentence on the Cell
    // Theory, "a lower silica content", "volcanic arcs" / "arc volcanism") or add words that are kept as a
    // qualifier ("in relation to the cell", "characterized by active seafloor spreading").
    expect(caught.length).toBeGreaterThanOrEqual(30);
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

  // OpenEdu #407's review of the #265 port: a stem that adds one qualifier that changes the answer, keyed in
  // words the other key shares, merged both ways (the tides / the highest tides). 4 of the review's stems and
  // 6 more, each also as multiple choice (ported from TerraTutor #267).
  it("keeps apart a stem that adds a qualifier when the keys differ", () => {
    const qualifier = (pairs.different as Pair[]).filter((p) => /OpenEdu #407 review|#407's take-back/.test(p.note ?? ""));
    expect(qualifier).toHaveLength(20);
    expect(qualifier.filter((p) => isNearDuplicate(p.a, p.b) || isNearDuplicate(p.b, p.a)).map(label)).toEqual([]);
    const rock = (question_text: string, correct_answer: string) => ({ question_text, question_type: "short_answer", options: [], correct_answer });
    expect(isNearDuplicate(rock("What kind of rock forms when magma cools?", "Igneous rock"),
      rock("What kind of intrusive rock forms when magma cools?", "Intrusive igneous rock"))).toBe(false);
    // The same stems with one key are still one question asked twice.
    expect(isNearDuplicate(rock("What weather does a front bring?", "Rain"), rock("What weather does a cold front bring?", "Rain"))).toBe(true);
  });

  // TerraTutor #267's review: the "and ..." exception took the words after an "and" both stems share, so a
  // qualifier added after it ("plants and animals need to live" / "... in the desert") was excused and merged.
  it("keeps apart a qualifier added after an \"and\" both stems share", () => {
    const shared = (pairs.different as Pair[]).filter((p) => /after a shared "and"/.test(p.note ?? ""));
    expect(shared).toHaveLength(6);
    expect(shared.filter((p) => isNearDuplicate(p.a, p.b) || isNearDuplicate(p.b, p.a)).map(label)).toEqual([]);
  });

  // OpenEdu #408's review: an "and ..." tail whose words are all new was excused even when it says where,
  // when or under what condition, so "What do cactus plants need to live?" merged with "... to live and grow
  // without water in the desert?" (all 6 of these merged before QUALIFIER_LINKS).
  it("keeps apart a qualifier in a new \"and\" tail", () => {
    const tail = (pairs.different as Pair[]).filter((p) => /new "and" tail/.test(p.note ?? ""));
    expect(tail).toHaveLength(6);
    expect(tail.filter((p) => isNearDuplicate(p.a, p.b) || isNearDuplicate(p.b, p.a)).map(label)).toEqual([]);
  });

  it("local path: a quiz keeps the tides and the highest tides", async () => {
    const pair = (pairs.different as Pair[]).find((p) => p.note === "tides / the highest tides (OpenEdu #407 review) (multiple choice)")!;
    const script = [asRaw(pair.a, "1.1"), asRaw(pair.b, "1.1")];
    model(script, "1.1");
    const qs = await generateQuizQuestions(cells, 4, { ...medium }, [], undefined, null, null);
    expect(qs.slice(0, 2).map((q) => q.question_text)).toEqual(script.map((q) => q.question_text));
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

describe("live test part 10: plurals, the review pool's near-twins and key wordings", () => {
  const LT10 = "volcanoes L3 level test, live test part 10 (options not saved, keys cut at 80 characters as the run saved them)";
  const lt10 = (i: number) => fromFixture(`${LT10}, #${i}`);
  // The level test saved no options: its key as option A of four.
  const asMc = (q: NearDuplicateQ, subtopic_id: string): Raw => {
    const key = `A) ${String(q.correct_answer).replace(/^[A-D]\)\s*/, "")}`;
    return asRaw({ ...q, correct_answer: key, options: [key, "B) Crystal size of the rock", "C) Gas pressure in the vent", "D) Temperature of the lava"] }, subtopic_id);
  };
  const mcq = (question_text: string, key: string, others: string[]): Raw =>
    asRaw({ question_text, question_type: "multiple_choice", options: [key, ...others], correct_answer: key }, "1.1");

  it("folds a plural to its singular only where that is safe", () => {
    for (const [w, one] of [["arcs", "arc"], ["cells", "cell"], ["plates", "plate"], ["volatiles", "volatile"], ["bodies", "body"]]) expect(foldPlural(w), w).toBe(one);
    for (const w of ["gas", "glass", "is", "its", "was", "process", "nucleus", "basis", "news", "means", "species", "arc",
      "physics", "genetics", "mathematics", "besides", "towards", "lens"]) expect(foldPlural(w), w).toBe(w);
    for (const [w, one] of [["movies", "movie"], ["cookies", "cookie"], ["calories", "calorie"]]) expect(foldPlural(w), w).toBe(one);
    // "gases" keeps its "e": a missed repeat with "gas", never a merge.
    expect(foldPlural("gases")).not.toBe("gas");
  });

  it("catches \"... fuels volcanic arcs is:\" asked again as \"... fuels the volcanic arc is:\" (#1 / #31)", () => {
    expect(isNearDuplicate(lt10(1), lt10(31))).toBe(true);
    expect(isNearDuplicate(lt10(31), lt10(1))).toBe(true);
    // "arc volcanism" (#35) is another word than "volcanic", not a plural: still two questions here.
    expect(isNearDuplicate(lt10(1), lt10(35))).toBe(false);
  });

  it("level test path: #31 is dropped as #1 asked again", async () => {
    model([asMc(lt10(1), "2.1"), asMc(lt10(31), "2.1")], "2.1");
    const { current } = await generatePromotionTestQuestions(volcanoes, [], { ...medium });
    expect(current).toHaveLength(35);
    const texts = current.map((q) => q.question_text);
    expect(texts).toContain(lt10(1).question_text);
    expect(texts).not.toContain(lt10(31).question_text);
  }, 30_000);

  // The branch review's pairs: subject-verb agreement folds to one word only if a plural fold reaches the
  // key, and a reversed question has one set of asked words in another order.
  it("keeps apart subject-verb agreement pairs and a reversed question with long keys", () => {
    const review = (pairs.different as Pair[]).filter((p) => /live test part 10 branch review/.test(p.note ?? ""));
    expect(review).toHaveLength(6);
    expect(review.filter((p) => isNearDuplicate(p.a, p.b) || isNearDuplicate(p.b, p.a)).map(label)).toEqual([]);
  });

  it("quiz path: two missed true/false questions on other numbers are both re-posed", async () => {
    const tf = (id: number, a: string) => ({
      id: String(id), attempt_id: "quiz-1", question_text: `Is the fraction ${a} more than the fraction 1/2 on this number line?`,
      question_type: "true_false", options: null, correct_answer: "False", user_answer: "True", is_correct: false,
      difficulty_level: 1, explanation: `${a} is less than 4/8. Therefore the answer is False`, subtopic_id: "1.1",
      matching_pairs: null, blank_position: null,
    }) as never;
    const pool = [tf(1, "3/8"), tf(2, "1/8")];
    model([], "1.1");
    const qs = await generateQuizQuestions(cells, 10, { ...medium }, pool, undefined, null, null);
    const texts = qs.map((q) => q.question_text);
    expect(texts).toContain("Is the fraction 3/8 more than the fraction 1/2 on this number line?");
    expect(texts).toContain("Is the fraction 1/8 more than the fraction 1/2 on this number line?");
  }, 30_000);

  it("quiz path: the review pool re-poses one of two near-twin misses and takes the next miss instead", async () => {
    const q2 = (i: number) => asRaw(fromFixture(`cells L1 quiz 2, live test part 9, #${i}`), "1.1");
    const missed = (q: Raw, id: number) => ({ ...q, id: String(id), attempt_id: "quiz-1", user_answer: "B) none", is_correct: false }) as never;
    const others = [filler("1.1"), filler("1.1"), filler("1.1")];
    const pool = [missed(q2(3), 1), missed(q2(6), 2), ...others.map((q, i) => missed(q, 3 + i))];
    model([], "1.1");
    const qs = await generateQuizQuestions(cells, 20, { ...medium }, pool, undefined, null, null);
    expect(qs).toHaveLength(20);
    const texts = qs.map((q) => q.question_text);
    expect(texts).toContain(q2(3).question_text);
    expect(texts).not.toContain(q2(6).question_text);
    for (const q of others) expect(texts).toContain(q.question_text);
  }, 30_000);

  it("counts one answer in other wordings as one key for the cap, and nothing else", () => {
    const k = (s: string) => sameKeyForm({ question_text: "", question_type: "short_answer", options: [], correct_answer: s })!;
    expect(sameAnswer(k("All cells arise from pre-existing cells."), k("Cells arise only from pre-existing cells."))).toBe(true);
    expect(sameAnswer(k("cells arise from pre-existing cells"), k("Cells arise only from pre-existing cells."))).toBe(true);
    for (const [a, b] of [["The inner core", "The outer core"], ["Ionic bond", "Covalent bond"], ["Na+", "Na"], ["it's", "its"],
      ["liquid water turning into water vapor", "water vapor turning into liquid water"], ["All", "Only"],
      // The branch review's: a one-word key is never folded, a short key keeps "all" and "only", and a
      // leading "only" is another claim.
      ["sings", "sing"], ["Arms", "Arm"], ["Genetics", "Genetic"], ["The odds", "Odd"], ["Only plants", "All plants"],
      ["Plants only", "Plants"], ["Only cells arise from pre-existing cells", "Cells arise only from pre-existing cells"]]) {
      expect(sameAnswer(k(a), k(b)), `${a} / ${b}`).toBe(false);
    }
    // No different pair in the fixture shares a key this way that keyForm kept apart.
    const merged = (pairs.different as Pair[]).filter((p) => {
      const [ka, kb] = [sameKeyForm(p.a), sameKeyForm(p.b)];
      return ka !== null && kb !== null && ka !== kb && sameAnswer(ka, kb);
    });
    expect(merged.map(label)).toEqual([]);
  });

  // Quiz 2's #4 and #5 (model text), and a third wording written here.
  it(`quiz path: three wordings of "cells arise from pre-existing cells" count toward one ${SAME_KEY_CAP}-per-key cap`, async () => {
    const wordings = [
      mcq("Which of the following is a fundamental concept that the Cell Theory supports regarding the origin of new cells?",
        "D) All cells arise from pre-existing cells.", ["A) Cells only exist in multicellular organisms.", "B) Cells can spontaneously generate energy.", "C) Cells are the only structures capable of reproduction."]),
      mcq("Which of the following statements best represents one of the three main tenets of the Cell Theory?",
        "C) Cells arise only from pre-existing cells.", ["A) All living things are made up of cells.", "B) Cells can only be found in multicellular organisms.", "D) Cells contain genetic material."]),
      mcq("According to the Cell Theory, where do new cells come from?",
        "B) Cells arise from pre-existing cells.", ["A) From nonliving matter", "C) From the air", "D) From sunlight"]),
    ];
    model([wordings[0], filler("1.1"), wordings[1], wordings[2]], "1.1");
    const qs = await generateQuizQuestions(cells, 6, { ...medium }, [], undefined, null, null);
    expect(qs).toHaveLength(6);
    expect(qs.filter((q) => /arise/i.test(q.correct_answer))).toHaveLength(SAME_KEY_CAP);
    expect(qs.map((q) => q.question_text)).not.toContain(wordings[2].question_text);
    expect(vi.mocked(log.info).mock.calls.some((c) => /1 question\(s\) set aside past the 2-per-key cap/.test(String(c[1])))).toBe(true);
  });
});

describe("live test part 11: the review pool, key tails and the last quiz's rewordings", () => {
  const q2 = (i: number) => fromFixture(`cells L1 quiz 2, live test part 11 (options not saved), #${i}`);
  const q1 = (i: number) => fromFixture(`cells L1 quiz 1, live test part 11, #${i}`);
  const mcq = (question_text: string, key: string, others: string[], subtopic_id = "1.1"): Raw =>
    asRaw({ question_text, question_type: "multiple_choice", options: [key, ...others], correct_answer: key }, subtopic_id);
  const missed = (q: Raw, id: number) => ({ ...q, id: String(id), attempt_id: "quiz-1", user_answer: "B) none", is_correct: false }) as never;
  // Quiz 1's #6 and #8, model text with their options.
  const ORIGIN = mcq("Which of the following is a fundamental concept that the Cell Theory supports regarding the origin of new cells?",
    "D) All cells arise from pre-existing cells.", ["A) Cells only exist in multicellular organisms.", "B) Cells can spontaneously generate energy.", "C) Cells are the only structures capable of reproduction."]);
  const TENET = mcq("Which of the following statements best represents one of the three main tenets of the Cell Theory?",
    "C) Cells arise only from pre-existing cells.", ["A) All living things are made up of cells.", "B) Cells can only be found in multicellular organisms.", "D) Cells contain genetic material."]);

  it("reads quiz 2's #9 / #13 as one stated answer, and never a short key two questions share", () => {
    expect(isNearDuplicate(q2(9), q2(13))).toBe(false);
    expect(sameStatedAnswer(q2(9), q2(13))).toBe(true);
    expect(sameStatedAnswer(ORIGIN, TENET)).toBe(true);
    // One key on mirror questions, one asking what is not true: two questions.
    const mirrors = (pairs.different as Pair[]).filter((p) => /, one key \(written for the live test part 11 branch review\)/.test(p.note ?? ""));
    expect(mirrors).toHaveLength(2);
    for (const p of mirrors) expect(sameStatedAnswer(p.a, p.b), label(p)).toBe(false);
    const merged = (pairs.different as Pair[]).filter((p) => sameStatedAnswer(p.a, p.b) || sameStatedAnswer(p.b, p.a)).map(label);
    expect(merged).toEqual([]);
  });

  it("quiz path: the review pool re-poses one of the two wordings of one miss and takes the next miss instead", async () => {
    const others = [filler("1.1"), filler("1.1"), filler("1.1")];
    const pool = [missed(ORIGIN, 1), missed(TENET, 2), ...others.map((q, i) => missed(q, 3 + i))];
    model([], "1.1");
    const qs = await generateQuizQuestions(cells, 20, { ...medium }, pool, undefined, null, null);
    expect(qs).toHaveLength(20);
    const texts = qs.map((q) => q.question_text);
    expect(texts).toContain(ORIGIN.question_text);
    expect(texts).not.toContain(TENET.question_text);
    for (const q of others) expect(texts).toContain(q.question_text);
  }, 30_000);

  it("quiz path: two missed questions that only share the answer \"Abraham Lincoln\" are both re-posed", async () => {
    const pair = (pairs.different as Pair[]).find((p) => p.note === "#263 review: president / speech (multiple choice)")!;
    const pool = [missed(asRaw(pair.a, "1.1"), 1), missed(asRaw(pair.b, "1.1"), 2)];
    model([], "1.1");
    const qs = await generateQuizQuestions(cells, 10, { ...medium }, pool, undefined, null, null);
    const texts = qs.map((q) => q.question_text);
    expect(texts).toContain(pair.a.question_text);
    expect(texts).toContain(pair.b.question_text);
  }, 30_000);

  it("reads a key with an explaining tail as the key before it, and nothing else", () => {
    expect(sameKeyHead("C) The Joule-Thomson effect", "A) The Joule-Thomson effect, where a gas expands rapidly upon throttling.")).toBe(true);
    expect(sameKeyHead("B) The Joule-Thomson effect, where rapid depressurization causes a temperature drop leading to gas exsolution.",
      "A) The Joule-Thomson effect, where a gas expands rapidly upon throttling.")).toBe(true);
    expect(sameKeyHead("A) Buoyancy-driven acceleration due to gas expansion.",
      "C) The buoyancy-driven acceleration resulting from density stratification of the gas mixture.")).toBe(true);
    // Two tails cut on a cause word that say one thing (live test part 10's "Decompression melting" keys).
    expect(sameKeyHead("Decompression melting resulting from the reduction in pressure", "Decompression melting due to the reduction in pressure")).toBe(true);
    for (const [a, b] of [
      // Containing or starting with a shorter key is not a tail (both pairs are in the fixture's different ones).
      ["Cell membrane", "Cell wall before the cell membrane"], ["Water, sunlight and air", "Stored water, sunlight and air"],
      ["Cell membrane", "Cell membrane proteins"], ["Andesitic or rhyolitic", "Andesitic or rhyolitic magma"],
      // A list, and a "that" that narrows the name, cut nothing.
      ["Igneous rock, metamorphic rock", "Igneous rock, sedimentary rock"], ["Plant cells that have chloroplasts", "Plant cells that lack chloroplasts"],
      // A one-word head, another head, another negation or number.
      ["Nucleus, which controls the cell", "Nucleus"], ["The inner core, which is solid", "The outer core, which is liquid"],
      // A tail cut on a cause word that is the answer itself, and a bracket or an "-ing" / "-ed" word after a
      // comma, which cut nothing (the live test part 11 branch review's pairs).
      ["High viscosity, leading to explosive eruptions.", "High viscosity, making it flow slowly"],
      ["Soil erosion caused by wind", "Soil erosion caused by water"], ["Cellular respiration (aerobic)", "Cellular respiration (anaerobic)"],
      ["Atomic number (protons)", "Atomic number (neutrons)"], ["Increased temperature, decreased pressure", "Increased temperature, increased pressure"],
      ["Plate boundaries, converging", "Plate boundaries, diverging"], ["Natural selection, favoring larger beaks", "Natural selection, favoring smaller beaks"],
      ["Sea level rise due to thermal expansion", "Sea level rise due to melting glaciers"],
      ["Mass extinction caused by an asteroid impact", "Mass extinction caused by volcanic activity"],
      ["Chemical weathering caused by acid rain", "Chemical weathering caused by oxidation"],
      ["Population growth, limited by food", "Population growth, unlimited by predators"],
      ["Cells that are not alive, which ...", "Cells that are alive, which ..."], ["Plates, which move", "Plates, which do not move"],
      ["Type 1 diabetes, where the body makes no insulin", "Type 2 diabetes, where the body resists insulin"],
      ["The pressure regime where gas expansion leads to a rapid drop in temperature", "The pressure regimes that drive explosive vs. effusive eruption styles."],
    ]) expect(sameKeyHead(a, b), `${a} / ${b}`).toBe(false);
    // No different pair in the fixture has keys the cap counts as one that keyForm and sameAnswer kept apart.
    const folded = (pairs.different as Pair[]).filter((p) => {
      const [ka, kb] = [sameKeyForm(p.a), sameKeyForm(p.b)];
      return ka !== null && kb !== null && !sameAnswer(ka, kb) && sameCapKey(p.a, p.b);
    });
    expect(folded.map(label)).toEqual([]);
  });

  it(`level test path: a section asks at most ${SAME_KEY_CAP} questions on "The Joule-Thomson effect" in any wording`, async () => {
    const jt = (question_text: string, key: string, letter: string) => {
      const others = ["Fractional crystallization", "Magma mixing", "Crustal assimilation"];
      const options = ["A", "B", "C", "D"].map((l) => `${l}) ${l === letter ? key : others.shift()}`);
      return asRaw({ question_text, question_type: "multiple_choice", options, correct_answer: `${letter}) ${key}` }, "2.1");
    };
    // Level test #1, #9 and #20, model text; options written here.
    model([
      jt("During a magma ascent, the solubility of volcanic gases in the magma is primarily governed by the relationship between magma temperature and pressure. Which phenomenon is the critical mechanism that allows dissolved volcanic gases to rapidly come out of solution and contribute to explosive eruption potential?",
        "The Joule-Thomson effect, where rapid depressurization causes a temperature drop leading to gas exsolution.", "B"),
      jt("Which physical principle is most directly responsible for driving a pressure-driven, explosive eruption regime when volatile gas expansion occurs near the critical point of the magma?",
        "The Joule-Thomson effect", "C"),
      jt("A magma body is subjected to increasing pressure, causing dissolved volcanic gases to come out of solution (exsolution). Which of the following physical phenomena is most directly responsible for the rapid pressure drop and subsequent explosive decompression that drives phreatomagmatic eruption mechanisms?",
        "The Joule-Thomson effect, where a gas expands rapidly upon throttling.", "A"),
    ], "2.1");
    const { current } = await generatePromotionTestQuestions(volcanoes, [], { ...medium });
    expect(current).toHaveLength(35);
    expect(current.filter((q) => /Joule-Thomson/.test(q.correct_answer))).toHaveLength(SAME_KEY_CAP);
    expect(vi.mocked(log.info).mock.calls.some((c) => /1 question\(s\) set aside past the 2-per-key cap/.test(String(c[1])))).toBe(true);
  }, 30_000);

  it("reads keys that differ only by a leading \"to\" before 3 or more words as one only on a reworded stem", () => {
    expect(keyForm("C) To separate the cell's interior from the outside environment")).not.toBe(keyForm("A) Separate the cell's interior from the outside environment"));
    expect(isNearDuplicate(q1(7), q2(20))).toBe(true);
    expect(isNearDuplicate(q2(20), q1(7))).toBe(true);
    // "made me" / "wants me", "Let her" / "Tell her": the stems share most words, but not the one that asks.
    const grammar = (pairs.different as Pair[]).filter((p) => /an infinitive with and without "to"/.test(p.note ?? ""));
    expect(grammar).toHaveLength(3);
    for (const p of grammar) {
      expect(isNearDuplicate(p.a, p.b), label(p)).toBe(false);
      expect(dedupeByQuestionText([p.a, p.b]), label(p)).toHaveLength(2);
    }
    // A short key keeps its "to": "to go" / "go".
    const go = (key: string) => asRaw({ question_text: "Which completes the sentence? 'Mom let the dog ___ outside.'", question_type: "multiple_choice", options: ["A) go", "B) to go"], correct_answer: key }, "1.1");
    expect(isNearDuplicate(go("A) go"), go("B) to go"))).toBe(false);
  });

  // Quiz 2's #20 was a rewording of quiz 1's #7 and an older quiz's question; the older one set it aside,
  // and the fill took it because the last-quiz check read its key "To separate ..." as another answer.
  it("quiz path: a short quiz is not filled with a rewording of the last quiz's question", async () => {
    const asEarlier = (q: NearDuplicateQ, attempt_id: string): EarlierQuestion => ({
      question_text: q.question_text, correct_answer: String(q.correct_answer), subtopic_id: "1.1", question_type: "multiple_choice", attempt_id,
    });
    const older = fromFixture("cells L1 quiz 2, live test part 9, #6"); // "What is the primary role of the cell membrane in relation to the cytoplasm?"
    const earlier = [asEarlier(q1(7), "quiz-1"), asEarlier(older, "quiz-0")];
    const reworded = mcq("The primary role of the cell membrane in relation to the cytoplasm is to:",
      "C) To separate the cell's interior from the outside environment", ["A) Store genetic material within the cell", "B) Produce energy for the cell", "D) Provide structural support for the internal organelles"]);
    const fillers = [filler("1.1"), filler("1.1"), filler("1.1")];
    let calls = 0;
    vi.mocked(callLLMStructured).mockReset();
    vi.mocked(callLLMStructured).mockImplementation(async (_msgs, _cfg, opts) => {
      const { toolName, validate } = opts as { toolName: string; validate?: (p: unknown) => string[] };
      if (toolName === "emit_verdicts") return { verdicts: [] } as never;
      // Then the model only repeats itself, so the quiz comes up short.
      const out = [reworded, ...fillers][calls++] ?? fillers[2];
      const issues = validate ? validate(out) : [];
      if (issues.length) throw new Error(`Structured output failed after 3 attempts: ${issues.join("; ")}`);
      return out as never;
    });
    const qs = await generateQuizQuestions(cells, 4, { ...medium }, [], undefined, null, null, undefined, earlier);
    expect(qs.map((q) => q.question_text)).toEqual(fillers.map((q) => q.question_text));
    expect(vi.mocked(log.info).mock.calls.some((c) => /1 question\(s\) the last quiz asked are not asked again/.test(String(c[1])))).toBe(true);
  }, 30_000);
});
