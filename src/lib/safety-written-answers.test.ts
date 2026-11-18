import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../App.tsx?raw";
import questionRenderer from "../components/quiz/QuestionRenderer.tsx?raw";
import quizScreen from "../views/QuizFullScreen.tsx?raw";
import testScreen from "../views/PromotionTestFullScreen.tsx?raw";
import dashboard from "../views/Dashboard.tsx?raw";

// A self-harm, abuse or (with a K-12 grade set) pregnancy disclosure typed outside the chat (a quiz or
// level-test written answer, "why is that the answer?", the new-course topic) gets the chat's
// SAFETY_NOTICE, from the chat's own check (child-safety.ts isSafetyDisclosure with the learner's grade,
// unchanged). A typed answer that is one is never marked by code or a model and never marked wrong:
// gradeAnswersBatch, the one place written answers are marked, passes it as not checked. Ported from
// TerraTutor #175. The model call is stubbed; the rest is the production path.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "small"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch } from "./quiz";
import { callLLMStructured } from "./llm";
import { answerMark, showsAnswerAndKey, showsSafetyNotice } from "./quiz-grading";
import { levelTestResult } from "./level-test";
import { isSafetyDisclosure } from "./child-safety";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "m", modelTier: "small" } as unknown as LLMConfig;
const HARM = "i dont want to live anymore";
const ABUSE = "my stepdad hits me";
// A disclosure only for a learner with a K-12 grade set (OpenEdu's gate; it also serves adults).
const PREGNANT = "im 14 and pregnant";
const GRADE = 8 as const;
const item = (index: number, student: string, expected = "Photosynthesis") =>
  ({ index, question: "What do plants use sunlight for?", expected, student, type: "short_answer" });

const src = (raw: string) => raw.replace(/\r\n?/g, "\n");

describe("the disclosures used here are the chat's own hits", () => {
  it("each reads as a safety disclosure at a grade, and an ordinary answer does not", () => {
    for (const t of [HARM, ABUSE, PREGNANT]) expect(isSafetyDisclosure(t, GRADE)).toBe(true);
    expect(isSafetyDisclosure(PREGNANT, null)).toBe(false);
    expect(isSafetyDisclosure("they make food from light", GRADE)).toBe(false);
  });
});

describe("gradeAnswersBatch: a disclosure typed as an answer is not marked", () => {
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  it("passes it as not checked, never wrong, and never sends it to the grader model", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "no", correct: false } });
    const out = await gradeAnswersBatch(
      [item(0, HARM), item(1, "they make food from light"), item(2, ABUSE), item(3, PREGNANT)], config, GRADE);
    for (const i of [0, 2, 3]) expect(out.get(i)).toEqual({ isCorrect: true, feedback: "", by: "fallback" });
    expect(out.get(1)).toMatchObject({ isCorrect: false, by: "model" });
    expect(callLLMStructured).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(vi.mocked(callLLMStructured).mock.calls[0][0]);
    for (const t of [HARM, ABUSE, PREGNANT]) expect(prompt).not.toContain(t);
  });

  // The sexual-abuse, touching and sextortion patterns ported from TerraTutor #125: each was marked as an
  // ordinary (wrong) answer before the port. They need no grade.
  it("passes the ported sexual-abuse, touching and sextortion disclosures as not checked, with no grade set", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "no", correct: false } });
    const ported = [
      "he made me have sex with him", "my stepdad comes into my room at night and touches me",
      "someone online keeps asking for my nudes", "he'll post my pics unless i send more",
    ];
    const out = await gradeAnswersBatch(
      [...ported.map((t, i) => item(i, t)), item(4, "they make food from light")], config, null);
    for (const i of [0, 1, 2, 3]) expect(out.get(i), ported[i]).toEqual({ isCorrect: true, feedback: "", by: "fallback" });
    expect(out.get(4)).toMatchObject({ isCorrect: false, by: "model" });
    const prompt = JSON.stringify(vi.mocked(callLLMStructured).mock.calls[0][0]);
    for (const t of ported) expect(prompt).not.toContain(t);
  });

  // The review of #372: a science answer that only looks like the ported patterns is marked as usual, so a
  // wrong one gets no free credit.
  it("marks schoolwork answers that tripped the patterns as first ported, with or without a grade", async () => {
    const schoolwork = [
      "mimosa leaves fold up when people touch them", "a venus flytrap closes when its hairs get touched twice",
      "sea anemones sting people who touch them", "she kept her private feelings to herself",
      // TerraTutor #223's list.
      "apollo 11 touched down there in 1969", "many kids get hurt at home from falls", "Romeo and Juliet both commit suicide",
    ];
    for (const grade of [null, GRADE]) {
      vi.mocked(callLLMStructured).mockReset();
      vi.mocked(callLLMStructured).mockResolvedValue(Object.fromEntries(
        schoolwork.map((_, i) => [`answer_${i + 1}`, { feedback: "no", correct: false }])));
      const out = await gradeAnswersBatch(schoolwork.map((t, i) => item(i, t)), config, grade);
      for (let i = 0; i < schoolwork.length; i++) expect(out.get(i), schoolwork[i]).toMatchObject({ isCorrect: false, by: "model" });
      const prompt = JSON.stringify(vi.mocked(callLLMStructured).mock.calls[0][0]);
      for (const t of schoolwork) expect(prompt).toContain(t);
    }
  });

  it("calls no model at all when every answer is one", async () => {
    const out = await gradeAnswersBatch([item(0, HARM), item(1, ABUSE)], config, null);
    expect(callLLMStructured).not.toHaveBeenCalled();
    expect([...out.values()].every((o) => o.by === "fallback" && o.isCorrect)).toBe(true);
  });

  it("is not settled by code either, even when it matches the key", async () => {
    const out = await gradeAnswersBatch([item(0, ABUSE, ABUSE)], config, null);
    expect(out.get(0)).toEqual({ isCorrect: true, feedback: "", by: "fallback" });
    expect(callLLMStructured).not.toHaveBeenCalled();
  });

  it("with no grade set, a pregnancy message is graded as an answer, as it gets no notice in the chat", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "no", correct: false } });
    const out = await gradeAnswersBatch([item(0, PREGNANT)], config, null);
    expect(out.get(0)).toMatchObject({ isCorrect: false, by: "model" });
    expect(JSON.stringify(vi.mocked(callLLMStructured).mock.calls[0][0])).toContain(PREGNANT);
  });

  it("is never a wrong mark on the results or in a level test's pass rule", async () => {
    const out = await gradeAnswersBatch([item(0, HARM)], config, GRADE);
    const o = out.get(0)!;
    const q = { is_correct: o.isCorrect, graded_by: o.by, user_answer: HARM };
    expect(answerMark(q)).toBe("unchecked");
    const r = levelTestResult([{ section: "current", ...q }]);
    expect(r).toMatchObject({ unchecked: 1, correct: 0 });
    expect(r.status).not.toBe("failed");
  });
});

