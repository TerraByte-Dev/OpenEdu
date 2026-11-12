import { describe, it, expect } from "vitest";
import { learningRecord, type LearningRecord } from "./build";
import { RECORD_COPY, RECORD_DISCLAIMER } from "./copy";
import {
  fileNamePart, recordCsvNames, recordDailyCsv, recordDays, recordEventCsv, recordEvents, SELF_EXPLANATION_MAX, truncate,
} from "./csv";
import type { RecordSource } from "./sources";
import { course, dec, emptySource, local, nov, oct, quiz, sub, syllabus, utc } from "./test-rows";
import { masteredCount } from "./view";

const X = RECORD_COPY.csv;
const NOW = local(2026, 10, 20);
const NOVEMBER = { kind: "month" as const, year: 2026, month: 10 };

/** RFC 4180 back into rows (the files are toCsv's: BOM, CRLF, quoted cells). */
function parse(csv: string): string[][] {
  const text = csv.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  return rows;
}

/** Rows keyed by column name, header and disclaimer row left out. */
function table(csv: string): Array<Record<string, string>> {
  const [head, ...rest] = parse(csv);
  return rest.slice(0, -1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Two courses in November before capture began: quizzes, lessons, tutor, flashcards, notes. */
function busy(): RecordSource {
  const s = emptySource();
  s.courses = [course({ current_level: 1 }), course({ id: "m", title: "Fractions", subject: "Math" })];
  s.syllabuses = [
    syllabus(1, [sub("1.1", "Greetings"), sub("1.2", "Numbers"), sub("1.3", "Verbs")]),
    syllabus(1, [sub("1.1", "Halves")], "m"),
  ];
  quiz(s, "1.1", 3, 3, { completed_at: oct(4) });
  quiz(s, "1.2", 9, 10, { started_at: nov(4, 10), completed_at: nov(4, 10, 12) });
  quiz(s, "1.3", 1, 1, { started_at: nov(6, 9), completed_at: nov(6, 9, 1) }); // an early sign
  quiz(s, "1.1", 2, 4, { course_id: "m", started_at: nov(4, 15), completed_at: nov(4, 15, 6) });
  s.chats = [
    { course_id: "c", thread_id: "t", created_at: nov(4, 10, 20) },
    { course_id: "c", thread_id: "t", created_at: nov(8, 18) },
    { course_id: "m", thread_id: "u", created_at: nov(8, 19) },
  ];
  s.lessons = [{ course_id: "c", level: 1, topic: "Numbers", read_at: nov(9) }, { course_id: "m", level: 1, topic: "Halves", read_at: oct(2) }];
  s.flashcards = [
    { course_id: "c", source: "manual", created_at: nov(9, 12, 30), last_reviewed_at: nov(10) },
    { course_id: "c", source: "missed_question", created_at: nov(9, 12, 31), last_reviewed_at: null },
  ];
  // Late evening local time: still that local day, whatever the UTC date.
  s.notes = [{ course_id: "m", title: "My halves", content: "a half is one of two", created_at: nov(11, 23, 30) }];
  return s;
}

const build = (s: RecordSource, range = NOVEMBER, now = NOW) => learningRecord(s, range, now);

describe("record CSV columns", () => {
  it("writes the daily summary's columns in the spec's order", () => {
    const s = busy();
    const r = build(s);
    expect(parse(recordDailyCsv(r, recordDays(s, r)))[0]).toEqual([
      "date", "course", "subject", "level", "activities", "minutes", "minutes_kind", "skills_mastered", "recorded_by",
    ]);
  });

  it("writes the event log's columns in the spec's order", () => {
    const s = busy();
    const r = build(s);
    expect(parse(recordEventCsv(r, recordEvents(s, r)))[0]).toEqual([
      "date", "time", "course", "level", "activity", "detail", "skill_status_change", "recorded_by",
    ]);
  });
});

describe("the daily summary", () => {
  it("has one row per local day per course, and its totals agree with the record's tiles and counts", () => {
    const s = busy();
    const r = build(s);
    const days = recordDays(s, r);
    expect(new Set(days.filter((d) => d.courseId !== null).map((d) => d.date)).size).toBe(r.days);
    expect(days.flatMap((d) => d.quizzes)).toHaveLength(r.quizzes.length);
    const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((n, d) => n + f(d), 0);
    expect(sum((d) => d.lessons)).toBe(r.activity.lessonsOpened);
    expect(sum((d) => d.tutorMessages)).toBe(r.activity.tutorMessages);
    expect(sum((d) => d.flashcardsMade)).toBe(r.activity.flashcardsMade);
    expect(sum((d) => d.notes)).toBe(s.notes.length);
    expect(sum((d) => d.skillsMastered.length)).toBe(masteredCount(r));
    // Before capture every day is approximate, and each course's days add up to its C4 time.
    expect(days.every((d) => d.minutesKind === "approximate")).toBe(true);
    for (const c of r.timeBySubject.flatMap((g) => g.courses)) {
      expect(sum((d) => (d.courseId === c.courseId ? d.minutes ?? 0 : 0))).toBe(c.minutes);
    }
    expect(r.time.approx!.minutes).toBe(sum((d) => d.minutes ?? 0));
  });

  it("buckets by local day and writes the activities in words", () => {
    const s = busy();
    const r = build(s);
    const rows = table(recordDailyCsv(r, recordDays(s, r)));
    expect(rows.map((x) => `${x.date} ${x.course}`)).toEqual([
      "2026-11-04 Fractions", "2026-11-04 Spanish I", "2026-11-06 Spanish I", "2026-11-08 Fractions", "2026-11-08 Spanish I",
      "2026-11-09 Spanish I", "2026-11-10 Spanish I", "2026-11-11 Fractions",
    ]);
    const nov4 = rows[1];
    expect(nov4).toMatchObject({
      subject: "Foreign language", level: "1", activities: "quiz 9 of 10; 1 message to the tutor", minutes: "12", minutes_kind: "approximate",
      skills_mastered: "Level 1: Numbers",
    });
    expect(rows[5].activities).toBe("1 lesson first opened; 1 flashcard made");
    expect(rows[6].activities).toBe("1 flashcard last reviewed (earlier reviews not stored)");
    expect(rows[7]).toMatchObject({ subject: "Math", activities: "1 note started", minutes: "0" });
    // The early sign on Nov 6 is not a mastered skill.
    expect(rows[2].skills_mastered).toBe("");
  });

  it("puts counted minutes on an All courses row, never split per course or added to approximate time", () => {
    const s = busy();
    s.captureSince = nov(7, 9); // counted from Nov 8
    s.learnerDays = [{ day: "2026-11-08", minutes: 25 }, { day: "2026-11-09", minutes: 12 }, { day: "2026-11-12", minutes: 7 }, { day: "2026-12-01", minutes: 9 }];
    const r = build(s);
    const days = recordDays(s, r);
    const counted = days.filter((d) => d.minutesKind === "counted");
    expect(counted.every((d) => d.courseId === null && d.course === X.allCourses)).toBe(true);
    expect(counted.reduce((n, d) => n + (d.minutes ?? 0), 0)).toBe(r.time.counted!.minutes);
    // A counted day with activity but no stored minute still says 0, counted, and says why.
    expect(counted.map((d) => [d.date, d.minutes])).toEqual([
      ["2026-11-08", 25], ["2026-11-09", 12], ["2026-11-11", 0], ["2026-11-12", 7],
    ]);
    for (const d of days) {
      if (d.date >= "2026-11-08" && d.courseId !== null) expect([d.minutes, d.minutesKind]).toEqual([null, null]);
      if (d.date < "2026-11-08") expect(d.minutesKind).toBe("approximate");
    }
    const rows = table(recordDailyCsv(r, days));
    const nov8 = rows.filter((x) => x.date === "2026-11-08");
    expect(nov8.map((x) => [x.course, x.subject, x.minutes, x.minutes_kind])).toEqual([
      ["Fractions", "Math", "", ""], ["Spanish I", "Foreign language", "", ""], [X.allCourses, "", "25", "counted"],
    ]);
    expect(nov8[2].activities).toBe("");
    const nov11 = rows.find((x) => x.date === "2026-11-11" && x.course === X.allCourses)!;
    expect(nov11).toMatchObject({ minutes: "0", minutes_kind: "counted", activities: X.noCountedMinutes });
    expect(X.noCountedMinutes).toBe("No counted minutes were stored for this day. A minute counts only while a learning screen is open and someone clicked, typed or scrolled in the last 2 minutes.");
    // A counted day with minutes but no activity is in the file, though the days tile does not count it.
    expect(rows.filter((x) => x.date === "2026-11-12").map((x) => x.course)).toEqual([X.allCourses]);
  });

  it("credits a sitting that crosses midnight to the day it started, so a course's days add up to the record", () => {
    const s = busy();
    s.chats.push({ course_id: "m", thread_id: "u", created_at: nov(14, 23, 58) }, { course_id: "m", thread_id: "u", created_at: nov(15, 0, 2) });
    const r = build(s);
    const days = recordDays(s, r).filter((d) => d.courseId === "m");
    expect(days.filter((d) => d.date >= "2026-11-14").map((d) => [d.date, d.minutes])).toEqual([["2026-11-14", 4], ["2026-11-15", 0]]);
    const fractions = r.timeBySubject.flatMap((g) => g.courses).find((c) => c.courseId === "m")!;
    expect(days.reduce((n, d) => n + (d.minutes ?? 0), 0)).toBe(fractions.minutes);
  });

  it("rounds a course's minutes so its days add up exactly to the record's minutes for it", () => {
    const s = emptySource();
    s.courses = [course()];
    // Three days with one 80-second sitting each: 240 seconds, which the record rounds to 4 minutes.
    for (const d of [2, 3, 4]) {
      const t = local(2026, 10, d, 10);
      s.chats.push({ course_id: "c", thread_id: "t", created_at: utc(t) }, { course_id: "c", thread_id: "t", created_at: utc(new Date(t.getTime() + 80_000)) });
    }
    const r = build(s);
    expect(r.timeBySubject[0].courses[0].minutes).toBe(4);
    expect(recordDays(s, r).map((d) => [d.date, d.minutes])).toEqual([["2026-11-02", 2], ["2026-11-03", 1], ["2026-11-04", 1]]);
  });

  it("credits a quiz that crossed midnight with nothing answered on its start day to the day it finished", () => {
    const s = busy();
    // No answered row: its start is not activity, so Nov 14 has nothing to show and gets no row.
    s.attempts.push({
      id: "late", course_id: "c", quiz_type: "quiz", level: 1, score: 0, total_questions: 2, correct_count: 0, time_taken_seconds: null,
      started_at: nov(14, 23, 58), completed_at: nov(15, 0, 3), passed: null,
    });
    const r = build(s);
    const rows = table(recordDailyCsv(r, recordDays(s, r)));
    expect(rows.some((x) => x.date === "2026-11-14")).toBe(false);
    expect(rows.find((x) => x.date === "2026-11-15")).toMatchObject({ activities: "quiz 0 of 2", minutes: "4", minutes_kind: "approximate" });
    expect(rows.every((x) => x.activities !== "")).toBe(true);
    expect(new Set(rows.map((x) => x.date)).size).toBe(r.days);
  });

  it("shows a quiz started before midnight and finished after it on both days, so the file's dates are the days tile", () => {
    const s = busy();
    quiz(s, "1.1", 1, 2, { started_at: nov(14, 23, 58), completed_at: nov(15, 0, 3) });
    const r = build(s);
    const rows = table(recordDailyCsv(r, recordDays(s, r)));
    expect(rows.find((x) => x.date === "2026-11-14")).toMatchObject({ activities: "quiz started, finished on a later day", minutes: "4" });
    expect(rows.find((x) => x.date === "2026-11-15")).toMatchObject({ activities: "quiz 1 of 2", minutes: "0" });
    expect(new Set(rows.map((x) => x.date)).size).toBe(r.days);
  });

  it("keeps approximate time that crosses into the first counted day on the day it started", () => {
    const s = busy();
    s.captureSince = nov(14, 9); // counted from Nov 15
    // Nothing answered, so Nov 14 has no activity of its own; the sitting runs 23:58 to 00:02.
    s.attempts.push({
      id: "late", course_id: "c", quiz_type: "quiz", level: 1, score: 0, total_questions: 2, correct_count: 0, time_taken_seconds: null,
      started_at: nov(14, 23, 58), completed_at: nov(15, 0, 3), passed: null,
    });
    const r = build(s);
    const days = recordDays(s, r);
    expect(days.find((d) => d.date === "2026-11-14" && d.courseId === "c")).toMatchObject({ minutes: 4, minutesKind: "approximate" });
    expect(days.find((d) => d.date === "2026-11-15" && d.courseId === "c")).toMatchObject({ minutes: null, minutesKind: null });
    const spanish = r.timeBySubject.flatMap((g) => g.courses).find((c) => c.courseId === "c")!;
    expect(days.filter((d) => d.courseId === "c").reduce((n, d) => n + (d.minutes ?? 0), 0)).toBe(spanish.minutes);
  });

  it("marks every row as worked out from stored rows on the export date", () => {
    const s = busy();
    const r = build(s);
    const rows = table(recordDailyCsv(r, recordDays(s, r)));
    expect(new Set(rows.map((x) => x.recorded_by))).toEqual(new Set(["worked out from stored rows on 2026-11-20"]));
  });
});

describe("the event log", () => {
  it("dates raw rows as stored and status changes as worked out", () => {
    const s = busy();
    const r = build(s);
    const rows = table(recordEventCsv(r, recordEvents(s, r)));
    const by = (activity: string) => rows.filter((x) => x.activity === activity);
    for (const a of ["quiz", "lesson first opened", "tutor message", "flashcard made", "flashcard reviewed", "note started"]) {
      expect(by(a).length, a).toBeGreaterThan(0);
      for (const x of by(a)) expect(x.recorded_by).toBe("stored when it happened");
    }
    const status = by("skill status change");
    expect(status.map((x) => x.skill_status_change)).toEqual(["Mastered (quiz-checked)", "Early sign"]);
    for (const x of status) expect(x.recorded_by).toBe("worked out from stored rows on 2026-11-20");
    expect(status[0]).toMatchObject({ date: "2026-11-04", time: "10:12", level: "1" });
    expect(status[0].detail).toMatch(/^Numbers · 9 of 10 right · quiz/);
  });

  it("gives a tutor message no text at all", () => {
    const s = busy();
    // Even if a row ever carried the message, it never reaches the file.
    s.chats = s.chats.map((m) => ({ ...m, content: "my secret message" }) as typeof m);
    const r = build(s);
    const csv = recordEventCsv(r, recordEvents(s, r));
    expect(csv).not.toContain("secret");
    const tutor = table(csv).filter((x) => x.activity === "tutor message");
    expect(tutor).toHaveLength(3);
    for (const x of tutor) expect([x.detail, x.level, x.skill_status_change]).toEqual(["", "", ""]);
  });

  it("cuts a self-explanation to 500 characters", () => {
    const s = busy();
    const long = "because ".repeat(100).trim();
    quiz(s, "1.1", 1, 1, { started_at: nov(16), completed_at: nov(16, 12, 5) }, { self_explanation: long });
    quiz(s, "1.2", 1, 1, { started_at: nov(17), completed_at: nov(17, 12, 5) }, { self_explanation: "short and whole" });
    const r = build(s);
    const said = table(recordEventCsv(r, recordEvents(s, r))).filter((x) => x.activity === "self-explanation");
    expect(said.map((x) => x.detail.slice(0, 13))).toEqual(["On Greetings:", "On Numbers: s"]);
    const cut = said[0].detail.slice("On Greetings: ".length);
    expect(Array.from(cut)).toHaveLength(SELF_EXPLANATION_MAX);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(said[1].detail).toBe("On Numbers: short and whole");
    expect(truncate("ab😀cd", 4)).toBe("ab😀…");
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("says a level test passed, and logs only the learner's own flashcards", () => {
    const s = busy();
    quiz(s, "1.1", 9, 10, { quiz_type: "promotion", level: 1, passed: 1, completed_at: nov(18), time_taken_seconds: 600 });
    const r = build(s);
    const rows = table(recordEventCsv(r, recordEvents(s, r)));
    expect(rows.find((x) => x.activity === "level test")!.detail).toBe("9 of 10 right (90%), passed");
    // A level test that stored fewer rows than its questions says so, in one piece the "; " list keeps whole.
    quiz(s, "1.2", 3, 4, { quiz_type: "promotion", level: 1, passed: 0, total_questions: 10, correct_count: 3, score: 30, completed_at: nov(19), time_taken_seconds: 900 });
    const r2 = build(s);
    expect(table(recordEventCsv(r2, recordEvents(s, r2))).filter((x) => x.activity === "level test").map((x) => x.detail)).toEqual([
      "9 of 10 right (90%), passed", "3 of 10 right (30%), not passed (timed out, unanswered questions not stored)",
    ]);
    expect(table(recordDailyCsv(r2, recordDays(s, r2))).find((x) => x.date === "2026-11-19")!.activities)
      .toBe("level test 3 of 10, not passed (timed out, unanswered questions not stored)");
    expect(rows.filter((x) => x.activity === "flashcard made").map((x) => x.detail)).toEqual([""]);
  });
});

describe("both files", () => {
  const fixture = (): [RecordSource, LearningRecord] => {
    const s = busy();
    s.courses[0] = { ...s.courses[0], title: "=HYPERLINK(\"http://x\",\"click\")" };
    s.notes[0] = { ...s.notes[0], title: "@SUM(A1)" };
    s.lessons[0] = { ...s.lessons[0], topic: "+1+1" };
    return [s, build(s)];
  };

  it("defuses titles that start with = + - @, so a spreadsheet shows them as text", () => {
    const [s, r] = fixture();
    const daily = recordDailyCsv(r, recordDays(s, r));
    const events = recordEventCsv(r, recordEvents(s, r));
    for (const csv of [daily, events]) {
      expect(csv).toContain("'=HYPERLINK(");
      expect(csv).not.toMatch(/(^|,|")=HYPERLINK/m);
    }
    expect(table(events).map((x) => x.detail)).toEqual(expect.arrayContaining(["'@SUM(A1)", "'+1+1"]));
  });

  it("ends with the disclaimer, in the widest text column, and only there", () => {
    const [s, r] = fixture();
    const cases: Array<[string, string]> = [
      [recordDailyCsv(r, recordDays(s, r)), "activities"],
      [recordEventCsv(r, recordEvents(s, r)), "detail"],
    ];
    for (const [csv, column] of cases) {
      const rows = parse(csv);
      const last = rows[rows.length - 1];
      const at = rows[0].indexOf(column);
      expect(last[at]).toBe(column === "activities" ? `${RECORD_DISCLAIMER} ${X.statementFile} ${X.timeNote}` : `${RECORD_DISCLAIMER} ${X.statementFile}`);
      expect(last.filter((c, i) => i !== at && c !== "")).toEqual([]);
      expect(last).toHaveLength(rows[0].length);
      expect(rows.flat().filter((c) => c.includes(RECORD_DISCLAIMER))).toHaveLength(1);
      // The app's third sentence ("no way to add rows") is not a claim the file makes.
      expect(csv).not.toContain(X.statementApp);
    }
  });

  it("still has its header and disclaimer for a quiet month", () => {
    const s = busy();
    const r = build(s, { kind: "month", year: 2026, month: 11 }, local(2026, 11, 20));
    expect(recordDays(s, r)).toEqual([]);
    expect(parse(recordEventCsv(r, recordEvents(s, r)))).toHaveLength(2);
    expect(parse(recordDailyCsv(r, recordDays(s, r)))).toHaveLength(2);
  });

  it("covers only the record's range: a December row stays out of November", () => {
    const s = busy();
    s.chats.push({ course_id: "c", thread_id: "t", created_at: dec(1, 0, 5) });
    s.chats.push({ course_id: "c", thread_id: "t", created_at: utc(local(2026, 10, 30, 23, 59)) });
    const r = build(s);
    expect(recordEvents(s, r).filter((e) => e.activity === "tutor").map((e) => e.at)).toHaveLength(4);
    const days = recordDays(s, r);
    expect(days[days.length - 1].date).toBe("2026-11-30");
  });
});

describe("file names", () => {
  it("names the files after the learner and the month", () => {
    const s = busy();
    expect(recordCsvNames(build(s))).toEqual({ daily: "openedu-record-maya-2026-11.csv", events: "openedu-record-maya-2026-11-events.csv" });
    expect(recordCsvNames(build(s, { kind: "since", from: "2026-08-01" } as never)).daily).toBe("openedu-record-maya-since-2026-08-01.csv");
  });

  it("keeps a learner's name safe for a file name, in any script", () => {
    expect(fileNamePart("Mary-Kate O'Neil")).toBe("mary-kate-o-neil");
    expect(fileNamePart("../../etc/passwd")).toBe("etc-passwd");
    expect(fileNamePart("José Ñúñez")).toBe("josé-ñúñez");
    expect(fileNamePart("小明")).toBe("小明");
    // Combining marks are part of the name: Devanagari vowel signs and the virama stay with their letters.
    expect(fileNamePart("आर्या")).toBe("आर्या");
    expect(fileNamePart("Ārya Sharma")).toBe("ārya-sharma");
    expect(fileNamePart("  :*?  ")).toBe("learner");
    expect(fileNamePart("a".repeat(60))).toHaveLength(40);
  });
});
