import { describe, it, expect, vi, beforeEach } from "vitest";

// progress.ts persists through Tauri-backed ./db and logs via ./llm; stub both so the write path runs in node.
vi.mock("./db", () => ({
  getSyllabuses: vi.fn(),
  getQuizAttempts: vi.fn(),
  upsertUserProgress: vi.fn(),
  getUserProgress: vi.fn(),
  updateSyllabusSubtopics: vi.fn(),
  saveTutorInstruction: vi.fn(),
}));
vi.mock("./llm", () => ({ log: { info: vi.fn() } }));

import { setSubtopicStatus } from "./progress";
import { updateSyllabusSubtopics } from "./db";
import type { Subtopic, Syllabus } from "../types";

const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });
const syllabus = {
  level: 1,
  subtopics: [sub("1.1", "Loops"), sub("1.2", "Nested Loops"), sub("1.3", "List Comprehensions"), sub("1.4", "Dict Comprehensions")],
} as Syllabus;

describe("setSubtopicStatus", () => {
  beforeEach(() => vi.mocked(updateSyllabusSubtopics).mockClear());

  it.each(["", "   ", "comprehensions"])("never writes for blank or ambiguous ref %j", async (ref) => {
    const res = await setSubtopicStatus("c1", syllabus, ref, "mastered");
    expect(res.found).toBe(false);
    expect(updateSyllabusSubtopics).not.toHaveBeenCalled();
  });

  it("returns the ambiguous candidates' ids", async () => {
    const res = await setSubtopicStatus("c1", syllabus, "comprehensions", "mastered");
    expect(res.ambiguous?.map((s) => s.id)).toEqual(["1.3", "1.4"]);
  });

  it("writes only the resolved subtopic for a padded id", async () => {
    await setSubtopicStatus("c1", syllabus, " 1.1 ", "mastered");
    expect(updateSyllabusSubtopics).toHaveBeenCalledTimes(1);
    const written: Subtopic[] = JSON.parse(vi.mocked(updateSyllabusSubtopics).mock.calls[0][2]);
    expect(written.filter((s) => s.mastered || s.practiced).map((s) => s.id)).toEqual(["1.1"]);
  });
});
