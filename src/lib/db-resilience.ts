// Power-loss resilience for the learner database: the boot health check and the "back up all learner
// data" copy. Tauri-free on purpose: db.ts and the Learner data settings section hand in the plugin's
// Database (it satisfies SqlDb structurally), and the tests hand in a fake that records the SQL.

import { APP_NAME, BACKUP_FILE_STEM } from "./product";

/** The two methods of tauri-plugin-sql's `Database` these helpers need. */
export interface SqlDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
}

export type DbHealth =
  | { status: "ok" }
  /** SQLite reported damage. The UI tells the user to restore a backup. */
  | { status: "damaged"; detail: string }
  /** The check could not run for some other reason (e.g. busy). Logged, never shown as damage. */
  | { status: "unknown"; detail: string };

// sqlx error text arrives in JS as a plain string (tauri-plugin-sql serializes its Error with
// to_string()), e.g. "error returned from database: (code: 11) database disk image is malformed".
// SQLITE_CORRUPT = 11, SQLITE_NOTADB = 26.
const DAMAGE_RE = /malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB|\(code: (11|26)\)/i;

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** First column of each row. `PRAGMA quick_check` comes back as `[{ quick_check: "ok" }]`. */
function firstColumn(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (r && typeof r === "object" ? Object.values(r as Record<string, unknown>)[0] : r));
}

/** Read the rows of `PRAGMA quick_check`. Exactly one row saying "ok" is healthy; anything else is not. */
export function interpretQuickCheck(rows: unknown): DbHealth {
  const lines = firstColumn(rows).map((v) => String(v ?? "").trim());
  if (lines.length === 0) return { status: "unknown", detail: "quick_check returned no rows" };
  if (lines.length === 1 && lines[0].toLowerCase() === "ok") return { status: "ok" };
  return { status: "damaged", detail: lines.slice(0, 5).join("\n") };
}

// sqlx's MigrateError text (sqlx-core 0.8.6 migrate/error.rs), which tauri-plugin-sql 2.3.2 passes
// through unchanged (its Error::Migration is #[error(transparent)]), e.g. "while executing migration 23:
// error returned from database: (code: 1) no such table: x" or "migration 22 was previously applied but
// has been modified".
const MIGRATION_RE = /\bwhile (?:executing|resolving) migrations?\b|\bmigration \d+ (?:was previously applied|is not present|is older than|is newer than|is partially applied)/i;

/** The database opened but its migrations failed (or did not match this build's). */
export function isMigrationError(err: unknown): boolean {
  return MIGRATION_RE.test(errorText(err));
}

/** A thrown error is damage only when SQLite says so. A busy or locked file is not damage. */
export function interpretDbError(err: unknown): DbHealth {
  const detail = errorText(err);
  return DAMAGE_RE.test(detail) ? { status: "damaged", detail } : { status: "unknown", detail };
}

/**
 * Open the database and run `PRAGMA quick_check`. A file too damaged to open (or to check) throws
 * instead of returning rows, so the error path is interpreted too.
 * quick_check reads every page: ~75 ms on a 55 MB database, ~530 ms on 392 MB (warm cache, SSD).
 */
export async function runQuickCheck(open: () => Promise<SqlDb>): Promise<DbHealth> {
  try {
    const db = await open();
    return interpretQuickCheck(await db.select<unknown>("PRAGMA quick_check"));
  } catch (e) {
    return interpretDbError(e);
  }
}

/**
 * Switch the file to WAL. The mode is stored in the database file, so it applies to every pooled
 * connection, including ones opened later. Returns the mode SQLite reports afterwards ("wal" on success).
 */
export async function enableWal(db: SqlDb): Promise<string | null> {
  const mode = firstColumn(await db.select<unknown>("PRAGMA journal_mode=WAL"))[0];
  return typeof mode === "string" ? mode.toLowerCase() : null;
}

/** `openedu-backup-YYYY-MM-DD-HHMM.db`, in the computer's local time. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  // The time is in the name so a second backup the same day to the same USB folder sits beside the
  // first instead of replacing it. (Before backup.rs, SQLite's refusal to overwrite also made a
  // date-only name fail right after Windows asked "replace?" and the user said yes.)
  return `${BACKUP_FILE_STEM}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.db`;
}

/**
 * Where a backup goes (backup-file.ts, src-tauri/src/backup.rs). SQLite writes the copy to `partial`, a
 * temporary name beside the picked one; `finish` flushes it, checks it is whole and gives it the picked
 * name, returning that path; `abandon` removes the temporary file after a failed copy. A copy cut short
 * by a shutdown or a power cut is left as `.partial`, never under a backup's name.
 */
export interface BackupDestination {
  partial: string;
  finish(): Promise<string>;
  abandon(): Promise<void>;
}

export interface BackupResult {
  path: string;
  /** Live pages x page size before the copy. VACUUM INTO drops free pages, so this is close, not exact. */
  approxBytes: number | null;
}

const SIZE_SQL =
  "SELECT (page_count - freelist_count) * page_size AS bytes FROM pragma_page_count(), pragma_freelist_count(), pragma_page_size()";

/**
 * Copy the whole database with `VACUUM INTO`, to the destination's temporary file, then make that the
 * backup. VACUUM INTO reads a consistent snapshot, so the app can keep working while it runs, and the
 * copy is a normal standalone .db file. It writes straight to the path it is given and does not flush it,
 * so it never writes the picked name itself. A failure removes the temporary file and is thrown for the
 * UI to explain.
 */
export async function backupTo(db: SqlDb, dest: BackupDestination): Promise<BackupResult> {
  let approxBytes: number | null = null;
  try {
    const v = firstColumn(await db.select<unknown>(SIZE_SQL))[0];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) approxBytes = v;
  } catch { /* the size is a nicety; never block the backup on it */ }
  try {
    await db.execute("VACUUM INTO $1", [dest.partial]);
    return { path: await dest.finish(), approxBytes };
  } catch (e) {
    await dest.abandon().catch(() => { /* the error that matters is the copy's */ });
    throw e;
  }
}

/** Plain-words reason a backup failed, with what to do next. */
export function describeBackupError(err: unknown): string {
  const msg = errorText(err);
  // backup.rs BUSY: one backup at a time. Settings › Learner data shows the running backup's "Saving
  // backup…" and then "Backup saved" even after the section was left and opened again (backup-status.ts).
  if (/already being saved/i.test(msg)) return 'A backup is already being saved. Wait until this page says "Backup saved", then make another if you need one.';
  if (/already exists/i.test(msg)) return `${APP_NAME} could not use that name because a file is already there. Choose a new name, or delete the old file first.`;
  if (/disk is full|SQLITE_FULL|\(code: 13\)/i.test(msg)) return "The drive is full. Free some space, or save to another drive such as a USB stick.";
  if (/unable to open|SQLITE_CANTOPEN|\(code: 14\)|access is denied|permission/i.test(msg)) {
    return `${APP_NAME} could not write there. Check the USB stick is still plugged in, or pick another folder.`;
  }
  if (DAMAGE_RE.test(msg)) return "The learner data is damaged, so it could not be copied. Restore your most recent backup.";
  return `The backup did not finish: ${msg}`;
}

/** "about 55 MB" style size for the success message. */
export function formatApproxSize(bytes: number): string {
  if (bytes >= 1e9) return `about ${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `about ${Math.round(bytes / 1e6)} MB`;
  return `about ${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
