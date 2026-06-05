import { describe, it, expect } from "vitest";
import { computeStreak, dayKey, accuracyPct, minutesFromSeconds } from "./analytics";

const NOW = new Date("2026-06-05T15:00:00.000Z");
const at = (day: string, time = "10:00:00") => `${day}T${time}.000Z`;

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak([at("2026-06-05"), at("2026-06-04"), at("2026-06-03")], NOW)).toBe(3);
  });

  it("anchors on yesterday when there's nothing yet today", () => {
    expect(computeStreak([at("2026-06-04"), at("2026-06-03")], NOW)).toBe(2);
  });

  it("breaks the streak on a gap", () => {
    expect(computeStreak([at("2026-06-05"), at("2026-06-03")], NOW)).toBe(1);
  });

  it("is 0 when the most recent activity is older than yesterday", () => {
    expect(computeStreak([at("2026-06-01")], NOW)).toBe(0);
  });

  it("dedupes multiple activities on the same day", () => {
    expect(computeStreak([at("2026-06-05", "09:00:00"), at("2026-06-05", "20:00:00"), at("2026-06-04")], NOW)).toBe(2);
  });

  it("returns 0 for no activity", () => {
    expect(computeStreak([], NOW)).toBe(0);
  });
});

describe("dayKey / accuracyPct / minutesFromSeconds", () => {
  it("dayKey strips to YYYY-MM-DD", () => {
    expect(dayKey("2026-06-05T23:59:00.000Z")).toBe("2026-06-05");
  });
  it("accuracyPct rounds, null when empty", () => {
    expect(accuracyPct({ correct: 3, total: 4 })).toBe(75);
    expect(accuracyPct({ correct: 0, total: 0 })).toBeNull();
  });
  it("minutesFromSeconds rounds to whole minutes", () => {
    expect(minutesFromSeconds(150)).toBe(3);
    expect(minutesFromSeconds(0)).toBe(0);
  });
});
