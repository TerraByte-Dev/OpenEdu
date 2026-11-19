import { describe, it, expect } from "vitest";
import {
  backupFileName, backupTo, describeBackupError, enableWal, formatApproxSize,
  interpretDbError, interpretQuickCheck, isMigrationError, runQuickCheck, type SqlDb, type BackupDestination,
  RESTORE_PIN_NOTE, PIN_BACKUP_NOTE,
} from "./db-resilience";
import libRs from "../../src-tauri/src/lib.rs?raw";
import storeTs from "./store.ts?raw";
import restoreSteps from "../components/RestoreSteps.tsx?raw";
import learnerData from "../views/settings/sections/LearnerData.tsx?raw";
import learnerMenu from "../components/LearnerMenu.tsx?raw";

// A stand-in for tauri-plugin-sql's Database: records every statement and answers from a script.
function fakeDb(answer: (sql: string, args?: unknown[]) => unknown): SqlDb & { calls: Array<[string, unknown[] | undefined]> } {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const run = async (sql: string, args?: unknown[]) => {
    calls.push([sql, args]);
    const r = answer(sql, args);
    if (r instanceof Error || typeof r === "string") throw r;
    return r;
  };
  return { calls, select: run as SqlDb["select"], execute: run };
}

describe("backupFileName", () => {
  it("uses the local date, zero-padded", () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe("openedu-backup-2026-01-05-2359.db");
    expect(backupFileName(new Date(2026, 10, 7))).toBe("openedu-backup-2026-11-07-0000.db");
    // Two backups on the same day get different names, so the second sits beside the first.
    expect(backupFileName(new Date(2026, 10, 7, 9, 5))).not.toBe(backupFileName(new Date(2026, 10, 7, 17, 30)));
  });
});

describe("interpretQuickCheck", () => {
  it("one ok row is healthy", () => {
    expect(interpretQuickCheck([{ quick_check: "ok" }])).toEqual({ status: "ok" });
  });
  it("any other rows are damage, with the first lines kept", () => {
    const rows = [
      { quick_check: "*** in database main ***\nPage 52: btreeInitPage() returns error code 11" },
      { quick_check: "row 3 missing from index idx_nb_chunks_doc" },
    ];
    const h = interpretQuickCheck(rows);
    expect(h.status).toBe("damaged");
    expect(h.status === "damaged" && h.detail).toContain("Page 52");
  });
  it("no rows or a non-array is unknown, not damage", () => {
    expect(interpretQuickCheck([]).status).toBe("unknown");
    expect(interpretQuickCheck(null).status).toBe("unknown");
  });
});

describe("interpretDbError", () => {
  it("SQLite corruption errors are damage", () => {
    expect(interpretDbError("error returned from database: (code: 11) database disk image is malformed").status).toBe("damaged");
    expect(interpretDbError("error returned from database: (code: 26) file is not a database").status).toBe("damaged");
  });
  it("a busy file is not damage", () => {
    expect(interpretDbError("error returned from database: (code: 5) database is locked").status).toBe("unknown");
  });
});

describe("isMigrationError", () => {
  it("knows sqlx's migration errors, which tauri-plugin-sql passes through as text", () => {
    expect(isMigrationError("while executing migration 23: error returned from database: (code: 1) no such table: x")).toBe(true);
    expect(isMigrationError("while executing migrations: error returned from database: (code: 5) database is locked")).toBe(true);
    expect(isMigrationError("while resolving migrations: bad")).toBe(true);
    expect(isMigrationError("migration 22 was previously applied but has been modified")).toBe(true);
    expect(isMigrationError("migration 22 is partially applied; fix and remove row from `_sqlx_migrations` table")).toBe(true);
    expect(isMigrationError(new Error("migration 22 is not present in the migration source"))).toBe(true);
  });
  it("an open, lock or damage error is not one", () => {
    expect(isMigrationError("error returned from database: (code: 14) unable to open database file")).toBe(false);
    expect(isMigrationError("error returned from database: (code: 5) database is locked")).toBe(false);
    expect(isMigrationError("error returned from database: (code: 11) database disk image is malformed")).toBe(false);
  });
});

describe("runQuickCheck (the path checkDatabaseHealth takes)", () => {
  it("runs PRAGMA quick_check and reads the rows", async () => {
    const db = fakeDb(() => [{ quick_check: "ok" }]);
    expect(await runQuickCheck(async () => db)).toEqual({ status: "ok" });
    expect(db.calls).toEqual([["PRAGMA quick_check", undefined]]);
  });
  it("a check that throws a corruption error reports damage", async () => {
    const db = fakeDb(() => "error returned from database: (code: 11) database disk image is malformed");
    expect((await runQuickCheck(async () => db)).status).toBe("damaged");
  });
  it("a database that will not open at all reports damage when SQLite says it is not a database", async () => {
    const h = await runQuickCheck(async () => { throw "error returned from database: (code: 26) file is not a database"; });
    expect(h.status).toBe("damaged");
  });
});

describe("enableWal", () => {
  it("sends the persistent WAL pragma and returns the reported mode", async () => {
    const db = fakeDb(() => [{ journal_mode: "wal" }]);
    expect(await enableWal(db)).toBe("wal");
    expect(db.calls[0][0]).toBe("PRAGMA journal_mode=WAL");
  });
  it("returns the old mode when SQLite could not switch", async () => {
    expect(await enableWal(fakeDb(() => [{ journal_mode: "delete" }]))).toBe("delete");
  });
});

