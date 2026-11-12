import { describe, it, expect } from "vitest";
import { learningRecord } from "./build";
import { bannedWordsIn, fill, RECORD_COPY, RECORD_DISCLAIMER, RECORD_DISCLAIMER_SHORT } from "./copy";
import {
  clip, coverHeightPx, coverSheet, coverTotals, detailPages, isEmptyRecord, needsNameCheck, page1, page1HeightPx, printPlan, saveLabel,
  PAGE1_CAPS, PAGE1_CONTENT_PX, PAGE1_TEXT_MAX, PRINT_OWN_WORDS_MAX,
} from "./print";
import { earlySignCount, masteredCount, type Audience } from "./view";
import { course, emptySource, local, nov, oct, quiz, sub, syllabus, utc } from "./test-rows";
import type { RecordSource } from "./sources";

const NOW = local(2026, 10, 20);
const NOVEMBER = { kind: "month" as const, year: 2026, month: 10 };
const SCHOOL_YEAR = { kind: "since" as const, from: "2026-08-01" };
const AUDIENCES: Audience[] = ["self", "guided", "teacher"];

/** Every string anywhere inside a value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const LONG = "A very long skill title the app's model wrote that goes on and on about reading maps and charts";

/**
 * A busy learner: 5 courses (one legacy, one finished) in 3 subjects plus one without, 48 skills mastered
 * in November with long titles, early signs, a level pass and self-explanations.
 */
function bigSource(): RecordSource {
  const s = emptySource();
  s.learner.name = "Maximiliana Fernández-Oyelaran";
  s.captureSince = oct(1);
  const ids = ["c", "d", "e", "f"];
  const subjects = ["Math", "Science", "Foreign language", null];
  s.courses = ids.map((id, i) => course({
    id, title: `${LONG} course ${i + 1}`, subject: subjects[i], current_level: i === 3 ? 6 : 2, status: i === 3 ? "completed" : "active",
  }));
  s.courses.push(course({ id: "old", title: "Old maths", current_level: 1.5, subject: "Math" }));
  for (const id of ids) {
    s.syllabuses.push(syllabus(1, Array.from({ length: 6 }, (_, k) => sub(`1.${k + 1}`, `${LONG} ${id}${k}`, { mastered: true })), id));
    s.syllabuses.push(syllabus(2, Array.from({ length: 6 }, (_, k) => sub(`2.${k + 1}`, `Level two skill ${id}${k}`)), id));
    for (let k = 1; k <= 6; k++) quiz(s, `1.${k}`, 3, 3, { course_id: id, completed_at: nov(2 + k) }, { self_explanation: `Because ${id}${k}` });
    for (let k = 1; k <= 6; k++) quiz(s, `2.${k}`, k <= 4 ? 9 : 1, k <= 4 ? 10 : 1, { course_id: id, level: 2, completed_at: nov(10 + k) });
  }
  quiz(s, null, 0, 0, { course_id: "c", quiz_type: "promotion", level: 1, score: 90, passed: 1, completed_at: nov(9) });
  s.lessons = [{ course_id: "c", level: 1, topic: "A lesson", read_at: nov(8) }];
  s.learnerDays = [{ day: "2026-11-09", minutes: 40 }];
  return s;
}

describe("Save and the name check", () => {
  it("asks while the learner is still 'Learner 1' or has no grade", () => {
    expect(needsNameCheck({ name: "Learner 1", grade: 3 })).toBe(true);
    expect(needsNameCheck({ name: " Learner 1 ", grade: 3 })).toBe(true);
    expect(needsNameCheck({ name: "Maya", grade: null })).toBe(true);
    expect(needsNameCheck({ name: "Maya", grade: 0 })).toBe(false);
    expect(needsNameCheck({ name: "Learner 12", grade: 5 })).toBe(false);
  });

  it("asks about a missing grade only where the reader may set one", () => {
    // A learner's own record in a class or school: Settings is behind the teacher PIN.
    expect(needsNameCheck({ name: "Maya", grade: null }, false)).toBe(false);
    expect(needsNameCheck({ name: "Learner 1", grade: null }, false)).toBe(true);
    expect(needsNameCheck({ name: "Maya", grade: null }, true)).toBe(true);
  });

  it("names the button for the range", () => {
    const s = bigSource();
    expect(saveLabel(learningRecord(s, NOVEMBER, NOW), "guided")).toBe("Save November's record");
    expect(saveLabel(learningRecord(s, { kind: "month", year: 2026, month: 9 }, NOW), "self")).toBe("Save October's record");
    expect(saveLabel(learningRecord(s, SCHOOL_YEAR, NOW), "guided")).toBe("Save this school year's record");
    expect(saveLabel(learningRecord(s, SCHOOL_YEAR, NOW), "self")).toBe("Save your record so far");
  });
});

