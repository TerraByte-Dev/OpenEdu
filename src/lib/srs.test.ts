import { describe, it, expect } from "vitest";
import { review, initialSchedule, isDue, requeueIfDue, MIN_EASE, DEFAULT_EASE, type SrsState } from "./srs";

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

// TerraTutor #200 (audit 5 #10): a card graded "Again" is due at once but was never shown again in the session, which then
// said "Nothing is due right now". ReviewTab.grade runs review() and then requeueIfDue; these tests cover
// requeueIfDue only (ReviewTab's refetch and delete are checked live).
describe("requeueIfDue — the review session's queue", () => {
  const card = (id: string) => ({ id, front: id, ...initialSchedule(NOW) });
  const queue = [card("a"), card("b"), card("c")];

  it("puts a card graded Again back at the end with its new schedule", () => {
    const next = review(queue[0], "again", NOW);
    const q = requeueIfDue(queue, 0, next, NOW);
    expect(q.map((c) => c.id)).toEqual(["a", "b", "c", "a"]);
    expect(q[3]).toMatchObject({ lapses: 1, reps: 0, interval_days: 0, due_at: next.due_at });
    expect(q.slice(0, 3)).toEqual(queue);
  });

  it("brings the last card back when it is graded Again, so the session does not end on it", () => {
    const q = requeueIfDue(queue, 2, review(queue[2], "again", NOW), NOW);
    expect(q.length).toBeGreaterThan(3);
    expect(q[3].id).toBe("c");
  });

  it("leaves the queue alone for Hard, Good and Easy", () => {
    for (const g of ["hard", "good", "easy"] as const) {
      expect(requeueIfDue(queue, 1, review(queue[1], g, NOW), NOW)).toBe(queue);
    }
  });

  it("a card graded Again then Good leaves the session with the relearned schedule", () => {
    let q = requeueIfDue(queue, 0, review(queue[0], "again", NOW), NOW);
    const again = q[3];
    const good = review(again, "good", NOW);
    expect(good.reps).toBe(1);
    expect(good.lapses).toBe(1);
    q = requeueIfDue(q, 3, good, NOW);
    expect(q).toHaveLength(4);
  });
});