describe("the results show the notice, not the answer and the key", () => {
  it("showsAnswerAndKey hides a disclosure answer whatever its mark", () => {
    for (const graded_by of ["fallback", "self", "model", "exact"] as const) {
      for (const is_correct of [true, false]) {
        expect(showsAnswerAndKey({ is_correct, graded_by, user_answer: HARM }, null)).toBe(false);
        expect(showsAnswerAndKey({ is_correct, graded_by, user_answer: PREGNANT }, GRADE)).toBe(false);
      }
    }
    expect(showsAnswerAndKey({ is_correct: true, graded_by: "fallback", user_answer: "light" }, GRADE)).toBe(true);
    expect(showsAnswerAndKey({ is_correct: false, graded_by: "model", user_answer: PREGNANT }, null)).toBe(true);
  });
  it("showsSafetyNotice reads the answer and the 'why is that the answer?' text, with the grade", () => {
    expect(showsSafetyNotice({ user_answer: PREGNANT }, GRADE)).toBe(true);
    expect(showsSafetyNotice({ user_answer: PREGNANT }, null)).toBe(false);
    expect(showsSafetyNotice({ user_answer: "True", self_explanation: ABUSE }, null)).toBe(true);
    expect(showsSafetyNotice({ user_answer: "True", self_explanation: "because light" }, GRADE)).toBe(false);
    expect(showsSafetyNotice({ user_answer: null, self_explanation: null }, GRADE)).toBe(false);
  });
});

describe("the screens draw the notice from these checks, with the learner's grade", () => {
  it("App gives the quiz, the level test and the new-course screen the same grade as the chat", () => {
    const s = src(app);
    expect(s).toMatch(/<QuizFullScreen context=\{quizContext\} onClose=\{closeQuiz\} grade=\{normalizeGrade\(activeLearner\.grade\)\} \/>/);
    expect(s).toMatch(/<PromotionTestFullScreen\n\s+context=\{quizContext\}\n\s+grade=\{normalizeGrade\(activeLearner\.grade\)\}/);
    expect(s).toMatch(/<Dashboard\n\s+grade=\{normalizeGrade\(activeLearner\.grade\)\}/);
  });
  it("the question shows it as soon as the answer, or the saved 'why', is one", () => {
    expect(src(questionRenderer)).toMatch(/\{showsSafetyNotice\(question, grade\) && <SafetyNotice \/>\}/);
  });
  for (const [name, raw] of [["QuizFullScreen", quizScreen], ["PromotionTestFullScreen", testScreen]] as const) {
    it(`${name} grades with the grade, and shows it on the question and the results row in place of the not-checked note`, () => {
      const s = src(raw);
      expect(s).toMatch(/await getLocalVerifyConfig\([a-z]+\)\.catch\(\(\) => null\),\n\s+grade,\n\s+\);/);
      expect(s).toMatch(/<QuestionRenderer[^>]*\n\s+grade=\{grade\}/);
      expect(s).toMatch(/const safety = showsSafetyNotice\(q, grade\);/);
      expect(s).toMatch(/\{safety && <SafetyNotice /);
      expect(s).toMatch(/\{mark === "unchecked" && !safety && /);
      expect(s).toMatch(/\{showsAnswerAndKey\(q, grade\) && \(/);
    });
  }
  it("the level test shows it next to the answer in the learner's own marking list", () => {
    expect(src(testScreen)).toMatch(/noteFor=\{\(a\) => \(showsSafetyNotice\(a, grade\) \? SAFETY_NOTICE : null\)\}/);
  });
  it("the new-course topic shows it, and no click builds or sends it (dashboard-topic.test.ts clicks it)", () => {
    const s = src(dashboard);
    expect(s).toContain("if (isSafetyDisclosure(t, grade)) { setSafetyTopic(t); setError(SAFETY_TOPIC_COURSE_LINE); return; }");
    expect(s).toMatch(/\{safetyTopic !== null && safetyTopic === topic\.trim\(\) && <SafetyNotice /);
  });
});