describe("page 1, the one-page summary", () => {
  const s = bigSource();
  const record = learningRecord(s, NOVEMBER, NOW);

  it("caps its lists and counts the rest exactly", () => {
    expect(record.mastered.filter((m) => !m.earlySign)).toHaveLength(40); // 10 per course, and 2 early signs each
    expect(record.mastered).toHaveLength(48);
    const p = page1(record, "guided", NOW);
    expect(p.mastered).toHaveLength(PAGE1_CAPS.mastered);
    expect(p.masteredMore).toBe(`+${record.mastered.length - PAGE1_CAPS.mastered} more in the detail pages`);
    expect(p.courses).toHaveLength(PAGE1_CAPS.courses);
    expect(p.coursesMore).toBe(`+${record.courses.length - PAGE1_CAPS.courses} more in the detail pages`);
    // Proof first: the capped list is quiz-checked rows, never early signs ahead of them.
    expect(p.mastered.every((m) => !m.early)).toBe(true);
    for (const m of p.mastered) {
      expect(m.skill.length).toBeLessThanOrEqual(PAGE1_TEXT_MAX.skill);
      expect(m.meta.length).toBeLessThanOrEqual(PAGE1_TEXT_MAX.meta);
    }
  });

  it("shows no '+N more' when everything fits", () => {
    const small = emptySource();
    small.courses = [course()];
    small.syllabuses = [syllabus(1, [sub("1.1", "Greetings")])];
    quiz(small, "1.1", 3, 3, { completed_at: nov(4) });
    const p = page1(learningRecord(small, NOVEMBER, NOW), "guided", NOW);
    expect(p.masteredMore).toBeNull();
    expect(p.coursesMore).toBeNull();
    expect(p.mastered).toEqual([{ skill: "Greetings", meta: "Spanish I · Level 1 · Nov 4", early: false }]);
  });

  it("never runs past the page, in any voice or range, with the large fixture", () => {
    for (const range of [NOVEMBER, SCHOOL_YEAR]) {
      for (const audience of AUDIENCES) {
        const p = page1(learningRecord(s, range, NOW), audience, NOW);
        expect(page1HeightPx(p), `${audience} ${range.kind}`).toBeLessThanOrEqual(PAGE1_CONTENT_PX);
      }
    }
    // A saved month whose course was deleted adds two header lines, and a K-1 learner a third: page 1
    // gives up a row of mastered skills to fit them.
    const k1 = { ...s, learner: { ...s.learner, grade: 0 } };
    const saved = { ...learningRecord(k1, NOVEMBER, NOW), current: false, saved: { at: utc(NOW), examplesGone: true } };
    const tight = page1(saved, "guided", NOW);
    expect([tight.header.built, tight.header.gone, tight.header.note].every(Boolean)).toBe(true);
    expect(page1HeightPx(tight)).toBeLessThanOrEqual(PAGE1_CONTENT_PX);
    expect(tight.mastered).toHaveLength(PAGE1_CAPS.mastered - 2);
    expect(tight.masteredMore).toBe(`+${saved.mastered.length - PAGE1_CAPS.mastered + 2} more in the detail pages`);
    // The estimate is not vacuous: an uncapped list of this size would overflow.
    const p = page1(record, "guided", NOW);
    expect(page1HeightPx({ ...p, mastered: Array(record.mastered.length).fill(p.mastered[0]) })).toBeGreaterThan(PAGE1_CONTENT_PX);
  });

  it("takes its tiles from the builder", () => {
    const p = page1(record, "guided", NOW);
    expect(p.tiles.days.big).toBe(`At least ${record.days}`);
    expect(p.tiles.mastered.big).toBe(String(masteredCount(record)));
    expect(p.tiles.mastered.extra).toBe(fill(RECORD_COPY.tiles.earlySigns, { n: earlySignCount(record) }));
    // Capture began in October, so November's time is all counted.
    expect(p.tiles.time).toEqual({ big: "40", rest: "active minutes (counted)", extra: null });
  });

  it("clips only page 1's rows; the detail pages keep every title whole", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
    const d = detailPages(record, "guided");
    expect(d.mastered.some((m) => m.skill.startsWith(LONG))).toBe(true);
  });
});

