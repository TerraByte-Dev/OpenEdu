// Headless stand-in for @tauri-apps/plugin-sql, aliased in only by vitest.eval.config.ts (and mocked
// in by the parity test). It runs the REAL migrations, parsed out of src-tauri/src/lib.rs, on an
// in-memory node:sqlite database, so db.ts runs unchanged against the schema the app ships.
//
// In memory on purpose: the eval seeds its own course and deletes it again, and the app's real
// database under %APPDATA% is never opened.

import libRs from "../../../../../src-tauri/src/lib.rs?raw";

interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
}

/** Every `Migration { version: N, description: "...", sql: "..." }` in lib.rs, Rust escapes undone. */
export function migrations(): Map<number, string> {
  const out = new Map<number, string>();
  const re = /version:\s*(\d+),\s*description:\s*"(?:[^"\\]|\\.)*",\s*sql:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of libRs.matchAll(re)) out.set(Number(m[1]), m[2].replace(/\\(.)/g, "$1"));
  return out;
}

let shared: Promise<Sqlite> | null = null;

async function open(): Promise<Sqlite> {
  const spec = "node:sqlite"; // not a literal: keeps tsc from needing @types/node
  const { DatabaseSync } = (await import(/* @vite-ignore */ spec)) as { DatabaseSync: new (p: string) => Sqlite };
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;"); // sqlx turns foreign keys on for every connection; match it
  const all = migrations();
  const versions = [...all.keys()].sort((a, b) => a - b);
  if (versions.length === 0) throw new Error("No migrations found in src-tauri/src/lib.rs");
  for (const v of versions) db.exec(all.get(v)!);
  return db;
}

// tauri-plugin-sql binds $1, $2…; SQLite's numbered form is ?1, ?2…. It also accepts JSON values that
// node:sqlite refuses, so convert them the way sqlx would store them.
const bindSql = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");
function bindValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

export default class Database {
  private constructor(private readonly db: Sqlite) {}

  static async load(_url: string): Promise<Database> {
    if (!shared) shared = open();
    return new Database(await shared);
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    return this.db.prepare(bindSql(sql)).all(...params.map(bindValue)) as T;
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId: number }> {
    const r = this.db.prepare(bindSql(sql)).run(...params.map(bindValue));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }

  async close(): Promise<boolean> {
    return true;
  }
}
