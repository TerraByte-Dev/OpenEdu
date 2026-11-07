// `npm run eval` runs this file and nothing else (vitest.eval.config.ts includes only *.eval.ts, and
// the normal `npm test` config includes only *.test.ts). Options come from EVAL_* environment
// variables; see ./README.md.
import { it } from "vitest";
import { runHeadlessEval } from "./run";
import { env } from "./node-io";

it("headless eval", async () => {
  await runHeadlessEval(env());
}, 0);
