import { describe, it, expect, vi, afterEach } from "vitest";

// generateLesson through its real path: callLLMStructured against a fake Ollama (the headless shim
// forwards @tauri-apps/plugin-http to globalThis.fetch), with only the database write stubbed.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  createLesson: vi.fn(async (courseId: string, level: number, title: string, content: string, subtopicId?: string) =>
    ({ id: "l1", course_id: courseId, level, subtopic_id: subtopicId ?? null, topic_string: title, content, generated_at: "", read_at: null })),
}));

import { generateLesson } from "./curriculum";
import { createLesson } from "./db";
import { endsMidSentence, lessonIssues, type LessonContent } from "./lesson-format";
import type { LLMConfig } from "../types";

const LOCAL = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434", modelTier: "tiny" } as LLMConfig;
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

// The lesson from the readiness run: one section, 487 chars, done_reason "stop", cut off mid-sentence.
const CUT: LessonContent = {
  summary: "Matter is all around us. In this lesson you will learn what matter is and how we describe it.",
  sections: [{
    heading: "What is matter?",
    body: "Everything you can touch is made of matter. Your desk, the water you drink and the air you breathe " +
      "are all matter. Scientists describe matter by its properties, like how heavy it is, how much space it " +
      "takes up, and whether it is a solid, a liquid or a gas. A rock keeps its shape. Water takes the shape " +
      "of its cup. Air spreads out to fill a whole room. Each of these is a different state of matter, and " +
      "you will meet all three in this unit. Matter is anything that has mass (it has",
  }],
  key_takeaways: ["Matter has mass and takes up space."],
};
const WHOLE: LessonContent = {
  ...CUT,
  sections: [{ heading: "What is matter?", body: CUT.sections[0].body.replace(/ \(it has$/, " and takes up space.") }],
};

// Raise hand's stuck points, which generateLesson writes after the lesson (raise-hand.ts).
const HELP = { stuck_points: ["What is mass?", "What is a state?", "Why does air spread out?"].map((label) => ({
  label, another_way: "Mass is how much stuff something has. A rock has more stuff than a feather.",
  example: "A brick and a sponge are the same size. The brick has more mass, so it is heavier.", hint: "Think about how heavy it feels.",
})) };

describe("generateLesson rejects a section cut off mid-sentence", () => {
  it("retries the cut-off lesson and saves the complete one", async () => {
    const replies: unknown[] = [CUT, WHOLE, HELP];
    const chats: unknown[] = [];
    globalThis.fetch = ((url: string, init?: { body?: string }) => {
      if (!String(url).endsWith("/api/chat")) return Promise.resolve(new Response("{}", { status: 404 }));
      chats.push(JSON.parse(String(init?.body)));
      const next = replies.shift()!;
      return Promise.resolve(Response.json({ message: { content: JSON.stringify(next) }, done: true, done_reason: "stop" }));
    }) as unknown as typeof fetch;

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Matter", key_concepts: ["mass"] }, "Science", { ...LOCAL });

    expect(chats).toHaveLength(3); // the cut lesson, its retry, then the stuck points
    expect(JSON.stringify(chats[1])).toContain("stops mid-sentence");
    expect(JSON.stringify(chats[2])).toContain("anything that has mass and takes up space.");
    expect(lesson.content).toContain("anything that has mass and takes up space.");
    expect(lesson.content).not.toContain("(it has");
  });
});

// A worked example whose last steps and answer sit past the 1200-character cap. A cut at the last
// sentence end that fits would keep it, without them; "3." on its own line used to count as one.
const PREAMBLE = "Mass tells you how much matter is in an object. A bowling ball and a beach ball can be the same size, " +
  "but the bowling ball has far more matter packed inside it, so its mass is greater. ";
const LONG_EXAMPLE = PREAMBLE.repeat(5) +
  "Worked example: a box holds 3 bags and each bag has 4 kg of sand, and the empty box itself has no mass worth counting.\n" +
  "1. Count the bags in the box: there are 3 of them.\n2. Find the mass of one bag: it is 4 kg.\n" +
  "3. Multiply the number of bags by the mass of one bag: 3 × 4 = 12.\nThe answer is 12 kg.";
const SHORT_EXAMPLE = "A box holds 3 bags of 4 kg each.\n1. Count the bags: 3.\n2. Multiply: 3 × 4 = 12.\nThe answer is 12 kg.";

function fakeOllama(replies: unknown[], chats: unknown[]) {
  globalThis.fetch = ((url: string, init?: { body?: string }) => {
    if (!String(url).endsWith("/api/chat")) return Promise.resolve(new Response("{}", { status: 404 }));
    chats.push(JSON.parse(String(init?.body)));
    const next = replies.shift()!;
    return Promise.resolve(Response.json({ message: { content: JSON.stringify(next) }, done: true, done_reason: "stop" }));
  }) as unknown as typeof fetch;
}

describe("a lesson section or worked example past its cap is written again shorter, never cut", () => {
  const withBody = (body: string): LessonContent => ({ ...WHOLE, sections: [{ heading: "Mass", body }] });

  it("a lesson section: the repair names the length, and the saved lesson keeps its answer", async () => {
    // Step 3 starts inside the cap; its working and the answer end past it.
    expect(LONG_EXAMPLE.indexOf("\n3. Multiply")).toBeLessThan(1200);
    expect(LONG_EXAMPLE.indexOf("= 12.")).toBeGreaterThan(1195);
    const chats: unknown[] = [];
    fakeOllama([withBody(LONG_EXAMPLE), withBody(SHORT_EXAMPLE), HELP], chats);

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Mass", key_concepts: ["mass"] }, "Science", { ...LOCAL });

    expect(chats).toHaveLength(3); // the long lesson, its repair, then the stuck points
    expect(JSON.stringify(chats[1])).toContain("string too long");
    expect(lesson.content).toContain("The answer is 12 kg.");
    expect(lesson.content).not.toMatch(/\n3\.\s*$/m);
  });

  it("a Raise-hand worked example: the stuck points are asked for again, not saved without the answer", async () => {
    const longHelp = { stuck_points: HELP.stuck_points.map((p, i) => (i === 0 ? { ...p, example: LONG_EXAMPLE.slice(0, 900) + " The answer is 12 kg." } : p)) };
    const chats: unknown[] = [];
    fakeOllama([WHOLE, longHelp, HELP], chats);

    const lesson = await generateLesson("c1", 1, { id: "s1", title: "Matter", key_concepts: ["mass"] }, "Science", { ...LOCAL });

    expect(chats).toHaveLength(3); // the lesson, the long stuck points, their repair
    expect(JSON.stringify(chats[2])).toContain("string too long");
    expect(lesson.content).toContain("anything that has mass and takes up space.");
    const saves = vi.mocked(createLesson).mock.calls;
    const savedHelp = saves[saves.length - 1][5];
    expect(JSON.parse(savedHelp!).stuck_points[0].example).toBe(HELP.stuck_points[0].example);
  });
});

describe("endsMidSentence", () => {
  it.each([
    ["the run's cut-off section", CUT.sections[0].body],
    ["a sentence with no full stop", "Plants need sunlight to grow and they also need"],
    ["a trailing comma", "First, mix the flour and the sugar,"],
    ["an operator", "So the total is 3 + 4 ="],
    ["an unclosed code block", "Try this:\n\n```python\nfor i in range(3):\n    print(i"],
    ["an unclosed bracket in a list item", "Remember:\n- Matter has mass (it has"],
    ["a dangling bold label", "Here is the rule.\n\n**Example**"],
    ["a long line cut after a colon", "Example: if you have 3 apples and your friend gives you 2 more, then you"],
    ["a numbered list cut at its next marker", "Steps:\n1. Count the bags.\n2. Find one bag's mass.\n3."],
    ["a numbered list cut at its next marker, with parens", "Steps:\n1) Count the bags.\n2)"],
  ])("rejects %s", (_name, body) => {
    expect(endsMidSentence(body)).toBe(true);
  });

  it.each([
    ["a sentence", "Matter is anything that has mass and takes up space."],
    ["a question", "What do you think happens next?"],
    ["an exclamation inside a quote", "She shouted, \"It works!\""],
    ["a closing bracket after the full stop", "This is the key idea (we will use it again.)"],
    ["a code block", "Loop three times:\n\n```python\nfor i in range(3):\n    print(i)\n```"],
    ["a bulleted list without full stops", "The three states are:\n- solid\n- liquid\n- gas"],
    ["a numbered list", "Steps:\n1. Read the problem\n2. Draw a picture"],
    ["a table", "| n | n² |\n|---|---|\n| 2 | 4 |\n| 3 | 9 |"],
    ["a worked line", "Multiply the length by the width:\n\nArea = 3 × 4 = 12"],
    ["a formula", "Newton's second law says:\n\nF = ma"],
    ["display math", "The area of a circle is $$A = \\pi r^2$$"],
    ["inline math", "The area of a circle is $\\pi r^2$"],
    ["a LaTeX paren", "The area is \\(\\pi r^2\\)"],
    ["a number", "The answer to 6 × 7 is 42"],
    ["a symbol", "The area of a circle is πr²"],
    ["an emoji", "You did it 🎉"],
    ["a colon before the next section", "Here is how it works:"],
    ["a half-open interval", "Pick any number in [0, 1)."],
    ["a smiley", "Fractions are friends :)"],
    ["trailing whitespace", "All done.\n\n  "],
    // Endings seen in the k12-flow eval runs' gemma4 / qwen3.5 replies.
    ["lettered options", "Which part makes energy?\n\nA) Chloroplast\nB) Ribosome\nC) Mitochondrion"],
    ["a label line", "The calculation is 3002 − 1468 = 1534.\n\nFinal answer: B"],
    ["a bold label line", "That is the definition.\n\n**Correct answer:** B) majority rule"],
    ["a bold option", "So the correct answer is:\n**C) the governor**"],
    ["a starred list of options", "*   C) $144 < 180$ (Less)\n*   D) $160 < 180$ (Less)"],
    ["a trailing rule", "Keep the constant term unchanged.\n\n---"],
    ["a bracketed formula line", "Combine like terms:\n[6x - 15 + 4x]"],
    ["a sentence and an aside", "It turned out the opposite of what was expected. (Correct)"],
    ["a number on its own line that is no list's next marker", "So the answer is:\n\n12."],
    ["a decimal at a line's start before a lone number", "1.5 kg is the mass of the bag.\nThe answer is:\n2."],
  ])("accepts %s", (_name, body) => {
    expect(endsMidSentence(body)).toBe(false);
  });
});

describe("lessonIssues", () => {
  it("names each cut-off section and passes a complete lesson", () => {
    expect(lessonIssues(CUT)).toEqual([expect.stringContaining('Section "What is matter?" stops mid-sentence')]);
    expect(lessonIssues(WHOLE)).toEqual([]);
  });
});
