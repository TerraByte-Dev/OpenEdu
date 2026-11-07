import { describe, it, expect } from "vitest";
import { isHealthTopic, HEALTH_NOTICE } from "./health-notice";

describe("isHealthTopic", () => {
  it("flags the school health class topics", () => {
    for (const t of [
      "First Aid", "Basic first-aid for parents", "CPR", "Human anatomy", "Human Biology",
      "What to do in an emergency", "Snakebite", "Malaria prevention", "Nutrition basics",
      "Mental health", "Pregnancy and childbirth", "Injuries and wounds", "Medicine dosage",
      "Burn care", "Treating a burn", "HIV and AIDS", "Tuberculosis", "Cholera", "COVID-19 prevention",
      "Sex education", "Puberty", "Newborn care", "Breastfeeding", "Herbal remedies", "Stop the bleed",
      "Paramedic training", "Stroke", "Signs of a stroke", "Epilepsy and seizures",
    ]) expect(isHealthTopic(t), t).toBe(true);
  });

  it("flags common non-English topic names", () => {
    for (const t of ["Premiers secours", "Primeros auxilios", "Primeiros socorros", "Huduma ya kwanza", "Afya ya jamii", "Santé publique"])
      expect(isHealthTopic(t), t).toBe(true);
  });

  it("does not flag unrelated topics", () => {
    for (const t of ["Python", "Linear Algebra", "Music Theory", "World War II", "Comedic writing", "Bookkeeping", "Bulldoser maintenance", "",
      "The Great Depression", "Tropical depressions", "Search and seizure", "Swimming strokes", "Brush strokes",
      "The Medici family", "Emergence of nation states", "Visual aids for teachers", "Archive management"])
      expect(isHealthTopic(t), t).toBe(false);
  });

  it("matches a stem only at the start of a word", () => {
    expect(isHealthTopic("archive")).toBe(false);
    expect(isHealthTopic("medical terms")).toBe(true);
  });

  it("is a warning that points to real help", () => {
    expect(HEALTH_NOTICE).toMatch(/local emergency number/);
    expect(HEALTH_NOTICE).not.toMatch(/911/);
  });
});
