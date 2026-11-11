// Compare the define suite's two arms, offline (no model, no Ollama): docs/BENCHMARKS.md lever 16.
//
//   $env:DEFINE_B = "<main>/.dev/eval-runs/...-define-test-B-gemma4_e2b.json"
//   $env:DEFINE_D = "<main>/.dev/eval-runs/...-define-test-D-gemma4_e2b.json"
//   npx vite-node src/lib/eval/headless/define-compare.ts
//
// Prints, per pre-registered group, item-majority passes in each arm with a 95% Wilson interval, the
// items lost and gained, and the exact McNemar p (define-grade.ts compareDefineArms). Refuses two files
// from different commits, models or splits, or the same arm twice. DEFINE_OUT writes to a file.

import { DEFINE_ITEMS, DEFINE_SPLIT, type DefineSplit } from "../define-items";
import { compareDefineArms, type DefineRowLike } from "../define-grade";
import { env, fs, writeText } from "./node-io";

interface Saved {
  suite: string;
  commit: string | null;
  model: string;
  split: DefineSplit;
  dictionary: "on" | "off";
  repeats: number;
  partial: boolean;
  void?: boolean;
  noted: number;
  rows: DefineRowLike[];
}

const pct = (k: number, n: number, w: [number, number]) => `${k}/${n} (${(100 * w[0]).toFixed(1)}–${(100 * w[1]).toFixed(1)}%)`;

async function main(): Promise<void> {
  const e = env();
  const f = await fs();
  const load = async (k: string): Promise<Saved> => {
    const file = e[k];
    if (!file) throw new Error(`Set ${k} to a define results file.`);
    return JSON.parse(await f.readFile(file, "utf8")) as Saved;
  };
  const [b, d] = [await load("DEFINE_B"), await load("DEFINE_D")];
  const why = [
    b.suite !== "define" || d.suite !== "define" ? "not define results files" : "",
    b.commit !== d.commit ? `different commits (${b.commit} vs ${d.commit})` : "",
    b.model !== d.model ? `different models (${b.model} vs ${d.model})` : "",
    b.split !== d.split ? `different splits (${b.split} vs ${d.split})` : "",
    b.dictionary !== "off" || d.dictionary !== "on" ? "DEFINE_B must be the EVAL_DICTIONARY=off arm and DEFINE_D the note arm" : "",
  ].filter(Boolean);
  if (why.length) throw new Error(`Refusing to compare: ${why.join("; ")}.`);

  const out: string[] = [];
  out.push(`define ${b.split}, ${b.model}, commit ${b.commit?.slice(0, 7)}, repeats B ${b.repeats} / D ${d.repeats}${b.partial || d.partial ? ", PARTIAL (not a result)" : ""}${b.void || d.void ? ", VOID" : ""}`);
  out.push(`D rows with a note: ${d.noted}/${d.rows.length}; B: ${b.noted}/${b.rows.length}`, "");
  out.push("| Group | n | B | D | lost | gained | McNemar p |", "|---|---|---|---|---|---|---|");
  for (const c of compareDefineArms(DEFINE_ITEMS, b.split, DEFINE_SPLIT, b.rows, d.rows)) {
    out.push(`| ${c.group} | ${c.n} | ${pct(c.b.k, c.n, c.b.wilson)} | ${pct(c.d.k, c.n, c.d.wilson)} | ${c.lost.join(", ") || "—"} | ${c.gained.join(", ") || "—"} | ${c.p.toFixed(4)} |`);
  }
  const text = out.join("\n");
  if (e.DEFINE_OUT) await writeText(e.DEFINE_OUT, text);
  else console.log(text);
}

await main();
