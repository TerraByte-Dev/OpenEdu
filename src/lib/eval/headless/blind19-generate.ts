// Generate lever 19's held-out set, blind-19 (docs/BENCHMARKS.md B8 "Lever 19"). Everything it does is
// in ../blind19.ts; this file only connects it to Node, the network and the bundled dictionary.
//
//   run-with-secrets npx vite-node src/lib/eval/headless/blind19-generate.ts -- openai/gpt-6.1-sol
//
// It takes no argument but the model, and makes no request without it. Run it once, from the repo
// root, only after senseRank.ts's SHA-256 is committed. Files go to src/lib/eval/blind-19/.

import { generateBlind19, noteCheck } from "../blind19";
import { lookupWord } from "../../dictionary";
import { installAppOrigin } from "./origin";
import { env, fs, writeText } from "./node-io";

async function main(): Promise<void> {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2);
  installAppOrigin();
  const f = await fs();
  await generateBlind19(args, {
    fetch: globalThis.fetch,
    env: env(),
    write: writeText,
    exists: (file) => f.readFile(file, "utf8").then(() => true, () => false),
    hasNote: noteCheck(lookupWord),
    now: () => new Date(),
    log: (line) => console.log(line),
  });
}

await main();
