import { describe, it, expect } from "vitest";
import { opensWhenBuilt, readyNotice } from "./course-ready";
import type { View } from "../types";

describe("opensWhenBuilt", () => {
  it("opens the new course only from the build screen", () => {
    expect(opensWhenBuilt("create")).toBe(true);
  });

  // Click test 2026-11-14: a build that finished while the learner was in Settings closed Settings and
  // its open cloud notice, and opened the course.
  it.each<View>(["dashboard", "course", "settings", "quiz", "promotion-test"])("leaves %s where it is", (view) => {
    expect(opensWhenBuilt(view)).toBe(false);
  });
});

describe("readyNotice", () => {
  it("names the course, or says a course when the title is unknown", () => {
    expect(readyNotice("Fractions")).toBe("Your course Fractions is ready.");
    expect(readyNotice(undefined)).toBe("Your course is ready.");
    expect(readyNotice("  ")).toBe("Your course is ready.");
  });
});
