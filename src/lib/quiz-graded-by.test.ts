import { describe, it, expect, vi, beforeEach } from "vitest";

// gradeAnswersBatch is the one place free-text answers are marked. The learning record (#258) shows
// which marks came from the model and which were passed because the grader failed, so every outcome
// must carry how it was decided. The model call is stubbed; the rest is the production path.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "small"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { gradeAnswersBatch } from "./quiz";
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
    vi.mocked(callLLMStructured).mockResolvedValue({ results: [
      { index: 1, correct: true, feedback: "ok" },
      { index: 2, correct: false, feedback: "no" },
    ] });
    const out = await gradeAnswersBatch(items, config);
    expect(out.get(0)).toMatchObject({ isCorrect: true, by: "exact" });
    expect(out.get(1)).toMatchObject({ isCorrect: true, by: "model" });
    expect(out.get(2)).toMatchObject({ isCorrect: false, by: "model" });
  });

  it("marks an item the model skipped 'fallback'", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ results: [{ index: 1, correct: true, feedback: "ok" }] });
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
