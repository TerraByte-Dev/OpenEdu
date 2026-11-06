import { describe, it, expect } from "vitest";
import { ollamaMaxPredict } from "./llm";

// A runaway must be bounded. -1 relied on num_ctx stopping a looping model; Ollama shifts the
// context and keeps going instead (30,000+ tokens in an 8,192 window on 2026-11-06).
describe("ollamaMaxPredict", () => {
  it("caps generation at the context window", () => {
    expect(ollamaMaxPredict({ contextTokens: 8192 })).toBe(8192);
    expect(ollamaMaxPredict({ contextTokens: 4096.7 })).toBe(4096);
  });
  it("is never unbounded, even when the window is unknown", () => {
    expect(ollamaMaxPredict({})).toBe(8192);
    expect(ollamaMaxPredict({ contextTokens: 0 })).toBe(8192);
    expect(ollamaMaxPredict({ contextTokens: undefined })).toBeGreaterThan(0);
  });
});
