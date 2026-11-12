import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Migration 19 (saved monthly records, #258 PR 5) and the launch's saveEndedMonths, run for real: the
// migrations parsed out of lib.rs and the real db.ts functions against an in-memory SQLite (node:sqlite),
// through the same stand-in for tauri-plugin-sql that db-record.test.ts uses.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;

const bind = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string, params: unknown[] = []) => sqlite.prepare(bind(sql)).all(...params),
      execute: async (sql: string, params: unknown[] = []) => { sqlite.prepare(bind(sql)).run(...params); },
    }),
  },
}));
vi.mock("./llm", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import {
  setActiveLearnerId, createLearner, deleteLearner, createCourse, deleteCourse, createNote, createQuizAttempt, saveQuizQuestion,
  completeQuizAttempt, saveSyllabus, saveEndedMonths, saveMonthlyRecord, getRecordSource, getLearnerRecordSource,
} from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { shownRecord, snapshotOf } from "./record/saved";

function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

async function openDb(): Promise<void> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = await import(/* @vite-ignore */ spec);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;"); // sqlx enables FKs; match it
}

function migrate(upTo: number, from = 1): void {
  const all = migrations();
  for (let v = from; v <= upTo; v++) {
    const sql = all.get(v);
    if (!sql) throw new Error(`migration ${v} not found in lib.rs`);
    sqlite.exec(sql);
  }
}

const rows = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];

/** The month the rows below are stamped in (datetime('now')), and a "today" a month later, when it has ended. */
const today = new Date();
const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
const monthAfter = new Date(today.getFullYear(), today.getMonth() + 2, 15);
/** Stamp every saved row as saved on `nextMonth`, as sqlite's own clock would have, had it read that date. */
const stamp = () => sqlite.exec(`UPDATE monthly_records SET saved_at = '${nextMonth.toISOString().slice(0, 19).replace("T", " ")}'`);

/** A course with one mastered skill (9 of 10), a missed question with the learner's own words, and a note. */
async function seed(prefix: string): Promise<string> {
  const c = await createCourse(`${prefix} course`, "topic");
  await saveSyllabus({
    course_id: c.id, level: 1, title: "Level 1", description: "", learning_objectives: [], assessment_criteria: [], estimated_hours: 1,
    subtopics: [{ id: "1.1", title: `${prefix} skill`, key_concepts: [], practice_type: "recall", mastered: false }],
  });
  const a = await createQuizAttempt(c.id, "quiz", 1, 10);
  for (let i = 0; i < 10; i++) {
    await saveQuizQuestion({
      attempt_id: a.id, question_text: i === 9 ? `${prefix} QTEXT` : `${prefix} q${i}`, question_type: "multiple_choice" as const, options: null,
      correct_answer: "A", user_answer: i === 9 ? `${prefix} ANSWER` : "A", is_correct: i < 9, difficulty_level: 1, explanation: "", subtopic_id: "1.1",
      ...(i === 9 ? { self_explanation: `${prefix} OWN WORDS` } : {}),
    }, "key");
  }
  await completeQuizAttempt(a.id, 90, 9, 60);
  await createNote(c.id, `${prefix} NOTE TITLE`, `${prefix} NOTE BODY`, 1, null, "learner");
  return c.id;
}

