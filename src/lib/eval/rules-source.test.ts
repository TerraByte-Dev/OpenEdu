import { describe, it, expect } from "vitest";
import runnerSource from "./runner.ts?raw";
import k12RunnerSource from "./k12-runner.ts?raw";

// Lever 16 made buildSystemPrompt replace a stored rules row with the code's TUTOR_RULES by default. The
// golden-tool eval (runner.ts) and the k12 multiple-choice eval (k12-runner.ts) send their own fixed
// instructions, including a rules line, and must keep sending them as written: the review of #233 caught
// both being silently rewritten (runner.ts's "plain text, no LaTeX" rule became TUTOR_RULES, which asks
// for LaTeX). Every buildSystemPrompt call in them passes "stored".
const calls = (src: string) => src.match(/buildSystemPrompt\([^;]*\);/g) ?? [];

describe("eval runners that bring their own rules keep them", () => {
  it("runner.ts sends its own instructions as stored", () => {
    expect(calls(runnerSource)).toHaveLength(2);
    for (const c of calls(runnerSource)) expect(c).toMatch(/"stored"\);$/);
  });
  it("k12-runner.ts sends its own instructions as stored, and its raw arm samples at the kernel's temperature", () => {
    expect(calls(k12RunnerSource)).toHaveLength(1);
    for (const c of calls(k12RunnerSource)) expect(c).toMatch(/"stored"\);$/);
    expect(k12RunnerSource).toContain("callLLMTurn([{ role: \"user\", content: prompt }], config, { tier: profile.tier, signal, temperature: TUTOR_TEMPERATURE })");
  });
});
