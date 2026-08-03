import { describe, it, expect } from "vitest";
import {
  estTokens,
  budgetFor,
  capText,
  fitMessages,
  formatBudgetUsage,
  DEFAULT_CONTEXT_TOKENS,
  MIN_CONTEXT_TOKENS,
  type Budget,
} from "./budget";

// Build a message whose content costs approximately `tokens` tokens (4 chars/token).
const msg = (role: string, tokens: number, tag = "x") => ({ role, content: tag.repeat(tokens * 4) });

describe("estTokens", () => {
  it("is chars/4, rounded up", () => {
    expect(estTokens("")).toBe(0);
    expect(estTokens("abc")).toBe(1);
    expect(estTokens("abcd")).toBe(1);
    expect(estTokens("abcde")).toBe(2);
  });
});

describe("budgetFor", () => {
  it("splits the window into slices that do not exceed the total", () => {
    const b = budgetFor(8192);
    expect(b.total).toBe(8192);
    expect(b.system + b.grounding + b.history + b.reserve).toBeLessThanOrEqual(8192);
  });

  it("floors at MIN_CONTEXT_TOKENS so a bad setting cannot produce an unusable window", () => {
    expect(budgetFor(100).total).toBe(MIN_CONTEXT_TOKENS);
    expect(budgetFor(0).total).toBe(DEFAULT_CONTEXT_TOKENS);
    expect(budgetFor(Number.NaN).total).toBe(DEFAULT_CONTEXT_TOKENS);
  });

  it("scales with the window", () => {
    expect(budgetFor(16384).history).toBeGreaterThan(budgetFor(8192).history);
  });

  // The default is a product decision, not an implementation detail: 4096 left ~19 messages of
  // history once the system prompt and grounding block were paid for, and chat outgrew it in a
  // sitting. 16384 is deliberately NOT the default — small models get worse with long contexts, so it
  // mostly buys history the model handles badly, for ~2.2GB of KV cache.
  it("defaults to a window that actually fits a conversation", () => {
    expect(DEFAULT_CONTEXT_TOKENS).toBe(8192);
    const b = budgetFor(DEFAULT_CONTEXT_TOKENS);
    const SYSTEM_PROMPT = 735; // measured: buildSystemPrompt 549 + output_rules 186
    const GROUNDING = 450;     // observed 111-446 across real turns
    const history = b.total - b.reserve - SYSTEM_PROMPT - GROUNDING;
    expect(history).toBeGreaterThan(5000);  // ~40+ prior messages
    expect(b.reserve).toBeGreaterThan(1000); // room for a long reply
  });
});

describe("capText", () => {
  it("leaves short text untouched", () => {
    expect(capText("hello", 100)).toBe("hello");
  });

  it("truncates with a visible marker naming both lengths", () => {
    const long = "word ".repeat(500);
    const out = capText(long, 100); // a realistic cap — the marker itself is ~45 chars
    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/…\[truncated: showing \d+ of \d+ characters\]/);
  });

  it("returns empty for a non-positive budget", () => {
    expect(capText("anything", 0)).toBe("");
  });

  it("prefers a whitespace boundary over a mid-word cut", () => {
    const out = capText("alpha bravo charlie delta echo foxtrot golf hotel ".repeat(20), 40);
    const body = out.split("\n")[0];
    expect(body.endsWith(" ")).toBe(false);
    // the marker is on its own line, and the body did not end mid-word
    expect(/[a-z]$/.test(body)).toBe(true);
  });

  // The marker counts against the cap. Before this, a "capped" result could come back LONGER than
  // the budget that was supposed to bound it — capText("z".repeat(41), 10) returned 82 chars.
  it("never returns more characters than the cap allows", () => {
    for (const tokens of [1, 5, 10, 50, 200]) {
      const out = capText("z".repeat(5000), tokens);
      expect(out.length).toBeLessThanOrEqual(tokens * 4);
    }
  });

  it("still respects the cap when it is too small to fit the explanatory marker", () => {
    const out = capText("z".repeat(500), 1);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.endsWith("…")).toBe(true); // visibly cut, even with no room to explain
  });

  it("handles text with no whitespace at all", () => {
    const out = capText("z".repeat(5000), 40);
    expect(out).toContain("truncated");
    expect(out.length).toBeLessThanOrEqual(160);
  });
});

