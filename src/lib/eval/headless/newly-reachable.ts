// Write lever 19's newly reachable senses to a file for the blind read (docs/BENCHMARKS.md row 19, R1 b).
// Offline: reads the bundled dictionary from public/, no model.
//
//   npx vite-node src/lib/eval/headless/newly-reachable.ts -- <out.tsv>

import { newlyReachable, reachableTsv } from "./newly-reachable-lib";
import { lookupWord, type Shard } from "../../dictionary";
import { installAppOrigin } from "./origin";
import { writeText } from "./node-io";

async function main(): Promise<void> {
  const out = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2).find((a) => /\.tsv$/i.test(a));
  if (!out) throw new Error("Usage: newly-reachable.ts -- <out.tsv>");
  installAppOrigin();
  const meta = (await (await fetch("/dictionary/meta.json")).json()) as { shardKeys: string[] };
  const shards = await Promise.all(meta.shardKeys.map(async (k) => (await (await fetch(`/dictionary/${k}.json`)).json()) as Shard));
  const rows = await newlyReachable(shards, lookupWord);
  await writeText(out, reachableTsv(rows));
  console.log(`${rows.length} senses on ${new Set(rows.map((r) => r.headword)).size} headwords: ${out}`);
}

await main();
