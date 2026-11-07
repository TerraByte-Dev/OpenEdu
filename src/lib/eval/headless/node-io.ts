// The few Node APIs the headless eval needs, typed locally.
//
// The repo has no @types/node, and adding it would change the global types the app compiles against
// (setTimeout's return type, for one). So, like db-learners.test.ts, Node modules are loaded by a
// non-literal specifier and given the narrow types below. Only the headless eval and its tests import
// this file; nothing in the app does, so Vite never bundles it.

import type { GitState } from "./env";

interface Dirent { name: string; isDirectory(): boolean; isFile(): boolean }
interface Fs {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, enc: "utf8"): Promise<string>;
  writeFile(path: string, data: string, enc: "utf8"): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  readdir(path: string, opts: { withFileTypes: true }): Promise<Dirent[]>;
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string, opts: { recursive: true; force: true }): Promise<void>;
}
interface Path {
  join(...p: string[]): string;
  resolve(...p: string[]): string;
  relative(from: string, to: string): string;
  dirname(p: string): string;
}
interface ChildProcess { execSync(cmd: string, opts: { encoding: "utf8"; stdio: ["ignore", "pipe", "ignore"] }): string }
interface Os { tmpdir(): string }
interface Proc { env: Record<string, string | undefined>; cwd(): string }

const load = <T>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;

export const fs = (): Promise<Fs> => load<Fs>("node:fs/promises");
export const path = (): Promise<Path> => load<Path>("node:path");
export const os = (): Promise<Os> => load<Os>("node:os");

function proc(): Proc {
  const p = (globalThis as { process?: Proc }).process;
  if (!p) throw new Error("The headless eval runs under Node only.");
  return p;
}
export const env = (): Record<string, string | undefined> => proc().env;
export const cwd = (): string => proc().cwd();

/** Every file under `root`, recursively, as absolute paths with forward slashes. */
export async function listFiles(root: string): Promise<string[]> {
  const [f, p] = await Promise.all([fs(), path()]);
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await f.readdir(dir, { withFileTypes: true })) {
      const full = p.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push(full.replace(/\\/g, "/"));
    }
  };
  await walk(p.resolve(root));
  return out.sort();
}

/** Write a UTF-8 file, creating its folder first. */
export async function writeText(file: string, text: string): Promise<void> {
  const [f, p] = await Promise.all([fs(), path()]);
  await f.mkdir(p.dirname(file), { recursive: true });
  await f.writeFile(file, text, "utf8");
}

async function git(cmd: string): Promise<string> {
  const cp = await load<ChildProcess>("node:child_process");
  return cp.execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** What protocol rule 4 asks about the working copy. A field is null when git could not answer. */
export async function gitState(): Promise<GitState> {
  const ask = <T>(f: () => Promise<T>): Promise<T | null> => f().catch(() => null);
  return {
    commit: await ask(() => git("rev-parse HEAD")),
    srcDirty: await ask(async () => (await git("status --porcelain -- src")) !== ""),
    srcDiffersFromMaster: await ask(async () => (await git("diff --name-only master -- src")) !== ""),
    tags: await ask(async () => (await git("tag --points-at HEAD")).split(/\s+/).filter(Boolean)),
  };
}

/**
 * The main checkout's folder (the parent of git's common dir), so results written from a linked
 * worktree outlive the worktree. The working directory when git cannot say.
 */
export async function mainCheckout(): Promise<string> {
  const p = await path();
  return git("rev-parse --path-format=absolute --git-common-dir").then((d) => p.dirname(d), () => cwd());
}