// A stand-in for backup-file.ts's destination (backup.rs): records what was asked of it, in order.
function fakeDest(path: string, finishFails?: string): BackupDestination & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    partial: `${path}.partial`,
    finish: async () => { log.push("finish"); if (finishFails) throw finishFails; return path; },
    abandon: async () => { log.push("abandon"); },
  };
}

describe("backupTo", () => {
  const path = "E:\\openedu-backup-2026-11-07.db";

  it("copies into the temporary file, never the picked name, then finishes it and reports the size", async () => {
    const db = fakeDb((sql) => (sql.startsWith("SELECT") ? [{ bytes: 55_222_272 }] : { rowsAffected: 0 }));
    const dest = fakeDest(path);
    expect(await backupTo(db, dest)).toEqual({ path, approxBytes: 55_222_272 });
    expect(db.calls[1]).toEqual(["VACUUM INTO $1", [`${path}.partial`]]);
    expect(db.calls.some(([, args]) => args?.includes(path))).toBe(false);
    expect(dest.log).toEqual(["finish"]);
  });
  it("still backs up when the size query fails", async () => {
    const db = fakeDb((sql) => (sql.startsWith("SELECT") ? new Error("no such function") : {}));
    expect((await backupTo(db, fakeDest("x.db"))).approxBytes).toBeNull();
    expect(db.calls.some(([s]) => s === "VACUUM INTO $1")).toBe(true);
  });
  it("a copy that fails is never finished: the temporary file is removed and the error passed on", async () => {
    const db = fakeDb((sql) => (sql.startsWith("VACUUM") ? "error returned from database: (code: 13) database or disk is full" : [{ bytes: 1 }]));
    const dest = fakeDest("x.db");
    await expect(backupTo(db, dest)).rejects.toContain("disk is full");
    expect(dest.log).toEqual(["abandon"]);
  });
  it("a copy that comes out incomplete is removed, not kept under the picked name", async () => {
    const db = fakeDb((sql) => (sql.startsWith("SELECT") ? [{ bytes: 1 }] : {}));
    const dest = fakeDest("x.db", "The backup copy came out incomplete, so it was not kept. Try again.");
    await expect(backupTo(db, dest)).rejects.toContain("incomplete");
    expect(dest.log).toEqual(["finish", "abandon"]);
  });
});

describe("describeBackupError", () => {
  it("explains the common failures in plain words", () => {
    expect(describeBackupError("error returned from database: (code: 1) output file already exists")).toMatch(/already there/);
    expect(describeBackupError("error returned from database: (code: 13) database or disk is full")).toMatch(/drive is full/);
    expect(describeBackupError("error returned from database: (code: 14) unable to open database: E:\\x.db")).toMatch(/could not write there/);
    expect(describeBackupError("error returned from database: (code: 11) database disk image is malformed")).toMatch(/damaged/);
    expect(describeBackupError(new Error("something odd"))).toBe("The backup did not finish: something odd");
    // backup.rs BUSY, as backup_pick's invoke rejects with it: a second backup while one is saving.
    expect(describeBackupError("A backup is already being saved. Wait until it finishes, then try again."))
      .toBe('A backup is already being saved. Wait until this page says "Backup saved", then make another if you need one.');
  });
});

describe("formatApproxSize", () => {
  it("rounds to a friendly unit", () => {
    expect(formatApproxSize(55_222_272)).toBe("about 55 MB");
    expect(formatApproxSize(1_500_000_000)).toBe("about 1.5 GB");
    expect(formatApproxSize(40_960)).toBe("about 41 KB");
  });
});

// A backup is the whole database (backupTo: VACUUM INTO), and each learner's PIN hash is a column of
// learners in it, so a restore brings back the PINs of the backup's day. Settings are in the plugin
// store's file, which a restore does not touch.
describe("backups and learner PINs", () => {
  it("the PIN lives in the database a backup copies, and settings do not", () => {
    expect(libRs).toMatch(/CREATE TABLE IF NOT EXISTS learners \([^;]*pin_hash TEXT/);
    expect(storeTs).toContain("Store.load(STORE_FILE)");
    expect(storeTs).not.toMatch(/from "\.\/db"/);
  });

  it("the restore steps say the PIN comes back from the backup's day, once", () => {
    expect(RESTORE_PIN_NOTE).toContain("brings back each learner's PIN from the day of the backup");
    expect(RESTORE_PIN_NOTE).toContain("Settings, such as the model, are not in the backup");
    expect(restoreSteps).toContain("{RESTORE_PIN_NOTE}");
    // Once, in the steps: Settings › Learner data also printed it in the row's help (port of TerraTutor #243).
    expect(restoreSteps.split("RESTORE_PIN_NOTE").length - 1).toBe(2); // the import and the one use
    expect(learnerData).toContain("<RestoreSteps />");
    expect(learnerData).not.toContain("RESTORE_PIN_NOTE");
  });

  it("setting, changing or removing a PIN suggests a new backup", () => {
    expect(PIN_BACKUP_NOTE).toContain("make a new one after this in Settings › Learner data");
    expect(learnerMenu).toContain("{PIN_BACKUP_NOTE}");
    expect(learnerData).toContain("after a PIN is set, changed or removed");
  });
});
