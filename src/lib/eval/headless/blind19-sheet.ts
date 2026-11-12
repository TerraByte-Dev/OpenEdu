// Build a blind-19 grading sheet and its hidden key (docs/BENCHMARKS.md B8 "Lever 19"). Offline: no
// model call. Both graders then answer it with define-label-grader2.ts (DEFINE_GRADER_SLOT 1 and 2),
// unchanged; blind19-cost.ts prices the sheets first (R8).
//
//   $env:BLIND19_RUNS = "<S file>,<R file>"      # one model's S and R runs (or its B run alone)
//   $env:BLIND19_SHEET = "blind19-e2b-SR"        # the sheet id: the file name and the answers' key
//   $env:BLIND19_CANARY = "1"                    # only on the gemma4:e2b S and R sheet: the 20 canary rows
//   $env:BLIND19_ONLY_CHANGED = "1"              # R8 step 2: only the changed items (e4b, qwen3.5:4b)
//   npx vite-node src/lib/eval/headless/blind19-sheet.ts
//
// Spending order (R8): the gemma4:e2b S and R sheet first. Writes <main checkout>/.dev/<sheet>.html and
// the key to <main checkout>/.dev/label-verdicts/<sheet>.json, outside the sheet's folder.

import { buildBlind19Sheet, type Blind19Run } from "../blind19-grade";
import { groupRuns, loadChanged, loadItems, readJson } from "./blind19-script-lib";
import { renderDefineSheet } from "./define-script-lib";
import { env, mainCheckout, path, writeText } from "./node-io";

async function main(): Promise<void> {
  const e = env();
  const files = (e.BLIND19_RUNS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sheet = e.BLIND19_SHEET;
  if (!files.length || !sheet) throw new Error("Set BLIND19_RUNS (results files, comma-separated) and BLIND19_SHEET (the sheet id).");
  const p = await path();
  const runs = await Promise.all(files.map((f) => readJson<Blind19Run>(f)));
  const items = await loadItems();
  const only = e.BLIND19_ONLY_CHANGED === "1" ? new Set(Object.entries((await loadChanged()).items).filter(([, c]) => c.changed).map(([id]) => id)) : undefined;
  // A B run stands alone (it is never compared with S or R on a sheet's model); otherwise S and R.
  const arms = runs.length === 1 && runs[0].dictionary === "off"
    ? [{ run: runs[0], arm: "B" as const }]
    : groupRuns(runs).flatMap((m) => [{ run: m.S, arm: "S" as const }, { run: m.R, arm: "R" as const }]);
  const { rows, key } = buildBlind19Sheet(sheet, arms, items, { canary: e.BLIND19_CANARY === "1", onlyItems: only });
  const root = await mainCheckout();
  const sheetFile = p.join(root, ".dev", `${sheet}.html`);
  const keyFile = p.join(root, ".dev", "label-verdicts", `${sheet}.json`);
  await writeText(sheetFile, renderDefineSheet(sheet, rows));
  await writeText(keyFile, JSON.stringify(key, null, 2));
  console.log(`Sheet ${sheet}: ${rows.length} rows (${Object.values(key.rows).filter((k) => k.canary).length} canary): ${sheetFile}\nKey (hidden from graders): ${keyFile}`);
}

await main();
