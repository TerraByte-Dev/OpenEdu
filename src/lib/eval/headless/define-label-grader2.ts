// The blind second grader for the define hand-label sheet (BENCHMARKS.md B8, lever 18's validation
// gate): an OpenAI model, a different family from the models that wrote the replies (gemma, qwen) and
// from the model that wrote the items and the lexical grader (Claude). It answers the sheet's own
// questions about each row's student message and reply, and sees nothing else: no arm, model, lexical
// verdict, expect terms or dictionary note. Writes an export in the sheet's format for define-kappa.ts.
//
//   $env:DEFINE_GRADER2_MODEL = "<an OpenAI chat model that supports structured outputs>"
//   run-with-secrets npx vite-node src/lib/eval/headless/define-label-grader2.ts -- <sheet.html> <out.json>
//
// The model is chosen at run time, not here: pick a current one from OpenAI's model docs and the
// export records its name. OPENAI_API_KEY comes from the environment (run-with-secrets); it is never
// written anywhere. One request per row; a row whose reply cannot be parsed is left unanswered (it then
// drops out of kappa, and the count is printed).

import { DEFINE_LABEL_QUESTIONS, questionText, type LabelExport } from "../define-label";
import type { DefineKind } from "../define-items";
import { env, fs, writeText } from "./node-io";

interface SheetData { sheet: string; rows: Array<{ rid: string; word: string; kind: DefineKind; ask: string; reply: string }> }

/** The sheet's embedded data, read back out of the HTML. */
export function sheetData(html: string): SheetData {
  const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("No sheet data in that file: is it define-label-sheet.ts's HTML?");
  return JSON.parse(m[1]) as SheetData;
}

const INSTRUCTIONS =
  "You are labelling a tutor's replies for a study. Each item is a student's question about what a word means, and one " +
  "tutor reply. Answer each question about the reply as written, with yes or no. Judge the meaning, not the style: a " +
  "reply can be long, short, simple or formal. Do not reward or punish wording; only whether the meaning is correct.";

/** The request body for one row. Pure, so the prompt the grader sees is pinned by a test. */
export function grader2Request(model: string, row: SheetData["rows"][number]): Record<string, unknown> {
  const qs = DEFINE_LABEL_QUESTIONS.filter((q) => q.kinds.includes(row.kind));
  const user = [
    `The student wrote:\n"""\n${row.ask}\n"""`,
    `The tutor replied:\n"""\n${row.reply}\n"""`,
    ...qs.map((q) => `Question "${q.id}": ${questionText(q, row.word, row.kind)}`),
  ].join("\n\n");
  const properties = Object.fromEntries(qs.map((q) => [q.id, { type: "string", enum: ["yes", "no"] }]));
  return {
    model,
    messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: user }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "labels", strict: true, schema: { type: "object", properties, required: qs.map((q) => q.id), additionalProperties: false } },
    },
  };
}

async function main(): Promise<void> {
  const e = env();
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2).filter((a) => /\.(html|json)$/i.test(a));
  const [sheetFile, outFile] = [args.find((a) => /\.html$/i.test(a)), args.find((a) => /\.json$/i.test(a))];
  if (!sheetFile || !outFile) throw new Error("Usage: define-label-grader2.ts -- <sheet.html> <out.json>");
  const model = e.DEFINE_GRADER2_MODEL;
  if (!model) throw new Error("Set DEFINE_GRADER2_MODEL to the OpenAI model to use (checked against OpenAI's docs at run time).");
  const key = e.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set: run this through run-with-secrets.");
  const data = sheetData(await (await fs()).readFile(sheetFile, "utf8"));
  const answers: LabelExport["answers"] = {};
  let failed = 0;
  for (const row of data.rows) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(grader2Request(model, row)),
    });
    try {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      answers[row.rid] = JSON.parse(body.choices[0].message.content) as LabelExport["answers"][string];
    } catch (err) {
      failed++;
      console.log(`[grader2] ${row.rid}: no answer (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  const out: LabelExport = { sheet: data.sheet, grader: `openai:${model}`, exportedAt: new Date().toISOString(), answers };
  await writeText(outFile, JSON.stringify(out, null, 2));
  console.log(`[grader2] ${data.rows.length - failed}/${data.rows.length} rows answered by ${model}: ${outFile}`);
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv.some((a) => /define-label-grader2\.ts$/.test(a))) await main();
