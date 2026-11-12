import { describe, it, expect } from "vitest";
import { isActiveMinute, ACTIVE_INPUT_WINDOW_MS, type MinuteState } from "./active-minute";

const now = 1_800_000_000_000;
const base: MinuteState = { visible: true, lastInputMs: now - 30_000, nowMs: now, view: "course", teacherOpen: false };

describe("isActiveMinute", () => {
  it("counts a visible learning screen with input in the last 2 minutes", () => {
    expect(isActiveMinute(base)).toBe(true);
    expect(isActiveMinute({ ...base, lastInputMs: now - ACTIVE_INPUT_WINDOW_MS })).toBe(true);
    expect(isActiveMinute({ ...base, view: "quiz" })).toBe(true);
  });

  it("does not count an idle window", () => {
    expect(isActiveMinute({ ...base, lastInputMs: now - ACTIVE_INPUT_WINDOW_MS - 1 })).toBe(false);
    expect(isActiveMinute({ ...base, lastInputMs: null })).toBe(false);
  });

  it("does not count a hidden window", () => {
    expect(isActiveMinute({ ...base, visible: false })).toBe(false);
  });

  it("does not count settings, the grown-ups view, the record, or the teacher view", () => {
    for (const view of ["settings", "grownups", "record"]) expect(isActiveMinute({ ...base, view })).toBe(false);
    expect(isActiveMinute({ ...base, teacherOpen: true })).toBe(false);
  });

  it("does not count input stamped in the future (a clock change)", () => {
    expect(isActiveMinute({ ...base, lastInputMs: now + 5_000 })).toBe(false);
  });
});
