import { describe, it, expect } from "vitest";
import {
  localDayKey, minutesToday, tickActiveMinutes, normalizeGoal, goalProgress, goalSentence, courseProgressPct,
  DAILY_GOAL_OPTIONS, DEFAULT_DAILY_GOAL,
} from "./daily-goal";

const NOW = new Date(2026, 5, 5, 19, 30); // local time: 5 June 2026, 7:30 pm

describe("today's minutes", () => {
  it("uses the local day, not UTC", () => {
    expect(localDayKey(NOW)).toBe("2026-06-05");
    expect(localDayKey(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("a record from another day counts as zero", () => {
    expect(minutesToday({ day: "2026-06-04", minutes: 12 }, NOW)).toBe(0);
    expect(minutesToday({ day: "2026-06-05", minutes: 12 }, NOW)).toBe(12);
    expect(minutesToday(null, NOW)).toBe(0);
  });

  it("ticking adds a minute today and rolls over on a new day", () => {
    expect(tickActiveMinutes(null, NOW)).toEqual({ day: "2026-06-05", minutes: 1 });
    expect(tickActiveMinutes({ day: "2026-06-05", minutes: 7 }, NOW)).toEqual({ day: "2026-06-05", minutes: 8 });
    expect(tickActiveMinutes({ day: "2026-06-04", minutes: 40 }, NOW)).toEqual({ day: "2026-06-05", minutes: 1 });
  });
});

describe("goal", () => {
  it("the default is one of the offered options", () => {
    expect(DAILY_GOAL_OPTIONS).toContain(DEFAULT_DAILY_GOAL);
  });

  it("normalizes what storage holds", () => {
    expect(normalizeGoal(15)).toBe(15);
    expect(normalizeGoal(12.6)).toBe(13);
    expect(normalizeGoal(0)).toBeNull();
    expect(normalizeGoal("15")).toBeNull();
    expect(normalizeGoal(undefined)).toBeNull();
  });

  it("progress is capped at 100 and reports what is left", () => {
    expect(goalProgress(0, 15)).toEqual({ pct: 0, done: false, remaining: 15 });
    expect(goalProgress(10, 15)).toEqual({ pct: 67, done: false, remaining: 5 });
    expect(goalProgress(40, 15)).toEqual({ pct: 100, done: true, remaining: 0 });
  });

  it("the sentence changes with progress", () => {
    expect(goalSentence(0, 15)).toBe("15 minutes today. Let's go.");
    expect(goalSentence(10, 15)).toBe("10 of 15 minutes done — 5 to go.");
    expect(goalSentence(15, 15)).toMatch(/hit today's goal/);
  });
});

describe("courseProgressPct", () => {
  it("is 0 at the start, a sixth per finished level, and 100 when complete", () => {
    expect(courseProgressPct({ current_level: 1, status: "active" }, 0, 4)).toBe(0);
    expect(courseProgressPct({ current_level: 2, status: "active" }, 0, 4)).toBe(17);
    expect(courseProgressPct({ current_level: 6, status: "active" }, 0, 0)).toBe(83);
    expect(courseProgressPct({ current_level: 6, status: "completed" }, 0, 0)).toBe(100);
  });

  it("credits learned topics within the current level", () => {
    expect(courseProgressPct({ current_level: 1, status: "active" }, 2, 4)).toBe(8);
    expect(courseProgressPct({ current_level: 1, status: "active" }, 4, 4)).toBe(17);
  });

  it("tolerates legacy fractional levels and empty syllabuses", () => {
    expect(courseProgressPct({ current_level: 2.5, status: "active" }, 0, 0)).toBe(17);
    expect(courseProgressPct({ current_level: 0, status: "active" }, 0, 0)).toBe(0);
  });
});
