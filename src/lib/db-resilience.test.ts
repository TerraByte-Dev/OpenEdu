import { describe, it, expect } from "vitest";
import {
  backupFileName, backupTo, describeBackupError, enableWal, formatApproxSize,
  interpretDbError, interpretQuickCheck, runQuickCheck, type SqlDb,
} from "./db-resilience";

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
    // Two backups on the same day get different names, because SQLite refuses to overwrite a file.
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

describe("backupTo", () => {
  it("binds the picked path into VACUUM INTO and reports the estimated size", async () => {
    const db = fakeDb((sql) => (sql.startsWith("SELECT") ? [{ bytes: 55_222_272 }] : { rowsAffected: 0 }));
    const path = "E:\\openedu-backup-2026-11-07.db";
    expect(await backupTo(db, path)).toEqual({ path, approxBytes: 55_222_272 });
    expect(db.calls[1]).toEqual(["VACUUM INTO $1", [path]]);
  });
  it("still backs up when the size query fails", async () => {
    const db = fakeDb((sql) => (sql.startsWith("SELECT") ? new Error("no such function") : {}));
    expect((await backupTo(db, "x.db")).approxBytes).toBeNull();
    expect(db.calls.some(([s]) => s === "VACUUM INTO $1")).toBe(true);
  });
  it("passes the VACUUM INTO error through for the UI to explain", async () => {
    const db = fakeDb((sql) => (sql.startsWith("VACUUM") ? "error returned from database: (code: 1) output file already exists" : [{ bytes: 1 }]));
    await expect(backupTo(db, "x.db")).rejects.toContain("output file already exists");
  });
});

describe("describeBackupError", () => {
  it("explains the common failures in plain words", () => {
    expect(describeBackupError("error returned from database: (code: 1) output file already exists")).toMatch(/already there/);
    expect(describeBackupError("error returned from database: (code: 13) database or disk is full")).toMatch(/drive is full/);
    expect(describeBackupError("error returned from database: (code: 14) unable to open database: E:\\x.db")).toMatch(/could not write there/);
    expect(describeBackupError("error returned from database: (code: 11) database disk image is malformed")).toMatch(/damaged/);
    expect(describeBackupError(new Error("something odd"))).toBe("The backup did not finish: something odd");
  });
});

describe("formatApproxSize", () => {
  it("rounds to a friendly unit", () => {
    expect(formatApproxSize(55_222_272)).toBe("about 55 MB");
    expect(formatApproxSize(1_500_000_000)).toBe("about 1.5 GB");
    expect(formatApproxSize(40_960)).toBe("about 41 KB");
  });
});
