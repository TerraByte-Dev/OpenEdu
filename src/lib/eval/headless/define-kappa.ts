// Score the define hand-label sheet (BENCHMARKS.md B8, lever 18's validation gate). Offline.
//
//   npx vite-node src/lib/eval/headless/define-kappa.ts -- grader1.json grader2.json verdicts.json
//
// Grader 1 (a blind Claude model since the 2026-11-11 amendment) comes first. The verdicts file is the one define-label-sheet.ts wrote. Refuses an
// export for another sheet, an export that leaves any row unanswered, and a verdicts file built with a
// lexical grader other than the one committed now (define-grade.ts and define-items.ts).
//
// Kappa sheet: per reading (lenient on every row, strict on sense rows), Cohen's kappa between the
// graders and of each grader and their agreed rows against the lexical grader, the gate (both graders
// vs lexical >= 0.8; a kappa that cannot be estimated misses), and per arm the lexical grader's false
// passes and false fails on the rows the graders agree on.
//
// Adjudication sheet (lever 18, review round 2 ruling a): the item verdicts per arm with grader 1
// deciding each row (every row has grader 1's label: an export with an unanswered row is refused above),
// the both-graders-agree reading as a sensitivity line, kappa between the graders, and every
// disagreement. No gate line: the gate is read on the kappa sheet.

import { adjudicate, checkDefineVerdicts, defineKappaReport, unansweredRows, cohenKappa, defineHumanVerdicts, type DefineLabelVerdicts, type Kappa, type LabelExport } from "../define-label";
import { graderCommits } from "./define-script-lib";
import { fs } from "./node-io";

const fmt = (k: Kappa) => (k.kappa === null ? `n/a (n ${k.n})` : `${k.kappa.toFixed(2)} (n ${k.n}, agree ${(100 * k.po!).toFixed(0)}%)`);
const pf = (b: boolean | null) => (b === null ? "—" : b ? "pass" : "fail");

async function main(): Promise<void> {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).filter((a) => /\.json$/i.test(a));
  if (args.length < 3) throw new Error("Usage: define-kappa.ts -- grader1.json grader2.json verdicts.json");
  const f = await fs();
  const read = async <T>(file: string): Promise<T> => JSON.parse(await f.readFile(file, "utf8")) as T;
  const [a, b, v] = await Promise.all([read<LabelExport>(args[0]), read<LabelExport>(args[1]), read<DefineLabelVerdicts>(args[2])]);
  checkDefineVerdicts(v);
  if (a.grader === b.grader) throw new Error(`Both exports name the same grader (${a.grader}); the gate needs two graders.`);
  for (const e of [a, b]) {
    if (e.sheet !== v.sheet) throw new Error(`${e.grader}'s export is for sheet ${e.sheet}, the verdicts are for ${v.sheet}`);
    const open = unansweredRows(e, v);
    if (open.length) throw new Error(`${e.grader} left ${open.length} row(s) unanswered (${open.slice(0, 8).join(", ")}${open.length > 8 ? ", ..." : ""}); every row must be answered.`);
  }
  const now = await graderCommits();
  if (v.grader !== now) throw new Error(`The verdicts were built with the lexical grader at ${v.grader}; the committed grader is ${now}. Rebuild the sheet's verdicts.`);
  console.log(`Sheet ${v.sheet} (${Object.keys(v.rows).length} rows), lexical grader at ${v.grader}. Grader 1: ${a.grader}; grader 2: ${b.grader}.\n`);

  if (v.adjudication) {
    const r = adjudicate(a, b, v);
    const graders = cohenKappa(Object.keys(v.rows).flatMap((rid): Array<[boolean, boolean]> => {
      const x = defineHumanVerdicts(a.answers[rid] ?? {}, v.rows[rid].kind).lenient;
      const y = defineHumanVerdicts(b.answers[rid] ?? {}, v.rows[rid].kind).lenient;
      return x === null || y === null ? [] : [[x, y]];
    }));
    console.log(`Adjudicated item verdicts (lenient, majority of ${v.repeats} repeats; a missing repeat is an ERROR row and fails):\n`);
    console.log("| Item | B (grader 1 decides) | D (grader 1 decides) | B (both agree, sensitivity) | D (both agree, sensitivity) |\n|---|---|---|---|---|");
    for (const [item, m] of r.items) console.log(`| ${item} | ${pf(m.B)} | ${pf(m.D)} | ${pf(r.bothAgree.get(item)!.B)} | ${pf(r.bothAgree.get(item)!.D)} |`);
    console.log(`Grader 1 vs grader 2: ${fmt(graders)}. Disagreements: ${r.disagreements.length ? "" : "none"}`);
    for (const d of r.disagreements) console.log(`- ${d.rid} (${d.item}, ${d.arm}): grader 1 ${pf(d.grader1)}, grader 2 ${pf(d.grader2)}, lexical ${pf(d.lexical)}`);
    return;
  }

  console.log("| Reading | grader 1 vs grader 2 | grader 1 vs lexical | grader 2 vs lexical | agreed vs lexical | gate (>= 0.8) |");
  console.log("|---|---|---|---|---|---|");
  const report = defineKappaReport(a, b, v);
  for (const r of report) console.log(`| ${r.reading} | ${fmt(r.graders)} | ${fmt(r.aVsLexical)} | ${fmt(r.bVsLexical)} | ${fmt(r.agreedVsLexical)} | ${r.meetsBar ? "passes" : "MISSES"} |`);
  console.log("\nLexical errors on rows the graders agree on:\n\n| Reading | Arm | false pass / human fail | false fail / human pass |\n|---|---|---|---|");
  for (const r of report) for (const arm of ["B", "D"] as const) {
    const t = r.byArm[arm];
    console.log(`| ${r.reading} | ${arm} | ${t.falsePass} / ${t.humanFail} | ${t.falseFail} / ${t.humanPass} |`);
  }
  console.log(`\nGate: ${report.every((r) => r.meetsBar) ? "PASSES" : "MISSES: B8 is descriptive, no accuracy claim (lever 18)"} (both readings, both graders vs lexical, kappa >= 0.8).`);
}

await main();
