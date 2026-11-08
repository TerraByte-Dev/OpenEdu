// Cohen's kappa per k12-flow detector, from two graders' label-sheet exports and the hidden verdicts.
//
//   npx vite-node src/lib/eval/headless/kappa.ts -- tate.json second.json verdicts.json
//
// The verdicts file is the one label-sheet.ts wrote (in the main checkout's .dev/label-verdicts/,
// away from the sheet, so graders never see it). It must name its grader commit and mark every row
// fixed or drawn, or the script stops. Kappa is reported for all rows, then separately for the 20 fixed rows (named with their
// verdicts in the committed baseline results file, so not blind) and the 40 drawn rows. The bar
// (docs/BENCHMARKS.md B4) is kappa >= 0.8 per detector before the freeze.

import { checkVerdicts, kappaReport, type Kappa, type LabelExport, type LabelVerdicts } from "../k12-flow-label";
import { fs } from "./node-io";

const fmt = (k: Kappa) => (k.kappa === null ? `n/a (n ${k.n})` : `${k.kappa.toFixed(2)} (n ${k.n}, agree ${(100 * k.po!).toFixed(0)}%)`);

async function main(): Promise<void> {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).filter((a) => /\.json$/i.test(a));
  if (args.length < 3) throw new Error("Usage: kappa.ts -- graderA.json graderB.json verdicts.json");
  const f = await fs();
  const read = async <T>(file: string): Promise<T> => JSON.parse(await f.readFile(file, "utf8")) as T;
  const [a, b, v] = await Promise.all([read<LabelExport>(args[0]), read<LabelExport>(args[1]), read<LabelVerdicts>(args[2])]);
  for (const e of [a, b]) if (e.sheet !== v.sheet) throw new Error(`${e.grader}'s export is for sheet ${e.sheet}, the verdicts are for ${v.sheet}`);
  checkVerdicts(v);
  console.log(`Sheet ${v.sheet}, verdicts from the grader at ${v.grader}.`);
  const sets: Array<[string, (r: LabelVerdicts["rows"][string]) => boolean]> = [
    ["All rows", () => true],
    ["The 20 fixed rows (verdicts public in the baseline results file)", (r) => r.fixed],
    ["The 40 drawn rows", (r) => !r.fixed],
  ];
  for (const [title, only] of sets) {
    const n = Object.values(v.rows).filter(only).length;
    console.log(`\n### ${title}: ${n}\n`);
    console.log(`| Detector | ${a.grader} vs ${b.grader} | ${a.grader} vs detector | ${b.grader} vs detector | agreed rows vs detector | ≥ 0.8? |`);
    console.log("|---|---|---|---|---|---|");
    for (const r of kappaReport(a, b, v, only)) {
      const ok = [r.aVsDetector, r.bVsDetector].every((k) => k.kappa !== null && k.kappa >= 0.8);
      console.log(`| ${r.detector.toUpperCase()} | ${fmt(r.graders)} | ${fmt(r.aVsDetector)} | ${fmt(r.bVsDetector)} | ${fmt(r.agreedVsDetector)} | ${ok ? "yes" : "no"} |`);
    }
  }
}

await main();
