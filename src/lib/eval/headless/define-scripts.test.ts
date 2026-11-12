import { describe, it, expect } from "vitest";

// Each define script runs its main() under its documented command, `npx vite-node <script>`: with no
// inputs it must fail loudly (a non-zero exit and its own usage error), not print nothing and exit 0.
// vite-node rewrites process.argv, so a script that guards main() on its own name in argv never runs
// (lever 18 review round 2, B2). No model or network: every script stops at its input check.

interface SpawnResult { status: number | null; stderr: string; stdout: string }
interface ChildProcess {
  spawnSync(cmd: string, args: string[], opts: { encoding: "utf8"; env: Record<string, string | undefined>; timeout: number; cwd: string }): SpawnResult;
}
interface Proc { execPath: string; env: Record<string, string | undefined>; cwd(): string }
const load = <T>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;

const SCRIPTS: Array<[string, RegExp]> = [
  ["define-compare.ts", /Set DEFINE_B/],
  ["define-label-sheet.ts", /Set DEFINE_LABEL_FILES/],
  ["define-label-grader2.ts", /Usage: define-label-grader2\.ts/],
  ["define-kappa.ts", /Usage: define-kappa\.ts/],
  // No model argument: no request is made (blind19.ts throws before any fetch).
  ["blind19-generate.ts", /Usage: blind19-generate\.ts/],
];

describe("define scripts run under vite-node", () => {
  it.each(SCRIPTS)("%s exits non-zero with its usage error when given no inputs", async (script, usage) => {
    const cp = await load<ChildProcess>("node:child_process");
    const proc = (globalThis as unknown as { process: Proc }).process;
    // No inputs: drop every variable these scripts read.
    const env = Object.fromEntries(Object.entries(proc.env).filter(([k]) => !/^(DEFINE_|OPENAI_API_KEY$|OPENROUTER_API_KEY$)/.test(k)));
    const r = cp.spawnSync(proc.execPath, ["node_modules/vite-node/vite-node.mjs", `src/lib/eval/headless/${script}`], { encoding: "utf8", env, timeout: 60_000, cwd: proc.cwd() });
    expect(r.status, `${script}: ${r.stdout}\n${r.stderr}`).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(`${r.stdout}\n${r.stderr}`).toMatch(usage);
  }, 70_000);
});
