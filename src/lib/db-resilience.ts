// Power-loss resilience for the learner database: the boot health check and the "back up all learner
// data" copy. Tauri-free on purpose: db.ts and the Learner data settings section hand in the plugin's
// Database (it satisfies SqlDb structurally), and the tests hand in a fake that records the SQL.

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

/** `openedu-backup-YYYY-MM-DD.db`, in the computer's local date. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `openedu-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.db`;
}

export interface BackupResult {
  path: string;
  /** Live pages x page size before the copy. VACUUM INTO drops free pages, so this is close, not exact. */
  approxBytes: number | null;
}

const SIZE_SQL =
  "SELECT (page_count - freelist_count) * page_size AS bytes FROM pragma_page_count(), pragma_freelist_count(), pragma_page_size()";

/**
 * Copy the whole database to `path` with `VACUUM INTO`. It reads a consistent snapshot, so the app can
 * keep working while it runs, and the copy is a normal standalone .db file. SQLite refuses to write
 * over an existing file ("output file already exists").
 */
export async function backupTo(db: SqlDb, path: string): Promise<BackupResult> {
  let approxBytes: number | null = null;
  try {
    const v = firstColumn(await db.select<unknown>(SIZE_SQL))[0];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) approxBytes = v;
  } catch { /* the size is a nicety; never block the backup on it */ }
  await db.execute("VACUUM INTO $1", [path]);
  return { path, approxBytes };
}

/** Plain-words reason a backup failed, with what to do next. */
export function describeBackupError(err: unknown): string {
  const msg = errorText(err);
  if (/already exists/i.test(msg)) return "A file with that name is already there. Choose a new name, or delete the old file first.";
  if (/disk is full|SQLITE_FULL|\(code: 13\)/i.test(msg)) return "The drive is full. Free some space, or save to another drive such as a USB stick.";
  if (/unable to open|SQLITE_CANTOPEN|\(code: 14\)|access is denied|permission/i.test(msg)) {
    return "OpenEdu could not write there. Check the USB stick is still plugged in, or pick another folder.";
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
