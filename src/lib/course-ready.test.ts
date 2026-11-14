import { describe, it, expect } from "vitest";
import { opensWhenBuilt, readyNotice, readyNoticeAfter } from "./course-ready";
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

describe("readyNoticeAfter", () => {
  const ready = { id: "c-time", title: "Telling time" };

  // Click test 2026-11-14: the notice stayed on every screen. It goes once its course is open, however
  // the learner got there (its Open button, the course list, Home's Continue, or a build that
  // finished while that course was already open).
  it.each<View>(["course", "quiz", "promotion-test"])("is gone once its course is open on %s", (view) => {
    expect(readyNoticeAfter(ready, view, "c-time")).toBeNull();
  });

  it("stays while another course, or no course, is open", () => {
    expect(readyNoticeAfter(ready, "course", "c-fractions")).toBe(ready);
    expect(readyNoticeAfter(ready, "dashboard", "c-time")).toBe(ready);
    expect(readyNoticeAfter(ready, "settings", null)).toBe(ready);
    expect(readyNoticeAfter(null, "course", "c-time")).toBeNull();
  });
});
