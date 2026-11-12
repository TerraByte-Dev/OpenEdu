// The blind second grader for the define hand-label sheet (BENCHMARKS.md B8, lever 18's validation
// gate): an OpenAI model, a different family from the models that wrote the replies (gemma, qwen) and
// from the model that wrote the items and the lexical grader (Claude). It answers the sheet's own
// questions about each row's student message and reply, and sees nothing else: no arm, model, lexical
// verdict, expect terms or dictionary note. Writes an export in the sheet's format for define-kappa.ts.
//
//   $env:DEFINE_GRADER2_MODEL = "<an OpenAI chat model that supports structured outputs>"
//   run-with-secrets npx vite-node src/lib/eval/headless/define-label-grader2.ts -- <sheet.html> <out.json>
//
// The model is chosen at run time, not here: pick a current one from OpenAI's model docs; the export
// records its name, and no sampling parameters are set (the API's defaults). One run per sheet: the first
// complete export is the one scored; any rerun is reported beside it. OPENAI_API_KEY comes from the
// environment (run-with-secrets) and is never written anywhere. One request per row, retried once; if
// any row is still unanswered the export is written and the script exits non-zero (define-kappa.ts
// refuses an export that does not answer every row).
//
// Route: OpenAI's own API by default. DEFINE_GRADER2_ROUTE=openrouter sends the same request to
// OpenRouter's OpenAI-compatible endpoint, with OPENROUTER_API_KEY and the model named "openai/<id>":
// still an OpenAI model, reached through another account. The export's grader field records the route.
//
// Grader 1 (BENCHMARKS.md B8, amendment of 2026-11-11: no human grader): DEFINE_GRADER_SLOT=1 sends the
// same request, word for word, to a Claude model through OpenRouter (DEFINE_GRADER2_ROUTE=openrouter,
// the model named "anthropic/<id>"). Only the vendor check changes; the prompt, schema and rules do not.
//
// Resume (lever 19, BENCHMARKS.md R8): run it again with the same sheet and output file and the rows
// already answered are kept; only the rest are asked. The export is saved every 25 requests.

import { DEFINE_LABEL_QUESTIONS } from "../define-label";
import { grader2Request, sheetData, type SheetData } from "./define-script-lib";
import type { LabelExport } from "../define-label";
import { env, fs, writeText } from "./node-io";

/** Every question the row's kind asks has a yes or no. */
const answeredAll = (row: SheetData["rows"][number], a: LabelExport["answers"][string] | undefined): boolean =>
  !!a && DEFINE_LABEL_QUESTIONS.filter((q) => q.kinds.includes(row.kind)).every((q) => a[q.id] === "yes" || a[q.id] === "no");

async function main(): Promise<void> {
  const e = env();
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2).filter((a) => /\.(html|json)$/i.test(a));
  const [sheetFile, outFile] = [args.find((a) => /\.html$/i.test(a)), args.find((a) => /\.json$/i.test(a))];
  if (!sheetFile || !outFile) throw new Error("Usage: define-label-grader2.ts -- <sheet.html> <out.json>");
  const model = e.DEFINE_GRADER2_MODEL;
  if (!model) throw new Error("Set DEFINE_GRADER2_MODEL to the OpenAI model to use (checked against OpenAI's docs at run time).");
  const viaOpenRouter = e.DEFINE_GRADER2_ROUTE === "openrouter";
  const slot1 = e.DEFINE_GRADER_SLOT === "1";
  if (slot1 && (!viaOpenRouter || !model.startsWith("anthropic/"))) throw new Error('Grader 1 is a Claude model through OpenRouter: DEFINE_GRADER2_ROUTE=openrouter and a model named "anthropic/<id>".');
  if (viaOpenRouter && !slot1 && !model.startsWith("openai/")) throw new Error('Through OpenRouter grader 2 must be an OpenAI model, named "openai/<id>".');
  const keyName = viaOpenRouter ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  const key = e[keyName];
  if (!key) throw new Error(`${keyName} is not set: run this through run-with-secrets.`);
  const endpoint = viaOpenRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const f = await fs();
  const data = sheetData(await f.readFile(sheetFile, "utf8"));
  const grader = viaOpenRouter ? `openrouter:${model}` : `openai:${model}`;
  // Resume (lever 19, R8): an earlier export of this sheet by this grader keeps its fully answered rows;
  // only the rest are asked. The request for a row is the same either way.
  const answers: LabelExport["answers"] = await f.readFile(outFile, "utf8").then((t) => {
    const prev = JSON.parse(t) as LabelExport;
    if (prev.sheet !== data.sheet || prev.grader !== grader) throw new Error(`${outFile} is another sheet's or another grader's export; pick a new file.`);
    return Object.fromEntries(Object.entries(prev.answers).filter(([rid]) => {
      const row = data.rows.find((r) => r.rid === rid);
      return !!row && answeredAll(row, prev.answers[rid]);
    }));
  }, () => ({}));
  const kept = Object.keys(answers).length;
  if (kept) console.log(`[grader2] resuming ${outFile}: ${kept} row(s) already answered`);
  const save = () => writeText(outFile, JSON.stringify({ sheet: data.sheet, grader, exportedAt: new Date().toISOString(), answers } satisfies LabelExport, null, 2));
  const ask = async (row: (typeof data.rows)[number]): Promise<LabelExport["answers"][string]> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(grader2Request(model, row)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return JSON.parse(body.choices[0].message.content) as LabelExport["answers"][string];
  };
  const missing: string[] = [];
  let asked = 0;
  for (const row of data.rows) {
    if (answers[row.rid]) continue;
    if (++asked % 25 === 0) await save();
    for (let attempt = 1; attempt <= 2 && !answers[row.rid]; attempt++) {
      try {
        answers[row.rid] = await ask(row);
      } catch (err) {
        console.log(`[grader2] ${row.rid} attempt ${attempt}: no answer (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (!answers[row.rid]) missing.push(row.rid);
  }
  await save();
  console.log(`[grader2] ${data.rows.length - missing.length}/${data.rows.length} rows answered by ${model}: ${outFile}`);
  if (missing.length) throw new Error(`Unanswered rows after a retry: ${missing.join(", ")}. define-kappa.ts will refuse this export.`);
}

await main();
