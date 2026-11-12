// R8's dry run (docs/BENCHMARKS.md B8 "Lever 19", Cost): before any grader request, build every
// request of every planned sheet, as define-label-grader2.ts would send it, and price it. Offline: no
// request is sent.
//
//   $env:BLIND19_SHEETS = "<sheet.html>,<sheet.html>,..."   # every sheet planned
//   $env:BLIND19_PRICE = "anthropic/claude-fable-5.2=<in>/<out>,openai/gpt-6.1-sol=<in>/<out>"   # USD per M tokens, today's
//   $env:BLIND19_CREDIT = "9"                               # the OpenRouter credit, USD
//   npx vite-node src/lib/eval/headless/blind19-cost.ts
//
// Over 80% of the credit, apply in order and record: (1) the :batch slugs for both graders (check first
// that they honour response_format); (2) grade e4b and qwen3.5:4b only on changed items
// (BLIND19_ONLY_CHANGED=1) and drop the grading of arm B. Then run this again.

import { dryRun, parsePrices } from "./blind19-script-lib";
import { sheetData } from "./define-script-lib";
import { env, fs } from "./node-io";

async function main(): Promise<void> {
  const e = env();
  const files = (e.BLIND19_SHEETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!files.length || !e.BLIND19_PRICE || !e.BLIND19_CREDIT) throw new Error("Set BLIND19_SHEETS, BLIND19_PRICE and BLIND19_CREDIT.");
  const f = await fs();
  const sheets = await Promise.all(files.map(async (file) => sheetData(await f.readFile(file, "utf8"))));
  const r = dryRun(sheets, parsePrices(e.BLIND19_PRICE), Number(e.BLIND19_CREDIT));
  for (const m of r.perModel) console.log(`${m.model}: ${m.requests} requests, ~${m.inTokens} prompt tokens, ~$${m.usd.toFixed(2)}`);
  console.log(`Total ~$${r.usd.toFixed(2)} of $${r.credit} credit: ${r.over ? "OVER 80% — apply the R8 savings in order, then price again" : "within 80%"}.`);
}

await main();