describe("the detail pages drop nothing", () => {
  const s = bigSource();
  it("carry every row of sections A-C, with only C2 cut to the newest few", () => {
    for (const audience of AUDIENCES) {
      const record = learningRecord(s, NOVEMBER, NOW);
      const d = detailPages(record, audience);
      expect(d.mastered).toHaveLength(record.mastered.length);
      expect(new Set(d.mastered)).toEqual(new Set(record.mastered));
      expect(d.withoutProof).toEqual(record.withoutProof);
      expect(d.levelsPassed).toEqual(record.levelsPassed);
      expect(d.courses).toEqual(record.courses);
      expect(d.courses.reduce((n, c) => n + c.skills.length, 0)).toBe(s.syllabuses.reduce((n, x) => n + x.subtopics.length, 0));
      expect(d.learning).toEqual(record.learning);
      expect(d.hardOnes).toEqual(record.hardOnes);
      expect(d.quizzes).toEqual(record.quizzes);
      expect(d.timeBySubject).toEqual(record.timeBySubject);
      expect(record.ownWords.length).toBeGreaterThan(PRINT_OWN_WORDS_MAX);
      expect(d.ownWords).toEqual(record.ownWords.slice(0, PRINT_OWN_WORDS_MAX));
      expect(d.ownWordsNote).toBe(`The newest 3 of ${record.ownWords.length} are printed here.`);
    }
  });
});

describe("what prints in each voice", () => {
  const s = bigSource();
  it("self: the reflection prompts only, the short disclaimer, no cover sheet, no Talk about it", () => {
    for (const range of [NOVEMBER, SCHOOL_YEAR]) {
      const plan = printPlan(range, "self");
      expect(plan).toEqual({
        cover: false, otherLearning: false, reflection: true, grownUpNotes: false, attestation: false, talkAboutIt: false, disclaimer: "short",
      });
      const record = learningRecord(s, range, NOW);
      expect(page1(record, "self", NOW).disclaimer).toBe(RECORD_DISCLAIMER_SHORT);
      expect(detailPages(record, "self").talkAboutIt).toBeNull();
      expect(detailPages(record, "self").disclaimer).toBe(RECORD_DISCLAIMER_SHORT);
    }
  });

  it("guided and teacher: all of section D and the full disclaimer; the cover sheet on the school year only", () => {
    for (const audience of ["guided", "teacher"] as const) {
      expect(printPlan(NOVEMBER, audience)).toEqual({
        cover: false, otherLearning: true, reflection: true, grownUpNotes: true, attestation: true, talkAboutIt: true, disclaimer: "full",
      });
      // The cover sheet carries the one signature line.
      expect(printPlan(SCHOOL_YEAR, audience)).toMatchObject({ cover: true, attestation: false, otherLearning: true, grownUpNotes: true });
      const record = learningRecord(s, NOVEMBER, NOW);
      expect(page1(record, audience, NOW).disclaimer).toBe(RECORD_DISCLAIMER);
      expect(detailPages(record, audience).talkAboutIt).toEqual(record.talkAboutIt);
    }
  });

  it("always names the learner on paper, and says which period the write-in lines cover", () => {
    const month = page1(learningRecord(s, NOVEMBER, NOW), "self", NOW);
    expect(month.header.title).toBe("Maximiliana Fernández-Oyelaran's record");
    expect(month.masteredHead).toBe("What Maximiliana Fernández-Oyelaran mastered in November");
    expect(month.otherLearningHead).toBe(RECORD_COPY.writeIn.otherLearning);
    expect(page1(learningRecord(s, SCHOOL_YEAR, NOW), "guided", NOW).otherLearningHead).toBe(RECORD_COPY.writeIn.otherLearningPeriod);
  });

  it("says where a K or grade 1 learner's early-screen activities are, and nothing for older learners", () => {
    const s0 = emptySource();
    s0.learner.grade = 0;
    expect(page1(learningRecord(s0, NOVEMBER, NOW), "guided", NOW).header.note).toBe(RECORD_COPY.view.earlyNote);
    s0.learner.grade = 2;
    expect(page1(learningRecord(s0, NOVEMBER, NOW), "guided", NOW).header.note).toBeNull();
  });

  it("marks a past month as built from what is still on record", () => {
    const oct2026 = page1(learningRecord(s, { kind: "month", year: 2026, month: 9 }, NOW), "guided", NOW);
    expect(oct2026.header.built).toBe("Built Nov 20, 2026 from the activity still on record.");
    expect(oct2026.header.printed).toBe("Printed Nov 20, 2026 · Record format 1");
    expect(page1(learningRecord(s, NOVEMBER, NOW), "guided", NOW).header.built).toBeNull();
  });
});

