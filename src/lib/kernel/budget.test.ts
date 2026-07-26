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
});

describe("capText", () => {
  it("leaves short text untouched", () => {
    expect(capText("hello", 100)).toBe("hello");
  });

  it("truncates with a visible marker naming both lengths", () => {
    const long = "word ".repeat(500);
    const out = capText(long, 10);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/…\[truncated: showing \d+ of \d+ characters\]/);
  });

  it("returns empty for a non-positive budget", () => {
    expect(capText("anything", 0)).toBe("");
  });

  it("prefers a whitespace boundary over a mid-word cut", () => {
    const out = capText("alpha bravo charlie delta echo foxtrot golf hotel", 4);
    const body = out.split("\n")[0];
    expect(body.endsWith(" ")).toBe(false);
    // the marker is on its own line, and the body did not end mid-word
    expect(/[a-z]$/.test(body)).toBe(true);
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
