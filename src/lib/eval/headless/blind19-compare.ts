// Read lever 19's kill rule and claims on blind-19 (docs/BENCHMARKS.md row 19), offline: no model.
//
//   $env:BLIND19_RUNS = "<every S, R and B results file of every model>"
//   $env:BLIND19_GRADED = "<key.json>|<grader 1 export>|<grader 2 export>,..."   # one triple per sheet
//   $env:BLIND19_SAFETY_READ = "<the newly-reachable read's record>"             # R1 (b); absent = missing
//   npx vite-node src/lib/eval/headless/blind19-compare.ts
//
// Items and the changed list are the committed src/lib/eval/blind-19/items.json and changed.json.
// Refuses (blind19Refusals) runs from different commits, a wrong arm, a partial or void run, repeats
// other than 3, rows missing, a changed list that disagrees with the notes sent, an export for another
// sheet or another grader, an unanswered row, rows left off the sheets, and a canary that is not 20 rows.
// Then prints every clause (each harm and other-models clause three ways), the gate, the accuracy
// reading and the descriptive lines.

import { blind19Refusals, judgeBlind19, READINGS, type Blind19Key, type Blind19Run, type GradedSheet } from "../blind19-grade";
import type { LabelExport } from "../define-label";
import { groupRuns, loadChanged, loadItems, readJson } from "./blind19-script-lib";
import { env, fs } from "./node-io";

async function main(): Promise<void> {
  const e = env();
  const runFiles = (e.BLIND19_RUNS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const graded = (e.BLIND19_GRADED ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!runFiles.length || !graded.length) throw new Error("Set BLIND19_RUNS (results files) and BLIND19_GRADED (key|grader1|grader2 triples).");
  const runs = groupRuns(await Promise.all(runFiles.map((f) => readJson<Blind19Run>(f))));
  const sheets: GradedSheet[] = await Promise.all(graded.map(async (t) => {
    const [k, a, b] = t.split("|");
    if (!k || !a || !b) throw new Error(`BLIND19_GRADED: "${t}" is not key|grader1|grader2`);
    return { key: await readJson<Blind19Key>(k), g1: await readJson<LabelExport>(a), g2: await readJson<LabelExport>(b) };
  }));
  const safetyRead = !!e.BLIND19_SAFETY_READ && (await (await fs()).readFile(e.BLIND19_SAFETY_READ, "utf8").then((t) => t.trim() !== "", () => false));
  const input = { items: await loadItems(), changed: await loadChanged(), runs, sheets, safetyRead };
  const why = blind19Refusals(input);
  if (why.length) throw new Error(`Refusing to judge: ${why.join("; ")}.`);
  const v = judgeBlind19(input);
  const k = v.gate.kappa;
  console.log(`Gate: kappa ${k.kappa === null ? "n/a" : k.kappa.toFixed(3)} (n ${k.n}); "no" answers ${v.gate.no.g1} / ${v.gate.no.g2}; canary "no" ${v.gate.canary.g1} / ${v.gate.canary.g2} of ${v.gate.canary.n} → ${v.gate.passes ? "PASSES" : "MISSES"}${v.gate.undecided ? " (kappa below 0.6: harm undecided)" : ""}\n`);
  console.log("| Clause | Fires | Detail |\n|---|---|---|");
  for (const c of v.clauses) console.log(`| ${c.clause} | ${c.fires ? "**FIRES**" : "no"} | ${c.detail} |`);
  console.log(`\n${v.killed ? "KILLED: not shipped." : "No clause fires: it ships."} Accuracy reading: ${v.accuracy}.\n`);
  console.log("Rule model, item-majority (changed / unchanged, the latter descriptive):\n\n| Reading | Kind | Changed S → R (gained/lost, p) | Unchanged S → R |\n|---|---|---|---|");
  for (const reading of READINGS) for (const kind of ["L", "C"] as const) {
    const { changed: c, unchanged: u } = v.contrasts[reading][kind];
    console.log(`| ${reading} | ${kind} | ${c.s}/${c.n} → ${c.r}/${c.n} (${c.gained.length}/${c.lost.length}, p ${c.p.toPrecision(3)}) | ${u.s}/${u.n} → ${u.r}/${u.n} |`);
  }
  console.log(`\nDescriptive (R5): changed items whose S first sense is absent under R: L ${v.descriptive.L.sFirstAbsentUnderR}, C ${v.descriptive.C.sFirstAbsentUnderR}; items whose top sense scored 1: L ${v.descriptive.L.topScore1}, C ${v.descriptive.C.topScore1}.`);
}

await main();
