import { describe, it, expect } from "vitest";
import { modelToolCalls } from "./modelToolCalls";
import { addedCalls } from "../eval/define-grade";

// What the eval runners count (runner.ts, k12-runner.ts, k12-flow-runner.ts, rag-runner.ts,
// define-compare.ts, define-grade.ts): the model's own calls, never the app's flashcard stage.
describe("modelToolCalls", () => {
  it("drops the calls the app made and keeps the model's, in order", () => {
    const calls = [
      { name: "flashcard.create", ok: true, byApp: true as const },
      { name: "notebook.search", ok: true },
      { name: "flashcard.create", ok: false },
    ];
    expect(modelToolCalls(calls)).toEqual([calls[1], calls[2]]);
    expect(modelToolCalls([])).toEqual([]);
  });

  it("is what define-grade's added-call bound counts", () => {
    const row = {
      id: "r1", repeat: 0, grade: null, error: null, askedWord: null, dictionaryNote: null, attempts: 1, stopReason: "complete",
      toolCallRecovery: null, chatRequests: 1, structuredRequests: 0, reply: "x",
    };
    expect(addedCalls({ ...row, toolCalls: [{ byApp: true }] } as never).added).toBe(0);
    expect(addedCalls({ ...row, chatRequests: 2, toolCalls: [{ byApp: true }] } as never).added).toBe(1);
  });
});
