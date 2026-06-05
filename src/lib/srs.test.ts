import { describe, it, expect } from "vitest";
import { review, initialSchedule, isDue, MIN_EASE, DEFAULT_EASE, type SrsState } from "./srs";

const NOW = new Date("2026-06-05T12:00:00.000Z");
const fresh: SrsState = { ease: DEFAULT_EASE, interval_days: 0, reps: 0, lapses: 0 };

const daysBetween = (iso: string, from: Date) => Math.round((new Date(iso).getTime() - from.getTime()) / 86_400_000);

describe("review — first review", () => {
  it("good schedules 2 days out and bumps reps", () => {
    const s = review(fresh, "good", NOW);
    expect(s.reps).toBe(1);
    expect(s.interval_days).toBe(2);
    expect(daysBetween(s.due_at, NOW)).toBe(2);
    expect(s.ease).toBe(DEFAULT_EASE); // good leaves ease unchanged
  });

  it("easy schedules further out and raises ease", () => {
    const s = review(fresh, "easy", NOW);
    expect(s.interval_days).toBe(4);
    expect(s.ease).toBeGreaterThan(DEFAULT_EASE);
  });

  it("hard schedules sooner and lowers ease", () => {
    const s = review(fresh, "hard", NOW);
    expect(s.interval_days).toBe(1);
    expect(s.ease).toBeLessThan(DEFAULT_EASE);
  });
});

describe("review — intervals grow with ease", () => {
  it("third+ review multiplies the interval by ease", () => {
    const after2: SrsState = { ease: 2.5, interval_days: 6, reps: 2, lapses: 0 };
    const s = review(after2, "good", NOW);
    expect(s.reps).toBe(3);
    expect(s.interval_days).toBe(Math.round(6 * 2.5)); // 15
  });
});

describe("review — again is a lapse", () => {
  it("resets reps, increments lapses, lowers ease, due immediately", () => {
    const mature: SrsState = { ease: 2.5, interval_days: 30, reps: 5, lapses: 0 };
    const s = review(mature, "again", NOW);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.interval_days).toBe(0);
    expect(s.ease).toBe(2.3);
    expect(new Date(s.due_at).getTime()).toBe(NOW.getTime()); // due now
  });
});

describe("ease floor", () => {
  it("never drops ease below the minimum", () => {
    const low: SrsState = { ease: 1.35, interval_days: 5, reps: 3, lapses: 2 };
    expect(review(low, "again", NOW).ease).toBe(MIN_EASE);
    expect(review(low, "hard", NOW).ease).toBe(MIN_EASE);
  });
});

describe("initialSchedule / isDue", () => {
  it("a fresh card is due immediately", () => {
    const s = initialSchedule(NOW);
    expect(s.reps).toBe(0);
    expect(isDue(s.due_at, NOW)).toBe(true);
  });

  it("isDue is false before due_at, true at/after", () => {
    const later = review(fresh, "good", NOW); // 2 days out
    expect(isDue(later.due_at, NOW)).toBe(false);
    const twoDaysLater = new Date(NOW.getTime() + 2 * 86_400_000);
    expect(isDue(later.due_at, twoDaysLater)).toBe(true);
  });
});
