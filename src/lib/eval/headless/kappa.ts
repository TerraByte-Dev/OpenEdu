// Cohen's kappa per k12-flow detector, from two graders' label-sheet exports and the hidden verdicts.
//
//   npx vite-node src/lib/eval/headless/kappa.ts -- tate.json second.json [verdicts.json]
//
// The verdicts file defaults to <main checkout>/.dev/k12-flow-label-verdicts.json (written by
// label-sheet.ts). The bar (docs/BENCHMARKS.md B4) is kappa >= 0.8 per detector before the freeze.

import { kappaReport, type Kappa, type LabelExport, type LabelVerdicts } from "../k12-flow-label";
import { fs, mainCheckout, path } from "./node-io";

const fmt = (k: Kappa) => (k.kappa === null ? `n/a (n ${k.n})` : `${k.kappa.toFixed(2)} (n ${k.n}, agree ${(100 * k.po!).toFixed(0)}%)`);

async function main(): Promise<void> {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).filter((a) => /\.json$/i.test(a));
  if (args.length < 2) throw new Error("Usage: kappa.ts -- graderA.json graderB.json [verdicts.json]");
  const [f, p] = await Promise.all([fs(), path()]);
  const read = async <T>(file: string): Promise<T> => JSON.parse(await f.readFile(file, "utf8")) as T;
  const verdictFile = args[2] ?? p.join(await mainCheckout(), ".dev", "k12-flow-label-verdicts.json");
  const [a, b, v] = await Promise.all([read<LabelExport>(args[0]), read<LabelExport>(args[1]), read<LabelVerdicts>(verdictFile)]);
  for (const e of [a, b]) if (e.sheet !== v.sheet) throw new Error(`${e.grader}'s export is for sheet ${e.sheet}, the verdicts are for ${v.sheet}`);
  const rows = kappaReport(a, b, v);
  console.log(`| Detector | ${a.grader} vs ${b.grader} | ${a.grader} vs detector | ${b.grader} vs detector | agreed rows vs detector | ≥ 0.8? |`);
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    const ok = [r.aVsDetector, r.bVsDetector].every((k) => k.kappa !== null && k.kappa >= 0.8);
    console.log(`| ${r.detector.toUpperCase()} | ${fmt(r.graders)} | ${fmt(r.aVsDetector)} | ${fmt(r.bVsDetector)} | ${fmt(r.agreedVsDetector)} | ${ok ? "yes" : "no"} |`);
  }
}

await main();
