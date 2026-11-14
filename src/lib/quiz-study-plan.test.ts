import { describe, it, expect, vi, beforeEach } from "vitest";

// generateStudyPlan after a failed promotion test. Asked for "3-5 bullet points" in "plain text",
// gemma4:e2b wrote paragraphs in 17 of 20 plans (B9 readiness run, 2026-11-13). The plan is now a
// structured list that code renders as bullets. The model call is stubbed; the item texts are the
// paragraphs e2b wrote in that run (readiness.study s02 and s15), one per item.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { generateStudyPlan } from "./quiz";
import { callLLMStructured } from "./llm";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b", modelTier: "tiny" } as unknown as LLMConfig;
const missed = [
  { question_text: "Which is larger, 1/3 or 1/4?", correct_answer: "1/3", explanation: "Thirds are bigger pieces than fourths." },
  { question_text: "What is 1/2 + 1/4?", correct_answer: "3/4", explanation: "1/2 = 2/4, and 2/4 + 1/4 = 3/4." },
];

describe("generateStudyPlan", () => {
  beforeEach(() => { vi.mocked(callLLMStructured).mockReset(); });

  it("asks for a 3-5 item list, without the bullets-and-plain-text contradiction", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ items: ["Review comparing fractions with a common denominator."] });
    await generateStudyPlan("Fractions", 1, missed, config);
    const [messages, , opts] = vi.mocked(callLLMStructured).mock.calls[0];
    const prompt = messages[0].content;
    expect(prompt).not.toMatch(/bullet|use plain text/i);
    expect(prompt).toContain("Which is larger, 1/3 or 1/4?");
    // No maxItems / maxLength: a sixth or long item is trimmed by code instead of failing the call.
    const items = (opts.schema as { properties: { items: Record<string, unknown> & { items: Record<string, unknown> } } }).properties.items;
    expect(items).toMatchObject({ minItems: 3, items: { type: "string" } });
    expect(items).not.toHaveProperty("maxItems");
    expect(items.items).not.toHaveProperty("maxLength");
    expect(opts.tier).toBe("tiny");
    expect(opts.maxRepairAttempts).toBe(1);
  });

  it("falls back to the missed questions with their answers when the call fails", async () => {
    vi.mocked(callLLMStructured).mockRejectedValue(new Error("LLM call timed out after 180s (tier=tiny)."));
    const plan = await generateStudyPlan("Fractions", 1, missed, config);
    expect(plan.split("\n")).toEqual([
      "• Review \"Which is larger, 1/3 or 1/4?\" The answer is 1/3. Thirds are bigger pieces than fourths.",
      "• Review \"What is 1/2 + 1/4?\" The answer is 3/4. 1/2 = 2/4, and 2/4 + 1/4 = 3/4.",
    ]);
  });

  it("strips markdown bold and cuts a long item at a word", async () => {
    const long = `Practice ${"counting aloud for measures of 4/4 and 3/4 ".repeat(10)}`.trim();
    vi.mocked(callLLMStructured).mockResolvedValue({ items: [
      "**Treble Clef Staff Practice:** Draw the treble clef and physically label the spaces from bottom to top (F A C E).",
      long,
      "Review the definitions.",
    ] });
    const lines = (await generateStudyPlan("Music", 1, missed, config)).split("\n");
    expect(lines[0]).toBe("• Treble Clef Staff Practice: Draw the treble clef and physically label the spaces from bottom to top (F A C E).");
    expect(lines[1].endsWith("…")).toBe(true);
    const kept = lines[1].slice(2, -1);
    expect(kept.length).toBeLessThanOrEqual(300);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });

  it("renders each item as one bullet line (s02)", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ items: [
      "Review the concept of comparing fractions. Practice comparing fractions by finding a common denominator, like for 1/3 and 1/4.",
      "Master adding fractions with different denominators. Practice finding the least common multiple (LCM) for denominators like 2 and 4 to solve problems like 1/2 + 1/4.",
      "Understand how to write a fraction as shaded parts over the total parts. Practice converting word descriptions into fractions, such as 3 shaded parts out of 8 total parts means 3/8.",
      "Focus on understanding the \"why\" behind each concept. Make sure you can explain why thirds are bigger than fourths, and why you need a common denominator when adding.",
      "Practice several mixed problems covering comparison, addition, and shading until you feel confident. You can do this!",
    ] });
    const plan = await generateStudyPlan("Fractions", 1, missed, config);
    const lines = plan.split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(/^• \S/);
    expect(lines[0]).toBe("• Review the concept of comparing fractions. Practice comparing fractions by finding a common denominator, like for 1/3 and 1/4.");
  });

  it("drops the model's own numbering and line breaks, and keeps at most 5 (s15)", async () => {
    vi.mocked(callLLMStructured).mockResolvedValue({ items: [
      "1. Treble Clef Staff Practice: Draw the treble clef and physically label the spaces from bottom to top (F A C E). Drill this pattern until you can recall the notes instantly.",
      "2. Time Signature Mastery: For every time signature (like 4/4 or 3/4), memorize what the top number means (beats per measure) and what the bottom number means (which note gets one beat).\nPractice counting aloud for measures of 4/4 and 3/4.",
      "- Note Value Equivalents: Solidify the relationship between note names and their duration.",
      "4) Review Definitions: Re-read the explanations for why the answers are correct.",
      "  ",
      "Focus on these specific details, and you will pass the next time.",
      "An extra sixth item.",
    ] });
    const plan = await generateStudyPlan("Music", 1, missed, config);
    expect(plan.split("\n")).toEqual([
      "• Treble Clef Staff Practice: Draw the treble clef and physically label the spaces from bottom to top (F A C E). Drill this pattern until you can recall the notes instantly.",
      "• Time Signature Mastery: For every time signature (like 4/4 or 3/4), memorize what the top number means (beats per measure) and what the bottom number means (which note gets one beat). Practice counting aloud for measures of 4/4 and 3/4.",
      "• Note Value Equivalents: Solidify the relationship between note names and their duration.",
      "• Review Definitions: Re-read the explanations for why the answers are correct.",
      "• Focus on these specific details, and you will pass the next time.",
    ]);
  });
});
