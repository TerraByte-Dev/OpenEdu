import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Runs the REAL migrations (parsed out of src-tauri/src/lib.rs) and the REAL db.ts functions against
// an in-memory SQLite (node:sqlite), through a stand-in for tauri-plugin-sql's Database. This is the
// path production takes: migration 13 on an existing install, then the course-list filter and the
// getCourse guard in db.ts.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};
let sqlite: Sqlite;

// tauri-plugin-sql binds $1, $2…; SQLite's numbered form is ?1, ?2….
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
  getCourses, getCourse, createCourse, createNote, getNotes, deleteLearner,
  listLearners, createLearner, setActiveLearnerId, setLearnerGrade,
} from "./db";
import { needsPicker, DEFAULT_LEARNER_ID } from "./learners";
import { normalizeGrade, readingLevelLayer } from "./grade";

// Every `Migration { version: N, description: "...", sql: "..." }` in lib.rs, Rust escapes undone.
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

describe("migration 13 on an existing install", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(12);
    sqlite.exec(`INSERT INTO courses (id, title, topic, current_level) VALUES ('c1', 'Algebra', 'algebra', 1.0), ('c2', 'Biology', 'biology', 2.0);`);
    sqlite.exec(`INSERT INTO notes (id, course_id, title, content) VALUES ('n1', 'c1', 'My note', 'x = 2');`);
    migrate(15, 13); // the app runs every migration; 14 adds group_id and 15 grade, which createLearner writes
  });

  it("creates one default learner with no PIN, so no picker appears", async () => {
    const learners = await listLearners();
    expect(learners.map((l) => l.id)).toEqual([DEFAULT_LEARNER_ID]);
    expect(learners[0].pin_hash).toBeNull();
    expect(needsPicker(learners)).toBe(false);
  });

  it("gives every existing course, and so everything under it, to that learner", async () => {
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    expect((await getCourses()).map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(await getCourse("c1")).not.toBeNull();
    expect((await getNotes("c1")).map((n) => n.id)).toEqual(["n1"]);
  });

  it("a second learner sees none of it and cannot open it by id", async () => {
    const b = await createLearner("Bilal");
    setActiveLearnerId(b.id);
    expect(await getCourses()).toEqual([]);
    expect(await getCourse("c1")).toBeNull();
  });

  it("a new course belongs to whoever created it, and only they see it", async () => {
    const b = await createLearner("Bilal");
    setActiveLearnerId(b.id);
    const mine = await createCourse("Chemistry", "chemistry");
    expect(mine.learner_id).toBe(b.id);
    expect((await getCourses()).map((c) => c.id)).toEqual([mine.id]);

    setActiveLearnerId(DEFAULT_LEARNER_ID);
    expect(await getCourse(mine.id)).toBeNull();
    expect((await getCourses()).map((c) => c.id)).not.toContain(mine.id);
  });

  it("with no learner active (picker up) nothing is listed, opened or created", async () => {
    setActiveLearnerId(null);
    expect(await getCourses()).toEqual([]);
    expect(await getCourse("c1")).toBeNull();
    await expect(createCourse("X", "x")).rejects.toThrow();
  });

  it("deleting a learner deletes their courses and what hangs off them, and nobody else's", async () => {
    const b = await createLearner("Bilal");
    setActiveLearnerId(b.id);
    const course = await createCourse("Chemistry", "chemistry");
    await createNote(course.id, "Bonds", "covalent", 1);
    await deleteLearner(b.id);

    const count = (sql: string) => (sqlite.prepare(sql).all()[0] as { n: number }).n;
    expect(count(`SELECT COUNT(*) AS n FROM courses WHERE id = '${course.id}'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM notes WHERE course_id = '${course.id}'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM learners WHERE id = '${b.id}'`)).toBe(0);

    setActiveLearnerId(DEFAULT_LEARNER_ID);
    expect((await getCourses()).map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect((await getNotes("c1")).length).toBe(1);
  });
});

describe("migration 13 on a fresh install", () => {
  it("still makes exactly one default learner and no picker", async () => {
    await openDb();
    migrate(15);
    const learners = await listLearners();
    expect(learners.map((l) => l.id)).toEqual([DEFAULT_LEARNER_ID]);
    expect(needsPicker(learners)).toBe(false);
  });
});

describe("migration 15: a grade on each learner", () => {
  beforeEach(async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(14);
    sqlite.exec(`INSERT INTO learners (id, name, created_at) VALUES ('ana', 'Ana', datetime('now'));`);
    migrate(15, 15);
  });

  it("leaves every existing learner with no grade, so their tutor prompt is unchanged", async () => {
    const learners = await listLearners();
    expect(learners.map((l) => l.id)).toEqual([DEFAULT_LEARNER_ID, "ana"]);
    for (const l of learners) {
      expect(l.grade).toBeNull();
      expect(readingLevelLayer(normalizeGrade(l.grade))).toBeUndefined();
    }
  });

  it("stores a grade given when adding a learner, and none by default", async () => {
    const k = await createLearner("Kai", null, 0);
    const none = await createLearner("Noor");
    expect(normalizeGrade(k.grade)).toBe(0);
    expect(none.grade).toBeNull();
  });

  it("sets, changes and clears a learner's grade", async () => {
    const gradeOf = async () => (await listLearners()).find((l) => l.id === "ana")!.grade;
    await setLearnerGrade("ana", 2);
    expect(normalizeGrade(await gradeOf())).toBe(2);
    await setLearnerGrade("ana", 12);
    expect(normalizeGrade(await gradeOf())).toBe(12);
    await setLearnerGrade("ana", null);
    expect(await gradeOf()).toBeNull();
  });

  it("refuses a grade outside K-12 at the database", () => {
    expect(() => sqlite.exec(`UPDATE learners SET grade = 13 WHERE id = 'ana'`)).toThrow();
    expect(() => sqlite.exec(`UPDATE learners SET grade = -1 WHERE id = 'ana'`)).toThrow();
  });
});