describe("the school-year cover sheet", () => {
  it("totals by subject and course equal the builder's counts", () => {
    const s = bigSource();
    const record = learningRecord(s, SCHOOL_YEAR, NOW);
    const t = coverTotals(record);
    expect(t.all.mastered).toBe(masteredCount(record));
    expect(t.all.levels).toBe(record.levelsPassed.length);
    expect(t.all.quizzes).toBe(record.quizzes.length);
    // No summed time for all courses: approximate per-course minutes never rival the time total.
    expect("minutes" in t.all).toBe(false);
    expect(t.subjects.reduce((n, x) => n + x.minutes, 0)).toBe(record.timeBySubject.reduce((n, g) => n + g.minutes, 0));
    for (const sub of t.subjects) {
      expect(sub.mastered).toBe(sub.courses.reduce((n, c) => n + c.mastered, 0));
      expect(sub.minutes).toBe(sub.courses.reduce((n, c) => n + c.minutes, 0));
      for (const c of sub.courses) {
        expect(c.mastered).toBe(record.mastered.filter((m) => m.courseId === c.courseId && !m.earlySign).length);
        expect(c.quizzes).toBe(record.quizzes.filter((q) => q.courseId === c.courseId).length);
      }
    }
    expect(t.subjects.map((x) => x.subject)).toEqual(["Foreign language", "Math", "Science", null]);
    expect(t.subjects.find((x) => x.subject === "Math")!.courses.map((c) => c.courseId).sort()).toEqual(["c", "old"]);
  });

  it("lists the year's totals, the write-in lines and the full disclaimer", () => {
    const record = learningRecord(bigSource(), SCHOOL_YEAR, NOW);
    const c = coverSheet(record, NOW);
    expect(c.fields).toEqual(["Date of birth", "State and homeschool option", "School year"]);
    expect(c.header.kicker).toBe("School-year record");
    expect(c.header.sub).toBe("Grade 3 · Since Aug 1, 2026");
    expect(c.totals.find((x) => x.label === RECORD_COPY.print.cover.mastered)!.value).toBe(String(masteredCount(record)));
    expect(c.totals.find((x) => x.label === RECORD_COPY.print.cover.days)!.value).toBe(`At least ${record.days}`);
    expect(c.withCourses).toBe(true);
    expect(c.disclaimer).toBe(RECORD_DISCLAIMER);
  });

  it("says the per-course time does not add up to the counted total when there is one", () => {
    const withCounted = coverSheet(learningRecord(bigSource(), SCHOOL_YEAR, NOW), NOW);
    expect(withCounted.timeNote).toBe(RECORD_COPY.print.cover.timeNoteCounted);
    expect(coverSheet(learningRecord(emptySource(), SCHOOL_YEAR, NOW), NOW).timeNote).toBe(RECORD_COPY.print.cover.timeNote);
  });

  /** n courses with realistic long titles (41-55 characters), in `subjects` subjects, each with a quiz. */
  function manyCourses(n: number, subjects: number): RecordSource {
    const s = emptySource();
    s.captureSince = oct(1);
    const names = ["Mathematics", "Science", "Social Studies/History", "English/Language Arts", "Arts", "Health/PE", "Foreign language"];
    for (let i = 0; i < n; i++) {
      const title = `Course ${i + 1}: understanding maps, charts and the stories they tell`.slice(0, 41 + (i % 15));
      s.courses.push(course({ id: `c${i}`, title, subject: names[i % subjects] }));
      s.syllabuses.push(syllabus(1, [sub("1.1", `Skill ${i}`)], `c${i}`));
      quiz(s, "1.1", 3, 3, { course_id: `c${i}`, completed_at: nov(2 + (i % 8)) });
    }
    return s;
  }

  it("never runs past the sheet: 14 rows of long titles are measured, and a longer table drops to subject rows", () => {
    // 2 subjects + 12 courses = 14 table rows, titles 41-55 characters.
    const fourteen = coverSheet(learningRecord(manyCourses(12, 2), SCHOOL_YEAR, NOW), NOW);
    expect(fourteen.table.subjects.length + fourteen.table.subjects.reduce((n, x) => n + x.courses.length, 0)).toBe(14);
    expect(fourteen.table.subjects.flatMap((x) => x.courses).every((c) => c.course.length >= 41 && c.course.length <= 55)).toBe(true);
    expect(coverHeightPx(fourteen)).toBeLessThanOrEqual(PAGE1_CONTENT_PX);
    // A table that would not fit lists subjects only, and that fits.
    const thirty = coverSheet(learningRecord(manyCourses(30, 7), SCHOOL_YEAR, NOW), NOW);
    expect(thirty.withCourses).toBe(false);
    expect(coverHeightPx(thirty)).toBeLessThanOrEqual(PAGE1_CONTENT_PX);
    expect(coverHeightPx({ ...thirty, withCourses: true })).toBeGreaterThan(PAGE1_CONTENT_PX);
    // The decision is the measured one, not a row count.
    for (const n of [4, 8, 12, 16, 20, 24]) {
      const c = coverSheet(learningRecord(manyCourses(n, 3), SCHOOL_YEAR, NOW), NOW);
      expect(c.withCourses).toBe(coverHeightPx({ ...c, withCourses: true }) <= PAGE1_CONTENT_PX);
      expect(coverHeightPx(c)).toBeLessThanOrEqual(PAGE1_CONTENT_PX);
    }
  });
});

