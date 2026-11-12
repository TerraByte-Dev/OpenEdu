import { describe, it, expect, beforeEach } from "vitest";
import { learningRecord } from "./build";
import { bannedWordsIn } from "./copy";
import {
  approxTimeText, cachedTeaser, currentMonth, everythingMastered, evidenceText, forgetTeasers, groupByCourseAndLevel,
  masteredCount, rangeOptions, rememberTeaser, teaserCounts, teaserFromRecord, teaserKey, teaserLine, whenText,
} from "./view";
import { course, emptySource, local, nov, oct, quiz, sub, syllabus } from "./test-rows";

const NOW = local(2026, 10, 20);

function busySource() {
  const s = emptySource();
  s.courses = [course({ current_level: 1 })];
  s.syllabuses = [syllabus(1, [sub("1.1", "Greetings"), sub("1.2", "Numbers"), sub("1.3", "Verbs")])];
  quiz(s, "1.1", 3, 3, { completed_at: oct(4) });
  quiz(s, "1.2", 9, 10, { completed_at: nov(4) });
  quiz(s, "1.3", 1, 1, { completed_at: nov(6) }); // an early sign: not counted
  s.chats = [{ course_id: "c", thread_id: "t", created_at: nov(8) }];
  s.lessons = [{ course_id: "c", read_at: nov(9) }];
  return s;
}

describe("the Home teaser counts what the record counts", () => {
  beforeEach(() => forgetTeasers());

  it("equals the builder's days and quiz-checked mastered count for the current month", () => {
    const s = busySource();
    const record = learningRecord(s, currentMonth(NOW), NOW);
    const t = teaserCounts(s, NOW);
    expect(t).toEqual({ month: "November", days: record.days, mastered: record.mastered.filter((m) => !m.earlySign).length });
    expect(t).toEqual(teaserFromRecord(record));
    expect(t.mastered).toBe(masteredCount(record));
    expect(t).toMatchObject({ days: 4, mastered: 1 });
  });

  it("reads in the second person, with at least on the days", () => {
    expect(teaserLine({ month: "November", days: 6, mastered: 3 })).toBe("Your November so far: at least 6 days with learning · 3 skills mastered.");
    expect(teaserLine({ month: "November", days: 1, mastered: 1 })).toBe("Your November so far: at least 1 day with learning · 1 skill mastered.");
  });

  it("is kept per learner and month, and forgotten after a quiz", () => {
    const k = teaserKey("L", NOW);
    expect(k).not.toBe(teaserKey("L", local(2026, 11, 2)));
    expect(k).not.toBe(teaserKey("M", NOW));
    rememberTeaser(k, { month: "November", days: 2, mastered: 0 });
    expect(cachedTeaser(k)).toEqual({ month: "November", days: 2, mastered: 0 });
    forgetTeasers();
    expect(cachedTeaser(k)).toBeUndefined();
  });
});

describe("the range picker", () => {
  it("puts this month first, then months with activity newest first, then the school year", () => {
    const s = busySource();
    const opts = rangeOptions(s, "guided", local(2026, 11, 3));
    expect(opts.map((o) => o.label)).toEqual(["December 2026", "November 2026", "October 2026", "This school year"]);
    expect(opts[3].range).toEqual({ kind: "since", from: "2026-08-01" });
    expect(rangeOptions(s, "teacher", NOW).slice(-1)[0].label).toBe("This school year");
  });

  it("offers Since you started to a self reader, from the first activity, and never twice this month", () => {
    const s = busySource();
    const opts = rangeOptions(s, "self", NOW);
    expect(opts.map((o) => o.label)).toEqual(["November 2026", "October 2026", "Since you started"]);
    expect(opts[2].range).toEqual({ kind: "since", from: "2026-10-04" });
    expect(rangeOptions(emptySource(), "self", NOW).map((o) => o.label)).toEqual(["November 2026"]);
  });
});

describe("the record's wording", () => {
  it("splits the evidence by grader", () => {
    expect(evidenceText({ correct: 4, total: 4, levelTest: false, graders: { key: 3, exact: 0, model: 1, fallback: 0, unanswered: 0, unknown: 0 } }))
      .toBe("4 of 4 right · quiz · 3 checked against the app's answer key, 1 judged by the app's model");
    expect(evidenceText({ correct: 5, total: 6, levelTest: true, graders: { key: 0, exact: 0, model: 0, fallback: 0, unanswered: 0, unknown: 0 } }))
      .toBe("5 of 6 right · level test");
  });

  it("says about, and names the sittings", () => {
    expect(approxTimeText({ minutes: 400, sittings: 31 })).toBe("About 6 h 40 min · in 31 sittings");
    expect(approxTimeText({ minutes: 12, sittings: 1 })).toBe("About 12 min · in 1 sitting");
  });

  it("names the period: in November, or since a date", () => {
    const s = busySource();
    expect(whenText(learningRecord(s, currentMonth(NOW), NOW))).toBe("in November");
    expect(whenText(learningRecord(s, { kind: "since", from: "2026-08-01" }, NOW))).toBe("since Aug 1, 2026");
  });

  it("lists everything mastered since the start, grouped by course and level, and every string is clean", () => {
    const s = busySource();
    const all = everythingMastered(s, NOW);
    expect(all.map((m) => [m.skillId, m.earlySign])).toEqual([["1.1", false], ["1.2", false], ["1.3", true]]);
    const groups = groupByCourseAndLevel(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].levels.map((l) => l.rows.length)).toEqual([3]);
    expect(everythingMastered(emptySource(), NOW)).toEqual([]);
    for (const text of [teaserLine(teaserCounts(s, NOW)), ...all.map((m) => evidenceText(m.evidence))]) expect(bannedWordsIn(text)).toEqual([]);
  });
});
