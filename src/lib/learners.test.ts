import { describe, it, expect } from "vitest";
import {
  needsPicker, needsPin, autoPickLearner, canAccessCourse, canDeleteLearner,
  validateLearnerName, deleteConfirmMatches, DEFAULT_LEARNER_ID, LEARNER_NAME_MAX,
} from "./learners";

const L = (id: string, name: string, pin_hash: string | null = null) => ({
  id, name, pin_hash, pin_salt: pin_hash ? "salt" : null, created_at: "", last_active_at: null,
});

describe("picker visibility", () => {
  it("one learner with no PIN: no picker, that learner is entered (every new or solo install)", () => {
    const only = L(DEFAULT_LEARNER_ID, "Learner 1");
    expect(needsPicker([only])).toBe(false);
    expect(autoPickLearner([only])).toBe(only);
  });

  it("one learner with a PIN: picker", () => {
    const only = L("a", "Amina", "pbkdf2-sha256$210000$x");
    expect(needsPicker([only])).toBe(true);
    expect(autoPickLearner([only])).toBeNull();
  });

  it("two or more learners: picker, even with no PINs", () => {
    expect(needsPicker([L("a", "Amina"), L("b", "Bilal")])).toBe(true);
    expect(autoPickLearner([L("a", "Amina"), L("b", "Bilal")])).toBeNull();
  });

  it("no learners (only by hand-editing the database): nobody is entered without the picker", () => {
    expect(needsPicker([])).toBe(true);
    expect(autoPickLearner([])).toBeNull();
  });

  it("asks a learner's PIN only when they have one", () => {
    expect(needsPin(L("a", "Amina", "pbkdf2-sha256$210000$x"))).toBe(true);
    expect(needsPin(L("b", "Bilal"))).toBe(false);
  });
});

describe("course ownership guard", () => {
  it("the owner can open the course", () => {
    expect(canAccessCourse({ learner_id: "a" }, "a")).toBe(true);
  });

  it("another learner cannot", () => {
    expect(canAccessCourse({ learner_id: "a" }, "b")).toBe(false);
  });

  it("nobody can while no learner is active", () => {
    expect(canAccessCourse({ learner_id: "a" }, null)).toBe(false);
  });

  it("a course with no owner, or no course, is refused", () => {
    expect(canAccessCourse({ learner_id: null }, "a")).toBe(false);
    expect(canAccessCourse({}, "a")).toBe(false);
    expect(canAccessCourse(null, "a")).toBe(false);
    expect(canAccessCourse(undefined, "a")).toBe(false);
  });
});

describe("learner management rules", () => {
  it("the last learner cannot be deleted", () => {
    expect(canDeleteLearner([L("a", "A")])).toBe(false);
    expect(canDeleteLearner([L("a", "A"), L("b", "B")])).toBe(true);
  });

  it("names must be present, short, and unique ignoring case", () => {
    const all = [L("a", "Amina"), L("b", "Bilal")];
    expect(validateLearnerName("   ", all)).not.toBeNull();
    expect(validateLearnerName("x".repeat(LEARNER_NAME_MAX + 1), all)).not.toBeNull();
    expect(validateLearnerName(" amina ", all)).not.toBeNull();
    expect(validateLearnerName("Chidi", all)).toBeNull();
  });

  it("renaming to your own name (or its case) is fine", () => {
    const all = [L("a", "Amina"), L("b", "Bilal")];
    expect(validateLearnerName("AMINA", all, "a")).toBeNull();
    expect(validateLearnerName("Bilal", all, "a")).not.toBeNull();
  });

  it("delete confirmation needs the name, ignoring case and outer spaces", () => {
    expect(deleteConfirmMatches(" amina ", "Amina")).toBe(true);
    expect(deleteConfirmMatches("Amin", "Amina")).toBe(false);
    expect(deleteConfirmMatches("", "")).toBe(false);
  });
});