describe("migration 19 on an existing install", () => {
  it("migrates a seeded v18 database to v19 without touching its rows", async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(18);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('c1', 'Algebra', 'algebra', 2, '${DEFAULT_LEARNER_ID}');`);
    sqlite.exec(`INSERT INTO quiz_attempts (id, course_id, quiz_type, level, total_questions, passed) VALUES ('a1', 'c1', 'promotion', 1, 1, 1);`);
    sqlite.exec(`INSERT INTO learner_days (learner_id, day, minutes) VALUES ('${DEFAULT_LEARNER_ID}', '2026-10-02', 7);`);
    migrate(19, 19);
    expect(rows<{ passed: number }>("SELECT passed FROM quiz_attempts WHERE id = 'a1'")).toEqual([{ passed: 1 }]);
    expect(rows<{ minutes: number }>("SELECT minutes FROM learner_days")).toEqual([{ minutes: 7 }]);
    expect(rows("SELECT * FROM monthly_records")).toEqual([]);
    sqlite.exec(`INSERT INTO monthly_records (learner_id, month, format, body_json) VALUES ('${DEFAULT_LEARNER_ID}', '2026-10', 1, '{}');`);
    expect(rows<{ saved_at: string }>("SELECT saved_at FROM monthly_records")[0].saved_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    // One saved copy per learner per month.
    expect(() => sqlite.exec(`INSERT INTO monthly_records (learner_id, month, format, body_json) VALUES ('${DEFAULT_LEARNER_ID}', '2026-10', 1, '{}');`)).toThrow();
    // The SQL stays free of double quotes, which the lib.rs string literal and this parser rely on.
    expect(migrations().get(19)).not.toContain('"');
  });
});

describe("saved months", () => {
  let other: string;
  let mine: string;

  beforeEach(async () => {
    await openDb();
    migrate(migrations().size);
    const b = await createLearner("Bilal");
    other = b.id;
    setActiveLearnerId(other);
    await seed("B");
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    mine = await seed("A");
  });

  it("saves every learner's ended month once, and never the current month", async () => {
    expect(await saveEndedMonths(today)).toBe(0); // this month has not ended
    expect(rows("SELECT * FROM monthly_records")).toEqual([]);

    expect(await saveEndedMonths(nextMonth)).toBe(2);
    stamp(); // sqlite stamped saved_at with the real clock; this test's clock is a month on
    const saved = rows<{ learner_id: string; month: string; format: number }>("SELECT learner_id, month, format FROM monthly_records ORDER BY learner_id");
    expect(saved).toEqual([
      { learner_id: other, month: thisMonth, format: 1 },
      { learner_id: DEFAULT_LEARNER_ID, month: thisMonth, format: 1 },
    ].sort((a, b) => a.learner_id.localeCompare(b.learner_id)));
    const before = rows<{ body_json: string; saved_at: string }>("SELECT body_json, saved_at FROM monthly_records ORDER BY learner_id");

    // A second launch the same month reads nothing and rewrites nothing.
    expect(await saveEndedMonths(nextMonth)).toBe(0);
    // Nor does a later month: the saved one is kept as it is, and there is no new activity to save.
    sqlite.exec("DELETE FROM app_config WHERE key = 'record_saved_through'");
    expect(await saveEndedMonths(monthAfter)).toBe(0);
    expect(rows("SELECT body_json, saved_at FROM monthly_records ORDER BY learner_id")).toEqual(before);
  });

  it("keeps no learner words or question pairs in the saved body", async () => {
    await saveEndedMonths(nextMonth);
    for (const { body_json } of rows<{ body_json: string }>("SELECT body_json FROM monthly_records")) {
      for (const text of ["QTEXT", "ANSWER", "OWN WORDS", "NOTE TITLE", "NOTE BODY"]) expect(body_json).not.toContain(text);
      expect(body_json).toContain("skill"); // titles are kept
    }
  });

  it("keeps a saved month through a course's deletion, minus the learner's words, and drops it with the learner", async () => {
    await saveEndedMonths(nextMonth);
    stamp(); // sqlite stamped saved_at with the real clock; this test's clock is a month on
    const range = { kind: "month" as const, year: today.getFullYear(), month: today.getMonth() };
    const before = shownRecord((await getRecordSource())!, range, nextMonth);
    expect(before.mastered.map((m) => m.skill)).toEqual(["A skill"]);
    expect(before.ownWords.map((w) => w.text).sort()).toEqual(["A NOTE BODY", "A OWN WORDS"]);

    await deleteCourse(mine);
    expect(rows("SELECT month FROM monthly_records WHERE learner_id = ?", DEFAULT_LEARNER_ID)).toEqual([{ month: thisMonth }]);
    const src = (await getRecordSource())!;
    expect(src.courses).toEqual([]);
    const after = shownRecord(src, range, nextMonth);
    expect(after.mastered.map((m) => [m.course, m.skill])).toEqual([["A course", "A skill"]]);
    expect(after.quizzes).toHaveLength(1);
    expect(after.ownWords).toEqual([]);
    expect(after.saved?.examplesGone).toBe(true);
    expect(JSON.stringify(after)).not.toContain("OWN WORDS");

    // The teacher's path reads another learner's saved months too; deleting that learner deletes them.
    expect((await getLearnerRecordSource(other))!.savedMonths.map((m) => m.month)).toEqual([thisMonth]);
    await deleteLearner(other);
    expect(rows("SELECT * FROM monthly_records WHERE learner_id = ?", other)).toEqual([]);
    expect(rows("SELECT month FROM monthly_records WHERE learner_id = ?", DEFAULT_LEARNER_ID)).toEqual([{ month: thisMonth }]);
  });

  it("leaves every saved month byte-identical through a launch with the clock years back", async () => {
    expect(await saveEndedMonths(nextMonth)).toBe(2);
    stamp(); // sqlite stamped saved_at with the real clock; this test's clock is a month on
    await deleteCourse(mine); // a course deleted since: its months can never be rebuilt with it
    const before = rows("SELECT * FROM monthly_records ORDER BY learner_id, month");
    // A dead clock battery: the machine thinks it is January 2020, and then a year back.
    expect(await saveEndedMonths(new Date(2020, 0, 5))).toBe(0);
    expect(await saveEndedMonths(new Date(today.getFullYear() - 1, today.getMonth(), 15))).toBe(0);
    expect(rows("SELECT * FROM monthly_records ORDER BY learner_id, month")).toEqual(before);
    // The clock fixed: the launch runs (the marker does not match) and still rewrites nothing.
    expect(await saveEndedMonths(nextMonth)).toBe(0);
    expect(rows("SELECT * FROM monthly_records ORDER BY learner_id, month")).toEqual(before);
  });

  it("heals a copy saved while the clock was ahead once newer activity turns up, and a marker set ahead cannot switch saving off", async () => {
    const range = { kind: "month" as const, year: today.getFullYear(), month: today.getMonth() };
    // The clock read next month for one launch: this month was saved (stamped by that clock) and the marker moved to it.
    expect(await saveEndedMonths(nextMonth)).toBe(2);
    stamp();
    expect(rows<{ value: string }>("SELECT value FROM app_config WHERE key = 'record_saved_through'")).toEqual([{ value: thisMonth }]);
    // Back to the real date: this month is the current one, shown live; the copy is hidden, never deleted.
    expect(shownRecord((await getRecordSource())!, range, today).saved).toBeNull();
    await saveEndedMonths(today);
    expect(rows("SELECT * FROM monthly_records")).toHaveLength(2);
    // The learner keeps going this month, after the copy was made.
    const later = new Date(Math.min(Date.now() + 5000, new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime() - 1000));
    const a = await createQuizAttempt(mine, "quiz", 1, 1);
    sqlite.exec(`UPDATE quiz_attempts SET started_at = '${later.toISOString().slice(0, 19).replace("T", " ")}', completed_at = '${later.toISOString().slice(0, 19).replace("T", " ")}' WHERE id = '${a.id}'`);
    const frozen = rows<{ body_json: string }>("SELECT body_json FROM monthly_records WHERE learner_id = ?", DEFAULT_LEARNER_ID)[0].body_json;
    // When the month really ends, the launch replaces that learner's copy, and only that one.
    expect(await saveEndedMonths(nextMonth)).toBe(1);
    expect(rows<{ body_json: string }>("SELECT body_json FROM monthly_records WHERE learner_id = ?", DEFAULT_LEARNER_ID)[0].body_json).not.toBe(frozen);
    // A marker far ahead does not stop a launch either.
    sqlite.exec("DELETE FROM monthly_records; UPDATE app_config SET value = '2099-12' WHERE key = 'record_saved_through';");
    expect(await saveEndedMonths(nextMonth)).toBe(2);
  });

  it("saves every other learner when one fails, and tries again at the next launch", async () => {
    // The first learner listed has a syllabus that cannot be read.
    sqlite.exec(`UPDATE syllabuses SET subtopics = '{not json' WHERE course_id = '${mine}'`);
    expect(await saveEndedMonths(nextMonth)).toBe(1);
    stamp(); // sqlite stamped saved_at with the real clock; this test's clock is a month on
    expect(rows<{ learner_id: string }>("SELECT learner_id FROM monthly_records")).toEqual([{ learner_id: other }]);
    expect(rows("SELECT value FROM app_config WHERE key = 'record_saved_through'")).toEqual([]);
    sqlite.exec(`UPDATE syllabuses SET subtopics = '[]' WHERE course_id = '${mine}'`);
    expect(await saveEndedMonths(nextMonth)).toBe(1);
    expect(rows("SELECT learner_id FROM monthly_records")).toHaveLength(2);
    expect(rows<{ value: string }>("SELECT value FROM app_config WHERE key = 'record_saved_through'")).toEqual([{ value: thisMonth }]);
  });

  it("keeps a month saved first unless asked to replace it (Rebuild from current data)", async () => {
    const src = (await getRecordSource())!;
    const range = { kind: "month" as const, year: today.getFullYear(), month: today.getMonth() };
    const first = await saveMonthlyRecord(DEFAULT_LEARNER_ID, snapshotOf(src, range, nextMonth)!);
    await deleteCourse(mine);
    const rebuilt = snapshotOf((await getRecordSource())!, range, nextMonth)!;
    expect(await saveMonthlyRecord(DEFAULT_LEARNER_ID, rebuilt)).toEqual(first);
    const replaced = await saveMonthlyRecord(DEFAULT_LEARNER_ID, rebuilt, true);
    expect(replaced.body_json).toBe(rebuilt.body_json);
    expect(replaced.body_json).not.toBe(first.body_json);
    expect(rows("SELECT month FROM monthly_records WHERE learner_id = ?", DEFAULT_LEARNER_ID)).toHaveLength(1);
  });
});
