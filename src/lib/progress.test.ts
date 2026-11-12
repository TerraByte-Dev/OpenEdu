import { describe, it, expect, vi, beforeEach } from "vitest";

// progress.ts persists through Tauri-backed ./db and logs via ./llm; stub both so the write path runs in node.
vi.mock("./db", () => ({
  getSyllabuses: vi.fn(),
  getQuizAttempts: vi.fn(),
  upsertUserProgress: vi.fn(),
  getUserProgress: vi.fn(),
  updateSyllabusSubtopics: vi.fn(),
  saveTutorInstruction: vi.fn(),
  recordSubtopicEvents: vi.fn(),
}));
vi.mock("./llm", () => ({ log: { info: vi.fn() } }));

import { setSubtopicStatus, updateSubtopicMastery } from "./progress";
import { updateSyllabusSubtopics, recordSubtopicEvents } from "./db";
import type { Subtopic, Syllabus } from "../types";

const sub = (id: string, title: string): Subtopic => ({ id, title, key_concepts: [], practice_type: "recall", mastered: false });
const syllabus = {
  level: 1,
  subtopics: [sub("1.1", "Loops"), sub("1.2", "Nested Loops"), sub("1.3", "List Comprehensions"), sub("1.4", "Dict Comprehensions")],
} as Syllabus;

describe("setSubtopicStatus", () => {
  beforeEach(() => { vi.mocked(updateSyllabusSubtopics).mockClear(); vi.mocked(recordSubtopicEvents).mockClear(); });

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

describe("skill status events for the learning record (#258)", () => {
  beforeEach(() => { vi.mocked(updateSyllabusSubtopics).mockClear(); vi.mocked(recordSubtopicEvents).mockClear(); });

  it("logs a tutor mark as source 'tutor', practiced then mastered", async () => {
    await setSubtopicStatus("c1", syllabus, "1.1", "mastered");
    expect(recordSubtopicEvents).toHaveBeenCalledWith("c1", 1, [
      { subtopic_id: "1.1", event: "practiced", source: "tutor" },
      { subtopic_id: "1.1", event: "mastered", source: "tutor" },
    ]);
  });

  it("logs nothing when the tutor's mark changes nothing", async () => {
    const done = { ...syllabus, subtopics: syllabus.subtopics.map((s) => ({ ...s, practiced: true, mastered: true })) } as Syllabus;
    await setSubtopicStatus("c1", done, "1.1", "mastered");
    expect(recordSubtopicEvents).not.toHaveBeenCalled();
  });

  it("logs keyword-matched changes with their counts and attempt, and never tagged ones", async () => {
    const qs = [
      { question_text: "Use dict comprehensions here", is_correct: true, subtopic_id: null },
      { question_text: "Explain dict comprehensions", is_correct: true, subtopic_id: null },
      { question_text: "q3", is_correct: true, subtopic_id: "1.1" },
    ];
    await updateSubtopicMastery("c1", syllabus, qs, "a1");
    expect(updateSyllabusSubtopics).toHaveBeenCalledTimes(1);
    expect(recordSubtopicEvents).toHaveBeenCalledWith("c1", 1, [
      { subtopic_id: "1.4", event: "practiced", source: "keyword", correct: 2, total: 2, attempt_id: "a1" },
      { subtopic_id: "1.4", event: "mastered", source: "keyword", correct: 2, total: 2, attempt_id: "a1" },
    ]);
  });
});
