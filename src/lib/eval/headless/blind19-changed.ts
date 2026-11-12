// Write blind-19's changed list (docs/BENCHMARKS.md row 19, R4) beside its items, from the committed
// items and the bundled dictionary. Offline: no model. Run once after the items are committed and
// commit its output before any reply exists.
//
//   npx vite-node src/lib/eval/headless/blind19-changed.ts

import { changedEntry } from "../blind19-changed";
import { lookupWord } from "../../dictionary";
import { BLIND19_CHANGED_FILE, loadItems } from "./blind19-script-lib";
import { installAppOrigin } from "./origin";
import { fs, writeText } from "./node-io";
import type { ChangedList } from "../blind19-grade";

async function main(): Promise<void> {
  const items = await loadItems();
  if (await (await fs()).readFile(BLIND19_CHANGED_FILE, "utf8").then(() => true, () => false)) throw new Error(`${BLIND19_CHANGED_FILE} exists: it is computed once and committed.`);
  installAppOrigin();
  const out: ChangedList = { items: {} };
  for (const item of items) out.items[item.id] = await changedEntry(item.ask, lookupWord);
  await writeText(BLIND19_CHANGED_FILE, JSON.stringify(out, null, 2) + "\n");
  const n = (k: "L" | "C") => items.filter((i) => i.kind === k && out.items[i.id].changed).length;
  console.log(`Changed: ${n("L")} L and ${n("C")} C of ${items.length} items. ${BLIND19_CHANGED_FILE}`);
}

await main();
