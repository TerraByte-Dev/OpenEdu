import { describe, it, expect } from "vitest";
import {
  USAGE_MODES, parseUsageMode, resolveStartupMode, hasPriorUse, isProtected, needsTeacherPin,
  modeChangeStep, keepsTeacherPin, showsPicker, autoPickFor, showsLearnerChip, learnersManageLearners,
  pickerGroups, pickerAsksGroup, learnersInGroup, validateGroupName, NO_GROUP,
  type TeacherAction, type UsageMode,
} from "./usage-modes";

const one = [{ id: "default", pin_hash: null }];
const oneWithPin = [{ id: "default", pin_hash: "x" }];
const two = [{ id: "a", pin_hash: null }, { id: "b", pin_hash: null }];
const MODES: UsageMode[] = ["single", "class", "school"];

describe("the three modes", () => {
  it("offers exactly Just me, A class, A school or center, each with one sentence", () => {
    expect(USAGE_MODES.map((m) => m.title)).toEqual(["Just me", "A class", "A school or center"]);
    for (const m of USAGE_MODES) expect(m.sentence).toMatch(/^[^.]+\.$/);
  });

  it("parses only known modes", () => {
    for (const m of MODES) expect(parseUsageMode(m)).toBe(m);
    expect(parseUsageMode("teacher")).toBeNull();
    expect(parseUsageMode(null)).toBeNull();
    expect(parseUsageMode(undefined)).toBeNull();
  });
});

describe("startup", () => {
  it("a stored mode always wins", () => {
    expect(resolveStartupMode("class", false)).toBe("class");
    expect(resolveStartupMode("school", true)).toBe("school");
  });

  it("an install already in use starts as Just me without asking", () => {
    expect(resolveStartupMode(null, true)).toBe("single");
    expect(resolveStartupMode("garbage", true)).toBe("single");
  });

  it("only a fresh install is asked", () => {
    expect(resolveStartupMode(null, false)).toBeNull();
  });

  it("prior use = a finished tour, a second learner, or any PIN", () => {
    expect(hasPriorUse(one, false)).toBe(false);
    expect(hasPriorUse(one, true)).toBe(true);
    expect(hasPriorUse(two, false)).toBe(true);
    expect(hasPriorUse(oneWithPin, false)).toBe(true);
  });
});

describe("the teacher PIN", () => {
  const ACTIONS: TeacherAction[] = [
    "open-settings", "change-mode", "add-learner", "remove-learner", "reset-learner-pin", "teacher-view", "manage-groups",
  ];

  it("guards nothing in Just me", () => {
    expect(isProtected("single")).toBe(false);
    for (const a of ACTIONS) expect(needsTeacherPin("single", a)).toBe(false);
  });

  it("guards every teacher action in a class and in a school", () => {
    for (const m of ["class", "school"] as const) {
      expect(isProtected(m)).toBe(true);
      for (const a of ACTIONS) expect(needsTeacherPin(m, a)).toBe(true);
    }
  });
});

describe("changing mode", () => {
  it("moving up from Just me sets a new teacher PIN", () => {
    expect(modeChangeStep("single", "class")).toBe("set-teacher-pin");
    expect(modeChangeStep("single", "school")).toBe("set-teacher-pin");
  });

  it("leaving a protected mode always needs the teacher PIN, so only the teacher can lower protection", () => {
    expect(modeChangeStep("class", "single")).toBe("verify-teacher-pin");
    expect(modeChangeStep("school", "single")).toBe("verify-teacher-pin");
    expect(modeChangeStep("school", "class")).toBe("verify-teacher-pin");
    expect(modeChangeStep("class", "school")).toBe("verify-teacher-pin");
  });

  it("no change asks for nothing", () => {
    for (const m of MODES) expect(modeChangeStep(m, m)).toBe("none");
  });

  it("drops the teacher PIN only on the way back to Just me", () => {
    expect(keepsTeacherPin("single")).toBe(false);
    expect(keepsTeacherPin("class")).toBe(true);
    expect(keepsTeacherPin("school")).toBe(true);
  });
});

describe("picker and learner chip", () => {
  it("Just me keeps #173's rule: one learner with no PIN opens straight in", () => {
    expect(showsPicker("single", one)).toBe(false);
    expect(autoPickFor("single", one)).toBe(one[0]);
    expect(showsLearnerChip("single", one)).toBe(false);
  });

  it("Just me still shows the picker when there is someone to pick or a PIN", () => {
    expect(showsPicker("single", two)).toBe(true);
    expect(showsPicker("single", oneWithPin)).toBe(true);
    expect(autoPickFor("single", two)).toBeNull();
  });

  it("a class or school always asks who is learning, even with one learner", () => {
    for (const m of ["class", "school"] as const) {
      expect(showsPicker(m, one)).toBe(true);
      expect(autoPickFor(m, one)).toBeNull();
      expect(showsLearnerChip(m, one)).toBe(true);
    }
  });

  it("learners add and delete learners only in Just me", () => {
    expect(learnersManageLearners("single")).toBe(true);
    expect(learnersManageLearners("class")).toBe(false);
    expect(learnersManageLearners("school")).toBe(false);
  });
});

describe("groups in the picker", () => {
  const groups = [{ id: "g1", name: "Grade 5" }, { id: "g2", name: "Grade 6" }, { id: "g3", name: "Empty" }];
  const learners = [
    { id: "a", group_id: "g1" },
    { id: "b", group_id: "g1" },
    { id: "c", group_id: "g2" },
    { id: "d", group_id: null },
    { id: "e", group_id: "deleted-group" },
  ];

  it("shows groups with learners, skips empty ones, and puts the rest under Everyone else", () => {
    expect(pickerGroups(groups, learners)).toEqual([
      { id: "g1", name: "Grade 5", count: 2 },
      { id: "g2", name: "Grade 6", count: 1 },
      { id: NO_GROUP, name: "Everyone else", count: 2 },
    ]);
  });

  it("with no groups at all, everyone is one bucket and the group step is skipped", () => {
    const buckets = pickerGroups([], learners);
    expect(buckets).toEqual([{ id: NO_GROUP, name: "Everyone", count: 5 }]);
    expect(pickerAsksGroup("school", buckets)).toBe(false);
  });

  it("asks for the group only in school mode with more than one bucket", () => {
    const buckets = pickerGroups(groups, learners);
    expect(pickerAsksGroup("school", buckets)).toBe(true);
    expect(pickerAsksGroup("class", buckets)).toBe(false);
    expect(pickerAsksGroup("single", buckets)).toBe(false);
  });

  it("filters learners by bucket; a deleted group's learners count as in no group", () => {
    expect(learnersInGroup(learners, "g1", groups).map((l) => l.id)).toEqual(["a", "b"]);
    expect(learnersInGroup(learners, NO_GROUP, groups).map((l) => l.id)).toEqual(["d", "e"]);
    expect(learnersInGroup(learners, "g3", groups)).toEqual([]);
  });

  it("validates group names like learner names", () => {
    expect(validateGroupName("  ", groups)).toMatch(/name/);
    expect(validateGroupName("x".repeat(41), groups)).toMatch(/under/);
    expect(validateGroupName("grade 5", groups)).toMatch(/already/);
    expect(validateGroupName("Grade 5", groups, "g1")).toBeNull();
    expect(validateGroupName("Grade 7", groups)).toBeNull();
  });
});
