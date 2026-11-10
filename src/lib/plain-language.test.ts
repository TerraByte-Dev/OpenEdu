import { describe, it, expect } from "vitest";
import { describeGenerationState, describeToolRequest } from "./plain-language";

describe("describeGenerationState", () => {
  it("never leaks a state id into the sentence", () => {
    for (const s of ["researching", "outlining", "instructions", "syllabus_L1", "syllabus_L6", "mastery", "failed:syllabus_L3", "something_new"]) {
      const out = describeGenerationState(s);
      expect(out).not.toContain(s);
      expect(out).not.toMatch(/_|syllabus_L/);
    }
  });

  it("names the level that is still missing", () => {
    expect(describeGenerationState("syllabus_L3")).toBe("Your course still needs Level 3.");
    expect(describeGenerationState("syllabus_L6")).toBe("Your course still needs its final exam.");
    expect(describeGenerationState("mastery")).toBe("Your course still needs its final exam.");
  });

  it("reads a failed:<step> marker as that step", () => {
    expect(describeGenerationState("failed:researching")).toBe(describeGenerationState("researching"));
  });

  it("treats null and completed as done", () => {
    expect(describeGenerationState(null)).toBe("Your course is ready.");
    expect(describeGenerationState("completed")).toBe("Your course is ready.");
  });
});

describe("describeToolRequest", () => {
  it("speaks about what the tutor wants, not the tool id", () => {
    for (const t of ["notebook.search", "notebook.ingest", "library.lookup", "web.search", "flashcard.create", "progress.mark_mastered", "knowledge.update_map", "code.run"]) {
      const out = describeToolRequest(t);
      expect(out).toMatch(/^Your tutor wants to /);
      expect(out).not.toContain(t);
    }
  });

  it("distinguishes reading from writing the notebook", () => {
    expect(describeToolRequest("notebook.search")).toMatch(/look through your notes/);
    expect(describeToolRequest("notebook.ingest")).toMatch(/add something to your notes/);
  });

  it("falls back to a humanized id for an unknown family", () => {
    expect(describeToolRequest("widget.spin_fast")).toBe("Your tutor wants to use widget spin fast.");
  });
});
