// Build the define suite's hand-label sheet (BENCHMARKS.md B8, lever 18's validation gate): one
// self-contained HTML file for the graders, plus the hidden verdicts file define-kappa.ts reads.
// Offline: no model call.
//
//   $env:DEFINE_LABEL_FILES = "<B dev file>,<D dev file>[,<more dev files>]"
//   npx vite-node src/lib/eval/headless/define-label-sheet.ts
//
// Kappa sheet (the default): 60 rows drawn by define-label.ts selectDefineLabelRows from the non-ERROR
// rows of the given dev results files. Harm adjudication (DEFINE_LABEL_ITEMS=<ids>): every non-ERROR
// row of those items in the given files (both arms, every repeat). Either way the rows are shuffled and
// the sheet shows only the student's message and the reply: never the arm, the model, the lexical
// verdict, the expect terms or the dictionary note.
//
// Writes <main checkout>/.dev/<sheet id>.html and the verdicts to
// <main checkout>/.dev/label-verdicts/<sheet id>.json (DEFINE_LABEL_VERDICTS overrides; never in the
// sheet's folder). define-grade.ts and define-items.ts must be committed: the sheet id names them.

import { DEFINE_ITEMS, DEFINE_SPLIT } from "../define-items";
import { gradeDefine } from "../define-grade";
import { DEFINE_LABEL_SEED, selectDefineLabelRows, shuffled, type DefineLabelCandidate, type DefineLabelVerdicts } from "../define-label";
import { graderCommits, renderDefineSheet } from "./define-script-lib";
import { env, fs, mainCheckout, path, writeText } from "./node-io";

interface SavedRow { id: string; repeat: number; error: string | null; reply: string; ask: string }
interface Saved { suite: string; model: string; split: string; dictionary: "on" | "off"; repeats: number; rows: SavedRow[] }


async function main(): Promise<void> {
  const e = env();
  const [f, p] = await Promise.all([fs(), path()]);
  const files = (e.DEFINE_LABEL_FILES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (files.length < 2) throw new Error("Set DEFINE_LABEL_FILES to the B and D dev results files (comma-separated).");
  const only = e.DEFINE_LABEL_ITEMS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const grader = await graderCommits();
  const root = await mainCheckout();
  const byId = new Map(DEFINE_ITEMS.map((i) => [i.id, i]));
  const pool: DefineLabelCandidate[] = [];
  const rowOf = new Map<string, { row: SavedRow; source: string }>();
  const models = new Set<string>();
  const repeats = new Set<number>();
  for (const file of files) {
    const data = JSON.parse(await f.readFile(file, "utf8")) as Saved;
    if (data.suite !== "define") throw new Error(`${file}: not a define results file`);
    models.add(data.model);
    repeats.add(data.repeats);
    // The kappa sheet is drawn from dev rows only; adjudication reads the test rows a harm clause named.
    if (!only && data.split !== "dev") throw new Error(`${file}: the kappa sheet uses dev rows only`);
    const arm = data.dictionary === "off" ? "B" : "D";
    for (const r of data.rows) {
      const item = byId.get(r.id);
      if (!item || r.error || (only && !only.includes(r.id)) || (!only && DEFINE_SPLIT[r.id] !== "dev")) continue;
      // The verdicts come from the grader in this checkout, not the file, so a sheet always matches its id.
      const g = gradeDefine(item, r.reply);
      const uid = `${data.model}|${arm}|${r.id}|${r.repeat}`;
      rowOf.set(uid, { row: r, source: p.relative(root, file) });
      pool.push({ uid, model: data.model, arm, item: r.id, repeat: r.repeat, kind: item.kind, band: item.band, lenient: g.pass, strict: g.passStrict });
    }
  }
  if (repeats.size !== 1) throw new Error(`The files ran different repeat counts (${[...repeats].join(", ")}).`);
  // Item verdicts on an adjudication sheet are per model: one model per sheet.
  if (only && models.size !== 1) throw new Error(`An adjudication sheet holds one model's B and D files; these name ${[...models].join(", ")}.`);
  const shown = only ? selectAll(pool) : selectDefineLabelRows(pool);
  // The id names the model(s), the row set and the grader commits, so two sheets never share an id, a
  // file or the browser's saved answers (the localStorage key is the id).
  const rowSet = (await sha256([...shown].map((c) => c.uid).sort().join("\n"))).slice(0, 10);
  const modelSlug = [...models].sort().join("+").replace(/[^A-Za-z0-9._+-]+/g, "_");
  const sheetId = `define-label-${only ? "adjudication-" : ""}${modelSlug}-r${rowSet}-g${grader}`;
  const sheetFile = p.join(root, ".dev", `${sheetId}.html`);
  const verdictFile = p.resolve(e.DEFINE_LABEL_VERDICTS ?? p.join(root, ".dev", "label-verdicts", `${sheetId}.json`));
  if (p.dirname(verdictFile).toLowerCase() === p.dirname(sheetFile).toLowerCase()) throw new Error("Write the verdicts outside the sheet's folder.");

  const verdicts: DefineLabelVerdicts = { sheet: sheetId, grader, adjudication: !!only, repeats: [...repeats][0], rows: {} };
  const sheetRows = shown.map((c, i) => {
    const rid = `R${String(i + 1).padStart(2, "0")}`;
    const { row, source } = rowOf.get(c.uid)!;
    verdicts.rows[rid] = { source, model: c.model, arm: c.arm, item: c.item, repeat: c.repeat, kind: c.kind, band: c.band, lenient: c.lenient, strict: c.strict };
    return { rid, word: byId.get(c.item)!.word, kind: c.kind, ask: row.ask, reply: row.reply };
  });
  await writeText(sheetFile, renderDefineSheet(sheetId, sheetRows));
  await writeText(verdictFile, JSON.stringify(verdicts, null, 2));
  const n = (t: (c: DefineLabelCandidate) => boolean) => shown.filter(t).length;
  console.log(`Sheet ${sheetId}: ${sheetFile}\nVerdicts (hidden from graders): ${verdictFile}\nRows ${shown.length}: B ${n((c) => c.arm === "B")}, D ${n((c) => c.arm === "D")}, sense ${n((c) => c.kind === "sense")}, lexical fail ${n((c) => !c.lenient)}, sense strict-only fail ${n((c) => c.kind === "sense" && c.lenient && !c.strict)}`);
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Adjudication: every row (both arms, every repeat), in a stable order, shuffled with the frozen seed. */
function selectAll(pool: DefineLabelCandidate[]): DefineLabelCandidate[] {
  return shuffled([...pool].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)), DEFINE_LABEL_SEED);
}

await main();
