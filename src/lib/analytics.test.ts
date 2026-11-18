import { describe, it, expect, vi, afterAll } from "vitest";
import { computeStreak, dayKey, accuracyPct, minutesFromSeconds } from "./analytics";

// Pin a zone west of Greenwich (UTC-6 in November, UTC-5 in June), so a test fails if anything keys
// by UTC day or reads a stored SQLite time as local, whatever zone the machine running the suite is in.
vi.stubEnv("TZ", "America/Chicago");
afterAll(() => { vi.unstubAllEnvs(); });

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

  // quiz_attempts.started_at is SQLite's datetime('now'): UTC, "YYYY-MM-DD HH:MM:SS", no zone.
  it("counts a quiz taken at 1 pm Central right after it, from the stored SQLite time", () => {
    expect(computeStreak(["2026-11-18 19:00:00"], new Date("2026-11-18T19:05:00Z"))).toBe(1);
  });

  it("keys days by the learner's local day: an evening and the next morning are two days", () => {
    // 9 pm Central on the 17th (03:00 UTC on the 18th), then 9 am Central on the 18th.
    expect(computeStreak(["2026-11-18 03:00:00", "2026-11-18 15:00:00"], new Date("2026-11-18T20:00:00Z"))).toBe(2);
  });

  it("steps back over a DST change without skipping a day", () => {
    // US clocks fell back on 1 Nov 2026: noon Central on Oct 31, Nov 1 and Nov 2.
    expect(computeStreak(["2026-10-31 17:00:00", "2026-11-01 18:00:00", "2026-11-02 18:00:00"], new Date("2026-11-02T20:00:00Z"))).toBe(3);
  });
});

describe("dayKey / accuracyPct / minutesFromSeconds", () => {
  it("dayKey gives the local YYYY-MM-DD of an ISO or SQLite UTC time", () => {
    expect(dayKey("2026-06-05T23:59:00.000Z")).toBe("2026-06-05");
    expect(dayKey("2026-06-06T03:00:00.000Z")).toBe("2026-06-05");
    expect(dayKey("2026-11-18 03:00:00")).toBe("2026-11-17");
    expect(dayKey("2026-11-18 19:00:00")).toBe("2026-11-18");
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
