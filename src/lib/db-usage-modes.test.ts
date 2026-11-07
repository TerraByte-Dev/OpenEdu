import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Runs the REAL migrations (parsed out of src-tauri/src/lib.rs) and the REAL db.ts functions against
// an in-memory SQLite (node:sqlite), the same harness as db-learners.test.ts: migration 14 on an
// install that already has learners, courses and notes, then the mode, teacher PIN, groups and the
// teacher overview through the code paths the app calls.

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

import {
  getCourses, createCourse, createNote, getNotes, listLearners, createLearner, setActiveLearnerId,
  getUsageConfig, setUsageMode, listGroups, createGroup, renameGroup, deleteGroup, setLearnerGroup,
  getTeacherOverviewSource,
} from "./db";
import { DEFAULT_LEARNER_ID } from "./learners";
import { hashPin, verifyPin } from "./learner-pin";
import { resolveStartupMode, hasPriorUse, pickerGroups, learnersInGroup, NO_GROUP } from "./usage-modes";
import { buildOverviewRows, filterOverviewRows } from "./teacher-overview";

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

const count = (sql: string) => (sqlite.prepare(sql).all()[0] as { n: number }).n;

describe("migration 14 on an install already in use", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(12);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level) VALUES ('c1', 'Algebra', 'algebra', 2.0);`);
    sqlite.exec(`INSERT INTO notes (id, course_id, title, content) VALUES ('n1', 'c1', 'My note', 'x = 2');`);
    sqlite.exec(`INSERT INTO syllabuses (id, course_id, level, title, subtopics) VALUES ('s1', 'c1', 1, 'L1', '[{"id":"1.1","mastered":true},{"id":"1.2","mastered":false}]');`);
    migrate(13, 13);
    migrate(14, 14);
  });

  it("starts as Just me without asking, with no teacher PIN", async () => {
    const cfg = await getUsageConfig();
    expect(cfg.mode).toBe("single");
    expect(cfg.teacher).toEqual({ pin_hash: null, pin_salt: null });
    expect(resolveStartupMode(cfg.mode, false)).toBe("single");
  });

  it("keeps every learner, course and note, with nobody in a group", async () => {
    const learners = await listLearners();
    expect(learners.map((l) => [l.id, l.group_id])).toEqual([[DEFAULT_LEARNER_ID, null]]);
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    expect((await getCourses()).map((c) => c.id)).toEqual(["c1"]);
    expect((await getNotes("c1")).map((n) => n.id)).toEqual(["n1"]);
  });

  it("a class sets a teacher PIN that verifies; back to Just me drops it and deletes no one's data", async () => {
    const bilal = await createLearner("Bilal");
    setActiveLearnerId(bilal.id);
    const chem = await createCourse("Chemistry", "chemistry");
    await createNote(chem.id, "Bonds", "covalent", 1);

    await setUsageMode("class", await hashPin("2468"));
    let cfg = await getUsageConfig();
    expect(cfg.mode).toBe("class");
    expect(await verifyPin("2468", cfg.teacher)).toBe(true);
    expect(await verifyPin("1357", cfg.teacher)).toBe(false);

    // Class to school keeps the same teacher PIN (undefined = leave it alone).
    await setUsageMode("school");
    cfg = await getUsageConfig();
    expect(cfg.mode).toBe("school");
    expect(await verifyPin("2468", cfg.teacher)).toBe(true);

    await setUsageMode("single", null);
    cfg = await getUsageConfig();
    expect(cfg.mode).toBe("single");
    expect(cfg.teacher).toEqual({ pin_hash: null, pin_salt: null });
    expect(count("SELECT COUNT(*) AS n FROM learners")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM courses")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM notes")).toBe(2);
  });

  it("groups: learners join them, the picker buckets them, and deleting a group keeps its learners", async () => {
    const g5 = await createGroup("Grade 5");
    const g6 = await createGroup("Grade 6");
    const amina = await createLearner("Amina", g5.id);
    const bilal = await createLearner("Bilal");
    await setLearnerGroup(bilal.id, g6.id);
    await renameGroup(g6.id, "Grade 6B");

    let groups = await listGroups();
    let learners = await listLearners();
    expect(groups.map((g) => g.name)).toEqual(["Grade 5", "Grade 6B"]);
    expect(pickerGroups(groups, learners).map((b) => [b.name, b.count])).toEqual([
      ["Grade 5", 1], ["Grade 6B", 1], ["Everyone else", 1],
    ]);
    expect(learnersInGroup(learners, g5.id, groups).map((l) => l.id)).toEqual([amina.id]);

    setActiveLearnerId(amina.id);
    const course = await createCourse("Geometry", "geometry");
    await deleteGroup(g5.id);

    groups = await listGroups();
    learners = await listLearners();
    expect(groups.map((g) => g.id)).toEqual([g6.id]);
    expect(learners.find((l) => l.id === amina.id)!.group_id).toBeNull();
    expect(learnersInGroup(learners, NO_GROUP, groups).map((l) => l.id).sort()).toEqual([DEFAULT_LEARNER_ID, amina.id].sort());
    expect((await getCourses()).map((c) => c.id)).toEqual([course.id]);
  });

  it("an unknown group id is refused by the foreign key", async () => {
    await expect(createLearner("Ghost", "no-such-group")).rejects.toThrow();
  });

  it("the teacher overview reads every learner's courses while the course list stays scoped", async () => {
    const g = await createGroup("Grade 5");
    const amina = await createLearner("Amina", g.id);
    setActiveLearnerId(amina.id);
    await createCourse("Geometry", "geometry");
    expect((await getCourses()).map((c) => c.title)).toEqual(["Geometry"]);

    const rows = buildOverviewRows(await getTeacherOverviewSource());
    expect(rows.map((r) => [r.groupName, r.learnerName, r.courseTitle, r.mastered, r.subtopics])).toEqual([
      ["", "Learner 1", "Algebra", 1, 2],
      ["Grade 5", "Amina", "Geometry", 0, 0],
    ]);
    expect(filterOverviewRows(rows, g.id).map((r) => r.learnerName)).toEqual(["Amina"]);
    expect(filterOverviewRows(rows, NO_GROUP).map((r) => r.learnerName)).toEqual(["Learner 1"]);
  });
});

describe("migration 14 on a fresh install", () => {
  it("stores no mode, so the app asks who uses this computer", async () => {
    await openDb();
    migrate(14);
    const cfg = await getUsageConfig();
    expect(cfg.mode).toBeNull();
    expect(resolveStartupMode(cfg.mode, hasPriorUse(await listLearners(), false))).toBeNull();
  });

  it("an install with no courses but a finished tour still starts as Just me", async () => {
    await openDb();
    migrate(14);
    const cfg = await getUsageConfig();
    expect(resolveStartupMode(cfg.mode, hasPriorUse(await listLearners(), true))).toBe("single");
  });
});
