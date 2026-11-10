import { describe, it, expect, vi } from "vitest";

// LEGACY_TUTOR_RULES is the rules block every course stored before lever 16, and the eval's paired arm
// for master's behaviour (EVAL_COURSE_RULES=legacy) is only master's behaviour if it is that text to the
// byte. The hash below was taken from the template literal on master (cce3051), when the text was still
// called TUTOR_RULES; template literals normalise CRLF to LF, so it does not depend on how the file was
// checked out. Since lever 16, TUTOR_RULES is the code-owned block that replaces any stored row.
const RULES_SHA256_BEFORE_EXPORT = "b674cf17e2936eefc46099caca73c14d51572fd2d826de556096c61b3261bc5a";
const RULES_LENGTH_BEFORE_EXPORT = 1081;

const saved: Array<[string, string, string]> = [];
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  saveTutorInstruction: vi.fn(async (courseId: string, type: string, content: string) => { saved.push([courseId, type, content]); }),
}));
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  callLLM: vi.fn(async () => "Stand-in pedagogy."),
}));

import { LEGACY_TUTOR_RULES, TUTOR_RULES, buildSystemPrompt, generateTutorInstructions } from "./curriculum";
import type { LLMConfig } from "../types";

describe("TUTOR_RULES", () => {
  it("keeps the rules block courses stored before lever 16, byte for byte, as LEGACY_TUTOR_RULES", async () => {
    expect(LEGACY_TUTOR_RULES.length).toBe(RULES_LENGTH_BEFORE_EXPORT);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(LEGACY_TUTOR_RULES));
    expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(RULES_SHA256_BEFORE_EXPORT);
  });

  it("is what generateTutorInstructions stores as the course's rules, through the production function", async () => {
    saved.length = 0;
    await generateTutorInstructions("c-1", "Chemistry", "A brief.", { provider: "ollama", model: "m" } as unknown as LLMConfig);
    expect(saved).toEqual([
      ["c-1", "pedagogy", "Stand-in pedagogy."],
      ["c-1", "rules", TUTOR_RULES],
      ["c-1", "research", "A brief."],
    ]);
  });

  it("replaces a course's stored rules with TUTOR_RULES, unless the stored row is asked for", () => {
    const stored = { rules: LEGACY_TUTOR_RULES, pedagogy: "Be kind." };
    const code = buildSystemPrompt(stored, null, 1, "Chemistry");
    expect(code).toContain(`## Rules\n${TUTOR_RULES}`);
    expect(code).not.toContain("Guide the student to discover answers");
    expect(code).toContain("## Teaching Approach\nBe kind.");
    expect(buildSystemPrompt(stored, null, 1, "Chemistry", undefined, undefined, undefined, "stored")).toContain(`## Rules\n${LEGACY_TUTOR_RULES}`);
    // A course with no rules row gets no rules block either way.
    expect(buildSystemPrompt({}, null, 1, "Chemistry")).not.toContain("## Rules");
  });

  it("drops the discover-it-yourself rule and keeps hints for problems", () => {
    expect(TUTOR_RULES).not.toContain("Guide the student to discover answers");
    expect(TUTOR_RULES).toContain("answer it directly in your first sentence");
    expect(TUTOR_RULES).toContain("give a hint or the next step, not the full solution");
    expect(TUTOR_RULES).toContain("Never give answers during quiz/assessment mode.");
  });
});
