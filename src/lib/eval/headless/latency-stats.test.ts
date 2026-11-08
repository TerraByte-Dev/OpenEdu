import { describe, it, expect } from "vitest";
import { percentile, splitSetup, turnCost, summarizeB7, B7_BUDGET_MS, type B7TurnRow } from "./latency-stats";
import type { TapCall } from "./latency-tap";

const call = (over: Partial<TapCall>): TapCall => ({
  seq: 0, label: null, path: "/api/chat", kind: "turn", ask: "", inputs: [], status: 200, sentAt: 0,
  firstByteMs: 1, ms: 0, loadMs: 0, promptEvalCount: 0, promptEvalMs: 0, evalCount: 0, evalMs: 0, ...over,
});

describe("percentile (nearest rank)", () => {
  it("takes a value that was measured, never an interpolation", () => {
    const five = [9, 1, 7, 3, 5];
    expect(percentile(five, 50)).toBe(5);
    expect(percentile(five, 90)).toBe(9); // at n = 5, p90 is the maximum
    expect(percentile([4, 2], 50)).toBe(2);
    expect(percentile([3], 90)).toBe(3);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("splitSetup", () => {
  it("puts the vault seeding before the turn, and starts the turn at the question's embed or the first chat", () => {
    const seed = [call({ path: "/api/embed", kind: "embed", inputs: ["note one"] }), call({ path: "/api/embed", kind: "embed", inputs: ["note two"] })];
    const q = call({ path: "/api/embed", kind: "embed", inputs: ["the question?"] });
    const reply = call({ path: "/api/chat" });
    expect(splitSetup([...seed, q, reply], "the question?")).toEqual({ setup: seed, turn: [q, reply] });
    const gloss = call({ path: "/api/chat", kind: "structured" });
    expect(splitSetup([...seed, gloss, q, reply], "the question?").turn).toEqual([gloss, q, reply]);
    expect(splitSetup(seed, "the question?")).toEqual({ setup: seed, turn: [] });
  });
});

describe("turnCost", () => {
  it("sums Ollama's own fields, computes rates, and splits the wall time into steps", () => {
    const calls = [
      call({ kind: "structured", ms: 1_500, loadMs: 20, promptEvalCount: 40, promptEvalMs: 400, evalCount: 20, evalMs: 1_000 }),
      call({ path: "/api/embed", kind: "embed", ms: 130, loadMs: 30, promptEvalCount: 12, promptEvalMs: null, evalCount: null, evalMs: null }),
      call({ ms: 6_000, loadMs: 50, promptEvalCount: 960, promptEvalMs: 3_600, evalCount: 80, evalMs: 2_000 }),
    ];
    const c = turnCost(calls, 8_000);
    expect(c).toMatchObject({
      chatCalls: 1, structuredCalls: 1, embedCalls: 1,
      promptTokens: 1_000, promptEvalMs: 4_000, promptTokPerSec: 250,
      outputTokens: 100, evalMs: 3_000, outputTokPerSec: 33.3,
      loadMs: 100, reload: false, structuredMs: 1_500, incomplete: false,
    });
    expect(c.steps).toEqual({ load: 100, prefill: 4_000, generate: 3_000, embed: 100, other: 800 });
    const s = c.steps;
    expect(s.load + s.prefill + s.generate + s.embed + s.other).toBe(8_000);
  });

  it("flags a model load (load_duration >= 1 s) and a request without final timings", () => {
    expect(turnCost([call({ loadMs: 2_400 })], 3_000).reload).toBe(true);
    expect(turnCost([call({ loadMs: 999 })], 3_000).reload).toBe(false);
    expect(turnCost([call({ ms: null, evalMs: null })], 3_000).incomplete).toBe(true);
    expect(turnCost([], 10)).toMatchObject({ promptTokPerSec: null, outputTokPerSec: null, structuredMs: null, steps: { other: 10 } });
  });
});

const row = (over: Partial<B7TurnRow>): B7TurnRow => ({
  kind: "notes-en", rep: 1, cold: false, item: "x", user: "", reply: "", stopReason: null, error: null, ttftMs: 100, wallMs: 1_000,
  residentBefore: { chat: true, embed: true }, gloss: null, workedAnswerRules: null, calls: [],
  cost: turnCost([call({ ms: 900, promptEvalCount: 100, promptEvalMs: 300, evalCount: 50, evalMs: 500 })], over.wallMs ?? 1_000),
  ...over,
});

describe("summarizeB7", () => {
  it("takes the percentiles over warm, error-free turns only, and names the slowest step and kind", () => {
    const rows = [
      row({ rep: 0, cold: true, wallMs: 60_000, cost: turnCost([call({ loadMs: 40_000, ms: 59_000 })], 60_000) }),
      row({ rep: 1, wallMs: 4_000 }), row({ rep: 2, wallMs: 2_000 }), row({ rep: 3, wallMs: 3_000 }),
      row({ rep: 4, wallMs: 90_000, error: "turn stalled" }),
      row({ kind: "notes-hi-gloss", rep: 1, wallMs: 20_000, gloss: { text: null, ms: 3_000, error: "gloss timed out after 3000 ms" } }),
      row({ kind: "k12-t1-new-problem", rep: 0, cold: true, item: "k-1", wallMs: 45_000, ttftMs: 44_000, cost: turnCost([call({ loadMs: 30_000 })], 45_000) }),
    ];
    const s = summarizeB7(rows);
    const en = s.kinds.find((k) => k.kind === "notes-en")!;
    expect(en).toMatchObject({ warm: 3, errors: 1, wallMs: { n: 3, p50: 3_000, p90: 4_000, max: 4_000 }, underBudget: true });
    expect(en.cold).toEqual([{ item: "x", wallMs: 60_000, ttftMs: 100, loadMs: 40_000, error: null }]);
    // other = wall - 300 prefill - 500 generate: the largest step in every warm row here.
    expect(en.slowestStep).toBe("other");
    const hi = s.kinds.find((k) => k.kind === "notes-hi-gloss")!;
    expect(hi).toMatchObject({ warm: 1, underBudget: false, glossErrors: 1 });
    expect(s.kinds.find((k) => k.kind === "k12-t2-wrong-try")).toMatchObject({ warm: 0, underBudget: null, slowestStep: null });
    expect(s).toMatchObject({ budgetMs: B7_BUDGET_MS, allUnderBudget: false, slowestKind: { kind: "notes-hi-gloss", wallP50: 20_000 } });
    expect(s.coldStart).toEqual({ wallMs: 45_000, ttftMs: 44_000, loadMs: 30_000, error: null });
  });

  it("answers null, not yes, when nothing was measured", () => {
    expect(summarizeB7([])).toMatchObject({ allUnderBudget: null, slowestKind: null, coldStart: null });
  });
});
