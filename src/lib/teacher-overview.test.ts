import { describe, it, expect } from "vitest";
import { buildOverviewRows, filterOverviewRows, overviewCsv, countMastery, type OverviewSource } from "./teacher-overview";
import { NO_GROUP } from "./usage-modes";

const subs = (...mastered: boolean[]) => JSON.stringify(mastered.map((m, i) => ({ id: `1.${i}`, title: `t${i}`, mastered: m })));

const source: OverviewSource = {
  groups: [{ id: "g5", name: "Grade 5" }, { id: "g6", name: "Grade 6" }],
  learners: [
    { id: "a", name: "Amina", last_active_at: "2026-11-01 09:00:00", group_id: "g5" },
    { id: "b", name: "Bilal", last_active_at: "2026-11-02 09:00:00", group_id: "g6" },
    { id: "c", name: "Chen", last_active_at: null, group_id: null },
    { id: "d", name: "Dara", last_active_at: null, group_id: "gone" },
  ],
  courses: [
    { id: "c1", title: "Algebra", learner_id: "a", current_level: 2, updated_at: "2026-10-01 10:00:00" },
    { id: "c2", title: "Biology", learner_id: "a", current_level: 1, updated_at: "2026-10-05 10:00:00" },
    { id: "c3", title: "=cmd|' /C calc'!A0", learner_id: "b", current_level: 3, updated_at: "2026-10-03 10:00:00" },
  ],
  syllabuses: [
    { course_id: "c1", subtopics: subs(true, true, false) },
    { course_id: "c1", subtopics: subs(true, false) },
    { course_id: "c2", subtopics: "not json" },
    { course_id: "c3", subtopics: null },
  ],
  progress: [
    { course_id: "c1", last_active_at: "2026-11-01 08:00:00" },
    { course_id: "c2", last_active_at: null },
  ],
};

describe("countMastery", () => {
  it("counts mastered subtopics and never throws on bad data", () => {
    expect(countMastery(subs(true, false, true))).toEqual({ mastered: 2, total: 3 });
    expect(countMastery(null)).toEqual({ mastered: 0, total: 0 });
    expect(countMastery("{")).toEqual({ mastered: 0, total: 0 });
    expect(countMastery('{"a":1}')).toEqual({ mastered: 0, total: 0 });
    expect(countMastery('[null, {"mastered":"yes"}, {"mastered":true}]')).toEqual({ mastered: 1, total: 3 });
  });
});

describe("buildOverviewRows", () => {
  const rows = buildOverviewRows(source);

  it("has one row per learner x course, and one row for a learner with no courses", () => {
    expect(rows.map((r) => `${r.learnerName}/${r.courseTitle}`)).toEqual([
      "Chen/null", "Dara/null", "Amina/Algebra", "Amina/Biology", "Bilal/=cmd|' /C calc'!A0",
    ]);
  });

  it("sums mastery across every level of a course", () => {
    const algebra = rows.find((r) => r.courseTitle === "Algebra")!;
    expect([algebra.level, algebra.mastered, algebra.subtopics]).toEqual([2, 3, 5]);
  });

  it("last active is the later of the course's progress and its last update", () => {
    expect(rows.find((r) => r.courseTitle === "Algebra")!.lastActive).toBe("2026-11-01 08:00:00");
    expect(rows.find((r) => r.courseTitle === "Biology")!.lastActive).toBe("2026-10-05 10:00:00");
    expect(rows.find((r) => r.learnerName === "Chen")!.lastActive).toBeNull();
  });

  it("a learner in a deleted group is in no group", () => {
    expect(rows.find((r) => r.learnerName === "Dara")!.groupId).toBeNull();
  });
});

describe("filterOverviewRows", () => {
  const rows = buildOverviewRows(source);
  it("filters by group, by no group, or not at all", () => {
    expect(filterOverviewRows(rows, "all")).toHaveLength(5);
    expect(filterOverviewRows(rows, "g5").map((r) => r.courseTitle)).toEqual(["Algebra", "Biology"]);
    expect(filterOverviewRows(rows, "g6").map((r) => r.learnerName)).toEqual(["Bilal"]);
    expect(filterOverviewRows(rows, NO_GROUP).map((r) => r.learnerName)).toEqual(["Chen", "Dara"]);
  });
});

describe("overviewCsv", () => {
  const rows = buildOverviewRows(source);

  it("has a Class column only when groups are in use", () => {
    const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");
    expect(lines(overviewCsv(rows, false))[0]).toBe("Learner,Course,Level,Subtopics mastered,Subtopics total,Last active (UTC)");
    expect(lines(overviewCsv(rows, true))[0]).toBe("Class,Learner,Course,Level,Subtopics mastered,Subtopics total,Last active (UTC)");
    expect(lines(overviewCsv(rows, true))[3]).toBe("Grade 5,Amina,Algebra,2,3,5,2026-11-01 08:00:00");
  });

  it("defuses a course title written as a formula", () => {
    expect(overviewCsv(rows, false)).toContain("Bilal,'=cmd|' /C calc'!A0,3,0,0,");
  });
});