describe("fitMessages", () => {
  const budget: Budget = budgetFor(8192); // history allowance = history + unclaimed grounding

  it("keeps everything when it fits", () => {
    const input = [msg("system", 10), msg("user", 5), msg("assistant", 5)];
    const r = fitMessages(input, budget);
    expect(r.dropped).toBe(0);
    expect(r.messages).toHaveLength(3);
  });

  it("drops the oldest messages first and inserts one elision note", () => {
    const input = [msg("system", 10), ...Array.from({ length: 60 }, (_, i) => msg(i % 2 ? "assistant" : "user", 200, String(i % 10)))];
    const r = fitMessages(input, budget);
    expect(r.dropped).toBeGreaterThan(0);
    // system survives at the head
    expect(r.messages[0].role).toBe("system");
    // exactly one elision note, immediately after the pinned head
    const notes = r.messages.filter((m) => m.content.includes("were trimmed to fit") || m.content.includes("was trimmed to fit"));
    expect(notes).toHaveLength(1);
    expect(r.messages[1]).toBe(notes[0]);
    // the newest message survives
    expect(r.messages[r.messages.length - 1].content).toBe(input[input.length - 1].content);
  });

  it("never drops the system prompt, even under extreme pressure", () => {
    const tiny = budgetFor(MIN_CONTEXT_TOKENS);
    const input = [msg("system", 5000), ...Array.from({ length: 20 }, () => msg("user", 500))];
    const r = fitMessages(input, tiny);
    expect(r.messages[0].role).toBe("system");
    expect(r.messages[0].content).toBe(input[0].content);
  });

  it("keeps the final user message even when it alone exceeds the allowance", () => {
    const tiny = budgetFor(MIN_CONTEXT_TOKENS);
    const huge = msg("user", 100_000, "q");
    const r = fitMessages([msg("system", 10), msg("user", 500), huge], tiny);
    expect(r.messages[r.messages.length - 1].content).toBe(huge.content);
  });

  it("never starts the kept window on an orphaned tool result", () => {
    // A long prefix, then an assistant tool-call turn + its tool result, then the current question.
    const input = [
      msg("system", 10),
      ...Array.from({ length: 40 }, () => msg("user", 300)),
      msg("assistant", 300),
      msg("tool", 900),
      msg("tool", 900),
      msg("user", 20),
    ];
    const r = fitMessages(input, budgetFor(4096));
    const firstNonPinned = r.messages.find((m) => m.role !== "system");
    expect(firstNonPinned?.role).not.toBe("tool");
  });

  it("lends the unclaimed grounding slice to history", () => {
    const input = [msg("system", 10), ...Array.from({ length: 40 }, () => msg("user", 100))];
    const withGrounding = fitMessages(input, budget, { groundingUsed: budget.grounding });
    const withoutGrounding = fitMessages(input, budget, { groundingUsed: 0 });
    expect(withoutGrounding.dropped).toBeLessThanOrEqual(withGrounding.dropped);
  });

  it("handles a conversation with no system message", () => {
    const r = fitMessages([msg("user", 5), msg("assistant", 5)], budget);
    expect(r.dropped).toBe(0);
    expect(r.messages).toHaveLength(2);
    expect(r.usage.system).toBe(0);
  });

  it("handles an empty array", () => {
    const r = fitMessages([], budget);
    expect(r.messages).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  // The refit after a tool round hands fitMessages an array whose LAST messages are tool results.
  // The original guard stopped advancing ON the last element, so the window began on an orphan whose
  // assistant tool_calls turn had been dropped — a hard 400 on OpenAI and Anthropic.
  it("re-admits the assistant turn when the trailing tool block would be orphaned", () => {
    const input = [
      msg("system", 10),
      ...Array.from({ length: 40 }, () => msg("user", 300)),
      msg("assistant", 300, "a"),
      msg("tool", 900, "t"),
      msg("tool", 900, "t"),
    ];
    const r = fitMessages(input, budgetFor(2048));
    const kept = r.messages.filter((m) => m.role !== "system");
    expect(kept[0].role).toBe("assistant");
    expect(kept[kept.length - 1].role).toBe("tool");
  });

  // The pinned system head is never trimmed, so a fixed 60%-of-window history slice let
  // system + history exceed num_ctx — putting the server back in charge of what to drop.
  it("shrinks the history allowance when the system prompt is oversized", () => {
    const budget4k = budgetFor(4096);
    const fat = [msg("system", 2500), ...Array.from({ length: 30 }, () => msg("user", 100))];
    const r = fitMessages(fat, budget4k);
    expect(r.usage.total).toBeLessThanOrEqual(budget4k.total - budget4k.reserve + 100);
    expect(r.dropped).toBeGreaterThan(0);
  });

  // The kernel refits after every tool round. A note pinned into the system head on one pass would
  // be counted as head on the next, so they stacked up — all undroppable.
  it("does not accumulate elision notes across repeated fits", () => {
    const long = [msg("system", 10), ...Array.from({ length: 80 }, () => msg("user", 200))];
    let out = fitMessages(long, budget).messages;
    for (let i = 0; i < 5; i++) out = fitMessages(out, budget).messages;
    const notes = out.filter((m) => m.content.includes("trimmed to fit"));
    expect(notes.length).toBeLessThanOrEqual(1);
  });

  it("reports usage that reflects what was actually kept", () => {
    const input = [msg("system", 100), msg("user", 50)];
    const r = fitMessages(input, budget);
    expect(r.usage.system).toBe(100);
    expect(r.usage.history).toBe(50);
    expect(r.usage.total).toBe(150);
  });

  it("preserves extra fields on the message objects it passes through", () => {
    interface Wire { role: string; content: string; name?: string; tool_call_id?: string }
    const input: Wire[] = [
      { role: "system", content: "s" },
      { role: "assistant", content: "calling…" },
      { role: "tool", content: "t", name: "notebook.search", tool_call_id: "call_0" },
      { role: "user", content: "u" },
    ];
    const r = fitMessages(input, budget);
    const tool = r.messages.find((m) => m.role === "tool");
    expect(tool?.name).toBe("notebook.search");
    expect(tool?.tool_call_id).toBe("call_0");
  });
});

describe("formatBudgetUsage", () => {
  it("renders a readable one-liner and never reports negative free space", () => {
    const b = budgetFor(8192);
    const line = formatBudgetUsage(b, { system: 1240, history: 1900, total: 3140 });
    expect(line).toContain("/ 8192");
    expect(line).toMatch(/free \d+/);

    const over = formatBudgetUsage(b, { system: 9000, history: 9000, total: 18000 });
    expect(over).toContain("free 0");
  });
});
