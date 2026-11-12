import { describe, it, expect } from "vitest";
import { learningRecord } from "./build";
import { bannedWordsIn, fill, RECORD_COPY, singular } from "./copy";
import {
  allTimeRecord, approxTimeText, cachedTeaser, currentMonth, evidenceText, groupByCourseAndLevel, masteredCount, rangeOptions,
  rememberTeaser, splitAtCount, teaserCounts, teaserFromRecord, teaserKey, teaserLine, teaserShown, whenText,
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

  it("keeps the last build per learner and month, only to paint Home's first frame", () => {
    const k = teaserKey("L", NOW);
    expect(k).not.toBe(teaserKey("L", local(2026, 11, 2)));
    expect(k).not.toBe(teaserKey("M", NOW));
    expect(cachedTeaser(teaserKey("nobody", NOW))).toBeUndefined();
    rememberTeaser(k, { month: "November", days: 2, mastered: 0 });
    expect(cachedTeaser(k)).toEqual({ month: "November", days: 2, mastered: 0 });
  });

  it("is hidden while there is nothing in it", () => {
    expect(teaserShown({ month: "November", days: 0, mastered: 0 })).toBe(false);
    expect(teaserShown(teaserCounts(emptySource(), NOW))).toBe(false);
    expect(teaserShown({ month: "November", days: 1, mastered: 0 })).toBe(true);
    expect(teaserShown(teaserCounts(busySource(), NOW))).toBe(true);
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
    const all = allTimeRecord(s, NOW)!.mastered;
    expect(all.map((m) => [m.skillId, m.earlySign])).toEqual([["1.1", false], ["1.2", false], ["1.3", true]]);
    const groups = groupByCourseAndLevel(all);
    expect(groups).toHaveLength(1);
    expect(groups[0].levels.map((l) => l.rows.length)).toEqual([3]);
    expect(allTimeRecord(emptySource(), NOW)).toBeNull();
    for (const text of [teaserLine(teaserCounts(s, NOW)), ...all.map((m) => evidenceText(m.evidence))]) expect(bannedWordsIn(text)).toEqual([]);
  });
});

describe("counts of one read in the singular", () => {
  const C = RECORD_COPY;
  const V = RECORD_COPY.view;

  it("in every counted sentence the record fills in", () => {
    expect(fill(C.tiles.days, { n: 1 })).toBe("At least 1 day with learning");
    expect(fill(C.tiles.days, { n: 2 })).toBe("At least 2 days with learning");
    expect(fill(C.tiles.time_counted, { n: 1 })).toBe("1 active minute (counted)");
    expect(fill(C.tiles.earlySigns, { n: 1 })).toBe("Plus 1 early sign (fewer than 3 questions)");
    expect(fill(C.tiles.time_approx, { time: "12 min", sittings: 1 })).toBe("About 12 min · in 1 sitting");
    expect(fill(C.rechecked, { n: 1, held: 0, slipped: 1 })).toBe("Rechecked 1 skill · held 0 · slipped 1");
    expect(fill(C.reconciliation, { shown: 2, checked: 1, early: 1, without: 0 }))
      .toBe("The app shows 2 mastered: 1 quiz-checked here, 1 early sign, 0 without quiz proof (see above).");
    expect(fill(C.withoutProof.fallback, { n: 1 })).toBe("Grader failed on 1 answer, so this does not count as proof.");
    expect(fill(C.activity.tutor, { messages: 1, conversations: 1 })).toBe("1 message to the tutor in 1 conversation");
    expect(fill(C.activity.flashcards, { n: 1 })).toBe("Made 1 flashcard");
    expect(fill(C.activity.reviewed, { n: 1 })).toBe("Reviewed 1 flashcard");
    expect(fill(V.earlySigns, { n: 1 })).toBe("1 early sign");
    expect(fill(V.everythingTotal, { n: 1 })).toBe("Since you started: 1 skill mastered (quiz-checked)");
    expect(fill(V.skillsLine, { mastered: 0, total: 1 })).toBe("0 of 1 skill mastered (quiz-checked)");
    expect(fill(V.unansweredNote, { n: 1 })).toBe("1 unanswered");
    expect(fill(C.evidence.key, { n: 1 })).toBe("1 checked against the app's answer key");
  });

  it("leaves other numbers alone", () => {
    expect(singular("11 days, 21 skills, 1.5 days, 3 of 1 right")).toBe("11 days, 21 skills, 1.5 days, 3 of 1 right");
  });

  it("splits a tile at its count, and a zero bounds nothing", () => {
    expect(splitAtCount("At least 12 days with learning", 12)).toEqual({ big: "At least 12", rest: "days with learning" });
    expect(splitAtCount(fill(C.tiles.days, { n: 1 }), 1)).toEqual({ big: "At least 1", rest: "day with learning" });
    expect(splitAtCount(fill(C.tiles.days, { n: 0 }), 0)).toEqual({ big: "0", rest: "days with learning" });
    expect(splitAtCount(fill(C.tiles.time_counted, { n: 190 }), 190)).toEqual({ big: "190", rest: "active minutes (counted)" });
  });
});
