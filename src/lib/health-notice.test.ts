import { describe, it, expect } from "vitest";
import { isHealthTopic, HEALTH_NOTICE } from "./health-notice";

describe("isHealthTopic", () => {
  it("flags the school health class topics", () => {
    for (const t of [
      "First Aid", "Basic first-aid for parents", "CPR", "Human anatomy", "Human Biology",
      "What to do in an emergency", "Snakebite", "Malaria prevention", "Nutrition basics",
      "Mental health", "Pregnancy and childbirth", "Injuries and wounds", "Medicine dosage",
    ]) expect(isHealthTopic(t), t).toBe(true);
  });

  it("flags common non-English topic names", () => {
    for (const t of ["Premiers secours", "Primeros auxilios", "Primeiros socorros", "Huduma ya kwanza", "Afya ya jamii", "Santé publique"])
      expect(isHealthTopic(t), t).toBe(true);
  });

  it("does not flag unrelated topics", () => {
    for (const t of ["Python", "Linear Algebra", "Music Theory", "World War II", "Comedic writing", "Bookkeeping", "Bulldoser maintenance", ""])
      expect(isHealthTopic(t), t).toBe(false);
  });

  it("matches a stem only at the start of a word", () => {
    expect(isHealthTopic("comedic timing")).toBe(false);
    expect(isHealthTopic("medical terms")).toBe(true);
  });

  it("is a warning that points to real help", () => {
    expect(HEALTH_NOTICE).toMatch(/local emergency number/);
    expect(HEALTH_NOTICE).not.toMatch(/911/);
  });
});
