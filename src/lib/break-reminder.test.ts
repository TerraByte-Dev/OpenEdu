import { describe, it, expect } from "vitest";
import { tickBreakClock, NEW_BREAK_CLOCK, BREAK_REMINDER_MINUTES, BREAK_RESET_MINUTES, type BreakClock } from "./break-reminder";

// A fake clock: App ticks once a minute while the learner is active; a gap is minutes with no tick.
const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 14, 15, 0);

/** Ticks `count` active minutes, one a minute from `at`; returns the clock, the next free time and the reminders. */
function run(clock: BreakClock, at: number, count: number) {
  const reminders: Array<{ minute: number; hours: number }> = [];
  let c = clock;
  let t = at;
  for (let i = 0; i < count; i++) {
    const out = tickBreakClock(c, t);
    c = out.clock;
    if (out.remindAfterHours !== null) reminders.push({ minute: c.minutes, hours: out.remindAfterHours });
    t += MINUTE;
  }
  return { clock: c, next: t, reminders };
}

describe("the break reminder's timing", () => {
  it("is every 3 hours, and a break is a gap of 30 minutes", () => {
    expect(BREAK_REMINDER_MINUTES).toBe(180);
    expect(BREAK_RESET_MINUTES).toBe(30);
  });

  it("shows once after 3 hours of continuous activity, not a minute before", () => {
    expect(run(NEW_BREAK_CLOCK, START, 179).reminders).toEqual([]);
    expect(run(NEW_BREAK_CLOCK, START, 180).reminders).toEqual([{ minute: 180, hours: 3 }]);
  });

  it("shows again every 3 hours of activity after that", () => {
    expect(run(NEW_BREAK_CLOCK, START, 9 * 60).reminders).toEqual([
      { minute: 180, hours: 3 },
      { minute: 360, hours: 6 },
      { minute: 540, hours: 9 },
    ]);
  });

  it("a short gap does not reset the count, and its minutes are not counted", () => {
    const first = run(NEW_BREAK_CLOCK, START, 100);
    // The next active minute comes 29 minutes after the last one (the window hidden in between).
    const second = run(first.clock, first.next - MINUTE + (BREAK_RESET_MINUTES - 1) * MINUTE, 80);
    expect(second.reminders).toEqual([{ minute: 180, hours: 3 }]);
  });

  it("a gap of 30 minutes or more is a break: the count starts again", () => {
    const first = run(NEW_BREAK_CLOCK, START, 170);
    const second = run(first.clock, first.next - MINUTE + BREAK_RESET_MINUTES * MINUTE, 170);
    expect(second.clock.minutes).toBe(170);
    expect(second.reminders).toEqual([]);
    expect(run(second.clock, second.next, 10).reminders).toEqual([{ minute: 180, hours: 3 }]);
  });

  it("a new session starts from zero", () => {
    expect(tickBreakClock(NEW_BREAK_CLOCK, START)).toEqual({ clock: { minutes: 1, lastAt: START }, remindAfterHours: null });
  });
});
