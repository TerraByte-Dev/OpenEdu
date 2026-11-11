// Score the define hand-label sheet (BENCHMARKS.md B8, lever 18's validation gate). Offline.
//
//   npx vite-node src/lib/eval/headless/define-kappa.ts -- tate.json grader2.json verdicts.json
//
// The verdicts file is the one define-label-sheet.ts wrote. Prints, per reading (lenient on every row,
// strict on sense rows), Cohen's kappa between the graders and of each grader and their agreed rows
// against the lexical grader, the gate (both graders vs lexical >= 0.8), and per arm the lexical grader's
// false passes and false fails on the rows the graders agree on. On an adjudication sheet it also prints
// the adjudicated item verdicts per arm (graders' verdict where they agree, else the lexical one).

import { adjudicatedMajority, checkDefineVerdicts, defineKappaReport, type DefineLabelVerdicts, type Kappa, type LabelExport } from "../define-label";
import { fs } from "./node-io";

const fmt = (k: Kappa) => (k.kappa === null ? `n/a (n ${k.n})` : `${k.kappa.toFixed(2)} (n ${k.n}, agree ${(100 * k.po!).toFixed(0)}%)`);

async function main(): Promise<void> {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).filter((a) => /\.json$/i.test(a));
  if (args.length < 3) throw new Error("Usage: define-kappa.ts -- graderA.json graderB.json verdicts.json");
  const f = await fs();
  const read = async <T>(file: string): Promise<T> => JSON.parse(await f.readFile(file, "utf8")) as T;
  const [a, b, v] = await Promise.all([read<LabelExport>(args[0]), read<LabelExport>(args[1]), read<DefineLabelVerdicts>(args[2])]);
  for (const e of [a, b]) if (e.sheet !== v.sheet) throw new Error(`${e.grader}'s export is for sheet ${e.sheet}, the verdicts are for ${v.sheet}`);
  checkDefineVerdicts(v);
  console.log(`Sheet ${v.sheet} (${Object.keys(v.rows).length} rows), lexical grader at ${v.grader}. Graders: ${a.grader}, ${b.grader}.\n`);
  console.log(`| Reading | ${a.grader} vs ${b.grader} | ${a.grader} vs lexical | ${b.grader} vs lexical | agreed vs lexical | gate (>= 0.8) |`);
  console.log("|---|---|---|---|---|---|");
  const report = defineKappaReport(a, b, v);
  for (const r of report) console.log(`| ${r.reading} | ${fmt(r.graders)} | ${fmt(r.aVsLexical)} | ${fmt(r.bVsLexical)} | ${fmt(r.agreedVsLexical)} | ${r.meetsBar ? "passes" : "FAILS"} |`);
  console.log("\nLexical errors on rows the graders agree on:\n\n| Reading | Arm | false pass / human fail | false fail / human pass |\n|---|---|---|---|");
  for (const r of report) for (const arm of ["B", "D"] as const) {
    const t = r.byArm[arm];
    console.log(`| ${r.reading} | ${arm} | ${t.falsePass} / ${t.humanFail} | ${t.falseFail} / ${t.humanPass} |`);
  }
  console.log(`\nGate: ${report.every((r) => r.meetsBar) ? "PASSES" : "FAILS"} (both readings, both graders vs lexical, kappa >= 0.8).`);
  if (v.adjudication) {
    console.log("\nAdjudicated item verdicts (lenient; graders' verdict where they agree, else lexical):\n\n| Item | B | D |\n|---|---|---|");
    for (const [item, m] of adjudicatedMajority(a, b, v)) console.log(`| ${item} | ${m.B === null ? "—" : m.B ? "pass" : "fail"} | ${m.D === null ? "—" : m.D ? "pass" : "fail"} |`);
  }
}

await main();
