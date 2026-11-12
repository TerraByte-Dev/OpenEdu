import { describe, it, expect, vi, beforeEach } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";

// Runs the REAL migrations (parsed out of src-tauri/src/lib.rs) and the REAL db.ts functions against
// an in-memory SQLite (node:sqlite), through a stand-in for tauri-plugin-sql's Database. This is the
// path production takes: migration 13 on an existing install, then the course-list filter and the
// getCourse guard in db.ts. The app no longer adds learners, so the tests insert extra learners the
// way an earlier version left them: as rows already in the file.

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
  listLearners, setActiveLearnerId, setLearnerGrade, touchLearner,
} from "./db";
import { needsPicker, needsPin, autoPickLearner, canDeleteLearner, DEFAULT_LEARNER_ID } from "./learners";
import { hashPin, verifyPin } from "./learner-pin";
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

/** A learner row as an earlier version (profiles, a class or a school) left it in the file. */
function addLearner(id: string, name: string): { id: string } {
  sqlite.prepare("INSERT INTO learners (id, name, created_at) VALUES (?1, ?2, datetime('now'))").run(id, name);
  return { id };
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
    migrate(18, 13); // the app runs every migration; 14 adds group_id, 15 grade and 18 notes.origin, which db.ts writes
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
    const b = addLearner("bilal", "Bilal");
    setActiveLearnerId(b.id);
    expect(await getCourses()).toEqual([]);
    expect(await getCourse("c1")).toBeNull();
  });

  it("a new course belongs to whoever created it, and only they see it", async () => {
    const b = addLearner("bilal", "Bilal");
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
    const b = addLearner("bilal", "Bilal");
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

describe("a class install from the last multi-learner version, opened by the solo-learner app", () => {
  // Exactly what migration 19 left on a computer in class mode: the mode and the teacher PIN in
  // app_config, a group, three learners (Ana with a PIN), a course each with work under it, and the
  // learning-record and early-learner rows. The solo-learner app reads none of the class settings; this
  // checks that every learner and course is still reachable the way the app reaches them (App's launch:
  // listLearners + autoPickLearner; the picker: every learner, needsPin, then PinScreen's verifyPin;
  // then the course list and the getCourse guard), that Ana's PIN still stands, and that nothing is lost.
  const PIN = "4321";
  const TEACHER_PIN = "9999";
  const COURSES: Record<string, string> = { [DEFAULT_LEARNER_ID]: "c-kofi", ana: "c-ana", ben: "c-ben" };
  let pinRecord: { pin_hash: string; pin_salt: string };
  let teacherRecord: { pin_hash: string; pin_salt: string };

  // Every row of every table, order-free. learners.last_active_at is left out: entering a learner
  // stamps it (touchLearner), which is the one write the launch and the picker make.
  const snapshot = () => {
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
      .map((t) => t.name);
    return Object.fromEntries(tables.map((t) => [
      t,
      (sqlite.prepare(`SELECT * FROM "${t}"`).all() as Array<Record<string, unknown>>)
        .map((r) => { const row = { ...r }; if (t === "learners") delete row.last_active_at; return JSON.stringify(row); })
        .sort(),
    ]));
  };

  // The picker's tile, then PinScreen: a learner with a PIN is entered only when the typed PIN verifies.
  const enterThroughPicker = async (learner: Awaited<ReturnType<typeof listLearners>>[number], typed: string | null): Promise<boolean> => {
    if (needsPin(learner) && (typed === null || !(await verifyPin(typed, learner)))) return false;
    setActiveLearnerId(learner.id);
    await touchLearner(learner.id);
    return true;
  };

  beforeEach(async () => {
    pinRecord ??= await hashPin(PIN, 100_000);
    teacherRecord ??= await hashPin(TEACHER_PIN, 100_000);
    await openDb();
    setActiveLearnerId(null);
    migrate(19);
    sqlite.prepare("INSERT INTO app_config (key, value) VALUES ('usage_mode', 'class'), ('teacher_pin_hash', ?1), ('teacher_pin_salt', ?2)")
      .run(teacherRecord.pin_hash, teacherRecord.pin_salt);
    sqlite.exec(`UPDATE learners SET name = 'Kofi' WHERE id = '${DEFAULT_LEARNER_ID}'`);
    sqlite.exec(`INSERT INTO learner_groups (id, name) VALUES ('g1', 'Room 4')`);
    sqlite.prepare("INSERT INTO learners (id, name, pin_hash, pin_salt, group_id, grade) VALUES ('ana', 'Ana', ?1, ?2, 'g1', 3)")
      .run(pinRecord.pin_hash, pinRecord.pin_salt);
    sqlite.exec(`INSERT INTO learners (id, name, group_id) VALUES ('ben', 'Ben', 'g1')`);
    for (const [owner, course] of Object.entries(COURSES)) {
      sqlite.exec(`INSERT INTO courses (id, title, topic, current_level, learner_id) VALUES ('${course}', '${course}', 'x', 2.0, '${owner}')`);
      sqlite.exec(`INSERT INTO notes (id, course_id, title, content, origin) VALUES ('n-${course}', '${course}', 'Mine', 'my words', 'learner')`);
      sqlite.exec(`INSERT INTO chat_messages (id, course_id, role, content) VALUES ('m-${course}', '${course}', 'user', 'hello')`);
    }
    sqlite.exec(`INSERT INTO learner_days (learner_id, day, minutes) VALUES ('ana', '2026-10-01', 12), ('ben', '2026-10-01', 7)`);
    sqlite.exec(`INSERT INTO monthly_records (learner_id, month, format, body_json) VALUES ('ana', '2026-10', 1, '{}')`);
    sqlite.exec(`INSERT INTO early_attempts (learner_id, skill_id, item_id, correct, first_try) VALUES ('ben', 'colors', 'colors/red', 1, 1)`);
  });

  it("keeps all three learners and opens on the picker, which lists every one of them", async () => {
    const list = await listLearners();
    expect(list.map((l) => l.id)).toEqual([DEFAULT_LEARNER_ID, "ana", "ben"]);
    expect(autoPickLearner(list)).toBeNull();
    expect(needsPicker(list)).toBe(true);
  });

  it("reaches every learner's course, and Ana's only with her PIN", async () => {
    const list = await listLearners();
    const byId = Object.fromEntries(list.map((l) => [l.id, l]));

    for (const id of [DEFAULT_LEARNER_ID, "ben"]) {
      expect(await enterThroughPicker(byId[id], null)).toBe(true);
      expect((await getCourses()).map((c) => c.id)).toEqual([COURSES[id]]);
      expect(await getCourse(COURSES[id])).not.toBeNull();
      expect((await getNotes(COURSES[id])).map((n) => n.content)).toEqual(["my words"]);
      expect(await getCourse(COURSES.ana)).toBeNull(); // signed in as someone else: Ana's course is refused
    }

    setActiveLearnerId(null); // Switch learner: back to the picker
    expect(needsPin(byId.ana)).toBe(true);
    expect(await enterThroughPicker(byId.ana, null)).toBe(false);
    expect(await enterThroughPicker(byId.ana, "0000")).toBe(false);
    expect(await enterThroughPicker(byId.ana, TEACHER_PIN)).toBe(false); // the old teacher PIN opens nobody
    expect(await getCourses()).toEqual([]);
    expect(await getCourse(COURSES.ana)).toBeNull();

    expect(await enterThroughPicker(byId.ana, PIN)).toBe(true);
    expect((await getCourses()).map((c) => c.id)).toEqual([COURSES.ana]);
    expect((await getNotes(COURSES.ana)).map((n) => n.content)).toEqual(["my words"]);
  });

  it("deletes nothing and changes nothing but each learner's last-seen time", async () => {
    const before = snapshot();
    const list = await listLearners();
    autoPickLearner(list);
    for (const l of list) {
      setActiveLearnerId(null);
      await enterThroughPicker(l, l.id === "ana" ? PIN : null);
      await getCourses();
    }
    expect(snapshot()).toEqual(before);
    // The class settings stay in the file, unused, for anyone who moves the data on.
    expect(sqlite.prepare("SELECT key FROM app_config WHERE key IN ('usage_mode', 'teacher_pin_hash') ORDER BY key").all())
      .toEqual([{ key: "teacher_pin_hash" }, { key: "usage_mode" }]);
  });

  it("lets a learner delete themselves (with everything under them, and nobody else's) until one is left", async () => {
    await deleteLearner("ben");
    const count = (sql: string) => (sqlite.prepare(sql).all()[0] as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM courses WHERE learner_id = 'ben'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM early_attempts")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM learner_days WHERE learner_id = 'ana'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM notes")).toBe(2);

    let list = await listLearners();
    expect(canDeleteLearner(list)).toBe(true);
    expect(autoPickLearner(list)).toBeNull(); // two left, and Ana still has her PIN

    await deleteLearner("ana");
    list = await listLearners();
    expect(canDeleteLearner(list)).toBe(false);
    expect(autoPickLearner(list)?.id).toBe(DEFAULT_LEARNER_ID); // one learner, no PIN: straight in, as solo
    setActiveLearnerId(DEFAULT_LEARNER_ID);
    expect((await getCourses()).map((c) => c.id)).toEqual([COURSES[DEFAULT_LEARNER_ID]]);
  });
});

describe("a new install", () => {
  it("has one learner, opens straight into them, and their courses are theirs", async () => {
    await openDb();
    setActiveLearnerId(null);
    migrate(19);
    const list = await listLearners();
    const me = autoPickLearner(list);
    expect(me?.id).toBe(DEFAULT_LEARNER_ID);
    setActiveLearnerId(me!.id);
    const course = await createCourse("Chemistry", "chemistry");
    expect((await getCourses()).map((c) => c.id)).toEqual([course.id]);
  });
});
