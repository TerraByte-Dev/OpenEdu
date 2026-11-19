import { describe, it, expect, vi, beforeEach } from "vitest";

// gradeAnswersBatch is the one place free-text answers are marked. graded_by stores which marks came
// from the model and which were passed because the grader failed, so every outcome must carry how it
// was decided. The model call is stubbed; the rest is the production path.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "small"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch, CODE_MISMATCH_FEEDBACK, NO_ANSWER_FEEDBACK } from "./quiz";
import { callLLMStructured } from "./llm";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "m", modelTier: "small" } as unknown as LLMConfig;
const items = [
  { index: 0, question: "2 + 2?", expected: "4", student: "4", type: "short_answer" },
  { index: 1, question: "Why is the sky blue?", expected: "Scattering", student: "light scatters", type: "written_response" },
  { index: 2, question: "Name a noble gas", expected: "Neon", student: "argon", type: "short_answer" },
];

describe("gradeAnswersBatch: how each answer was marked", () => {
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  it("marks a string or number match 'exact', and the model's verdicts 'model'", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({
      answer_1: { feedback: "ok", correct: true },
      answer_2: { feedback: "no", correct: false },
    });
    const out = await gradeAnswersBatch(items, config);
    expect(out.get(0)).toMatchObject({ isCorrect: true, by: "exact" });
    expect(out.get(1)).toMatchObject({ isCorrect: true, by: "model" });
    expect(out.get(2)).toMatchObject({ isCorrect: false, by: "model" });
  });

  it("marks a number and unit code is sure is wrong 'exact' and wrong, and never asks the model about it", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "ok", correct: true } });
    const out = await gradeAnswersBatch([
      { index: 0, question: "Write 9/20 as a percent.", expected: "45%", student: "4.5%", type: "short_answer" },
      { index: 1, question: "What is the density of pure water?", expected: "1 g/cm³", student: "1 g/mL", type: "short_answer" },
      { index: 2, question: "Write 9/20 as a percent.", expected: "45%", student: "0.45", type: "short_answer" },
    ], config);
    expect(out.get(0)).toEqual({ isCorrect: false, feedback: CODE_MISMATCH_FEEDBACK, by: "exact" });
    expect(out.get(1)).toMatchObject({ isCorrect: true, by: "exact" });
    // "0.45" asked as a percent: the value is the key's, the form is not. The model decides.
    expect(out.get(2)).toMatchObject({ isCorrect: true, by: "model" });
    const prompt = vi.mocked(callLLMStructured).mock.calls[0][0][0].content as string;
    expect(prompt).toContain("0.45");
    expect(prompt).not.toContain("4.5%");
  });

  it("marks an item the model skipped 'fallback'", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: "ok", correct: true } });
    const out = await gradeAnswersBatch(items, config);
    expect(out.get(2)).toMatchObject({ isCorrect: true, by: "fallback" });
  });

  it("marks every pending answer 'fallback' when the grader call fails", async () => {
    vi.mocked(callLLMStructured).mockImplementation(async () => { throw new Error("model down"); });
    const out = await gradeAnswersBatch(items, config);
    expect(out.get(0)).toMatchObject({ by: "exact" });
    expect(out.get(1)).toMatchObject({ isCorrect: true, by: "fallback" });
    expect(out.get(2)).toMatchObject({ isCorrect: true, by: "fallback" });
  });
});

// The grader's feedback is shown to the learner on the results (TerraTutor click test 2026-11-19: a typed
// "xyz" got "The student did not provide an answer."). The marks are the model's; only the words change.
describe("gradeAnswersBatch: the feedback the learner reads", () => {
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  async function feedback(f1: string, c1: boolean, f2: string, c2: boolean) {
    vi.mocked(callLLMStructured).mockResolvedValue({ answer_1: { feedback: f1, correct: c1 }, answer_2: { feedback: f2, correct: c2 } });
    const out = await gradeAnswersBatch(items, config);
    return [out.get(1), out.get(2)];
  }

  it("a wrong answer the grader says gives no answer is told it doesn't answer the question yet", async () => {
    const [a, b] = await feedback("The student did not provide an answer.", false, "No amount is given.", false);
    expect(a).toEqual({ isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "model" });
    expect(b).toEqual({ isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "model" });
  });

  it("other feedback about the student becomes the plain line for its mark", async () => {
    const [a, b] = await feedback("The student correctly says light scatters.", true, "The student wrote a different gas, not neon.", false);
    expect(a).toEqual({ isCorrect: true, feedback: "Correct.", by: "model" });
    expect(b).toEqual({ isCorrect: false, feedback: CODE_MISMATCH_FEEDBACK, by: "model" });
  });

  it("a partial answer the grader says leaves something out is not told it gave no answer", async () => {
    const [a, b] = await feedback("The student does not include the unit.", false, "The student did not name the gas.", false);
    expect(a).toEqual({ isCorrect: false, feedback: CODE_MISMATCH_FEEDBACK, by: "model" });
    expect(b).toEqual({ isCorrect: false, feedback: CODE_MISMATCH_FEEDBACK, by: "model" });
  });

  it("feedback about the subject, or to the learner, is kept word for word", async () => {
    const [a, b] = await feedback("Light scatters off the air, which is why the sky looks blue.", true, "You wrote argon, but the answer is neon.", false);
    expect(a?.feedback).toBe("Light scatters off the air, which is why the sky looks blue.");
    expect(b?.feedback).toBe("You wrote argon, but the answer is neon.");
  });
});
