import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../App.tsx?raw";
import startupFailed from "../components/StartupFailed.tsx?raw";

// db.ts getDb after a failed Database.load. tauri-plugin-sql 2.3.2 (commands.rs load) removes this
// database's migration list before it migrates and does not put it back when migrating fails, so a second
// load in the same process opens the old schema with nothing applied. getDb must keep a migration failure
// for the session, and still retry any other failed open.

const load = vi.fn();
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: (...a: unknown[]) => load(...a) } }));

// What a working Database answers: enough for openDb's WAL switch.
const okDb = { select: async () => [{ journal_mode: "wal" }], execute: async () => undefined };

// The plugin's error text, as Tauri hands it to JS (a string; sqlx-core 0.8.6 migrate/error.rs).
const MIGRATION_FAILURES = [
  "while executing migration 23: error returned from database: (code: 5) database is locked",
  "while executing migration 23: error returned from database: (code: 1) no such column: x",
  "while executing migrations: error returned from database: (code: 13) database or disk is full",
  "migration 22 was previously applied but has been modified",
  "migration 24 was previously applied but is missing in the resolved migrations",
];

async function freshDb() {
  vi.resetModules();
  return await import("./db");
}

beforeEach(() => { load.mockReset(); });

describe("getDb after a failed open", () => {
  it.each(MIGRATION_FAILURES)("keeps a failed migration for the session: %s", async (err) => {
    const { getDb } = await freshDb();
    load.mockRejectedValueOnce(err).mockResolvedValue(okDb);
    await expect(getDb()).rejects.toBe(err);
    // "Try again", the boot quick_check and every later reader get the same failure, never a pool on the old schema.
    await expect(getDb()).rejects.toBe(err);
    await expect(getDb()).rejects.toBe(err);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("the boot quick_check sees the same failure and does not open the old schema", async () => {
    const { getDb, checkDatabaseHealth } = await freshDb();
    const err = MIGRATION_FAILURES[0];
    load.mockRejectedValueOnce(err).mockResolvedValue(okDb);
    await expect(getDb()).rejects.toBe(err);
    expect((await checkDatabaseHealth()).status).not.toBe("ok");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries any other failed open on the next call", async () => {
    const { getDb } = await freshDb();
    const err = "error returned from database: (code: 14) unable to open database file";
    load.mockRejectedValueOnce(err).mockResolvedValue(okDb);
    await expect(getDb()).rejects.toBe(err);
    await expect(getDb()).resolves.toBe(okDb);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("the startup screen after a failed migration", () => {
  it("App tells the screen it was the migration, with the error text", () => {
    expect(app).toMatch(/setStartupFailed\(\{ migration: isMigrationError\(e\) \? errorText\(e\) : null \}\)/);
    expect(app).toContain("<StartupFailed migrationError={startupFailed.migration}");
  });

  it("offers no Try again then, and keeps the restore steps", () => {
    const migrationBranch = startupFailed.slice(startupFailed.indexOf("{migrationError ? ("), startupFailed.indexOf(") : ("));
    expect(migrationBranch).toContain("Close {APP_NAME} and open it again");
    expect(migrationBranch).not.toContain("Try again");
    expect(startupFailed.indexOf("<RestoreSteps />")).toBeGreaterThan(startupFailed.indexOf(") : ("));
  });
});