describe("a record with nothing in it", () => {
  it("prints page 1 alone, and page 1 then points nowhere", () => {
    const empty = learningRecord(emptySource(), NOVEMBER, NOW);
    expect(isEmptyRecord(empty)).toBe(true);
    expect(page1(empty, "teacher", NOW).detail).toBe(false);
    const busy = learningRecord(bigSource(), NOVEMBER, NOW);
    expect(isEmptyRecord(busy)).toBe(false);
    expect(page1(busy, "teacher", NOW).detail).toBe(true);
    // A course with no activity in the period still has a standing to detail.
    const quiet = emptySource();
    quiet.courses = [course()];
    expect(isEmptyRecord(learningRecord(quiet, NOVEMBER, NOW))).toBe(false);
  });
});

describe("print copy", () => {
  it("uses no banned word in the new copy or anything printed from the fixtures", () => {
    const s = bigSource();
    const texts = [...strings(RECORD_COPY.print), ...strings(RECORD_COPY.writeIn)];
    for (const range of [NOVEMBER, SCHOOL_YEAR]) {
      const record = learningRecord(s, range, NOW);
      for (const audience of AUDIENCES) {
        const p = page1(record, audience, NOW);
        texts.push(...strings({ ...p, disclaimer: "" }), ...strings({ ...detailPages(record, audience), disclaimer: "" }));
      }
      texts.push(...strings({ ...coverSheet(record, NOW), disclaimer: "" }));
    }
    for (const text of texts) expect(bannedWordsIn(text), text).toEqual([]);
  });

  it("reads in the singular for a count of one", () => {
    const P = RECORD_COPY.print;
    expect(fill(P.more, { n: 1 })).toBe("+1 more in the detail pages");
    expect(fill(RECORD_COPY.tiles.days, { n: 1 })).toBe("At least 1 day with learning");
    const s = emptySource();
    s.courses = [course()];
    s.syllabuses = [syllabus(1, [sub("1.1", "Greetings"), sub("1.2", "Numbers")])];
    quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
    quiz(s, "1.2", 1, 1, { completed_at: nov(5) });
    s.learnerDays = [{ day: "2026-11-05", minutes: 1 }];
    s.captureSince = oct(1);
    const p = page1(learningRecord(s, NOVEMBER, NOW), "guided", NOW);
    expect(p.tiles.days).toMatchObject({ big: "At least 2", rest: "days with learning" });
    expect(p.tiles.mastered.extra).toBe("Plus 1 early sign (fewer than 3 questions)");
    expect(p.mastered.map((m) => [m.meta, m.early])).toEqual([["Spanish I · Level 1 · Nov 4", false], ["Early sign · Spanish I · Level 1 · Nov 5", true]]);
    expect(p.tiles.time).toMatchObject({ big: "1", rest: "active minute (counted)" });
    expect(saveLabel(learningRecord(s, NOVEMBER, NOW), "guided")).toBe("Save November's record");
  });
});
