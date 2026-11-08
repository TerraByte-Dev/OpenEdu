import { describe, it, expect, vi } from "vitest";

// TUTOR_RULES was a local inside generateTutorInstructions until the RAG eval runner needed the same
// text (EVAL_PROMPT=product-course). Moving it to an exported constant must not change one byte of
// what a generated course stores. The hash below was taken from the template literal on master
// (cce3051) before the move; template literals normalise CRLF to LF, so it does not depend on how
// the file was checked out.
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

import { TUTOR_RULES, generateTutorInstructions } from "./curriculum";
import type { LLMConfig } from "../types";

describe("TUTOR_RULES", () => {
  it("is byte-identical to the rules block generated courses stored before it was exported", async () => {
    expect(TUTOR_RULES.length).toBe(RULES_LENGTH_BEFORE_EXPORT);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TUTOR_RULES));
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
});
